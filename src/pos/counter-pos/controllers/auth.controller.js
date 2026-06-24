import * as authService from '../services/auth.service.js';

function handleError(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: fallback });
}

/**
 * POST /api/counter-pos/device/enroll
 * Body: { adminUsername, adminPassword, deviceToken, label? }
 * company_id + branch_id derived from admin's staff record — no manual input.
 */
export async function enrollDevice(req, res) {
  try {
    const result = await authService.enrollDevice(req.body);
    return res.json(result);
  } catch (err) {
    return handleError(res, err, 'Device enrollment failed');
  }
}

/**
 * POST /api/counter-pos/device/stations
 * Body: { adminUsername, adminPassword }
 * Verifies admin credentials, returns COUNTER_POS stations for that company.
 */
export async function listStationsForEnroll(req, res) {
  try {
    const result = await authService.listStationsForEnroll(req.body);
    return res.json(result);
  } catch (err) {
    return handleError(res, err, 'Could not load stations');
  }
}

/**
 * POST /api/counter-pos/staff-list
 * Body: { deviceToken }
 * Returns the staff picker (id + name only) for the enrolled device's company.
 */
export async function listStaff(req, res) {
  try {
    const result = await authService.listStaffForDevice(req.body);
    return res.json(result);
  } catch (err) {
    return handleError(res, err, 'Could not load staff');
  }
}

/**
 * POST /api/counter-pos/pin-login
 * Body: { staffId, pin, companyId }   (staffId = staffPk from the picker)
 */
export async function pinLogin(req, res) {
  try {
    const { accessToken, refreshToken, session } = await authService.loginWithPin(req.body);
    return res.json({ accessToken, refreshToken, session });
  } catch (err) {
    return handleError(res, err, 'PIN login failed');
  }
}
