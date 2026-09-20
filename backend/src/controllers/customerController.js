const crypto = require('crypto');
const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { normalizePhone, findUserByPhone } = require('../services/whatsappConversationService');
const { logActivity } = require('../services/activityLogService');

// Orders in these statuses don't represent real revenue -- excluded from
// total_spent the same way a "completed sales" figure would exclude them.
const SPEND_EXCLUDED_STATUSES = ['cancelled'];

function summarizeOrders(orders = []) {
  const counted = orders.filter((o) => !SPEND_EXCLUDED_STATUSES.includes(o.status));
  const total_spent = counted.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
  const last_order_at = orders.reduce((latest, o) => {
    return !latest || o.created_at > latest ? o.created_at : latest;
  }, null);
  return { order_count: orders.length, total_spent, last_order_at };
}

// Admin/sales_rep only: every customer with order/quote counts and lifetime
// spend. There's no GROUP BY available through the Supabase client without
// a Postgres view/RPC, so this aggregates in JS the same way the analytics
// endpoint does -- fine at this data scale, matches the rest of this codebase.
const getAllCustomersAdmin = asyncHandler(async (req, res) => {
  const { search, page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const from = (pageNum - 1) * limitNum;
  const to = from + limitNum - 1;

  let query = supabase
    .from('users')
    .select('id, email, company_name, created_at, orders(id, status, total_amount, created_at), quotes(id)', {
      count: 'exact',
    })
    .eq('role', 'customer')
    .order('created_at', { ascending: false })
    .range(from, to);

  if (search) {
    const safeSearch = search.replace(/[,()]/g, '');
    query = query.or(`email.ilike.%${safeSearch}%,company_name.ilike.%${safeSearch}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const customers = data.map(({ orders, quotes, ...customer }) => ({
    ...customer,
    quote_count: quotes.length,
    ...summarizeOrders(orders),
  }));

  return res.json({ data: customers, page: pageNum, limit: limitNum, total: count });
});

// Admin/sales_rep only: one customer's profile plus full order/quote history.
const getCustomerDetailAdmin = asyncHandler(async (req, res) => {
  const { data: customer, error: customerErr } = await supabase
    .from('users')
    .select('id, email, company_name, phone, created_at')
    .eq('id', req.params.id)
    .eq('role', 'customer')
    .single();

  if (customerErr || !customer) return res.status(404).json({ error: 'Customer not found' });

  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('*, order_items(*, products(name, sku))')
    .eq('customer_id', req.params.id)
    .order('created_at', { ascending: false });
  if (ordersErr) throw ordersErr;

  const { data: quotes, error: quotesErr } = await supabase
    .from('quotes')
    .select('*, quote_items(*, products(name, sku))')
    .eq('customer_id', req.params.id)
    .order('created_at', { ascending: false });
  if (quotesErr) throw quotesErr;

  return res.json({ ...customer, ...summarizeOrders(orders), orders, quotes });
});

// Admin/sales_rep only: for building a quote/order on behalf of someone who
// has never signed up themselves (e.g. a phone-in or walk-in customer).
// public.users.id is a foreign key onto auth.users(id) (001_auth_user_sync.sql),
// so a "customer" can't exist as a bare profile row -- this creates a real
// Supabase Auth user (random password nobody's meant to know; they'd reset
// it via "Forgot password?" if they ever want portal access themselves)
// exactly like the public register() and WhatsApp new-account flows do,
// then upserts the profile row rather than relying solely on the
// handle_new_auth_user trigger, for the same trigger-timing reason those
// two callers do.
const createCustomerAdmin = asyncHandler(async (req, res) => {
  const { email, company_name, full_name, phone } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  const { data: existingByEmail } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
  if (existingByEmail) {
    return res.status(400).json({ error: 'A customer with that email already exists.' });
  }

  const normalizedPhone = phone ? normalizePhone(phone) : null;
  if (normalizedPhone) {
    const existingByPhone = await findUserByPhone(normalizedPhone);
    if (existingByPhone) {
      return res.status(400).json({ error: 'A customer with that phone number already exists.' });
    }
  }

  const randomPassword = crypto.randomBytes(24).toString('hex');
  const { data: created, error } = await supabase.auth.admin.createUser({
    email,
    password: randomPassword,
    email_confirm: true,
    user_metadata: { company_name: company_name || null, full_name: full_name || null, role: 'customer' },
  });
  if (error) return res.status(400).json({ error: error.message });

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .upsert(
      {
        id: created.user.id,
        email,
        company_name: company_name || null,
        full_name: full_name || null,
        role: 'customer',
        status: 'approved',
        phone: normalizedPhone,
      },
      { onConflict: 'id' }
    )
    .select('id, email, company_name, full_name, phone')
    .single();
  if (profileError) throw profileError;

  await logActivity({
    actorId: req.user.id,
    actorRole: req.user.role,
    actorLabel: req.user.company_name || req.user.email,
    action: 'customer.created',
    entityType: 'customer',
    entityId: profile.id,
    description: `${req.user.company_name || req.user.email} created a new customer account for ${profile.company_name || profile.email} (${profile.email}).`,
  });

  return res.status(201).json(profile);
});

module.exports = { getAllCustomersAdmin, getCustomerDetailAdmin, createCustomerAdmin };
