/**
 * Restaurant / Quick-service POS device enrollment + PIN login.
 *
 * This is the till flow used by the Deyno Quick web client. It mirrors the
 * Salon-POS implementation, which in turn mirrors Counter-POS — the only POS
 * flows in this codebase that do device auth properly:
 *
 *   1. Admin enters credentials  -> POST /device/stations  (list RESTAURANT_POS tills)
 *   2. Admin picks a station     -> POST /device/enroll    (pairs deviceToken)
 *   3. Device shows staff picker -> POST /staff-list       (gated by deviceToken)
 *   4. Cashier taps name + PIN   -> POST /pin-login        (one bcrypt compare)
 *
 * Why device-scoped: the staff list is not public. Gating it behind an enrolled
 * deviceToken stops staff-name enumeration by arbitrary callers, and PIN
 * verification then targets exactly one staff row instead of scanning every
 * staff in the company (which turns one request into hundreds of bcrypt ops).
 *
 * Token scope: this path uses `buildTokensForPOSDevice`, which signs a genuinely
 * POS-scoped token (scope:'pos' + station id in `sid`). POS_ALLOWED_PREFIXES
 * isolation in authMiddleware engages here, and the session MUST be registered
 * as 'pos'. The legacy username/password path in controllers/pos.controller.js
 * issues an ERP-scoped token and stays 'erp' — do not cross the two.
 */
import bcrypt from 'bcryptjs';
import { pool } from '../../../config/db.js';
import { buildTokensForPOSDevice } from '../../../core/services/sessionTokens.js';

// Reused from counter-pos rather than duplicated: both are generic SQL over
// shared tables (core.pos_device_enrollment, core.staff_master) with nothing
// counter-specific in them. Duplicating would mean fixing bugs twice.
import * as deviceRepo from '../../counter-pos/repositories/device.repository.js';
import * as posStaffRepo from '../../counter-pos/repositories/staff.repository.js';

const RESTAURANT_STATION_TYPE = 'RESTAURANT_POS';  // station_type uses UNDERSCORES
// Role software types use HYPHENS. Kept in sync with
// core/services/auth.service.js RESTAURANT_POS_ALLOWED_TYPES.
const RESTAURANT_ROLE_TYPES = new Set(['RESTAURANT-POS', 'ERP', '', null, undefined]);

/** Same cap counter-pos uses: a legacy PIN-only login must not become a bcrypt storm. */
const LEGACY_PIN_SCAN_CAP = 50;

function bad(message, status = 400, code = null) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

function assertRestaurantPosAllowed(staffRow) {
  const roleType = String(staffRow.role_software_type || '').toUpperCase().trim();
  if (roleType !== '' && !RESTAURANT_ROLE_TYPES.has(roleType)) {
    throw bad(
      `This staff's role is '${roleType}', which is not authorised for Restaurant POS. ` +
      `Allowed: RESTAURANT-POS or ERP.`,
      403, 'ROLE_NOT_ALLOWED'
    );
  }
}

function assertEnrollmentAdmin(staffRow) {
  const roleId = Number(staffRow?.role_id);
  const roleName = String(staffRow?.role_name || '').trim().toLowerCase();
  if (roleId === 1 || roleName.includes('admin') || roleName === 'owner') return;
  throw bad('Only an admin can enroll POS devices', 403, 'NOT_ADMIN');
}

/** Verify admin username + password, return the matching staff row. */
async function authenticateAdmin(adminUsername, adminPassword) {
  if (!adminUsername || !adminPassword) {
    throw bad('Email and password are required', 400, 'MISSING_CREDENTIALS');
  }

  const { rows } = await posStaffRepo.findLoginCandidates(pool, String(adminUsername).trim());
  const active = rows.filter((r) => r.record_status === 'ACTIVE');
  if (!active.length) throw bad('Invalid credentials', 401, 'BAD_CREDENTIALS');

  for (const row of active) {
    if (!row.password_hash) continue;
    if (await bcrypt.compare(String(adminPassword), row.password_hash)) {
      assertEnrollmentAdmin(row);
      return row;
    }
  }
  throw bad('Invalid credentials', 401, 'BAD_CREDENTIALS');
}

