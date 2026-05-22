import { pool } from '../config/db.js';
import * as roleService from '../services/role.service.js';

function handleRoleError(res, err, fallbackMessage) {
  if (err.status) {
    return res.status(err.status).json({
      message: err.message,
      invalidCodes: err.invalidCodes,
      assignedCount: err.assignedCount,
    });
  }
  console.error(err);
  return res.status(500).json({ message: fallbackMessage });
}

export async function listRoles(req, res) {
  try {
    const roles = await roleService.listRoles(pool, req.authStaff);
    return res.json({ roles });
  } catch (err) {
    return handleRoleError(res, err, 'Could not load roles');
  }
}

export async function createRole(req, res) {
  try {
    const role = await roleService.createRole(pool, req.authStaff, req.body);
    return res.status(201).json(role);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Role name already exists for this company' });
    }
    return handleRoleError(res, err, 'Could not create role');
  }
}

export async function updateRole(req, res) {
  try {
    const role = await roleService.updateRole(pool, req.authStaff, req.params.roleId, req.body);
    return res.json(role);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Role name already exists for this company' });
    }
    return handleRoleError(res, err, 'Could not update role');
  }
}

export async function deactivateRole(req, res) {
  try {
    const role = await roleService.deactivateRole(pool, req.authStaff, req.params.roleId);
    return res.json(role);
  } catch (err) {
    return handleRoleError(res, err, 'Could not deactivate role');
  }
}

export async function listPermissionCatalog(_req, res) {
  try {
    const permissions = await roleService.listPermissionCatalog(pool);
    return res.json({ permissions });
  } catch (err) {
    return handleRoleError(res, err, 'Could not load permission catalog');
  }
}

export async function getRolePermissions(req, res) {
  try {
    const result = await roleService.getRolePermissions(pool, req.authStaff, req.params.roleId);
    return res.json(result);
  } catch (err) {
    return handleRoleError(res, err, 'Could not load role permissions');
  }
}

export async function updateRolePermissions(req, res) {
  try {
    const result = await roleService.updateRolePermissions(
      pool,
      req.authStaff,
      req.params.roleId,
      req.body
    );
    return res.json(result);
  } catch (err) {
    return handleRoleError(res, err, 'Could not update role permissions');
  }
}
