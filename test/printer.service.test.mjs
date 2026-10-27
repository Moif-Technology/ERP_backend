/**
 * Printing: routing, duplicate prevention, lifecycle, reprint and ambiguous
 * failure. Pure logic only — pg.Pool connects lazily so importing is offline-safe.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDedupeKey,
  canTransition,
  isDispatchedStatus,
  resolveRouting,
  normalizeLoc,
} from '../src/pos/restaurant-pos/services/printer.service.js';
import { posRouter } from '../src/pos/restaurant-pos/pos.routes.js';
import { printerRouter } from '../src/pos/restaurant-pos/routes/printer.routes.js';

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

const KITCHEN = { printerId: 1, kitchenLoc: 'Kitchen', counterNo: 1, isFallback: false, isActive: true };
const BAR = { printerId: 2, kitchenLoc: 'Bar', counterNo: 2, isFallback: false, isActive: true };
const FALLBACK = { printerId: 3, kitchenLoc: '', counterNo: 3, isFallback: true, isActive: true };

test('routing sends each line to the printer whose kitchen_loc matches location_code', () => {
  const items = [
    { productId: 10, locationCode: 'Kitchen' },
    { productId: 11, locationCode: 'kitchen' }, // case-insensitive
    { productId: 12, locationCode: 'Bar' },
  ];
  const { groups, unrouted } = resolveRouting(items, [KITCHEN, BAR]);
  assert.equal(unrouted.length, 0);
  const kitchen = groups.find((g) => g.printerId === 1);
  const bar = groups.find((g) => g.printerId === 2);
  assert.equal(kitchen.items.length, 2);
  assert.equal(bar.items.length, 1);
  assert.equal(kitchen.byFallback, false);
});

test('unmatched line uses the explicit fallback and is marked byFallback', () => {
  const items = [{ productId: 20, locationCode: 'Shisha' }];
  const { groups, unrouted } = resolveRouting(items, [KITCHEN, FALLBACK]);
  assert.equal(unrouted.length, 0);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].printerId, 3);
  assert.equal(groups[0].byFallback, true);
});

test('no silent wrong-printer fallback: unmatched with no fallback is UNROUTED', () => {
  const items = [{ productId: 30, locationCode: 'Shisha' }];
  const { groups, unrouted } = resolveRouting(items, [KITCHEN]);
  assert.equal(groups.length, 0);
  assert.equal(unrouted.length, 1);
  assert.equal(unrouted[0].productId, 30);
});

test('counter_no 99 (no printer) is excluded from routing', () => {
  const noPrinter = { printerId: 9, kitchenLoc: 'Kitchen', counterNo: 99, isFallback: false, isActive: true };
  const { groups, unrouted } = resolveRouting([{ productId: 1, locationCode: 'Kitchen' }], [noPrinter]);
  assert.equal(groups.length, 0);
  assert.equal(unrouted.length, 1);
});

test('dedupe key is idempotent for the same batch/printer and distinct per reprint', () => {
  const a = buildDedupeKey({ jobType: 'KOT_NEW', kotMasterId: 5, childIds: [11, 12], printerId: 1 });
  const b = buildDedupeKey({ jobType: 'KOT_NEW', kotMasterId: 5, childIds: [12, 11], printerId: 1 });
  assert.equal(a, b, 'same lines (any order) must collide so only one job survives the unique index');

  const other = buildDedupeKey({ jobType: 'KOT_NEW', kotMasterId: 5, childIds: [11, 12], printerId: 2 });
  assert.notEqual(a, other, 'different printer is a different job');

  const reprint1 = buildDedupeKey({ jobType: 'KOT_REPRINT', kotMasterId: 5, childIds: [11, 12], printerId: 1, nonce: 'n1' });
  const reprint2 = buildDedupeKey({ jobType: 'KOT_REPRINT', kotMasterId: 5, childIds: [11, 12], printerId: 1, nonce: 'n2' });
  assert.notEqual(reprint1, reprint2, 'each reprint is a deliberate new job');

  const delta = buildDedupeKey({ jobType: 'KOT_DELTA', kotMasterId: 5, childIds: [11, 12], printerId: 1 });
  assert.equal(a, delta, 'a re-save (DELTA) must not auto-print lines the first save (NEW) already printed');
  const added = buildDedupeKey({ jobType: 'KOT_DELTA', kotMasterId: 5, childIds: [13], printerId: 1 });
  assert.notEqual(a, added, 'items added later are different lines and do print');
});

test('lifecycle: spool success is not confirmation and ambiguous results never auto-retry', () => {
  assert.ok(canTransition('PENDING', 'CLAIMED'));
  assert.ok(canTransition('CLAIMED', 'SENT'));
  assert.ok(canTransition('SENT', 'CONFIRMED'));
  assert.ok(canTransition('SENT', 'UNKNOWN'));
  // UNKNOWN and FAILED are terminal — no transition back to PENDING/CLAIMED.
  assert.equal(canTransition('UNKNOWN', 'CLAIMED'), false);
  assert.equal(canTransition('UNKNOWN', 'PENDING'), false);
  assert.equal(canTransition('FAILED', 'SENT'), false);
  assert.equal(canTransition('CONFIRMED', 'SENT'), false);
});

test('only SENT/CONFIRMED mark a batch as dispatched', () => {
  assert.ok(isDispatchedStatus('SENT'));
  assert.ok(isDispatchedStatus('CONFIRMED'));
  assert.equal(isDispatchedStatus('UNKNOWN'), false);
  assert.equal(isDispatchedStatus('FAILED'), false);
  assert.equal(isDispatchedStatus('PENDING'), false);
});

test('normalizeLoc trims and lowercases', () => {
  assert.equal(normalizeLoc('  Main Kitchen '), 'main kitchen');
  assert.equal(normalizeLoc(null), '');
});

test('printer config + job lifecycle routes are mounted under /printers', () => {
  const r = declaredRoutes(printerRouter);
  for (const want of [
    'GET /', 'POST /', 'DELETE /:printerId',
    'POST /jobs/kot', 'POST /jobs/:jobId/claim', 'PATCH /jobs/:jobId', 'GET /jobs/kot/:kotMasterId',
  ]) {
    assert.ok(r.has(want), `printerRouter missing ${want}`);
  }
  const mounted = posRouter.stack
    .filter((l) => !l.route && l.name === 'router')
    .map((l) => l.regexp.source)
    .join(' ');
  assert.match(mounted, /printers/, '/printers sub-router not mounted');
});
