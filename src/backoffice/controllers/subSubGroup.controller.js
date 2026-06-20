import { pool } from '../../config/db.js';
import * as subSubGroupService from '../services/subSubGroup.service.js';

export async function listSubSubGroups(req, res) {
  try {
    const subSubGroups = await subSubGroupService.listSubSubGroups(
      pool,
      req.authStaff,
      req.query.branchId,
      req.query.groupId,
      req.query.subGroupId
    );
    return res.json({ subSubGroups });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load sub-sub-groups' });
  }
}

export async function createSubSubGroup(req, res) {
  try {
    const created = await subSubGroupService.createSubSubGroup(pool, req.body, req.authStaff);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    if (err.code === '23505') {
      const c = String(err.constraint || '');
      const dupCode = c.toLowerCase().includes('sub_sub_group_code') || c.toLowerCase().includes('subsubgroup');
      return res.status(409).json({
        message: dupCode
          ? 'Sub-sub-group code already exists for this company'
          : 'Duplicate sub-sub-group row',
        constraint: c || undefined,
      });
    }
    if (err.code === '23503') {
      return res.status(400).json({ message: 'Invalid parent sub-group for this branch' });
    }
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'Sub-sub-group table not installed. Run database migrations.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not create sub-sub-group' });
  }
}
