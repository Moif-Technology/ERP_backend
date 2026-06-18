import { pool } from '../../config/db.js';

export async function listFeatures() {
  const { rows } = await pool.query(
    `SELECT f.feature_code, f.feature_name, f.pack_code, f.parent_feature_code, f.feature_type,
            f.description, f.is_active, f.sort_order,
            COALESCE(
              ARRAY_AGG(stm.software_code ORDER BY stm.software_type_id)
                FILTER (WHERE stm.software_code IS NOT NULL),
              '{}'
            ) AS software_types
       FROM core.feature_master f
       LEFT JOIN core.software_type_feature stf ON stf.feature_code = f.feature_code
       LEFT JOIN core.software_type_master stm ON stm.software_type_id = stf.software_type_id
      WHERE f.is_active = TRUE
      GROUP BY f.feature_code, f.feature_name, f.pack_code, f.parent_feature_code,
               f.feature_type, f.description, f.is_active, f.sort_order
      ORDER BY f.pack_code, f.sort_order, f.feature_code`
  );
  return rows;
}

export async function upsertFeature(body) {
  const { rows } = await pool.query(
    `INSERT INTO core.feature_master
       (feature_code, feature_name, pack_code, parent_feature_code, feature_type,
        description, is_active, sort_order)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'feature'), $6, COALESCE($7, TRUE), COALESCE($8, 0))
     ON CONFLICT (feature_code) DO UPDATE
       SET feature_name = EXCLUDED.feature_name,
           pack_code = EXCLUDED.pack_code,
           parent_feature_code = EXCLUDED.parent_feature_code,
           feature_type = EXCLUDED.feature_type,
           description = EXCLUDED.description,
           is_active = EXCLUDED.is_active,
           sort_order = EXCLUDED.sort_order,
           updated_at = NOW()
     RETURNING *`,
    [
      body.feature_code,
      body.feature_name,
      body.pack_code,
      body.parent_feature_code || null,
      body.feature_type,
      body.description || null,
      body.is_active,
      body.sort_order,
    ]
  );
  return rows[0];
}

export async function listLimits() {
  const { rows } = await pool.query(
    `SELECT limit_code, limit_name, description, unit, is_active
       FROM core.limit_master
      ORDER BY limit_code`
  );
  return rows;
}

export async function upsertLimit(body) {
  const { rows } = await pool.query(
    `INSERT INTO core.limit_master (limit_code, limit_name, description, unit, is_active)
     VALUES ($1, $2, $3, $4, COALESCE($5, TRUE))
     ON CONFLICT (limit_code) DO UPDATE
       SET limit_name = EXCLUDED.limit_name,
           description = EXCLUDED.description,
           unit = EXCLUDED.unit,
           is_active = EXCLUDED.is_active
     RETURNING *`,
    [body.limit_code, body.limit_name, body.description || null, body.unit || null, body.is_active]
  );
  return rows[0];
}

export async function listPlans() {
  const { rows } = await pool.query(
    `SELECT plan_code,
            display_name           AS plan_name,
            audience_label,
            description,
            price_monthly_display,
            price_yearly_display,
            period_label,
            card_note,
            cta_label,
            is_popular,
            sort_order,
            trial_days,
            is_active
       FROM core.plan_master
      ORDER BY sort_order, plan_code`
  );
  return rows;
}

export async function upsertPlan(body) {
  const { rows } = await pool.query(
    `INSERT INTO core.plan_master (
        plan_code, display_name, audience_label, description,
        price_monthly_display, price_yearly_display, period_label,
        card_note, cta_label, is_popular, sort_order, trial_days, is_active
     ) VALUES (
        $1, $2, $3, $4,
        $5, $6, COALESCE($7, 'month'),
        $8, $9, COALESCE($10, FALSE), COALESCE($11, 0), COALESCE($12, 14), COALESCE($13, TRUE)
     )
     ON CONFLICT (plan_code) DO UPDATE SET
        display_name          = EXCLUDED.display_name,
        audience_label        = EXCLUDED.audience_label,
        description           = EXCLUDED.description,
        price_monthly_display = EXCLUDED.price_monthly_display,
        price_yearly_display  = EXCLUDED.price_yearly_display,
        period_label          = EXCLUDED.period_label,
        card_note             = EXCLUDED.card_note,
        cta_label             = EXCLUDED.cta_label,
        is_popular            = EXCLUDED.is_popular,
        sort_order            = EXCLUDED.sort_order,
        trial_days            = EXCLUDED.trial_days,
        is_active             = EXCLUDED.is_active,
        updated_at            = NOW()
     RETURNING *`,
    [
      body.plan_code,
      body.display_name || body.plan_name,
      body.audience_label || null,
      body.description || null,
      body.price_monthly_display ?? '0',
      body.price_yearly_display ?? null,
      body.period_label || 'month',
      body.card_note || null,
      body.cta_label || null,
      body.is_popular,
      body.sort_order,
      body.trial_days,
      body.is_active,
    ]
  );
  return rows[0];
}

export async function listPlanFeatures(planCode) {
  const { rows } = await pool.query(
    `SELECT feature_code, is_enabled
       FROM core.plan_feature
      WHERE plan_code = $1
      ORDER BY feature_code`,
    [planCode]
  );
  return rows;
}

export async function setPlanFeature(planCode, featureCode, isEnabled) {
  const { rows } = await pool.query(
    `INSERT INTO core.plan_feature (plan_code, feature_code, is_enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (plan_code, feature_code)
     DO UPDATE SET is_enabled = EXCLUDED.is_enabled
     RETURNING *`,
    [planCode, featureCode, isEnabled]
  );
  return rows[0];
}

export async function listPlanLimits(planCode) {
  const { rows } = await pool.query(
    `SELECT limit_code, limit_value
       FROM core.plan_limit
      WHERE plan_code = $1
      ORDER BY limit_code`,
    [planCode]
  );
  return rows;
}

export async function setPlanLimit(planCode, limitCode, limitValue) {
  const { rows } = await pool.query(
    `INSERT INTO core.plan_limit (plan_code, limit_code, limit_value)
     VALUES ($1, $2, $3)
     ON CONFLICT (plan_code, limit_code)
     DO UPDATE SET limit_value = EXCLUDED.limit_value
     RETURNING *`,
    [planCode, limitCode, limitValue]
  );
  return rows[0];
}
