import bcrypt from 'bcryptjs';
import { withTransaction } from '../../config/db.js';
import * as staffRepo from '../repositories/staff.repository.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as roleRepo from '../repositories/role.repository.js';
import * as technicianRepo from '../../garage/repositories/technician.repository.js';
import { actorStaffPk } from '../../utils/actorStaff.js';
import { assertLimitAvailable } from './entitlement.service.js';
import { invalidateStaffSession } from '../../middleware/authMiddleware.js';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateCreateBody(body) {
  const errors = [];
  const staffName = String(body.staffName || '').trim();
  const designation = String(body.designation || '').trim();
  const email = normalizeEmail(body.email || body.loginEmail);
  const password = body.password;
  const branchId = Number(body.branchId);
  const roleId = body.roleId == null || body.roleId === '' ? roleRepo.DEFAULT_ROLE_IDS.staff : Number(body.roleId);
  const mobileNo = body.mobileNo != null ? String(body.mobileNo).trim() : '';
  const pin = body.pin != null ? String(body.pin).trim() : '';
  const garageTechnicianRaw = body.garageTechnician && typeof body.garageTechnician === 'object'
    ? body.garageTechnician
    : {};
  const garageTechnicianEnabled = body.createGarageTechnician === true || garageTechnicianRaw.enabled === true;
  const garageSpecialisation = String(
    body.garageSpecialisation ?? garageTechnicianRaw.specialisation ?? ''
  ).trim();

  if (!staffName) errors.push('staffName is required');
  if (!designation) errors.push('designation is required');
  if (!email) errors.push('email is required');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('email is invalid');
  if (!password || String(password).length < 8) errors.push('password must be at least 8 characters');
  if (!Number.isFinite(branchId) || branchId < 1) errors.push('branchId is required');
  if (!Number.isFinite(roleId) || roleId < 1) errors.push('roleId is invalid');
  if (pin && !/^\d{4,6}$/.test(pin)) errors.push('PIN must be 4–6 digits');

  return {
    ok: errors.length === 0,
    errors,
    data: {
      staffName,
      designation,
      email,
      password: String(password),
      pin: pin || null,
      branchId,
      roleId,
      mobileNo: mobileNo || null,
      garageTechnicianEnabled,
      garageSpecialisation: garageSpecialisation || null,
    },
  };
}

function isGarageRole(role) {
  return String(role?.software_type || role?.softwareType || '').trim().toUpperCase() === 'GARAGE';
}

async function ensureGarageTechnician(db, staffRow, { companyId, actor, specialisation } = {}) {
  const branchId = Number(staffRow?.branch_id);
  const empId = String(staffRow?.staff_code || '').trim();
  const techName = String(staffRow?.staff_name || '').trim();
  if (!Number.isFinite(branchId) || branchId < 1 || !empId || !techName) return null;

  return technicianRepo.upsertTechnicianByEmpId(db, {
    companyId,
    branchId,
    empId,
    techName,
    specialisation: specialisation || staffRow.designation || null,
    phone: staffRow.mobile_no || null,
    createdBy: actor,
    modifiedBy: actor,
  });
}

/**
 * Create a staff user for the authenticated user's company (Data entry → Staff entry).
 */
