export function listAllFeatures(db) {
  return db.query(`
    SELECT feature_code, feature_name, pack_code, parent_feature_code, feature_type, is_active, sort_order
    FROM core.feature_master
    ORDER BY sort_order, feature_code
  `);
}

export function listAllPlanFeatures(db) {
  return db.query(`
    SELECT pf.plan_code, pf.feature_code, pf.is_enabled, pm.display_name as plan_name
    FROM core.plan_feature pf
    JOIN core.plan_master pm ON pm.plan_code = pf.plan_code
    ORDER BY pm.sort_order, pf.feature_code
  `);
}

export function listPlans(db) {
  return db.query(`
    SELECT plan_code, display_name, sort_order, is_active
    FROM core.plan_master
    ORDER BY sort_order
  `);
}

export function upsertPlan(db, { planCode, displayName, sortOrder, isActive }) {
  return db.query(`
    INSERT INTO core.plan_master (plan_code, display_name, sort_order, is_active)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (plan_code)
    DO UPDATE SET display_name = EXCLUDED.display_name, sort_order = EXCLUDED.sort_order, is_active = EXCLUDED.is_active
    RETURNING plan_code, display_name, sort_order, is_active
  `, [planCode, displayName, sortOrder ?? 0, isActive ?? true]);
}

export function deletePlan(db, planCode) {
  return db.query(`DELETE FROM core.plan_master WHERE plan_code = $1`, [planCode]);
}

export async function upsertPlanFeature(db, planCode, featureCode, isEnabled) {
  return db.query(`
    INSERT INTO core.plan_feature (plan_code, feature_code, is_enabled)
    VALUES ($1, $2, $3)
    ON CONFLICT (plan_code, feature_code)
    DO UPDATE SET is_enabled = EXCLUDED.is_enabled
  `, [planCode, featureCode, isEnabled]);
}

export async function bulkUpsertPlanFeatures(db, planCode, updates) {
  if (!updates.length) return;
  const values = updates.map((u, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(', ');
  const params = updates.flatMap((u) => [planCode, u.featureCode, u.isEnabled]);
  return db.query(`
    INSERT INTO core.plan_feature (plan_code, feature_code, is_enabled)
    VALUES ${values}
    ON CONFLICT (plan_code, feature_code)
    DO UPDATE SET is_enabled = EXCLUDED.is_enabled
  `, params);
}
