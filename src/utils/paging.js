/**
 * Normalize list pagination from req.query. Always returns a bounded limit so
 * no endpoint can be tricked into returning an unbounded result set.
 *
 * Usage in a service:
 *   const { limit, offset } = parsePaging(query);
 *   const rows = await repo.list(db, companyId, { limit, offset });
 *
 * And in the repo SQL: `... ORDER BY ... LIMIT $n OFFSET $m`.
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export function parsePaging(query = {}, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) {
  const rawLimit = Number(query.limit);
  const rawOffset = Number(query.offset);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), maxLimit)
    : defaultLimit;
  const offset = Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0;
  return { limit, offset };
}
