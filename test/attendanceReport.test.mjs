import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceReport } from '../src/backoffice/services/report.service.js';

test('report scopes branch/date range and preserves hours, missing times and confirmed absences', async () => {
  const pool = { query: async (sql, params) => {
    assert.deepEqual(params, [6, 3, '2026-09-01', '2026-09-30']);
    assert.match(sql, /last_out - ad.first_in/);
    return { rows: [
      { work_date: '2026-09-10', employee_name: 'Employee A', first_in: '2026-09-10 09:00:00', last_out: '2026-09-10 18:30:00', hours: '9.50', status: 'Present' },
      { work_date: '2026-09-10', employee_name: 'Employee B', hours: null, status: 'Absent' },
      { work_date: '2026-09-10', employee_name: 'Employee C', first_in: '2026-09-10 09:00:00', hours: null, status: 'Missing' },
    ] };
  } };
  const rows = await attendanceReport(pool, { company_id: 6, branch_id: 2 }, { branchId: 3, fromDate: '2026-09-01', toDate: '2026-09-30' });
  assert.equal(rows[0].firstIn, '09:00');
  assert.equal(rows[0].lastOut, '18:30');
  assert.equal(rows[0].hours, 9.5);
  assert.equal(rows[0].absence, 'No');
  assert.equal(rows[1].absence, 'Yes');
  assert.equal(rows[1].hours, null);
  assert.equal(rows[2].absence, 'Unconfirmed');
  assert.equal(rows[2].lastOut, '');
});
