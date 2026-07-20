export async function getPreference(pool, { staffId, prefKey }) {
  const { rows } = await pool.query(
    `SELECT pref_json
       FROM core.user_preferences
      WHERE staff_id = $1
        AND pref_key = $2
      LIMIT 1`,
    [staffId, prefKey],
  );
  return rows[0] ?? null;
}

export async function upsertPreference(pool, { staffId, prefKey, prefJson }) {
  const { rows } = await pool.query(
    `INSERT INTO core.user_preferences (staff_id, pref_key, pref_json, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT ON CONSTRAINT uq_user_preferences
     DO UPDATE SET pref_json = EXCLUDED.pref_json, updated_at = NOW()
     RETURNING id`,
    [staffId, prefKey, JSON.stringify(prefJson)],
  );
  return rows[0];
}
