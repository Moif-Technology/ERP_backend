/**
 * Capability gate test for platform middleware (no DB; mocks req).
 * Run with: node --test test/platformAuth.middleware.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireCapability } from '../src/middleware/platformAuth.middleware.js';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(b) { this.body = b; return this; },
  };
}

test('requireCapability: allows when cap present', () => {
  const req = { platformCapabilities: ['tenant.read'] };
  const res = mockRes();
  let nextCalled = false;
  requireCapability('tenant.read')(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('requireCapability: 403 when cap missing', () => {
  const req = { platformCapabilities: ['tenant.read'] };
  const res = mockRes();
  let nextCalled = false;
  requireCapability('plan.manage')(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.capabilityCode, 'plan.manage');
});

test('requireCapability: 403 when capabilities undefined', () => {
  const req = {};
  const res = mockRes();
  requireCapability('audit.read')(req, res, () => {});
  assert.equal(res.statusCode, 403);
});
