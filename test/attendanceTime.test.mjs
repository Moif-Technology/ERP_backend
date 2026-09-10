import test from 'node:test';
import assert from 'node:assert/strict';
import { validAttendanceDate, validAttendanceTime, formatAttendanceTime } from '../src/hr/services/attendanceTime.js';

test('attendance dates reject overflow and preserve leap days', () => {
  assert.equal(validAttendanceDate('2026-02-30'), false);
  assert.equal(validAttendanceDate('2026-02-29'), false);
  assert.equal(validAttendanceDate('2024-02-29'), true);
  assert.equal(validAttendanceDate('2026-13-01'), false);
});
test('punch times must be real clock times', () => {
  for (const t of ['24:00:00', '09:60:00', '09:00:60', 'bad']) assert.equal(validAttendanceTime(t), false);
  for (const t of ['00:00:00', '23:59:59', '09:30']) assert.equal(validAttendanceTime(t), true);
});
test('report renders PostgreSQL timestamps as branch-local hours and minutes', () => {
  assert.equal(formatAttendanceTime('2026-09-10 09:15:00'), '09:15');
  assert.equal(formatAttendanceTime('2026-09-10 18:45:12.123'), '18:45');
  assert.equal(formatAttendanceTime('2026-09-11T00:15:00'), '00:15');
  assert.equal(formatAttendanceTime('08:30:00'), '08:30');
  assert.equal(formatAttendanceTime(null), '');
});
