import { pool } from '../config/db.js';
import * as subGroupService from '../services/subGroup.service.js';

export async function listSubGroups(req, res) {
  try {
    const subGroups = await subGroupService.listSubGroups(
      pool,
      req.authStaff,
      req.query.branchId,
      req.query.groupId
    );
    return res.json({ subGroups });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load sub-groups' });
  }
}

export async function createSubGroup(req, res) {
  try {
    const created = await subGroupService.createSubGroup(pool, req.body, req.authStaff);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    if (err.code === '23505') {
      const c = String(err.constraint || '');
      const dupCode = c.toLowerCase().includes('sub_group_code') || c.toLowerCase().includes('subgroup');
      return res.status(409).json({
        message: dupCode
          ? 'Sub-group code already exists for this company'
          : 'Duplicate sub-group row',
        constraint: c || undefined,
      });
    }
    if (err.code === '23503') {
      return res.status(400).json({ message: 'Invalid parent group for this branch' });
    }
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'Sub-group table not installed. Run database migrations.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not create sub-group' });
  }
}
