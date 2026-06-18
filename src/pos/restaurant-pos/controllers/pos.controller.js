import * as authService from '../../../core/services/auth.service.js';
import * as staffRepo from '../../../core/repositories/staff.repository.js';
import { pool } from '../../../config/db.js';
import * as posParameterService from '../services/posParameter.service.js';
import { resolvePosPrivilegesForStaff } from '../../../core/services/entitlement.service.js';

function handlePosError(res, err, fallback) {
  if (err.status) {
    return res.status(err.status).json({ message: err.message });
  }
  if (err.code === '42P01' || err.message?.includes('does not exist')) {
    return res.status(503).json({
      message:
        'Database not ready. Run migrations for parameters: core.parameter_definition, core.company_parameter_value.',
    });
  }
  if (err.code === '42703') {
    return res.status(503).json({ message: 'Database migration required (missing column).' });
  }
  console.error(err);
  return res.status(500).json({ message: fallback });
}

/**
 * POST /api/pos/login
 * Username/password login for Restaurant POS (Flutter AdminMainDesktop).
 * Only staff with role software_type = 'RESTAURANT-POS' or 'ERP' can login.
 */
export async function login(req, res) {
  const username = req.body?.login ?? req.body?.username;
  const password = req.body?.password;
  try {
    const { accessToken, refreshToken, session } = await authService.loginWithCredentialsForPOS(
      username,
      password,
      'RESTAURANT-POS'
    );
    const u = session.user;
    const c = session.company;
    return res.json({
      stationId: u.stationId != null ? String(u.stationId) : '',
      staffName: u.staffName ?? '',
      staffID: u.staffId != null ? String(u.staffId) : '',
      companyId: c?.companyId != null ? String(c.companyId) : '',
      accessToken,
      refreshToken,
      subscription: session.subscription ?? null,
      features: session.features ?? {},
      limits: session.limits ?? {},
      permissions: session.permissions ?? [],
    });
  } catch (err) {
    return handlePosError(res, err, 'Login failed');
  }
}

/**
 * POST /api/pos/pin-login
 * PIN login for Restaurant POS — same UX as Counter-POS.
 * Body: { pin, companyId }
 */
export async function pinLogin(req, res) {
  try {
    const { accessToken, refreshToken, session } = await authService.loginWithPinForRestaurant(req.body);
    const u = session.user;
    const c = session.company;
    return res.json({
      stationId: u.stationId != null ? String(u.stationId) : '',
      staffName: u.staffName ?? '',
      staffID: u.staffId != null ? String(u.staffId) : '',
      companyId: c?.companyId != null ? String(c.companyId) : '',
      accessToken,
      refreshToken,
      subscription: session.subscription ?? null,
      features: session.features ?? {},
      limits: session.limits ?? {},
      permissions: session.permissions ?? [],
    });
  } catch (err) {
    return handlePosError(res, err, 'PIN login failed');
  }
}

/**
 * POST /api/pos/staff-list
 * Public — returns staff with PINs set for this company (for staff picker UI).
 * Body: { companyId }
 */
export async function staffList(req, res) {
  try {
    const companyId = Number(req.body?.companyId);
    if (!Number.isFinite(companyId) || companyId < 1) {
      return res.status(400).json({ message: 'companyId is required' });
    }
    const rows = await staffRepo.findAllActiveStaffWithPinForCompany(pool, companyId);
    const staff = rows.map((r) => ({
      staffPk:  r.id,
      staffName: r.staff_name,
      roleName:  r.role_name || null,
    }));
    return res.json({ staff, companyId });
  } catch (err) {
    return handlePosError(res, err, 'Could not load staff list');
  }
}

/** GET /api/pos/parameters — Flutter-shaped payload after login. */
export async function getParameters(req, res) {
  try {
    const data = await posParameterService.loadParametersPayload(req.authStaff.company_id);
    return res.json({ success: true, data });
  } catch (err) {
    return handlePosError(res, err, 'Could not load parameters');
  }
}

/** GET /api/pos/parameter-definitions — field list for ERP settings UI. */
export async function getParameterDefinitions(_req, res) {
  try {
    const definitions = await posParameterService.getParameterDefinitions();
    return res.json({ success: true, definitions });
  } catch (err) {
    return handlePosError(res, err, 'Could not load parameter definitions');
  }
}

/** PUT /api/pos/parameters — partial update (snake_case keys). */
export async function putParameters(req, res) {
  try {
    const result = await posParameterService.updateParameters(req.authStaff.company_id, req.body ?? {});
    return res.json({ success: true, ignoredKeys: result.ignoredKeys });
  } catch (err) {
    return handlePosError(res, err, 'Could not save parameters');
  }
}

/** PUT /api/pos/parameters/company-details — legacy Flutter body (heading1…5, footer1, footer2, taxRegNo). */
export async function putCompanyDetails(req, res) {
  try {
    await posParameterService.updateCompanyDetails(req.authStaff.company_id, req.body ?? {});
    return res.json({ success: true });
  } catch (err) {
    return handlePosError(res, err, 'Could not save company details');
  }
}

/** GET /api/pos/privileges — static list (privilege DB/UI deferred). */
export async function getPrivileges(req, res) {
  try {
    const privileges = await resolvePosPrivilegesForStaff(req.authStaff);
    return res.json({ success: true, privileges });
  } catch (err) {
    return handlePosError(res, err, 'Could not load privileges');
  }
}
