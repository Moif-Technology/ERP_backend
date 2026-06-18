import { pool } from '../../config/db.js';
import * as groupService from '../services/group.service.js';

export async function listGroups(req, res) {
  try {
    const groups = await groupService.listGroups(pool, req.authStaff, req.query.branchId);
    return res.json({ groups });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load groups' });
  }
}

export async function createGroup(req, res) {
  try {
    const created = await groupService.createGroup(pool, req.body, req.authStaff);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    if (err.code === '23505') {
      const c = String(err.constraint || '');
      const looksTenantScoped =
        c.includes('company') &&
        c.includes('branch') &&
        (c.includes('group_code') || c.includes('groupcode'));
      return res.status(409).json({
        message: looksTenantScoped
          ? 'Group code already exists for this company and branch'
          : 'Duplicate group row. If another company should be allowed the same code on this branch, run database/migrations/007_biz_group_master_unique_company_scope.sql (a unique index may be missing company_id).',
        constraint: c || undefined,
      });
    }
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'Group table not installed. Run database migrations.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not create group' });
  }
}
