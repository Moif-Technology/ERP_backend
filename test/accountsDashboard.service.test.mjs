import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccountsDashboardPeriod } from '../src/accounts/services/accountsDashboard.service.js';

test('accounts dashboard defaults to a trailing 30-day period', () => {
  const period = resolveAccountsDashboardPeriod({}, new Date('2026-06-25T12:00:00Z'));
  assert.deepEqual(period, {
    dateFrom: '2026-05-27',
    dateTo: '2026-06-25',
    days: 30,
  });
});

test('accounts dashboard accepts an inclusive 366-day range', () => {
  const period = resolveAccountsDashboardPeriod({
    dateFrom: '2025-06-26',
    dateTo: '2026-06-26',
  });
  assert.equal(period.days, 366);
});

test('accounts dashboard rejects reversed and oversized ranges', () => {
  assert.throws(
    () => resolveAccountsDashboardPeriod({ dateFrom: '2026-06-25', dateTo: '2026-06-01' }),
    (error) => error.status === 400 && error.message.includes('after'),
  );
  assert.throws(
    () => resolveAccountsDashboardPeriod({ dateFrom: '2025-01-01', dateTo: '2026-06-25' }),
    (error) => error.status === 400 && error.message.includes('366'),
  );
});
