// Bulk version of the "Create" + "Map" buttons on HR > Biometric sync.
//
// For every unmatched device PIN that carries a real name, creates the HR
// employee (employee_code = device PIN), maps the PIN, and replays every staged
// day into hr.attendance_daily. PINs whose device_name is just the PIN itself
// (unenrolled fingers, test badges) are left alone unless --include-unnamed.
//
// Reuses the same repository functions the API routes call, so the result is
// identical to clicking through the UI 21 times.
//
//   node scripts/adopt-biometric-pins.mjs --company 6            # dry run
//   node scripts/adopt-biometric-pins.mjs --company 6 --apply
//   node scripts/adopt-biometric-pins.mjs --company 6 --apply --only TWMSDXB17,TWMSDXB09
//   node scripts/adopt-biometric-pins.mjs --company 6 --apply --ignore-unnamed
//
// Target database comes from DATABASE_URL, so it can be pointed at production
// by running it on the API host.

import 'dotenv/config';
import { pool, withTransaction } from '../src/config/db.js';
import * as bioRepo from '../src/hr/repositories/biometric.repository.js';
import * as hrRepo from '../src/hr/repositories/hr.repository.js';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const companyId = Number(value('company', 6));
const branchId = Number(value('branch', 1));
const apply = flag('apply');
const includeUnnamed = flag('include-unnamed');
const ignoreUnnamed = flag('ignore-unnamed');
const only = value('only', '') ? value('only', '').split(',').map((s) => s.trim()).filter(Boolean) : null;

// A PIN is "named" when the device sent a human name rather than echoing the
// PIN back. Those echoes are people enrolled without a proper employee code.
const isNamed = (pin, name) => Boolean(name) && String(name).trim() !== String(pin).trim();

async function main() {
  const { rows: pins } = await pool.query(
    `SELECT device_pin,
            MAX(device_name) AS device_name,
            COUNT(*)::int    AS days,
            MIN(work_date)   AS first_day,
            MAX(work_date)   AS last_day
       FROM hr.attendance_biometric_staging
      WHERE company_id = $1 AND branch_id = $2 AND status = 'unmatched'
      GROUP BY device_pin
      ORDER BY days DESC`,
    [companyId, branchId],
  );

  if (!pins.length) {
    console.log(`No unmatched PINs for company ${companyId} branch ${branchId}.`);
    return;
  }

  const selected = pins.filter((p) => {
    if (only) return only.includes(p.device_pin);
    return includeUnnamed || isNamed(p.device_pin, p.device_name);
  });
  const unnamed = pins.filter((p) => !isNamed(p.device_pin, p.device_name));

  console.log(`\nCompany ${companyId} / branch ${branchId} — ${pins.length} unmatched PINs, ${selected.length} selected\n`);
  console.table(selected.map((p) => ({
    pin: p.device_pin,
    name: p.device_name,
    days: p.days,
    from: String(p.first_day).slice(0, 10),
    to: String(p.last_day).slice(0, 10),
  })));

  if (!apply) {
    console.log(`Dry run. ${selected.length} PIN(s) would be created + mapped, ` +
                `${selected.reduce((n, p) => n + p.days, 0)} staged day(s) replayed.`);
    if (!only && !includeUnnamed && unnamed.length) {
      console.log(`\nSkipped ${unnamed.length} unnamed PIN(s): ${unnamed.map((p) => p.device_pin).join(', ')}`);
      console.log('Re-run with --include-unnamed to adopt them, or --ignore-unnamed to hide them.');
    }
    console.log('\nRe-run with --apply to write.');
    return;
  }

  let created = 0;
  let mapped = 0;
  let replayed = 0;

  for (const p of selected) {
    const devicePin = p.device_pin;
    const employeeName = isNamed(devicePin, p.device_name) ? String(p.device_name).trim() : `PIN ${devicePin}`;

    try {
      const result = await withTransaction(async (client) => {
        // Same lock the sync path takes — daily_id and employee_id are MAX+1
        // allocations, so a push landing mid-run would otherwise collide.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
          `hr.biometric_sync:${companyId}:${branchId}`,
        ]);

        const { rows: existing } = await client.query(
          `SELECT employee_id FROM hr.employee_master
            WHERE company_id=$1 AND branch_id=$2 AND employee_code=$3 AND is_deleted = FALSE`,
          [companyId, branchId, devicePin],
        );

        let employeeId = existing[0] ? Number(existing[0].employee_id) : null;
        let didCreate = false;

        if (employeeId == null) {
          const { rows: next } = await client.query(
            `SELECT COALESCE(MAX(employee_id), 0) + 1 AS id FROM hr.employee_master
              WHERE company_id = $1 AND branch_id = $2`,
            [companyId, branchId],
          );
          employeeId = Number(next[0].id);
          await hrRepo.insertEmployee(client, {
            companyId, branchId, employeeId,
            employeeCode: devicePin,
            employeeName,
            shiftType: 'Regular',
            shiftId: null, designation: null, department: null, dateOfJoining: null,
            dateOfBirth: null, gender: null, nationality: null, mobileNo: null, email: null,
            addressLine1: null, addressLine2: null, emiratesIdNo: null, passportNo: null,
            employmentType: null, workLocation: null, reportingManager: null,
            payrollGroup: null, leavePolicy: null, basicSalary: null,
            bankName: null, bankAccountNo: null,
            createdBy: 'adopt-biometric-pins',
          });
          didCreate = true;
        }

        await bioRepo.upsertPinMap(client, {
          companyId, branchId, devicePin, employeeId,
          deviceName: employeeName, mappedBy: null,
        });

        const pending = await bioRepo.listUnmatchedRowsForPin(client, companyId, branchId, devicePin);
        let nextDaily = await bioRepo.nextDailyId(client, companyId, branchId);
        const appliedIds = [];
        for (const row of pending) {
          await bioRepo.upsertAttendanceFromDevice(client, {
            companyId, branchId,
            dailyId: nextDaily++,
            employeeId,
            workDate: String(row.workDate).slice(0, 10),
            firstIn: row.firstIn,
            lastOut: row.lastOut,
            devicePin,
          });
          appliedIds.push(row.stagingId);
        }
        await bioRepo.markStagingApplied(client, companyId, branchId, appliedIds, employeeId);

        return { employeeId, didCreate, days: appliedIds.length };
      });

      if (result.didCreate) created++;
      mapped++;
      replayed += result.days;
      console.log(`  ${devicePin.padEnd(11)} emp#${String(result.employeeId).padEnd(4)} ` +
                  `${result.didCreate ? 'created' : 'existing'}  ${result.days} day(s) replayed  ${employeeName}`);
    } catch (err) {
      console.error(`  ${devicePin.padEnd(11)} FAILED: ${err.message}`);
    }
  }

  if (ignoreUnnamed && unnamed.length) {
    const { rowCount } = await pool.query(
      `UPDATE hr.attendance_biometric_staging SET status = 'ignored'
        WHERE company_id=$1 AND branch_id=$2 AND status='unmatched' AND device_pin = ANY($3::text[])`,
      [companyId, branchId, unnamed.map((p) => p.device_pin)],
    );
    console.log(`\nIgnored ${rowCount} staged row(s) across ${unnamed.length} unnamed PIN(s). Reversible: set status back to 'unmatched'.`);
  }

  console.log(`\nDone. ${created} employee(s) created, ${mapped} PIN(s) mapped, ${replayed} day(s) written to hr.attendance_daily.`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
