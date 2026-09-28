import * as supervisorService from '../../salon/services/supervisor.service.js';
import * as adminApprovalService from '../services/adminApproval.service.js';

/** Keep Quick's supervisor/PIN flow and restaurant's ADMIN/CHIEF CASHIER flow. */
export async function verify(req, res) {
  const body = {
    ...req.body,
    username: req.body?.username ?? req.body?.login ?? req.body?.loginName ?? req.body?.adminUsername,
    password: req.body?.password ?? req.body?.adminPassword,
  };
  try {
    let approval;
    try {
      approval = await supervisorService.verifySupervisor(req.authStaff, body);
    } catch (err) {
      // Only a valid password rejected by the older role policy can fall through.
      // Bad credentials, company checks and PIN failures must remain failures.
      if (err.code !== 'NOT_SUPERVISOR') throw err;
      approval = await adminApprovalService.verifyAdminCredentials(req.authStaff, body);
    }
    return res.json({ ...approval, IsAdmin: 1 });
  } catch (err) {
    if (!err.status) console.error('[restaurant supervisor]', err);
    return res.status(err.status ?? 500).json({
      ok: false,
      IsAdmin: 0,
      code: err.code ?? 'INTERNAL',
      message: err.status ? err.message : 'Supervisor verification failed',
    });
  }
}