export async function createStaffMember(pool, body, authStaff) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid session company');
    err.status = 401;
    throw err;
  }

  const parsed = validateCreateBody(body);
  if (!parsed.ok) {
    const err = new Error(parsed.errors.join('; '));
    err.status = 400;
    throw err;
  }

  const {
    staffName,
    designation,
    email,
    password,
    pin,
    branchId,
    roleId,
    mobileNo,
    garageTechnicianEnabled,
    garageSpecialisation,
  } = parsed.data;

  const branchOk = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!branchOk) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }

  const role = await roleRepo.findRoleByCompany(pool, companyId, roleId);
  if (!role) {
    const err = new Error('Invalid role for this company');
    err.status = 400;
    throw err;
  }

  if (await staffRepo.existsStaffWithEmailGlobal(pool, email)) {
    const err = new Error('This email is already used for another login');
    err.status = 409;
    throw err;
  }

  const actor = String(authStaff.staff_name || authStaff.login_name || 'staff').slice(0, 50);

  const row = await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `core.staff_master:${companyId}`,
    ]);
    await assertLimitAvailable({
      companyId,
      limitCode: 'users_total',
      countFn: staffRepo.countActiveStaff,
      db: client,
    });
    const staffId = await staffRepo.nextStaffId(client, companyId);
    const staffCode = `U${staffId}`;
    const passwordHash = await bcrypt.hash(password, 12);
    const pinHash = pin ? await bcrypt.hash(pin, 12) : null;
    const now = new Date().toISOString();

    await staffRepo.insertStaff(client, {
      companyId,
      staffId,
      branchId,
      staffCode,
      staffName,
      designation,
      email,
      passwordHash,
      pinHash,
      roleId,
      phone: mobileNo,
      now,
      createdBy: actor,
      modifiedBy: actor,
      createdByStaffId: actorStaffPk(authStaff),
    });

    const staffRow = await staffRepo.findStaffForCompanyByStaffId(client, companyId, staffId);
    const shouldCreateGarageTechnician = isGarageRole(role) || garageTechnicianEnabled;
    let garageTechnician = null;
    if (shouldCreateGarageTechnician) {
      garageTechnician = await ensureGarageTechnician(client, staffRow, {
        companyId,
        actor,
        specialisation: garageSpecialisation || designation,
      });
    }

    const sessionRow = await staffRepo.selectStaffSessionRow(client, companyId, staffId);
    return { sessionRow, garageTechnician };
  });

  return {
    staffId: row.sessionRow.staff_id,
    staffCode: `U${row.sessionRow.staff_id}`,
    staffName: row.sessionRow.staff_name,
    branchId: row.sessionRow.branch_id,
    roleId,
    email: parsed.data.email,
    createdByStaffId: actorStaffPk(authStaff),
    garageTechnician: row.garageTechnician,
  };
}

export async function listStaffMembers(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid session company');
    err.status = 401;
    throw err;
  }
  const rows = await staffRepo.listStaffForCompany(pool, companyId, {
    limit: query?.limit,
  });
  return rows.map((r) => ({
    staffId: Number(r.staff_id),
    staffName: r.staff_name,
    staffCode: r.staff_code != null && r.staff_code !== '' ? String(r.staff_code) : null,
    branchId: r.branch_id != null ? Number(r.branch_id) : null,
    branchName: r.branch_name ?? null,
    designation: r.designation ?? null,
    mobileNo: r.mobile_no ?? null,
    email: r.email ?? null,
    roleId: r.role_id != null ? Number(r.role_id) : null,
    roleName: r.role_name ?? null,
    roleSoftwareType: r.software_type ?? null,
    hasPIN: r.has_pin === true || r.has_pin === 't',
  }));
}

