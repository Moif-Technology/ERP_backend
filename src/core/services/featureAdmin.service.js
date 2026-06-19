import { pool } from '../../config/db.js';
import * as repo from '../repositories/featureAdmin.repository.js';

export async function getFeatureMatrix() {
  const [featuresRes, planFeaturesRes, plansRes] = await Promise.all([
    repo.listAllFeatures(pool),
    repo.listAllPlanFeatures(pool),
    repo.listPlans(pool),
  ]);

  const features = featuresRes.rows;
  const plans = plansRes.rows;

  // Build map: planCode -> featureCode -> isEnabled
  const matrix = {};
  for (const plan of plans) {
    matrix[plan.plan_code] = {};
  }
  for (const row of planFeaturesRes.rows) {
    if (matrix[row.plan_code]) {
      matrix[row.plan_code][row.feature_code] = row.is_enabled;
    }
  }

  // Group active features into packs with children; skip empty packs
  const activeFeatures = features.filter((f) => f.is_active !== false);
  const packs = activeFeatures.filter((f) => f.feature_type === 'pack');
  const children = activeFeatures.filter((f) => f.feature_type !== 'pack');

  const tree = packs
    .map((pack) => ({
      ...pack,
      children: children.filter((f) => f.pack_code === pack.feature_code),
    }))
    .filter((pack) => pack.children.length > 0);

  return { tree, plans, matrix };
}

export async function updatePlanFeatures(planCode, updates) {
  if (!Array.isArray(updates) || !updates.length) return;
  const clean = updates
    .filter((u) => typeof u.featureCode === 'string' && typeof u.isEnabled === 'boolean')
    .map((u) => ({ featureCode: u.featureCode, isEnabled: u.isEnabled }));
  await repo.bulkUpsertPlanFeatures(pool, planCode, clean);
  // Touch tenant_subscription so getEntitlementVersion detects the change and
  // the client 30s poll propagates new features without requiring re-login.
  await pool.query(
    `UPDATE core.tenant_subscription SET updated_at = NOW() WHERE plan_code = $1`,
    [planCode],
  );
}
