import { withTransaction } from '../config/db.js';
import * as roleRepo from '../repositories/role.repository.js';

function parseCompanyId(authStaff) {
  const companyId = Number(authStaff?.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid session company');
    err.status = 401;
    throw err;
  }
  return companyId;
}

function parseRoleId(raw) {
  const roleId = Number(raw);
  if (!Number.isFinite(roleId) || roleId < 1) {
    const err = new Error('Invalid roleId');
    err.status = 400;
    throw err;
  }
  return Math.trunc(roleId);
}

function normalizePermissionCodes(body) {
  const input = Array.isArray(body?.permissionCodes)
    ? body.permissionCodes
    : Array.isArray(body?.permissions)
      ? body.permissions
      : null;

  if (!input) {
    const err = new Error('permissionCodes array is required');
    err.status = 400;
    throw err;
  }

  return [
    ...new Set(
      input
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') {
            if (item.isAllowed === false || item.is_allowed === false) return '';
            return item.permissionCode ?? item.permission_code ?? '';
          }
          return '';
        })
        .map((code) => String(code).trim())
        .filter(Boolean)
    ),
  ];
}

function normalizeRoleBody(body) {
  const roleName = String(body?.roleName ?? body?.role_name ?? '').trim();
  if (!roleName) {
    const err = new Error('roleName is required');
    err.status = 400;
    throw err;
  }
  if (roleName.length > 100) {
    const err = new Error('roleName must be at most 100 characters');
    err.status = 400;
    throw err;
  }

  const discountPercentAllowed = Number(body?.discountPercentAllowed ?? body?.discount_percent_allowed ?? 0);
  if (!Number.isFinite(discountPercentAllowed) || discountPercentAllowed < 0 || discountPercentAllowed > 100) {
    const err = new Error('discountPercentAllowed must be between 0 and 100');
    err.status = 400;
    throw err;
  }

  const softwareType = String(body?.softwareType ?? body?.software_type ?? 'ERP').trim().slice(0, 50) || 'ERP';
  return {
    roleName,
    discountPercentAllowed: Math.round(discountPercentAllowed * 100) / 100,
    softwareType,
  };
}

function mapRole(row) {
  return {
    roleId: Number(row.role_id),
    roleName: row.role_name,
    discountPercentAllowed: Number(row.discount_percent_allowed || 0),
    softwareType: row.software_type ?? null,
    recordStatus: row.record_status,
  };
}

function mapPermission(row) {
  return {
    permissionCode: row.permission_code,
    featureCode: row.feature_code,
    featureName: row.feature_name ?? null,
    packCode: row.pack_code ?? null,
    actionCode: row.action_code,
    permissionName: row.permission_name,
    description: row.description ?? null,
  };
}

export async function listRoles(db, authStaff) {
  const companyId = parseCompanyId(authStaff);
  const rows = await roleRepo.listRolesByCompany(db, companyId);
  return rows.map(mapRole);
}

export async function createRole(_db, authStaff, body) {
  const companyId = parseCompanyId(authStaff);
  const parsed = normalizeRoleBody(body);
  const actor = String(authStaff?.staff_name || authStaff?.login_name || 'role-entry').slice(0, 50);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `core.role_master:${companyId}`,
    ]);
    const roleId = await roleRepo.nextRoleId(client, companyId);
    const row = await roleRepo.insertRole(client, {
      companyId,
      roleId,
      ...parsed,
      actor,
    });
    return mapRole(row);
  });
}

export async function updateRole(_db, authStaff, roleIdRaw, body) {
  const companyId = parseCompanyId(authStaff);
  const roleId = parseRoleId(roleIdRaw);
  const parsed = normalizeRoleBody(body);
  const actor = String(authStaff?.staff_name || authStaff?.login_name || 'role-entry').slice(0, 50);

  const row = await roleRepo.updateRole(_db, {
    companyId,
    roleId,
    ...parsed,
    actor,
  });
  if (!row) {
    const err = new Error('Role not found');
    err.status = 404;
    throw err;
  }
  return mapRole(row);
}

export async function deactivateRole(db, authStaff, roleIdRaw) {
  const companyId = parseCompanyId(authStaff);
  const roleId = parseRoleId(roleIdRaw);
  const actor = String(authStaff?.staff_name || authStaff?.login_name || 'role-entry').slice(0, 50);

  const assignedCount = await roleRepo.countActiveStaffForRole(db, companyId, roleId);
  if (assignedCount > 0) {
    const err = new Error(`Cannot deactivate role while ${assignedCount} active staff member(s) are assigned`);
    err.status = 409;
    err.assignedCount = assignedCount;
    throw err;
  }

  const row = await roleRepo.deactivateRole(db, { companyId, roleId, actor });
  if (!row) {
    const err = new Error('Role not found');
    err.status = 404;
    throw err;
  }
  return mapRole(row);
}

export async function listPermissionCatalog(db) {
  const rows = await roleRepo.listPermissionCatalog(db);
  return rows.map(mapPermission);
}

export async function getRolePermissions(db, authStaff, roleIdRaw) {
  const companyId = parseCompanyId(authStaff);
  const roleId = parseRoleId(roleIdRaw);
  if (!(await roleRepo.roleBelongsToCompany(db, companyId, roleId))) {
    const err = new Error('Role not found');
    err.status = 404;
    throw err;
  }
  const rows = await roleRepo.listRolePermissions(db, companyId, roleId);
  return {
    roleId,
    permissions: rows.map((row) => ({
      permissionCode: row.permission_code,
      isAllowed: row.is_allowed === true,
    })),
  };
}

export async function updateRolePermissions(_db, authStaff, roleIdRaw, body) {
  const companyId = parseCompanyId(authStaff);
  const roleId = parseRoleId(roleIdRaw);
  const permissionCodes = normalizePermissionCodes(body);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `core.role_permission:${companyId}:${roleId}`,
    ]);

    if (!(await roleRepo.roleBelongsToCompany(client, companyId, roleId))) {
      const err = new Error('Role not found');
      err.status = 404;
      throw err;
    }

    const validCodes = await roleRepo.listValidPermissionCodes(client, permissionCodes);
    if (validCodes.length !== permissionCodes.length) {
      const valid = new Set(validCodes);
      const invalidCodes = permissionCodes.filter((code) => !valid.has(code));
      const err = new Error('Invalid permission code');
      err.status = 400;
      err.invalidCodes = invalidCodes;
      throw err;
    }

    await roleRepo.replaceRolePermissions(client, companyId, roleId, permissionCodes);
    const rows = await roleRepo.listRolePermissions(client, companyId, roleId);
    return {
      roleId,
      permissions: rows.map((row) => ({
        permissionCode: row.permission_code,
        isAllowed: row.is_allowed === true,
      })),
    };
  });
}
