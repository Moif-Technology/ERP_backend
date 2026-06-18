import * as service from '../services/featureAdmin.service.js';
import * as repo from '../repositories/featureAdmin.repository.js';
import { pool } from '../../config/db.js';

export async function getFeatureMatrix(req, res) {
  try {
    const data = await service.getFeatureMatrix();
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

export async function updatePlanFeatures(req, res) {
  try {
    const { planCode } = req.params;
    const { updates } = req.body;
    if (!planCode || !Array.isArray(updates)) {
      return res.status(400).json({ message: 'planCode and updates[] required' });
    }
    await service.updatePlanFeatures(planCode, updates);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

export async function listPlans(req, res) {
  try {
    const { rows } = await repo.listPlans(pool);
    res.json({ plans: rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

export async function upsertPlan(req, res) {
  try {
    const { planCode, displayName, sortOrder, isActive } = req.body;
    if (!planCode || !displayName) {
      return res.status(400).json({ message: 'planCode and displayName required' });
    }
    const { rows } = await repo.upsertPlan(pool, { planCode, displayName, sortOrder, isActive });
    res.json({ plan: rows[0] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

export async function deletePlan(req, res) {
  try {
    const { planCode } = req.params;
    await repo.deletePlan(pool, planCode);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}
