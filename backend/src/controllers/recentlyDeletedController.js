const asyncHandler = require('../utils/asyncHandler');
const { logForUser } = require('../services/activityLogService');
const { deleteRecord, restoreRecord, listRecentlyDeleted, purgeRecentlyDeleted } = require('../services/recentlyDeletedService');

// Admin only (the routes). See recentlyDeletedService.js for what each kind
// can be, and what happens after 30 days.

// The page. Clears out what's past its 30 days first, so that happens even
// where the background jobs don't run.
const getRecentlyDeleted = asyncHandler(async (req, res) => {
  try {
    await purgeRecentlyDeleted();
  } catch (err) {
    console.error('Could not clear out Recently deleted:', err.message || err);
  }
  return res.json({ data: await listRecentlyDeleted() });
});

const deleteToBin = asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  const result = await deleteRecord(type, id, req.user.id);
  if (result.error) return res.status(result.status).json({ error: result.error });

  await logForUser(req.user, {
    action: `${type}.deleted`,
    entityType: type,
    entityId: id,
    description: `Deleted ${result.name}${result.cancelled ? ', cancelling it first' : ''}. It's in Recently deleted for 30 days.`,
  });
  return res.json({ message: 'Moved to Recently deleted', ...result });
});

const restoreFromBin = asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  const result = await restoreRecord(type, id);
  if (result.error) return res.status(result.status).json({ error: result.error });

  await logForUser(req.user, {
    action: `${type}.restored`,
    entityType: type,
    entityId: id,
    description: `Restored ${result.name} from Recently deleted.`,
  });
  return res.json({ message: 'Restored', ...result });
});

module.exports = { getRecentlyDeleted, deleteToBin, restoreFromBin };