/**
 * Step 1 — POST /device/stations
 * Admin credentials in, the company's RESTAURANT_POS tills out.
 */
export async function listStationsForEnroll({ adminUsername, adminPassword }) {
  const adminRow = await authenticateAdmin(adminUsername, adminPassword);
  const companyId = Number(adminRow.company_id);

  const { rows } = await pool.query(
    `SELECT sm.station_id, sm.station_name, sm.station_code, sm.counter_no,
            bm.branch_name
       FROM core.station_master sm
       LEFT JOIN core.branch_master bm
         ON bm.branch_id = sm.branch_id AND bm.company_id = sm.company_id
      WHERE sm.company_id   = $1
        AND sm.station_type = $2
        AND sm.is_deleted   = FALSE
      ORDER BY sm.station_name`,
    [companyId, RESTAURANT_STATION_TYPE]
  );

  if (!rows.length) {
    throw bad(
      `No ${RESTAURANT_STATION_TYPE} station exists for this company. ` +
      `Create one in Backoffice > Stations before enrolling a device.`,
      400, 'NO_RESTAURANT_STATION'
    );
  }

  return {
    ok: true,
    companyId,
    companyName: adminRow.company_name ?? null,
    stations: rows.map((s) => ({
      stationId:   Number(s.station_id),
      stationName: s.station_name,
      stationCode: s.station_code,
      counterNo:   s.counter_no != null ? Number(s.counter_no) : null,
      branchName:  s.branch_name ?? null,
    })),
  };
}

/**
 * Step 2 — POST /device/enroll
 * Pairs this device to a company + RESTAURANT_POS station. company_id comes from
 * the admin's own record, never from client input.
 */
export async function enrollDevice({ adminUsername, adminPassword, deviceToken, stationId, label }) {
  const token = String(deviceToken || '').trim();
  if (!token) throw bad('deviceToken is required', 400, 'NO_DEVICE_TOKEN');

  const adminRow = await authenticateAdmin(adminUsername, adminPassword);
  const companyId = Number(adminRow.company_id);

  const sid = stationId != null ? Number(stationId) : null;
  if (!Number.isFinite(sid) || sid < 1) {
    throw bad('stationId is required — pick a station first', 400, 'NO_STATION');
  }

  const { rows } = await pool.query(
    `SELECT branch_id, station_type, station_name
       FROM core.station_master
      WHERE company_id = $1 AND station_id = $2 AND is_deleted = FALSE
      LIMIT 1`,
    [companyId, sid]
  );
  if (!rows.length) throw bad('Station not found for this company', 400, 'BAD_STATION');
  if (rows[0].station_type !== RESTAURANT_STATION_TYPE) {
    throw bad(
      `Station "${rows[0].station_name}" is a ${rows[0].station_type}, not a ${RESTAURANT_STATION_TYPE}.`,
      400, 'WRONG_STATION_TYPE'
    );
  }

  const branchId = Number(rows[0].branch_id);
  await deviceRepo.upsertEnrollment(pool, {
    deviceToken: token, companyId, branchId, stationId: sid, label,
  });
  const enrollment = await deviceRepo.findByToken(pool, token);

  return {
    ok: true,
    companyId,
    companyName: adminRow.company_name ?? null,
    branchId,
    stationId: sid,
    stationName: rows[0].station_name,
    counterNo: Number(enrollment?.counter_no ?? 1),
    label: label ?? null,
  };
}

/**
 * Step 3 — POST /staff-list
 * Staff picker for the enrolled device. Only staff who actually have a PIN.
 */
