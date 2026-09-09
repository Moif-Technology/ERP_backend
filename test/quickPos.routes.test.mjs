/**
 * Route-surface contract for the Deyno Quick till (/api/pos).
 *
 * Deyno Quick's apiService calls a fixed set of endpoints. If any of them stops
 * being mounted — a reordered `use`, a deleted line, a renamed controller — the
 * till breaks at runtime with a 404 that looks like a client bug. This test
 * fails at build time instead.
 *
 * No DB: pg.Pool connects lazily, so importing the router is safe offline.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { posRouter } from '../src/pos/restaurant-pos/pos.routes.js';
import { kotRouter } from '../src/pos/restaurant-pos/routes/kot.routes.js';
import { salesRouter } from '../src/pos/restaurant-pos/routes/sales.routes.js';

/** Every `router.METHOD(path)` declared directly on posRouter, as "GET /path". */
function declaredRoutes(router) {
  const out = new Set();
  for (const layer of router.stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      out.add(`${method.toUpperCase()} ${layer.route.path}`);
    }
  }
  return out;
}

/** Paths mounted as sub-routers via `router.use(path, subRouter)`. */
function mountedPrefixes(router) {
  return router.stack
    .filter((l) => !l.route && l.name === 'router')
    .map((l) => l.regexp.source);
}

const routes = declaredRoutes(posRouter);
const kotRoutes = declaredRoutes(kotRouter);
const salesRoutes = declaredRoutes(salesRouter);

test('device enrollment flow is mounted and public-facing', () => {
  for (const r of [
    'POST /device/stations',
    'POST /device/enroll',
    'POST /device/staff-list',
    'POST /device/pin-login',
  ]) {
    assert.ok(routes.has(r), `missing ${r}`);
  }
});

test('legacy Flutter auth path is untouched', () => {
  for (const r of ['POST /login', 'POST /pin-login', 'POST /staff-list']) {
    assert.ok(routes.has(r), `missing ${r}`);
  }
});

test('device auth is declared before authMiddleware', () => {
  // authMiddleware is added with `use` (no route). Every public endpoint must
  // sit at a lower stack index than it, or enrollment would need a token it
  // cannot have yet — the chicken-and-egg failure.
  const authIdx = posRouter.stack.findIndex(
    (l) => !l.route && l.handle?.name === 'authMiddleware',
  );
  assert.ok(authIdx > 0, 'authMiddleware not found on the router');

  const publicPaths = new Set([
    '/login', '/pin-login', '/staff-list',
    '/device/stations', '/device/enroll', '/device/staff-list', '/device/pin-login',
  ]);
  posRouter.stack.forEach((layer, idx) => {
    if (!layer.route || !publicPaths.has(layer.route.path)) return;
    assert.ok(idx < authIdx, `${layer.route.path} is behind authMiddleware`);
  });
});

test('counter reading (X/Z) and cash in-out are mounted', () => {
  for (const r of [
    'GET /counter/summary',
    'POST /counter/close',
    'GET /counter/history',
    'GET /counter/history/:closeId',
    'GET /counter/cash-in-out',
    'GET /counter/cash-in-out/report',
    'POST /counter/cash-in-out',
  ]) {
    assert.ok(routes.has(r), `missing ${r}`);
  }
});

test('credit settlement receipts are mounted', () => {
  for (const r of [
    'GET /settlement/credit-customers',
    'GET /settlement/customers/:customerId/bills',
    'POST /settlement/save',
    'GET /settlement/history',
    'GET /settlement/receipts/:transactionId',
  ]) {
    assert.ok(routes.has(r), `missing ${r}`);
  }
});

test('sales viewer and aggregate reports are mounted', () => {
  for (const r of [
    'GET /sales/viewer',
    'GET /sales/viewer/:salesId',
    'GET /sales/staff-wise',
    'GET /sales/reports/salesman-wise',
    'GET /sales/reports/item-wise',
    'GET /sales/reports/group-wise',
  ]) {
    assert.ok(routes.has(r), `missing ${r}`);
  }
});

test('supervisor approval is mounted', () => {
  assert.ok(routes.has('POST /supervisor/verify'));
});

test('the order lifecycle lives on the sub-routers', () => {
  for (const r of ['POST /save', 'GET /list', 'GET /:kotMasterId']) {
    assert.ok(kotRoutes.has(r), `kotRouter missing ${r}`);
  }
  for (const r of ['POST /settle', 'GET /next-bill-no']) {
    assert.ok(salesRoutes.has(r), `salesRouter missing ${r}`);
  }
});

test('next-bill-no uses restaurant per-station numbering, not counter-pos', async () => {
  // Counter-pos numbers bills company-wide; restaurant settle numbers per
  // station. Serving the counter-pos handler here would preview a bill number
  // that settle never assigns on a multi-till site.
  const restaurant = await import('../src/pos/restaurant-pos/controllers/sales.controller.js');
  const counter = await import('../src/pos/counter-pos/controllers/sales.controller.js');

  const layer = salesRouter.stack.find((l) => l.route?.path === '/next-bill-no');
  const handlers = layer.route.stack.map((s) => s.handle);
  assert.ok(handlers.includes(restaurant.nextBillNo), 'not the restaurant handler');
  assert.ok(!handlers.includes(counter.nextBillNo), 'counter-pos handler leaked in');
});

test('kot and sales sub-routers are still mounted', () => {
  const prefixes = mountedPrefixes(posRouter).join(' ');
  assert.match(prefixes, /kot/, '/kot sub-router missing');
  assert.match(prefixes, /sales/, '/sales sub-router missing');
});

test('/sales sub-router is declared before the /sales/* viewer routes', () => {
  // salesRouter only handles POST /settle. A GET /sales/viewer enters it, finds
  // no match and falls through to the routes below. That fall-through only
  // works while the sub-router comes first; flipping the order would shadow
  // nothing today but would silently break if salesRouter ever adds a
  // catch-all. Pin the order so the assumption is explicit.
  const subIdx = posRouter.stack.findIndex(
    (l) => !l.route && l.name === 'router' && /sales/.test(l.regexp.source),
  );
  const viewerIdx = posRouter.stack.findIndex(
    (l) => l.route?.path === '/sales/viewer',
  );
  assert.ok(subIdx >= 0 && viewerIdx >= 0);
  assert.ok(subIdx < viewerIdx, '/sales sub-router must precede /sales/viewer');
});
