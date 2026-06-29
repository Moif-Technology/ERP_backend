import { withTransaction } from '../../config/db.js';
import * as roleRepo from '../repositories/role.repository.js';
import * as staffRepo from '../repositories/staff.repository.js';
import { invalidateStaffSession } from '../../middleware/authMiddleware.js';
import { resolveEntitlementsForStaff } from './entitlement.service.js';

const PROTECTED_ROLE_IDS = new Set(Object.values(roleRepo.DEFAULT_ROLE_IDS));

function assertNotProtectedRole(roleId, action = 'modify') {
  if (PROTECTED_ROLE_IDS.has(roleId)) {
    const err = new Error(`Cannot ${action} a system default role (id=${roleId}). Create a custom role instead.`);
    err.status = 403;
    err.code = 'PROTECTED_ROLE';
    throw err;
  }
}

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
  assertNotProtectedRole(roleId, 'update');
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
  assertNotProtectedRole(roleId, 'deactivate');
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

/**
 * Set of feature codes enabled for the company (plan ∩ software type, plus
 * grants/overrides). Returns null when the entitlement schema is absent
 * (legacy install) — callers then skip feature filtering entirely.
 */
async function getEnabledFeatureSet(db, companyId) {
  const access = await resolveEntitlementsForStaff({ company_id: companyId }, db);
  if (access?.meta?.source === 'legacy-fallback') return null;
  const set = new Set();
  for (const [code, enabled] of Object.entries(access.features || {})) {
    if (enabled) set.add(code);
  }
  return set;
}

function permissionFeatureEnabled(featureCode, enabledSet) {
  if (enabledSet === null) return true;
  if (!featureCode) return true; // generic permission not tied to a feature
  return enabledSet.has(featureCode);
}

export async function listPermissionCatalog(db, authStaff) {
  const rows = await roleRepo.listPermissionCatalog(db);
  // Tenant admins only see permissions for features their company actually
  // has (software type + plan). Without auth context (legacy callers), show all.
  if (!authStaff) return rows.map(mapPermission);
  const companyId = parseCompanyId(authStaff);
  const enabledSet = await getEnabledFeatureSet(db, companyId);
  return rows
    .filter((row) => permissionFeatureEnabled(row.feature_code, enabledSet))
    .map(mapPermission);
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
  assertNotProtectedRole(roleId, 'modify permissions of');
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

    const validRows = await roleRepo.listValidPermissionsWithFeatures(client, permissionCodes);
    // Silently drop any codes that are inactive or don't exist in permission_master.
    // This prevents stale role_permission rows (from features deactivated via migration)
    // from causing a 400 when an admin saves the role.
    // Also drop permissions for features the company doesn't have (software
    // type + plan) — the catalog never shows them, but reject direct API
    // attempts too.
    const enabledSet = await getEnabledFeatureSet(client, companyId);
    const validCodes = validRows
      .filter((row) => permissionFeatureEnabled(row.feature_code, enabledSet))
      .map((row) => row.permission_code);
    await roleRepo.replaceRolePermissions(client, companyId, roleId, validCodes);

    // Invalidate cached sessions for all staff currently assigned this role
    // so their new permissions take effect without requiring re-login.
    const staffPks = await staffRepo.findStaffPksByRole(client, companyId, roleId);
    await Promise.all(staffPks.map((pk) => invalidateStaffSession(pk)));

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
