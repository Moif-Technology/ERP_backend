import { pool } from '../../config/db.js';
import * as staffEntryService from '../services/staffEntry.service.js';
import * as staffPinService from '../services/staffPin.service.js';

export async function listStaff(req, res) {
  try {
    const staff = await staffEntryService.listStaffMembers(pool, req.authStaff, req.query);
    return res.json({ staff });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load staff' });
  }
}

export async function listBranches(req, res) {
  try {
    const branches = await staffEntryService.listBranchesForCompany(pool, req.authStaff.company_id);
    return res.json({ branches });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not load branches' });
  }
}

export async function createStaff(req, res) {
  try {
    const created = await staffEntryService.createStaffMember(pool, req.body, req.authStaff);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Staff code or login already exists' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not create staff' });
  }
}

export async function updateStaff(req, res) {
  try {
    const updated = await staffEntryService.updateStaffMember(
      pool, req.params.staffId, req.body, req.authStaff
    );
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not update staff' });
  }
}

export async function resetStaffPassword(req, res) {
  try {
    const result = await staffEntryService.resetStaffPassword(
      pool, req.params.staffId, req.body, req.authStaff
    );
    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not reset password' });
  }
}

export async function updateStaffRole(req, res) {
  try {
    const updated = await staffEntryService.updateStaffMemberRole(
      pool,
      req.params.staffId,
      req.body,
      req.authStaff
    );
    return res.json(updated);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not update staff role' });
  }
}

export async function setStaffPin(req, res) {
  try {
    const result = await staffPinService.setStaffPin(
      pool,
      req.params.staffId,
      req.body,
      req.authStaff
    );
    return res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not set staff PIN' });
  }
}
