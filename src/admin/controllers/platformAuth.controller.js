import * as platformAuth from '../services/platformAuth.service.js';

export async function login(req, res) {
  try {
    const result = await platformAuth.login(req.body || {});
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }
}

export async function refresh(req, res) {
  try {
    const result = await platformAuth.refresh(req.body || {});
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }
}

export function me(req, res) {
  return res.json({
    user: req.platformUser,
    capabilities: req.platformCapabilities || [],
  });
}

export function logout(req, res) {
  return res.json({ ok: true });
}
