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
 * POST /api/counter-pos/pin-login
 * Body: { staffCode, pin, companyId }
 */
export async function pinLogin(req, res) {
  try {
    const { accessToken, refreshToken, session } = await authService.loginWithPin(req.body);
    return res.json({ accessToken, refreshToken, session });
  } catch (err) {
    return handleError(res, err, 'PIN login failed');
  }
}
