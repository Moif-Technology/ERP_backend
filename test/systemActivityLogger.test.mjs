import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  buildSystemActivityLogger,
  classifySystemEvent,
  extractReferenceFields,
  sanitizeLogValue,
} from '../src/middleware/systemActivityLogger.js';
import { buildPlatformActivityLogger } from '../src/middleware/platformActivityLogger.js';
import { toTenantBasicLog } from '../src/tools/services/tools.service.js';

test('classifies product update as an UPDATE event', () => {
  const event = classifySystemEvent('PUT', '/api/products/42', 200);
  assert.equal(event.action, 'UPDATE');
  assert.equal(event.source, 'PRODUCTS');
  assert.equal(event.entityType, 'product');
  assert.equal(event.level, 'INFO');
});

test('classifies sales posting and failed requests', () => {
  const posted = classifySystemEvent('POST', '/api/sales/91/post', 200);
  assert.equal(posted.action, 'POST');
  assert.equal(posted.entityType, 'sale');

  const failed = classifySystemEvent('POST', '/api/purchases', 500);
  assert.equal(failed.action, 'CREATE');
  assert.equal(failed.level, 'ERROR');
});

test('classifies an explicit Counter POS hold recall as a RECALL event', () => {
  const event = classifySystemEvent(
    'POST',
    '/api/counter-pos/sales/held/91/recall',
    200,
  );
  assert.equal(event.action, 'RECALL');
  assert.equal(event.source, 'COUNTER_POS');
  assert.equal(event.entityType, 'counter POS');
});

test('redacts credentials, tokens, pins, and nested secrets', () => {
  const value = sanitizeLogValue({
    username: 'cashier',
    password: 'secret',
    refreshToken: 'token',
    nested: { pin: '1234', productId: 7 },
  });
  assert.deepEqual(value, {
    username: 'cashier',
    password: '[REDACTED]',
    refreshToken: '[REDACTED]',
    nested: { pin: '[REDACTED]', productId: 7 },
  });
});

test('extracts useful business references without returning tokens', () => {
  const refs = extractReferenceFields({
    salesId: 9,
    invoiceNo: 'INV-0042',
    accessToken: 'hidden',
    lines: [{ productId: 2 }],
  });
  assert.deepEqual(refs, {
    salesId: 9,
    invoiceNo: 'INV-0042',
    productId: 2,
  });
});

test('records an authenticated mutation after the response finishes', async () => {
  const calls = [];
  const middleware = buildSystemActivityLogger({
    db: { query: async (...args) => { calls.push(args); } },
  });
  const req = {
    method: 'PATCH',
    originalUrl: '/api/products/42',
    body: { productName: 'Updated item', password: 'must-not-leak' },
    params: { id: '42' },
    authStaff: { company_id: 3, branch_id: 8, staff_name: 'Store Manager' },
    ip: '127.0.0.1',
    get: () => 'test-agent',
  };
  const res = new EventEmitter();
  res.statusCode = 200;
  res.json = (payload) => payload;
  middleware(req, res, () => {});
  res.json({ productId: 42, productCode: 'PRD-42' });
  res.emit('finish');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.length, 1);
  const values = calls[0][1];
  assert.equal(values[0], 3);
  assert.equal(values[6], 'Store Manager');
  assert.equal(values[7], 'UPDATE');
  assert.match(values[5], /"password":"\[REDACTED\]"/);
});

test('records Super Admin activity without requiring a tenant company', async () => {
  const calls = [];
  const middleware = buildPlatformActivityLogger({
    db: { query: async (...args) => { calls.push(args); } },
  });
  const req = {
    method: 'PATCH',
    originalUrl: '/api/admin/tenants/8/subscription',
    body: { status: 'active', password: 'hidden' },
    params: { companyId: '8' },
    platformUser: { platformUserId: 4, email: 'admin@example.com', fullName: 'Platform Admin' },
    ip: '127.0.0.1',
    get: () => 'test-agent',
  };
  const res = new EventEmitter();
  res.statusCode = 200;
  res.json = (payload) => payload;
  middleware(req, res, () => {});
  res.json({ subscription: { companyId: 8, status: 'active' } });
  res.emit('finish');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.length, 1);
  const values = calls[0][1];
  assert.equal(values[0], 4);
  assert.equal(values[1], 'Platform Admin');
  assert.match(values[7], /"password":"\[REDACTED\]"/);
});

test('tenant log projection excludes technical and cross-system evidence', () => {
  const projected = toTenantBasicLog({
    log_id: 10,
    branch_id: 2,
    level: 'INFO',
    source: 'SALES',
    message: 'sale created',
    actor: 'Cashier',
    action: 'CREATE',
    entity_type: 'sale',
    entity_id: 'INV-1',
    status_code: 201,
    created_at: '2026-06-24T10:00:00Z',
    details: { request: { total: 50 } },
    request_path: '/api/sales',
    ip_address: '127.0.0.1',
    user_agent: 'secret-device',
    duration_ms: 11,
    company_id: 99,
  });
  assert.deepEqual(Object.keys(projected).sort(), [
    'action', 'actor', 'branch_id', 'created_at', 'entity_id', 'entity_type',
    'level', 'log_id', 'message', 'source', 'status_code',
  ]);
});
