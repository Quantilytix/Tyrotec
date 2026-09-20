const supabase = require('../config/supabase');
const { isStaff } = require('../utils/roles');

// The audit log is read as two separate views (025_staff_invites_and_audit.sql):
// what customers did, and what staff did. The actor's role is recorded at the
// time of the action rather than joined from the user record, so promoting a
// sales rep to admin never re-labels what they did last month.
const AUDIENCES = {
  staff: ['sales_rep', 'admin', 'super_admin'],
  customer: ['customer'],
  system: ['system'],
};

// Fire-and-forget on purpose: a logging failure must never break the real
// action it's recording (approving an order, resolving a review, etc.).
// Every call site awaits this for ordering, but errors are swallowed here
// (and surfaced to the server log) instead of thrown.
async function logActivity({
  actorId = null,
  actorLabel,
  actorRole = 'system',
  action,
  entityType = null,
  entityId = null,
  description,
}) {
  const { error } = await supabase.from('activity_log').insert([
    {
      actor_id: actorId,
      actor_label: actorLabel,
      actor_role: actorRole,
      action,
      entity_type: entityType,
      entity_id: entityId,
      description,
    },
  ]);
  if (error) console.error('activityLog insert failed:', error.message);
}

// Convenience for the common case: log what a signed-in user just did, with
// their label and role filled in from req.user.
function logForUser(user, entry) {
  return logActivity({
    actorId: user?.id || null,
    actorLabel: user?.company_name || user?.email || 'Unknown',
    actorRole: user?.role || 'system',
    ...entry,
  });
}

// Admin only (enforced at the route) -- paginated, newest first.
// `audience` picks the view: 'staff' (everything staff and automated actors
// did) or 'customer'. Automated entries (the PayFast webhook, the reservation
// jobs) belong with staff activity: they're the business's own side of the
// conversation, not something a customer did.
async function listActivity({ page = 1, limit = 50, audience, action, search, from, to } = {}) {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const offset = (pageNum - 1) * limitNum;

  let query = supabase
    .from('activity_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limitNum - 1);

  if (audience === 'customer') {
    query = query.in('actor_role', AUDIENCES.customer);
  } else if (audience === 'staff') {
    query = query.in('actor_role', [...AUDIENCES.staff, ...AUDIENCES.system]);
  }

  if (action) query = query.eq('action', action);
  if (from) query = query.gte('created_at', `${from}T00:00:00.000+02:00`);
  if (to) query = query.lte('created_at', `${to}T23:59:59.999+02:00`);
  if (search) {
    // Same separator stripping as the product search: ',' '(' ')' are
    // PostgREST's own filter syntax and would otherwise inject conditions.
    const safe = String(search).replace(/[,()]/g, '');
    query = query.or(`actor_label.ilike.%${safe}%,description.ilike.%${safe}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { data, page: pageNum, limit: limitNum, total: count };
}

// The distinct actions present in the log, for the filter dropdown -- so it
// only ever offers filters that would actually match something.
async function listActions() {
  const { data, error } = await supabase.from('activity_log').select('action');
  if (error) throw error;
  return [...new Set((data || []).map((row) => row.action))].sort();
}

module.exports = { logActivity, logForUser, listActivity, listActions, AUDIENCES, isStaff };
