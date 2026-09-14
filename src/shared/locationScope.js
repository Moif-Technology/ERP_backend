/**
 * Station vs physical branch.
 * JWT station_id is the till; JWT branch_id is the physical location
 * (station_master.branch_id). Area/table masters may be stored under either.
 */

export async function getStationLocation(db, companyId, stationId) {
  const sid = Number(stationId);
  if (!Number.isFinite(sid) || sid < 1) return null;
  const { rows } = await db.query(
    `SELECT station_id, branch_id
     FROM core.station_master
     WHERE company_id = $1
       AND station_id = $2
       AND is_deleted = FALSE
     LIMIT 1`,
    [companyId, sid]
  );
  if (!rows[0]) return null;
  return {
    stationId: Number(rows[0].station_id),
    physicalBranchId: Number(rows[0].branch_id),
  };
}

/** branch_id values to try on core area/table masters: station first, then physical. */
export function locationBranchCandidates(location) {
  const ids = [];
  const add = (id) => {
    const n = Number(id);
    if (Number.isFinite(n) && n > 0 && !ids.includes(n)) ids.push(n);
  };
  add(location?.stationId);
  add(location?.physicalBranchId);
  return ids;
}

export async function firstNonEmptyByBranch(candidates, listFn) {
  let last = [];
  for (const id of candidates) {
    last = await listFn(id);
    if (Array.isArray(last) && last.length) return last;
  }
  return last;
}

/** Union rows from station + physical so a till-scoped area does not hide location areas. */
export async function mergeByBranch(candidates, listFn, keyFn) {
  const seen = new Set();
  const merged = [];
  for (const id of candidates) {
    const rows = await listFn(id);
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const key = keyFn ? keyFn(row, id) : `${id}:${JSON.stringify(row)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }
  }
  return merged;
}
