/** Shared helpers for CRM services. */

export function trimOrNull(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return max ? s.slice(0, max) : s;
}

export function requiredStr(v, label, max) {
  if (v == null || String(v).trim() === '') {
    const e = new Error(`${label} is required`); e.status = 400; throw e;
  }
  const s = String(v).trim();
  if (max && s.length > max) {
    const e = new Error(`${label} must be at most ${max} characters`); e.status = 400; throw e;
  }
  return s;
}

export function toBool(v, fallback = true) {
  if (v == null) return fallback;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'n'].includes(s)) return false;
  return fallback;
}

export function toIntOrNull(v) {
  if (v == null || v === '') return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

export function toIntDefault(v, def) {
  const n = toIntOrNull(v);
  return n == null ? def : n;
}

export function toNumberOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Slugify a name into uppercase code: "Lead Source" → "LEAD_SOURCE". */
export function slugCode(name, max = 30) {
  return String(name || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max) || 'CODE';
}

export function requireCompanyId(authStaff) {
  const n = Number(authStaff?.company_id);
  if (!Number.isFinite(n) || n < 1) {
    const e = new Error('Invalid company on session'); e.status = 400; throw e;
  }
  return n;
}

export function requireBranchId(authStaff, fallbackBody) {
  const candidates = [fallbackBody?.branchId, authStaff?.branch_id];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const e = new Error('Invalid branch on session'); e.status = 400; throw e;
}

export function actorStaffId(authStaff) {
  const n = Number(authStaff?.id);
  return Number.isFinite(n) && n >= 1 ? n : null;
}