export async function listStaffForDevice({ deviceToken }) {
  const token = String(deviceToken || '').trim();
  if (!token) throw bad('deviceToken is required', 400, 'NO_DEVICE_TOKEN');

  const enrollment = await deviceRepo.findByToken(pool, token);
  if (!enrollment) {
    throw bad('This device is not enrolled. Run enrollment first.', 401, 'NOT_ENROLLED');
  }

  const rows = await posStaffRepo.listActiveStaffForPicker(pool, Number(enrollment.company_id));

  return {
    ok: true,
    companyId: Number(enrollment.company_id),
    branchId:  Number(enrollment.branch_id),
    stationId: enrollment.station_id != null ? Number(enrollment.station_id) : null,
    counterNo: Number(enrollment.counter_no ?? 1),
    staff: rows
      // Only surface staff whose role can actually sign into a restaurant till —
      // showing names that will be rejected on tap is a bad picker.
      .filter((r) => {
        const t = String(r.role_software_type || '').toUpperCase().trim();
        return t === '' || RESTAURANT_ROLE_TYPES.has(t);
      })
      .map((r) => ({
        staffPk:   Number(r.id),
        staffId:   Number(r.staff_id),
        staffName: r.staff_name,
        staffCode: r.staff_code ?? null,
        roleName:  r.role_name ?? null,
      })),
  };
}

/**
 * Step 4 — POST /pin-login
 * `staffId` here is the picker's staffPk (core.staff_master.id), so exactly one
 * bcrypt compare runs. Returns a POS-scoped token carrying the device's station.
 */
export async function loginWithPin({ pin, companyId, staffId, deviceToken }) {
  const pinStr = String(pin || '').trim();
  const cid    = Number(companyId);
  const token  = String(deviceToken || '').trim();

  if (!pinStr) throw bad('PIN is required', 400, 'NO_PIN');
  if (!Number.isFinite(cid) || cid < 1) throw bad('companyId is required', 400, 'NO_COMPANY');
  if (!token) throw bad('deviceToken is required', 400, 'NO_DEVICE_TOKEN');
  // Generic message on purpose: a wrong-length PIN must not read differently
  // from a wrong PIN.
  if (!/^\d{4,6}$/.test(pinStr)) throw bad('Invalid PIN', 401, 'BAD_PIN');

  const enrollment = await deviceRepo.findByToken(pool, token);
  if (!enrollment) throw bad('This device is not enrolled', 401, 'NOT_ENROLLED');
  if (Number(enrollment.company_id) !== cid) {
    throw bad('This device is enrolled to a different company', 401, 'WRONG_COMPANY');
  }

  const stationId = enrollment.station_id != null ? Number(enrollment.station_id) : null;
  if (!Number.isFinite(stationId) || stationId < 1) {
    throw bad('This device has no station configured. Re-enroll it.', 401, 'NO_STATION');
  }
  const counterNo = Number(enrollment.counter_no ?? 1);

  const staffPk = Number(staffId);
  if (Number.isFinite(staffPk) && staffPk > 0) {
    const row = await posStaffRepo.findActiveStaffByIdWithPin(pool, cid, staffPk);
    if (!row || !row.staff_pin) throw bad('Invalid PIN', 401, 'BAD_PIN');
    if (!(await bcrypt.compare(pinStr, row.staff_pin))) throw bad('Invalid PIN', 401, 'BAD_PIN');
    assertRestaurantPosAllowed(row);
    return { ...(await buildTokensForPOSDevice(row, stationId)), staffPk: Number(row.id), counterNo };
  }

  // Legacy path: no staff selected. Bounded scan so this cannot become a DoS.
  const staffList = await posStaffRepo.findAllActiveStaffForCompany(pool, cid);
  if (!staffList.length) throw bad('No staff with a PIN found for this company', 401, 'NO_STAFF');

  for (const row of staffList.slice(0, LEGACY_PIN_SCAN_CAP)) {
    if (!row.staff_pin) continue;
    if (!(await bcrypt.compare(pinStr, row.staff_pin))) continue;
    assertRestaurantPosAllowed(row);
    return { ...(await buildTokensForPOSDevice(row, stationId)), staffPk: Number(row.id), counterNo };
  }

  throw bad('Invalid PIN', 401, 'BAD_PIN');
}
