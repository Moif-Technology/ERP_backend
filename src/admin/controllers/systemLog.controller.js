import * as repo from '../repositories/systemLog.repository.js';

export async function list(req, res) {
  try {
    const companyId = req.query.companyId ? Number(req.query.companyId) : null;
    const [logs, summary] = await Promise.all([
      repo.listSystemLogs({
        companyId: Number.isFinite(companyId) ? companyId : null,
        level: String(req.query.level || '').toUpperCase(),
        source: String(req.query.source || '').toUpperCase(),
        action: String(req.query.action || '').toUpperCase(),
        search: String(req.query.search || '').trim(),
        limit: req.query.limit,
        offset: req.query.offset,
      }),
      repo.getSystemLogSummary(),
    ]);
    return res.json({ logs, summary });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Could not load system logs' });
  }
}
