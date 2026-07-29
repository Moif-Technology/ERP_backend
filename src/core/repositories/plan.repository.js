/**
 * Data access for core.plan_master (public catalog).
 */

export async function findActivePlans(pool) {
  return pool.query(
    `SELECT plan_code, display_name, audience_label, description,
            price_monthly_display, price_yearly_display, period_label,
            features, card_note, cta_label, is_popular, sort_order, trial_days,
            effective_from, effective_to, is_active
     FROM core.plan_master
     WHERE is_active = true
       AND (effective_from IS NULL OR CURRENT_DATE >= effective_from)
       AND (effective_to IS NULL OR CURRENT_DATE <= effective_to)
     ORDER BY sort_order ASC, plan_code ASC`
  );
}

export async function findActivePlanByCode(pool, planCode) {
  const { rows } = await pool.query(
    `SELECT plan_code, trial_days
     FROM core.plan_master
     WHERE is_active = true
       AND LOWER(plan_code) = LOWER($1)
       AND (effective_from IS NULL OR CURRENT_DATE >= effective_from)
       AND (effective_to IS NULL OR CURRENT_DATE <= effective_to)
     LIMIT 1`,
    [String(planCode || '').trim()]
  );
  return rows[0] ?? null;
}

/**
 * Software types offered on the public signup page.
 *
 * display_order is the intended sort, but SERVICE was inserted with
 * display_order 0 (the column default) while every other row uses 1..8, so
 * ordering on it alone would push SERVICE to the front of the list. Sort rows
 * with a real display_order first, in that order, then fall back to id.
 */
export async function listActiveSoftwareTypes(pool) {
  const { rows } = await pool.query(
    `SELECT software_type_id, software_code, software_name, description
     FROM core.software_type_master
     WHERE is_active = TRUE
     ORDER BY (display_order IS NULL OR display_order = 0),
              display_order ASC,
              software_type_id ASC`
  );
  return rows;
}
