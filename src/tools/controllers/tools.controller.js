import { pool } from '../../config/db.js';
import * as service from '../services/tools.service.js';

const handle = (fn) => async (req, res, next) => {
  try { return res.json(await fn(req)); } catch (error) { return next(error); }
};

export const importRows = handle((req) => service.importRows(pool, req.authStaff, req.body || {}));
export const exportData = handle((req) => service.exportData(pool, req.authStaff, req.params.entityType));
export const jobs = handle((req) => service.listJobs(pool, req.authStaff));
export const audit = handle((req) => service.listAudit(pool, req.authStaff, req.query));
export const systemLogs = handle((req) => service.systemLogs(pool, req.authStaff, req.query));
export const duplicates = handle((req) => service.findDuplicates(pool, req.authStaff, req.params.entityType));
export const bulkUpdate = handle((req) => service.bulkUpdate(pool, req.authStaff, req.body || {}));
export const labels = handle((req) => service.labels(pool, req.authStaff, req.query));
export const sequences = handle((req) => service.sequences(pool, req.authStaff));
export const backup = handle((req) => service.backup(pool, req.authStaff));
export const restore = handle((req) => service.restore(pool, req.authStaff, req.body || {}));
