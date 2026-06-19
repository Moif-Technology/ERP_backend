import { pool } from '../../config/db.js';
import * as accountHeadService from '../services/accountHead.service.js';

function handleError(res, err, fallbackMsg) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.code === '42P01') {
    return res.status(503).json({ message: 'Accounts tables missing. Run migrations first.' });
  }
  if (err.code === '23505') {
    return res.status(409).json({ message: 'Duplicate account number or ID' });
  }
  console.error(err);
  return res.status(500).json({ message: fallbackMsg });
}

export async function listAccountHeads(req, res) {
  try {
    const data = await accountHeadService.listAccountHeads(pool, req.authStaff, req.query);
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not load account heads');
  }
}

export async function getAccountTree(req, res) {
  try {
    const data = await accountHeadService.getAccountTree(pool, req.authStaff);
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not load account tree');
  }
}

export async function getAccountHead(req, res) {
  try {
    const data = await accountHeadService.getAccountHead(pool, req.authStaff, Number(req.params.accountId));
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not load account');
  }
}

export async function createAccountHead(req, res) {
  try {
    const data = await accountHeadService.createAccountHead(pool, req.authStaff, req.body);
    return res.status(201).json(data);
  } catch (err) {
    return handleError(res, err, 'Could not create account');
  }
}

export async function suggestAccountNumber(req, res) {
  try {
    const data = await accountHeadService.suggestAccountNumber(pool, req.authStaff, req.query);
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not suggest account number');
  }
}

export async function seedStandardChart(req, res) {
  try {
    const data = await accountHeadService.seedStandardChart(pool, req.authStaff, req.body);
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not load standard chart of accounts');
  }
}

export async function updateAccountHead(req, res) {
  try {
    const data = await accountHeadService.updateAccountHead(pool, req.authStaff, Number(req.params.accountId), req.body);
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not update account');
  }
}

export async function deleteAccountHead(req, res) {
  try {
    const data = await accountHeadService.deleteAccountHead(pool, req.authStaff, Number(req.params.accountId));
    return res.json(data);
  } catch (err) {
    return handleError(res, err, 'Could not delete account');
  }
}
