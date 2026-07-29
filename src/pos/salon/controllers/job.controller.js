/**
 * Salon job controller — req/res only, all logic lives in the service.
 *
 * Error envelope is { ok, code, message } on EVERY path. Restaurant's kot
 * controller returns { ok:false, message } from saveKot but bare { message }
 * from getKot; the client then needs two shapes. One shape here.
 */
import { pool } from '../../../config/db.js';
import * as jobService from '../services/job.service.js';

function fail(res, err, fallback) {
  if (err.status) {
    return res.status(err.status).json({
      ok: false,
      code: err.code ?? null,
      message: err.message,
    });
  }
  if (err.code === '42P01') {
    return res.status(503).json({
      ok: false,
      code: 'TABLES_MISSING',
      message: 'Salon job tables not installed. Run: npm run migrate:salon',
    });
  }
  if (err.code === '23514') {
    // A CHECK failed — most likely chk_salon_service_needs_stylist.
    return res.status(400).json({
      ok: false,
      code: 'CONSTRAINT_VIOLATION',
      message: `Rejected by database constraint: ${err.constraint ?? 'unknown'}. ` +
               `A SERVICE line must name a stylist and use a valid status.`,
    });
  }
  if (err.code === '23505') {
    return res.status(409).json({
      ok: false,
      code: 'DUPLICATE',
      message: `Conflict on ${err.constraint ?? 'a unique constraint'}. ` +
               `A chair can hold only one open job.`,
    });
  }
  console.error('[salon job]', err);
  return res.status(500).json({ ok: false, code: 'INTERNAL', message: fallback });
}

export async function saveJob(req, res) {
  try {
    return res.status(200).json(await jobService.saveJob(pool, req.body, req.authStaff));
  } catch (err) {
    return fail(res, err, 'Could not save job');
  }
}

export async function listJobs(req, res) {
  try {
    return res.json(await jobService.listJobs(pool, req.authStaff, req.query));
  } catch (err) {
    return fail(res, err, 'Could not list jobs');
  }
}

export async function getJob(req, res) {
  try {
    return res.json(await jobService.getJob(pool, req.authStaff, req.params.jobId));
  } catch (err) {
    return fail(res, err, 'Could not load job');
  }
}

export async function setServiceStatus(req, res) {
  try {
    return res.json(await jobService.setLineServiceStatus(
      pool, req.authStaff, req.params.jobId, req.params.lineId,
      req.body?.serviceStatus ?? req.body?.ServiceStatus
    ));
  } catch (err) {
    return fail(res, err, 'Could not update service status');
  }
}

export async function reassignStylist(req, res) {
  try {
    return res.json(await jobService.reassignLineStylist(
      pool, req.authStaff, req.params.jobId, req.params.lineId,
      req.body?.stylistId ?? req.body?.StylistID
    ));
  } catch (err) {
    return fail(res, err, 'Could not reassign stylist');
  }
}
