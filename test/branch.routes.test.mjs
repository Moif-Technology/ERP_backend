import test from 'node:test';
import assert from 'node:assert/strict';
import { branchRouter } from '../src/core/routes/branch.routes.js';

function checkAccess(method, features) {
  const route = branchRouter.stack.find((layer) => layer.route?.methods[method]).route;
  let allowed = false;
  let status;
  const res = {
    status(code) { status = code; return this; },
    json() { return this; },
  };
  route.stack[0].handle(
    { authStaff: { enabledFeatures: new Set(features) } },
    res,
    () => { allowed = true; },
  );
  return { allowed, status };
}

for (const feature of ['backoffice.reports', 'hr.reports', 'crm.reports', 'garage.reports']) {
  test(`${feature} can load branch filters but cannot manage branches`, () => {
    assert.equal(checkAccess('get', [feature]).allowed, true);
    for (const method of ['post', 'patch', 'delete']) {
      assert.deepEqual(checkAccess(method, [feature]), { allowed: false, status: 403 });
    }
  });
}

test('branch lookup still rejects missing or unrelated features', () => {
  for (const features of [[], ['backoffice.sales']]) {
    assert.deepEqual(checkAccess('get', features), { allowed: false, status: 403 });
  }
});

test('existing branch administrators retain access', () => {
  for (const method of ['get', 'post', 'patch', 'delete']) {
    assert.equal(checkAccess(method, ['core.users']).allowed, true);
  }
});
