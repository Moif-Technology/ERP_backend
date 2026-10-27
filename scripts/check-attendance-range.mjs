import assert from 'assert';
import { listAttendanceDaily } from '../src/hr/repositories/hr.repository.js';

const calls = [];
const pool = { query: (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };

await listAttendanceDaily(pool, 1, 2, { fromDate: '2026-09-01', toDate: '2026-09-10' });
assert.match(calls[0].sql, /ad\.work_date >= \$3/);
assert.match(calls[0].sql, /ad\.work_date <= \$4/);
assert.deepStrictEqual(calls[0].params, [1, 2, '2026-09-01', '2026-09-10']);

await listAttendanceDaily(pool, 1, 2, { workDate: '2026-09-10' });
assert.match(calls[1].sql, /ad\.work_date = \$3/);
assert.deepStrictEqual(calls[1].params, [1, 2, '2026-09-10']);

await listAttendanceDaily(pool, 1, 2, { workDate: '2026-09-10', fromDate: '2026-09-01', toDate: '2026-09-10' });
assert.ok(!/work_date = \$/.test(calls[2].sql), 'range must win over workDate');
assert.strictEqual(calls[2].params.length, 4);

await listAttendanceDaily(pool, 1, 2, {});
assert.deepStrictEqual(calls[3].params, [1, 2], 'no date filter when none given');

console.log('ok');
