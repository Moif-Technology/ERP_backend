import { pool } from '../config/db.js';
import {
  classifySystemEvent,
  extractReferenceFields,
  sanitizeLogValue,
} from './systemActivityLogger.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function buildPlatformActivityLogger({ db = pool } = {}) {
  return function platformActivityLogger(req, res, next) {
    const method = String(req.method || '').toUpperCase();
    if (!MUTATING_METHODS.has(method) || req.originalUrl?.includes('/auth/refresh')) return next();
    const startedAt = Date.now();
    let responseReferences = {};
    let responseMessage = '';
    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      responseReferences = extractReferenceFields(payload);
      if (typeof payload?.message === 'string') responseMessage = payload.message.slice(0, 250);
      return originalJson(payload);
    };
    res.once('finish', () => {
      const user = req.platformUser || {};
      const explicit = req.platformLogContext || {};
      const actor = explicit.actor || user.fullName || user.email || req.body?.email || 'platform user';
      const event = classifySystemEvent(method, req.originalUrl, res.statusCode);
      const refs = { ...extractReferenceFields(req.params), ...extractReferenceFields(req.body), ...responseReferences };
      const primaryRef = Object.values(refs).find((value) => value != null && value !== '');
      const success = res.statusCode < 400;
      const message = explicit.message || `Super Admin ${event.action.toLowerCase()} ${success ? 'completed' : `failed${responseMessage ? `: ${responseMessage}` : ''}`}`;
      const details = {
        action: event.action,
        actor,
        method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        ipAddress: req.ip || req.socket?.remoteAddress || null,
        userAgent: req.get?.('user-agent') || null,
        references: refs,
        request: sanitizeLogValue(req.body || {}),
      };
      db.query(
        `INSERT INTO core.platform_system_log
           (platform_user_id, actor, level, source, action, entity_type, entity_id,
            message, details, http_method, request_path, status_code, duration_ms,
            ip_address, user_agent)
         VALUES ($1,$2,$3,'SUPER_ADMIN',$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14)`,
        [
          explicit.platformUserId || user.platformUserId || null, actor,
          event.level, event.action, explicit.entityType || event.entityType,
          primaryRef != null ? String(primaryRef) : null, message, JSON.stringify(details),
          method, req.originalUrl, res.statusCode, details.durationMs,
          details.ipAddress, details.userAgent,
        ],
      ).catch((error) => req.log?.error?.({ err: error }, 'Could not persist platform activity log'));
    });
    return next();
  };
}

export const platformActivityLogger = buildPlatformActivityLogger();
