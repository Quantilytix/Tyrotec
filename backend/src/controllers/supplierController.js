const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { logForUser } = require('../services/activityLogService');

const WRITABLE_FIELDS = ['name', 'email', 'phone', 'location', 'vat_number', 'credit_terms_days', 'is_active'];

function pickSupplierFields(body = {}) {
  const fields = {};
  for (const field of WRITABLE_FIELDS) {
    if (body[field] === undefined) continue;
    const value = body[field];
    if (field === 'is_active') fields[field] = value === true;
    else if (field === 'credit_terms_days') fields[field] = Number(value);
    else fields[field] = value === null || String(value).trim() === '' ? null : String(value).trim();
  }
  return fields;
}

// Products keep plain-text copies of their supplier's details (exports and
// older screens read them); keep those in step with the supplier record.
async function syncProductSupplierCopies(supplier) {
  const { error } = await supabase
    .from('products')
    .update({
      supplier_name: supplier.name,
      supplier_location: supplier.location,
      supplier_email: supplier.email,
      supplier_phone: supplier.phone,
    })
    .eq('supplier_id', supplier.id);
  if (error) console.error('supplier copy sync failed:', error.message);
}

function friendlySupplierError(error) {
  if (error?.code === '23505') return 'A supplier with this name already exists.';
  if (error?.code === '23514') return 'Check the supplier details: credit terms must be 0-365 days and the name is required.';
  return null;
}

// Staff. ?search= matches name/email; inactive suppliers only with ?include_inactive=true.
const listSuppliers = asyncHandler(async (req, res) => {
  let query = supabase.from('suppliers').select('*').order('name', { ascending: true });
  if (req.query.include_inactive !== 'true') query = query.eq('is_active', true);
  if (req.query.search) {
    const safe = String(req.query.search).replace(/[,()]/g, '');
    query = query.or(`name.ilike.%${safe}%,email.ilike.%${safe}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return res.json({ data });
});

const createSupplier = asyncHandler(async (req, res) => {
  const fields = pickSupplierFields(req.body);
  if (!fields.name) return res.status(400).json({ error: 'A supplier name is required.' });

  const { data, error } = await supabase.from('suppliers').insert([fields]).select().single();
  if (error) {
    const friendly = friendlySupplierError(error);
    if (friendly) return res.status(400).json({ error: friendly });
    throw error;
  }

  await logForUser(req.user, {
    action: 'supplier.created',
    entityType: 'supplier',
    entityId: data.id,
    description: `Added supplier ${data.name}.`,
  });
  return res.status(201).json(data);
});

const updateSupplier = asyncHandler(async (req, res) => {
  const fields = pickSupplierFields(req.body);
  if (fields.name === null) return res.status(400).json({ error: 'A supplier name is required.' });
  if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'Nothing to update.' });

  const { data, error } = await supabase
    .from('suppliers')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) {
    const friendly = friendlySupplierError(error);
    if (friendly) return res.status(400).json({ error: friendly });
    if (error.code === 'PGRST116') return res.status(404).json({ error: 'Supplier not found' });
    throw error;
  }

  await syncProductSupplierCopies(data);
  await logForUser(req.user, {
    action: 'supplier.updated',
    entityType: 'supplier',
    entityId: data.id,
    description: `Updated supplier ${data.name}${fields.is_active === false ? ' (deactivated)' : ''}.`,
  });
  return res.json(data);
});

module.exports = { listSuppliers, createSupplier, updateSupplier, syncProductSupplierCopies };
