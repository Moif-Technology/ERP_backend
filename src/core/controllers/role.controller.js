import { pool } from '../../config/db.js';
import * as roleService from '../services/role.service.js';
import * as roleAccessRepo from '../repositories/roleAccess.repository.js';

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

export async function listPermissionCatalog(req, res) {
  try {
    const permissions = await roleService.listPermissionCatalog(pool, req.authStaff);
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

export async function getMyAccess(req, res) {
  try {
    const companyId = Number(req.authStaff?.company_id);
    const roleId    = Number(req.authStaff?.role_id);
    if (!companyId) return res.status(401).json({ message: 'Unauthorized' });

    const [pagesResult, planFeaturesRes, overridesRes, subRes] = await Promise.all([
      roleId ? roleAccessRepo.getPageAccess(companyId, roleId) : Promise.resolve([]),
      pool.query(`
        SELECT pf.feature_code
        FROM core.plan_feature pf
        JOIN (
          SELECT COALESCE(ts.plan_code, ob.plan_code, 'custom') AS plan_code
          FROM core.company_master c
          LEFT JOIN core.tenant_subscription ts ON ts.company_id = c.company_id
          LEFT JOIN core.company_onboarding ob ON ob.company_id = c.company_id
          WHERE c.company_id = $1
          LIMIT 1
        ) sub ON sub.plan_code = pf.plan_code
        WHERE pf.is_enabled = TRUE
      `, [companyId]),
      pool.query(
        `SELECT feature_code, is_enabled FROM core.tenant_feature_override WHERE company_id = $1`,
        [companyId]
      ),
      pool.query(
        `SELECT COALESCE(ts.plan_code, ob.plan_code, 'custom') AS plan_code
         FROM core.company_master c
         LEFT JOIN core.tenant_subscription ts ON ts.company_id = c.company_id
         LEFT JOIN core.company_onboarding ob ON ob.company_id = c.company_id
         WHERE c.company_id = $1 LIMIT 1`,
        [companyId]
      ),
    ]);

    // Build enabled-features set: start from plan, apply overrides
    const enabled = new Set(planFeaturesRes.rows.map((r) => r.feature_code));
    for (const r of overridesRes.rows) {
      if (r.is_enabled) enabled.add(r.feature_code);
      else enabled.delete(r.feature_code);
    }

    // featuresConfigured = plan had rows OR tenant has explicit overrides
    const featuresConfigured = planFeaturesRes.rows.length > 0 || overridesRes.rows.length > 0;

    return res.json({
      roleId,
      planCode: subRes.rows[0]?.plan_code || null,
      features: [...enabled],
      pages: pagesResult,
      featuresConfigured,
      pagesRestricted: pagesResult.length > 0,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not load access data' });
  }
}

export async function getRolePages(req, res) {
  try {
    const companyId = Number(req.authStaff?.company_id);
    const roleId = Number(req.params.roleId);
    if (!companyId || !roleId) return res.status(400).json({ message: 'Invalid params' });
    const pages = await roleAccessRepo.getPageAccess(companyId, roleId);
    return res.json({ roleId, pages });
  } catch (err) {
    return res.status(500).json({ message: 'Could not load page access' });
  }
}

export async function setRolePages(req, res) {
  try {
    const companyId = Number(req.authStaff?.company_id);
    const roleId = Number(req.params.roleId);
    const { pages } = req.body;
    if (!companyId || !roleId || !Array.isArray(pages)) {
      return res.status(400).json({ message: 'Invalid params' });
    }
    const clean = pages.filter((p) => typeof p === 'string' && p.startsWith('/'));
    await roleAccessRepo.setPageAccess(companyId, roleId, clean);
    return res.json({ roleId, pages: clean });
  } catch (err) {
    return res.status(500).json({ message: 'Could not update page access' });
  }
}