export async function updateStaffMember(pool, staffIdRaw, body, authStaff) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid session company'); err.status = 401; throw err;
  }

  const staffId = Number(staffIdRaw);
  if (!Number.isFinite(staffId) || staffId < 1) {
    const err = new Error('Invalid staffId'); err.status = 400; throw err;
  }

  const staffName  = String(body.staffName  || '').trim();
  const designation = String(body.designation || '').trim();
  const email      = normalizeEmail(body.email || '');
  const branchId   = Number(body.branchId);
  const mobileNo   = body.mobileNo != null ? String(body.mobileNo).trim() : '';
  const password   = body.password != null ? String(body.password) : '';
  const pin        = body.pin != null ? String(body.pin).trim() : '';
  const roleIdRaw  = body.roleId == null || body.roleId === '' ? null : Number(body.roleId);

  const errors = [];
  if (!staffName)  errors.push('staffName is required');
  if (!email)      errors.push('email is required');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('email is invalid');
  if (!Number.isFinite(branchId) || branchId < 1) errors.push('branchId is required');
  if (password && password.length < 8) errors.push('password must be at least 8 characters');
  if (pin && !/^\d{4,6}$/.test(pin)) errors.push('PIN must be 4-6 digits');
  if (roleIdRaw != null && (!Number.isFinite(roleIdRaw) || roleIdRaw < 1)) errors.push('roleId is invalid');
  if (errors.length) { const e = new Error(errors.join('; ')); e.status = 400; throw e; }

  const branchOk = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!branchOk) { const e = new Error('Invalid branch'); e.status = 400; throw e; }

  let role = null;
  if (roleIdRaw != null) {
    role = await roleRepo.findRoleByCompany(pool, companyId, roleIdRaw);
    if (!role) { const e = new Error('Invalid role for this company'); e.status = 400; throw e; }
    if (roleIdRaw === roleRepo.DEFAULT_ROLE_IDS.admin && Number(authStaff.role_id) !== roleRepo.DEFAULT_ROLE_IDS.admin) {
      const e = new Error('Only admins can assign the admin role'); e.status = 403; throw e;
    }
  }

  // email uniqueness — exclude current staff row
  const { rows: conflict } = await pool.query(
    `SELECT 1 FROM core.staff_master
     WHERE (LOWER(login_name) = LOWER($1) OR (email IS NOT NULL AND LOWER(TRIM(email)) = LOWER($1)))
       AND company_id = $2 AND staff_id <> $3 LIMIT 1`,
    [email, companyId, staffId]
  );
  if (conflict.length > 0) {
    const e = new Error('Email already used by another staff'); e.status = 409; throw e;
  }

  const actor = String(authStaff.staff_name || authStaff.login_name || 'staff').slice(0, 50);
  const updated = await withTransaction(async (client) => {
    const details = await staffRepo.updateStaffDetails(client, {
      companyId, staffId, staffName, designation, branchId,
      mobileNo: mobileNo || null, email, actor,
    });
    if (!details) return null;

    if (roleIdRaw != null && Number(details.role_id) !== Math.trunc(roleIdRaw)) {
      await staffRepo.updateStaffRole(client, {
        companyId,
        staffId: Math.trunc(staffId),
        roleId: Math.trunc(roleIdRaw),
        actor,
      });
    }

    if (password) {
      const staffPk = await staffRepo.findStaffPk(client, companyId, staffId);
      if (staffPk) {
        await staffRepo.updatePasswordHashByStaffPk(client, staffPk, await bcrypt.hash(password, 12));
      }
    }

    if (pin) {
      await staffRepo.updateStaffPin(client, companyId, staffId, await bcrypt.hash(pin, 12));
    }

    return staffRepo.findStaffForCompanyByStaffId(client, companyId, staffId);
  });

  if (!updated) { const e = new Error('Staff not found'); e.status = 404; throw e; }

  // Drop cached session so updated details apply on the next request.
  await invalidateStaffSession(await staffRepo.findStaffPk(pool, companyId, staffId));

  let garageTechnician = null;
  if (role && isGarageRole(role)) {
    garageTechnician = await ensureGarageTechnician(pool, updated, {
      companyId,
      actor,
      specialisation: updated.designation,
    });
  }

  return {
    staffId:     Number(updated.staff_id),
    staffCode:   updated.staff_code != null ? String(updated.staff_code) : null,
    staffName:   updated.staff_name,
    branchId:    updated.branch_id != null ? Number(updated.branch_id) : null,
    designation: updated.designation ?? null,
    mobileNo:    updated.mobile_no ?? null,
    email:       updated.email ?? null,
    roleId:      updated.role_id != null ? Number(updated.role_id) : null,
    hasPIN:      pin ? true : undefined,
    garageTechnician,
  };
}

