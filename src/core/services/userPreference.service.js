import * as repo from '../repositories/userPreference.repository.js';

function badRequest(msg) {
  const err = new Error(msg);
  err.status = 400;
  return err;
}

// NOTE: use authStaff.id (staff_master.id, the JWT subject) — it is the only
// globally unique staff identifier. authStaff.staff_id is a per-company business
// number (resets to 1 for every company), so using it here would let two staff
// in two different companies collide on the same preference row.
export async function getPreference(pool, authStaff, query) {
  const staffId = Number(authStaff.id);
  const prefKey = String(query.prefKey || '').trim();
  if (!prefKey) throw badRequest('prefKey is required');

  const row = await repo.getPreference(pool, { staffId, prefKey });
  return { pref: row?.pref_json ?? null };
}

export async function savePreference(pool, authStaff, body) {
  const staffId  = Number(authStaff.id);
  const prefKey  = String(body.prefKey || '').trim();
  const prefJson = body.pref;

  if (!prefKey) throw badRequest('prefKey is required');
  if (!prefJson || typeof prefJson !== 'object') throw badRequest('pref must be a JSON object');

  await repo.upsertPreference(pool, { staffId, prefKey, prefJson });
  return { ok: true };
}
