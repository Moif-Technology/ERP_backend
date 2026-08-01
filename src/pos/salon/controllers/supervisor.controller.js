import * as supervisorService from '../services/supervisor.service.js';

function fail(res, err, fallback) {
  if (err.status) {
    return res.status(err.status).json({
      ok: false,
      code: err.code ?? null,
      message: err.message,
    });
  }
  console.error('[salon supervisor]', err);
  return res.status(500).json({ ok: false, code: 'INTERNAL', message: fallback });
}

/** POST /supervisor/verify — { username, password } */
export async function verify(req, res) {
  try {
    return res.json(await supervisorService.verifySupervisor(req.authStaff, req.body));
  } catch (err) {
    return fail(res, err, 'Supervisor verification failed');
  }
}