export async function resetStaffPassword(pool, staffIdRaw, body, authStaff) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid session company'); err.status = 401; throw err;
  }

  const staffId = Number(staffIdRaw);
  if (!Number.isFinite(staffId) || staffId < 1) {
    const err = new Error('Invalid staffId'); err.status = 400; throw err;
  }

  const password = String(body?.newPassword || '');
  if (password.length < 8) {
    const e = new Error('Password must be at least 8 characters'); e.status = 400; throw e;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const { rowCount } = await pool.query(
    `UPDATE core.staff_master
     SET password_hash = $3, modified_at = NOW(), modified_by = $4
     WHERE company_id = $1 AND staff_id = $2 AND record_status = 'ACTIVE'`,
    [companyId, staffId, passwordHash, String(authStaff.staff_name || 'admin').slice(0, 50)]
  );

  if (!rowCount) { const e = new Error('Staff not found'); e.status = 404; throw e; }

  // Password changed — force re-auth against DB on next request.
  await invalidateStaffSession(await staffRepo.findStaffPk(pool, companyId, staffId));
  return { ok: true };
}

export async function updateStaffMemberRole(pool, staffIdRaw, body, authStaff) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid session company');
    err.status = 401;
    throw err;
  }

  const staffId = Number(staffIdRaw);
  if (!Number.isFinite(staffId) || staffId < 1) {
    const err = new Error('Invalid staffId');
    err.status = 400;
    throw err;
  }

  // Prevent staff from changing their own role (privilege escalation).
  if (Number(authStaff.staff_id) === staffId) {
    const err = new Error('Cannot change your own role');
    err.status = 403;
    throw err;
  }

  const roleId = Number(body?.roleId);
  if (!Number.isFinite(roleId) || roleId < 1) {
    const err = new Error('roleId is required');
    err.status = 400;
    throw err;
  }

  // Only admins (role_id = 1) can assign the admin role to others.
  if (roleId === roleRepo.DEFAULT_ROLE_IDS.admin && Number(authStaff.role_id) !== roleRepo.DEFAULT_ROLE_IDS.admin) {
    const err = new Error('Only admins can assign the admin role');
    err.status = 403;
    throw err;
  }

  const role = await roleRepo.findRoleByCompany(pool, companyId, roleId);
  if (!role) {
    const err = new Error('Invalid role for this company');
    err.status = 400;
    throw err;
  }

  const actor = String(authStaff.staff_name || authStaff.login_name || 'staff').slice(0, 50);
  const updated = await staffRepo.updateStaffRole(pool, {
    companyId,
    staffId: Math.trunc(staffId),
    roleId: Math.trunc(roleId),
    actor,
  });

  if (!updated) {
    const err = new Error('Staff not found');
    err.status = 404;
    throw err;
  }

  // Role/permissions changed — drop cached session so new role applies at once.
  await invalidateStaffSession(await staffRepo.findStaffPk(pool, companyId, staffId));

  let garageTechnician = null;
  if (isGarageRole(role)) {
    garageTechnician = await ensureGarageTechnician(pool, updated, {
      companyId,
      actor,
      specialisation: updated.designation,
    });
  }

  return {
    staffId: Number(updated.staff_id),
    staffCode: updated.staff_code != null ? String(updated.staff_code) : null,
    staffName: updated.staff_name,
    branchId: updated.branch_id != null ? Number(updated.branch_id) : null,
    email: updated.email ?? null,
    roleId: Number(updated.role_id),
    garageTechnician,
  };
}

export async function listBranchesForCompany(pool, companyId) {
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid < 1) return [];
  const { rows } = await branchRepo.listBranchesByCompany(pool, cid);
  return rows.map((r) => ({
    branchId: r.branch_id,
    branchCode: r.branch_code,
    branchName: r.branch_name,
  }));
}
