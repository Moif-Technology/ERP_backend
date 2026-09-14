/**
 * Restaurant POS device enrollment + PIN login.
 *
 * Same flow as Salon / Counter POS:
 *   1. Admin credentials  -> POST /device/stations  (list RESTAURANT_POS tills)
 *   2. Admin picks a till -> POST /device/enroll    (pairs deviceToken)
 *   3. Device lists staff -> POST /device/staff-list
 *   4. Cashier PIN        -> POST /device/pin-login (POS-scoped token, 8h)
 */
import bcrypt from 'bcryptjs';
import { pool } from '../../../config/db.js';
import { buildTokensForPOSDevice } from '../../../core/services/sessionTokens.js';
import * as deviceRepo from '../../counter-pos/repositories/device.repository.js';
import * as posStaffRepo from '../../counter-pos/repositories/staff.repository.js';

const RESTAURANT_STATION_TYPE = 'RESTAURANT_POS';
const RESTAURANT_ROLE_TYPES = new Set(['RESTAURANT-POS', 'ERP', '', null, undefined]);
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
      403,
      'ROLE_NOT_ALLOWED',
    );
  }
}

function assertEnrollmentAdmin(staffRow) {
  const roleId = Number(staffRow?.role_id);
  const roleName = String(staffRow?.role_name || '').trim().toLowerCase();
  if (roleId === 1 || roleName.includes('admin') || roleName === 'owner') return;
  throw bad('Only an admin can enroll POS devices', 403, 'NOT_ADMIN');
}

async function authenticateAdmin(adminUsername, adminPassword) {
  if (!adminUsername || !adminPassword) {
    throw bad('Email and password are required', 400, 'MISSING_CREDENTIALS');
  }

  const { rows } = await posStaffRepo.findLoginCandidates(pool, String(adminUsername).trim());
  const active = rows.filter((r) => r.record_status === 'ACTIVE');
  if (!active.length) throw bad('Invalid credentials', 401, 'BAD_CREDENTIALS');

  for (const row of active) {
    if (await bcrypt.compare(String(adminPassword), row.password_hash)) {
      assertEnrollmentAdmin(row);
      return row;
    }
  }
  throw bad('Invalid credentials', 401, 'BAD_CREDENTIALS');
}

export async function listStationsForEnroll({ adminUsername, adminPassword }) {
  const adminRow = await authenticateAdmin(adminUsername, adminPassword);
  const companyId = Number(adminRow.company_id);

  const { rows } = await pool.query(
    `SELECT sm.station_id, sm.station_name, sm.station_code, sm.counter_no,
            bm.branch_name
       FROM core.station_master sm
       LEFT JOIN core.branch_master bm
         ON bm.branch_id = sm.branch_id AND bm.company_id = sm.company_id
      WHERE sm.company_id  = $1
        AND sm.station_type = $2
        AND sm.is_deleted   = FALSE
      ORDER BY sm.station_name`,
    [companyId, RESTAURANT_STATION_TYPE],
  );

  if (!rows.length) {
    throw bad(
      `No ${RESTAURANT_STATION_TYPE} station exists for this company. ` +
        `Create one in Backoffice > Stations before enrolling a device.`,
      400,
      'NO_RESTAURANT_STATION',
    );
  }

  return {
    ok: true,
    companyId,
    companyName: adminRow.company_name ?? null,
    stations: rows.map((s) => ({
      stationId: Number(s.station_id),
      stationName: s.station_name,
      stationCode: s.station_code,
      counterNo: s.counter_no != null ? Number(s.counter_no) : null,
      branchName: s.branch_name ?? null,
    })),
  };
}

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
    [companyId, sid],
  );
  if (!rows.length) throw bad('Station not found for this company', 400, 'BAD_STATION');
  if (rows[0].station_type !== RESTAURANT_STATION_TYPE) {
    throw bad(
      `Station "${rows[0].station_name}" is a ${rows[0].station_type}, not a ${RESTAURANT_STATION_TYPE}.`,
      400,
      'WRONG_STATION_TYPE',
    );
  }

  const branchId = Number(rows[0].branch_id);
  await deviceRepo.upsertEnrollment(pool, {
    deviceToken: token,
    companyId,
    branchId,
    stationId: sid,
    label,
  });
  const enrollment = await deviceRepo.findByToken(pool, token);

  return {
    ok: true,
    companyId,
    branchId,
    stationId: sid,
    stationName: rows[0].station_name,
    counterNo: Number(enrollment?.counter_no ?? 1),
    label: label ?? null,
  };
}

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
    branchId: Number(enrollment.branch_id),
    stationId: enrollment.station_id != null ? Number(enrollment.station_id) : null,
    counterNo: Number(enrollment.counter_no ?? 1),
    staff: rows
      .filter((r) => {
        const t = String(r.role_software_type || '').toUpperCase().trim();
        return t === '' || RESTAURANT_ROLE_TYPES.has(t);
      })
      .map((r) => ({
        staffPk: Number(r.id),
        staffId: Number(r.staff_id),
        staffName: r.staff_name,
        staffCode: r.staff_code ?? null,
        roleName: r.role_name ?? null,
      })),
  };
}

export async function loginWithPin({ pin, companyId, staffId, deviceToken }) {
  const pinStr = String(pin || '').trim();
  const cid = Number(companyId);
  const token = String(deviceToken || '').trim();

  if (!pinStr) throw bad('PIN is required', 400, 'NO_PIN');
  if (!Number.isFinite(cid) || cid < 1) throw bad('companyId is required', 400, 'NO_COMPANY');
  if (!token) throw bad('deviceToken is required', 400, 'NO_DEVICE_TOKEN');
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

  const staffPk = Number(staffId);
  if (Number.isFinite(staffPk) && staffPk > 0) {
    const row = await posStaffRepo.findActiveStaffByIdWithPin(pool, cid, staffPk);
    if (!row || !row.staff_pin) throw bad('Invalid PIN', 401, 'BAD_PIN');
    if (!(await bcrypt.compare(pinStr, row.staff_pin))) throw bad('Invalid PIN', 401, 'BAD_PIN');
    assertRestaurantPosAllowed(row);
    return { ...(await buildTokensForPOSDevice(row, stationId)), staffPk: Number(row.id) };
  }

  const staffList = await posStaffRepo.findAllActiveStaffForCompany(pool, cid);
  const restaurantStaff = staffList
    .filter((row) => {
      const roleType = String(row.role_software_type || '').toUpperCase().trim();
      return roleType === '' || RESTAURANT_ROLE_TYPES.has(roleType);
    })
    .sort((a, b) => {
      const score = (row) =>
        String(row.role_software_type || '').toUpperCase().trim() === 'RESTAURANT-POS' ? 0 : 1;
      return score(a) - score(b);
    });
  if (!restaurantStaff.length) throw bad('No staff with a PIN found for this company', 401, 'NO_STAFF');

  for (const row of restaurantStaff.slice(0, LEGACY_PIN_SCAN_CAP)) {
    if (!row.staff_pin) continue;
    if (!(await bcrypt.compare(pinStr, row.staff_pin))) continue;
    return { ...(await buildTokensForPOSDevice(row, stationId)), staffPk: Number(row.id) };
  }

  throw bad('Invalid PIN', 401, 'BAD_PIN');
}
