/**
 * Stylist roster and availability.
 *
 * Deliberately three states, not two. "Available / unavailable" forces the wrong
 * answer for the overwhelmingly common "she's free in ten minutes" case, which is
 * what a front desk actually needs to answer.
 *   FREE  — no open service lines
 *   BUSY  — has a service running now (busyMinutes = elapsed against estimate)
 *   QUEUED— has waiting services but none started
 */
import * as stylistRepo from '../repositories/stylist.repository.js';

function parseLong(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.trunc(n);
}

function statusFor(load) {
  if (!load) return { status: 'FREE', openServices: 0, runningServices: 0 };

  const open    = Number(load.open_services ?? 0);
  const running = Number(load.running_services ?? 0);

  let status = 'FREE';
  if (running > 0) status = 'BUSY';
  else if (open > 0) status = 'QUEUED';

  let elapsedMinutes = null;
  if (running > 0 && load.started_at) {
    elapsedMinutes = Math.max(0, Math.round((Date.now() - new Date(load.started_at).getTime()) / 60000));
  }

  return {
    status,
    openServices: open,
    runningServices: running,
    pendingMinutes: load.pending_minutes != null ? Number(load.pending_minutes) : null,
    elapsedMinutes,
  };
}

export async function listStylists(pool, authStaff, query = {}) {
  const companyId = Number(authStaff.company_id);
  const branchId  = parseLong(query.branchId);

  const [staff, loads] = await Promise.all([
    stylistRepo.listStylists(pool, companyId, { branchId }),
    stylistRepo.stylistLoad(pool, companyId),
  ]);

  const loadByStylist = new Map(loads.map((l) => [String(l.stylist_id), l]));

  return {
    success: true,
    data: staff.map((s) => {
      const load = statusFor(loadByStylist.get(String(s.staff_id)));
      return {
        StylistID: String(s.staff_id),
        stylistID: String(s.staff_id),
        StylistCode: s.staff_code ?? '',
        StylistName: s.staff_name ?? '',
        stylistName: s.staff_name ?? '',
        Designation: s.designation ?? '',
        BranchID: s.branch_id != null ? String(s.branch_id) : '',
        ...load,
      };
    }),
  };
}

export async function getStylistLoad(pool, authStaff, stylistIdRaw) {
  const companyId = Number(authStaff.company_id);
  const stylistId = parseLong(stylistIdRaw);
  if (stylistId == null) {
    const err = new Error('Invalid stylist id');
    err.status = 400;
    throw err;
  }

  const rows = await stylistRepo.stylistLoad(pool, companyId, { stylistId });
  return {
    success: true,
    StylistID: String(stylistId),
    ...statusFor(rows[0]),
  };
}
