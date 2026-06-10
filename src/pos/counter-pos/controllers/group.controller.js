import * as groupService from '../services/group.service.js';

function handleError(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: fallback });
}

/**
 * GET /api/counter-pos/groups
 * Returns all active groups for the logged-in company + branch.
 */
export async function listGroups(req, res) {
  try {
    const groups = await groupService.listGroups(req.authStaff);
    return res.json({ groups });
  } catch (err) {
    return handleError(res, err, 'Failed to load groups');
  }
}
