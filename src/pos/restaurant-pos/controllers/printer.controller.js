import { pool } from '../../../config/db.js';
import * as printerService from '../services/printer.service.js';

function fail(res, err, fallback) {
  if (err.status) {
    return res.status(err.status).json({ ok: false, code: err.code ?? null, message: err.message });
  }
  if (err.code === '42P01') {
    return res.status(503).json({
      ok: false,
      message: 'Printer tables not installed. Run migration 124_pos_printer_and_print_jobs.sql.',
    });
  }
  console.error('[printer]', err.message, err.code, err.detail);
  return res.status(500).json({ ok: false, message: fallback });
}

export async function listPrinters(req, res) {
  try {
    return res.json(await printerService.listPrinters(pool, req.authStaff));
  } catch (err) {
    return fail(res, err, 'Could not load printers');
  }
}

export async function savePrinter(req, res) {
  try {
    return res.json(await printerService.savePrinter(pool, req.authStaff, req.body));
  } catch (err) {
    return fail(res, err, 'Could not save printer');
  }
}

export async function deletePrinter(req, res) {
  try {
    return res.json(await printerService.deletePrinter(pool, req.authStaff, req.params.printerId));
  } catch (err) {
    return fail(res, err, 'Could not delete printer');
  }
}

export async function createKotJobs(req, res) {
  try {
    return res.json(await printerService.createKotJobs(pool, req.authStaff, req.body));
  } catch (err) {
    return fail(res, err, 'Could not create print jobs');
  }
}

export async function claimJob(req, res) {
  try {
    return res.json(
      await printerService.claimJob(pool, req.authStaff, req.params.jobId, req.body?.claimedBy),
    );
  } catch (err) {
    return fail(res, err, 'Could not claim print job');
  }
}

export async function updateJobStatus(req, res) {
  try {
    return res.json(await printerService.updateJobStatus(pool, req.authStaff, req.params.jobId, req.body));
  } catch (err) {
    return fail(res, err, 'Could not update print job');
  }
}

export async function listKotJobs(req, res) {
  try {
    return res.json(await printerService.listKotJobs(pool, req.authStaff, req.params.kotMasterId));
  } catch (err) {
    return fail(res, err, 'Could not list print jobs');
  }
}
