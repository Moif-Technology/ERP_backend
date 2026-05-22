/**
 * Pure-logic tests for entitlement service (no DB).
 * Run with: node --test test/entitlement.service.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveSubscriptionState,
  applyOverrides,
  defaultPermissionsFromFeatures,
} from '../src/services/entitlement.service.js';

test('resolveSubscriptionState: missing row -> default usable (legacy fallback)', () => {
  const s = resolveSubscriptionState(null);
  assert.equal(s.isUsable, true);
  assert.equal(s.planCode, 'legacy');
});

test('resolveSubscriptionState: trial in future -> usable', () => {
  const future = new Date(Date.now() + 86400 * 1000).toISOString();
  const s = resolveSubscriptionState({ status: 'trial', trial_ends_at: future, plan_code: 'basic' });
  assert.equal(s.isUsable, true);
  assert.equal(s.status, 'trial');
});

test('resolveSubscriptionState: trial in past -> expired/not usable', () => {
  const past = new Date(Date.now() - 86400 * 1000).toISOString();
  const s = resolveSubscriptionState({ status: 'trial', trial_ends_at: past, plan_code: 'basic' });
  assert.equal(s.isUsable, false);
});

test('resolveSubscriptionState: suspended -> not usable', () => {
  const s = resolveSubscriptionState({ status: 'suspended', plan_code: 'basic' });
  assert.equal(s.isUsable, false);
  assert.equal(s.status, 'suspended');
});

test('applyOverrides: tenant override wins over plan default', () => {
  const planFeatures = { 'pos.kot': true, 'pos.tables': true };
  const overrides = [{ feature_code: 'pos.kot', is_enabled: false }];
  const merged = applyOverrides(planFeatures, overrides, 'feature_code', 'is_enabled');
  assert.equal(merged['pos.kot'], false);
  assert.equal(merged['pos.tables'], true);
});

test('defaultPermissionsFromFeatures: derives perms from enabled features', () => {
  const perms = defaultPermissionsFromFeatures({ 'crm.leads': true, 'crm.followups': false });
  assert.ok(Array.isArray(perms));
});
