import { pool } from '../../config/db.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import { ensureBranchIntegrationDefaults } from '../../accounts/repositories/accountsParameter.repository.js';
import { seedDefaultDesignations } from '../repositories/designation.repository.js';

const VALID_TYPES = new Set(['GENERAL', 'COUNTER_POS', 'RESTAURANT_POS', 'GARAGE', 'WAREHOUSE', 'HEAD_OFFICE']);

export async function listBranches(req, res) {
  try {
    const { rows } = await branchRepo.listBranchesByCompany(pool, req.authStaff.company_id);
    return res.json({ branches: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not load branches' });
  }
}

export async function createBranch(req, res) {
  try {
    const companyId = req.authStaff.company_id;
    const { branchName, branchCode, branchType, address, phone } = req.body;

    if (!branchName || !String(branchName).trim()) {
      return res.status(400).json({ message: 'branchName is required' });
    }
    if (!branchCode || !String(branchCode).trim()) {
      return res.status(400).json({ message: 'branchCode is required' });
    }
    const type = String(branchType || 'GENERAL').toUpperCase();
    if (!VALID_TYPES.has(type)) {
      return res.status(400).json({ message: `Invalid branchType. Valid: ${[...VALID_TYPES].join(', ')}` });
    }

    const branchId = await branchRepo.nextBranchId(pool, companyId);
    const branch = await branchRepo.insertBranch(pool, {
      companyId,
      branchId,
      branchCode: String(branchCode).trim().toUpperCase(),
      branchName: String(branchName).trim(),
      branchType: type,
      address: address ? String(address).trim() : null,
      phone: phone ? String(phone).trim() : null,
      actor: req.authStaff.staff_id,
    });
    await ensureBranchIntegrationDefaults(pool, companyId, branchId);
    await seedDefaultDesignations(pool, companyId, branchId);
    return res.status(201).json({ branch });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Branch code already exists for this company' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not create branch' });
  }
}

export async function updateBranch(req, res) {
  try {
    const companyId = req.authStaff.company_id;
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) {
      return res.status(400).json({ message: 'Invalid branchId' });
    }

    const { branchName, branchCode, branchType, address, phone } = req.body;
    if (!branchName || !String(branchName).trim()) {
      return res.status(400).json({ message: 'branchName is required' });
    }
    if (!branchCode || !String(branchCode).trim()) {
      return res.status(400).json({ message: 'branchCode is required' });
    }
    const type = String(branchType || 'GENERAL').toUpperCase();
    if (!VALID_TYPES.has(type)) {
      return res.status(400).json({ message: `Invalid branchType` });
    }

    const branch = await branchRepo.updateBranch(pool, {
      companyId,
      branchId,
      branchCode: String(branchCode).trim().toUpperCase(),
      branchName: String(branchName).trim(),
      branchType: type,
      address: address ? String(address).trim() : null,
      phone: phone ? String(phone).trim() : null,
    });
    if (!branch) {
      return res.status(404).json({ message: 'Branch not found' });
    }
    return res.json({ branch });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Branch code already exists for this company' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not update branch' });
  }
}

export async function deleteBranch(req, res) {
  try {
    const companyId = req.authStaff.company_id;
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) {
      return res.status(400).json({ message: 'Invalid branchId' });
    }

    const deleted = await branchRepo.softDeleteBranch(pool, companyId, branchId);
    if (!deleted) {
      return res.status(404).json({ message: 'Branch not found or already inactive' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not delete branch' });
  }
}
