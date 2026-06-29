import { pool } from '../config/db.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SECRET_KEY = /(password|passcode|pin|token|secret|authorization|cookie|otp|hash)/i;
const REFERENCE_KEY = /(^id$|id$|_id$|Id$|No$|_no$|number$|Number$|code$|Code$|status$|Status$)/;
const SKIP_PATHS = new Set(['/api/auth/refresh']);

const ENTITY_NAMES = {
  products: 'product', customers: 'customer', suppliers: 'supplier',
  sales: 'sale', 'sales-returns': 'sales return', purchases: 'purchase',
  'purchase-returns': 'purchase return', lpos: 'purchase order', grns: 'goods receipt',
  quotations: 'quotation', 'delivery-orders': 'delivery order',
  'stock-entries': 'stock entry', vouchers: 'voucher', 'account-heads': 'account',
  staff: 'staff', roles: 'role', branches: 'branch', stations: 'station',
  groups: 'group', 'sub-groups': 'sub group', 'sub-sub-groups': 'sub sub group',
  company: 'company', parameters: 'system parameter', exchange: 'exchange rate',
  hr: 'HR record', crm: 'CRM record', garage: 'garage record',
  pos: 'restaurant POS', 'counter-pos': 'counter POS', van: 'van sale',
  'deals-offers': 'deal or offer', tools: 'tools operation', auth: 'authentication',
};

function cleanPath(pathname = '') {
  return String(pathname).split('?')[0].replace(/\/+/g, '/');
}

export function sanitizeLogValue(value, depth = 0) {
  if (depth > 4) return '[TRUNCATED]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeLogValue(item, depth + 1));
  if (typeof value !== 'object') return String(value);
  const output = {};
  for (const [key, nested] of Object.entries(value).slice(0, 60)) {
    output[key] = SECRET_KEY.test(key) ? '[REDACTED]' : sanitizeLogValue(nested, depth + 1);
  }
  return output;
}

export function extractReferenceFields(value, output = {}, depth = 0) {
  if (value == null || depth > 5 || Object.keys(output).length >= 30) return output;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 10)) extractReferenceFields(item, output, depth + 1);
    return output;
  }
  if (typeof value !== 'object') return output;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    if (REFERENCE_KEY.test(key) && (typeof nested === 'string' || typeof nested === 'number')) {
      output[key] ??= nested;
    } else if (nested && typeof nested === 'object') {
      extractReferenceFields(nested, output, depth + 1);
    }
  }
  return output;
}

export function classifySystemEvent(method, pathname, statusCode = 200) {
  const path = cleanPath(pathname);
  const parts = path.split('/').filter(Boolean);
  const apiIndex = parts.indexOf('api');
  const sourcePart = parts[apiIndex + 1] || 'system';
  const tail = parts.at(-1) || '';
  let action = method === 'DELETE' ? 'DELETE' : method === 'PUT' || method === 'PATCH' ? 'UPDATE' : 'CREATE';
  if (/^(post|unpost|cancel|complete|approve|reject|settle|close|deliver|issue|recall|hold|restore|login|logout|register)$/i.test(tail)) {
    action = tail.replaceAll('-', '_').toUpperCase();
  } else if (path.includes('/login')) action = 'LOGIN';
  else if (path.includes('/logout')) action = 'LOGOUT';
  else if (path.includes('/restore')) action = 'RESTORE';
  else if (path.includes('/import')) action = 'IMPORT';
  const source = sourcePart.replaceAll('-', '_').toUpperCase();
  const entityType = ENTITY_NAMES[sourcePart] || sourcePart.replaceAll('-', ' ') || 'system';
  const level = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO';
  return { action, source, entityType, level };
}

export function buildSystemActivityLogger({ db = pool } = {}) {
  return function systemActivityLogger(req, res, next) {
    const method = String(req.method || '').toUpperCase();
    const pathname = cleanPath(req.originalUrl || req.url);
    if (!MUTATING_METHODS.has(method) || SKIP_PATHS.has(pathname) || pathname.startsWith('/api/admin/')) return next();

    const startedAt = Date.now();
    let responseReferences = {};
    let responseMessage = '';
    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      responseReferences = extractReferenceFields(payload);
      if (typeof payload?.message === 'string' && !SECRET_KEY.test(payload.message)) {
        responseMessage = payload.message.slice(0, 250);
      }
      return originalJson(payload);
    };

    res.once('finish', () => {
      const auth = req.authStaff || {};
      const explicit = req.systemLogContext || {};
      const companyId = Number(explicit.companyId ?? auth.company_id ?? req.body?.companyId);
      if (!Number.isFinite(companyId) || companyId < 1) return;
      const branchCandidate = explicit.branchId ?? auth.branch_id ?? req.body?.branchId;
      const branchId = Number.isFinite(Number(branchCandidate)) ? Number(branchCandidate) : null;
      const actor = String(explicit.actor || auth.staff_name || auth.login_name || req.body?.username || req.body?.login || 'system').slice(0, 100);
      const event = classifySystemEvent(method, pathname, res.statusCode);
      const refs = { ...extractReferenceFields(req.params), ...extractReferenceFields(req.body), ...responseReferences };
      const primaryRef = Object.values(refs).find((value) => value != null && value !== '');
      const success = res.statusCode < 400;
      const message = explicit.message || `${event.entityType} ${event.action.toLowerCase()} ${success ? 'completed' : `failed${responseMessage ? `: ${responseMessage}` : ''}`}`;
      const details = {
        action: event.action,
        entityType: event.entityType,
        actor,
        method,
        path: pathname,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        ipAddress: req.ip || req.socket?.remoteAddress || null,
        userAgent: req.get?.('user-agent') || null,
        reference: primaryRef != null ? String(primaryRef) : null,
        references: refs,
        request: sanitizeLogValue(req.body || {}),
      };
      db.query(
        `INSERT INTO core.tool_system_log
           (company_id, branch_id, level, source, message, details, actor, action,
            entity_type, entity_id, http_method, request_path, status_code, duration_ms,
            ip_address, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          companyId, branchId, event.level, event.source, message, JSON.stringify(details),
          actor, event.action, event.entityType, primaryRef != null ? String(primaryRef) : null,
          method, pathname, res.statusCode, details.durationMs, details.ipAddress, details.userAgent,
        ],
      ).catch((error) => {
        req.log?.error?.({ err: error }, 'Could not persist system activity log');
      });
    });
    return next();
  };
}

export const systemActivityLogger = buildSystemActivityLogger();
