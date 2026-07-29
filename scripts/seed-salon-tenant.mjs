/**
 * Seed one complete salon tenant so SalonPOS is actually testable.
 *
 * Without this, standing up a salon means hand-writing SQL across seven tables
 * in an order nobody has written down — company (software_type_id = 8), branch,
 * role (software_type 'SALON-POS'), staff with a bcrypt PIN, a SALON_POS station,
 * chairs in table_master, and SERVICE products. Every downstream build step
 * depends on it.
 *
 * Usage:
 *   node scripts/seed-salon-tenant.mjs            # create or update
 *   node scripts/seed-salon-tenant.mjs --dry      # show what it would do
 *
 * Idempotent: safe to re-run. Prints the login credentials at the end.
 * Requires migration 104 to have been applied first (npm run migrate:salon).
 */
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/**
 * CLI:
 *   --code CODE        company_code           (default SALON01)
 *   --name "Name"      company_name           (default Demo Salon)
 *   --login NAME       admin login_name       (default salonadmin)
 *   --password PW      admin password         (default: generated, printed once)
 *   --station N        station_id             (default 90)
 *   --dry              show plan, change nothing
 */
function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}

/**
 * Strong random password. Generated rather than hardcoded because a literal in
 * this file is a credential committed to the repo — and anything pasted into a
 * chat or ticket while setting up is compromised the moment it is shared.
 * Printed once at the end; not stored anywhere.
 */
function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const symbols = '!@#$%^&*-_=+';
  const pick = (set, n) =>
    Array.from({ length: n }, () => set[crypto.randomInt(0, set.length)]).join('');
  // Shuffle so the symbol position is not predictable.
  return pick(alphabet, 16).split('')
    .concat(pick(symbols, 2).split(''))
    .sort(() => crypto.randomInt(0, 2) - 0.5)
    .join('');
}

function generatePin() {
  return String(crypto.randomInt(1000, 10000));
}

const SALON_SOFTWARE_TYPE_ID = 8;
const COMPANY_CODE = arg('--code', 'SALON01');
const COMPANY_NAME = arg('--name', 'Demo Salon');
const LOGIN_NAME   = arg('--login', 'salonadmin');
const EMAIL        = arg('--email', null);
// staff_master.email_verified gates login on post-094 schemas; --verified marks
// the seeded admin as already verified so no verification mail is needed.
const EMAIL_VERIFIED = process.argv.includes('--verified');
const PASSWORD_ARG = arg('--password');
const PASSWORD     = PASSWORD_ARG ?? generatePassword();
const PASSWORD_GENERATED = PASSWORD_ARG == null;
/**
 * Station id — and ALSO a real branch id.
 *
 * Post-085, POS-scoped masters (area_master, table_master, group_master) filter
 * on `branch_id` but are handed the STATION id
 * (area.service.js:44 -> listAreasByCompanyAndBranch(companyId, stationId)).
 * Those tables also carry an FK to core.branch_master, so the station id must
 * exist as a branch row too. Migration 085 got this for free by keeping each POS
 * station's id equal to its old branch_id; a new tenant has to create both.
 *
 * Hence: branch 1 = head office, branch 2 = the salon POS, station 2 = the till.
 */
const STATION_ID   = Number(arg('--station', '2'));
const AREA_ID      = 1;
// core.plan_master codes are lowercase: basic | standard | pro | custom
const PLAN_CODE    = 'pro';

// Two zones so the area strip in the POS has something real to switch between.
const AREAS = [
  { areaId: 1, name: 'Main Floor', prefix: 'MF' },
  { areaId: 2, name: 'VIP Room',   prefix: 'VIP' },
];

// Stations a client physically occupies. Named by what they are, because the
// chair type decides which services can run there — a nail desk is not a
// styling chair, and the front desk will pick by name, not number.
const CHAIRS = [
  { tableId: 1,  no: '1',  name: 'Styling 1',  areaId: 1 },
  { tableId: 2,  no: '2',  name: 'Styling 2',  areaId: 1 },
  { tableId: 3,  no: '3',  name: 'Styling 3',  areaId: 1 },
  { tableId: 4,  no: '4',  name: 'Styling 4',  areaId: 1 },
  { tableId: 5,  no: '5',  name: 'Wash 1',     areaId: 1 },
  { tableId: 6,  no: '6',  name: 'Wash 2',     areaId: 1 },
  { tableId: 7,  no: '7',  name: 'Nail Bar 1', areaId: 1 },
  { tableId: 8,  no: '8',  name: 'Nail Bar 2', areaId: 1 },
  { tableId: 9,  no: '9',  name: 'Pedicure 1', areaId: 1 },
  { tableId: 10, no: '10', name: 'Pedicure 2', areaId: 1 },
  { tableId: 11, no: '11', name: 'VIP Suite 1', areaId: 2 },
  { tableId: 12, no: '12', name: 'VIP Suite 2', areaId: 2 },
  { tableId: 13, no: '13', name: 'Facial Room', areaId: 2 },
  { tableId: 14, no: '14', name: 'Massage Room', areaId: 2 },
];

// Product-grid categories. The POS left strip renders these, so without them the
// grid has nothing to filter by and looks empty.
const GROUPS = [
  { groupId: 1, code: 'HAIR',    name: 'Hair' },
  { groupId: 2, code: 'NAILS',   name: 'Nails' },
  { groupId: 3, code: 'SKIN',    name: 'Skin & Spa' },
  { groupId: 4, code: 'PACK',    name: 'Packages' },
  { groupId: 5, code: 'RETAIL',  name: 'Retail' },
];

const SUBGROUPS = [
  { subGroupId: 1, groupId: 1, code: 'CUT',    name: 'Cut & Style' },
  { subGroupId: 2, groupId: 1, code: 'COLOR',  name: 'Colour' },
  { subGroupId: 3, groupId: 1, code: 'TREAT',  name: 'Treatments' },
  { subGroupId: 4, groupId: 2, code: 'MANI',   name: 'Manicure' },
  { subGroupId: 5, groupId: 2, code: 'PEDI',   name: 'Pedicure' },
  { subGroupId: 6, groupId: 3, code: 'FACIAL', name: 'Facials' },
  { subGroupId: 7, groupId: 3, code: 'MASSAGE',name: 'Massage' },
  { subGroupId: 8, groupId: 4, code: 'BRIDAL', name: 'Bridal' },
  { subGroupId: 9, groupId: 5, code: 'HAIRCARE', name: 'Hair Care' },
];

// PINs are generated per run for the same reason as the password. A 4-digit PIN
// is brute-forceable, so it must at least not be a published constant.
const STYLISTS = [
  { name: 'Maya', pin: generatePin() },
  { name: 'Sara', pin: generatePin() },
];

// product_type 'SERVICE' marks a catalogue row as labour (decision D1).
// g = group_id, sg = sub_group_id, so the POS grid can filter properly.
const CATALOGUE = [
  // Hair — cut & style
  { id: 1,  code: 'SVC-CUT',    name: 'Haircut',              type: 'SERVICE', price: 60,  duration: 45,  g: 1, sg: 1 },
  { id: 2,  code: 'SVC-CUTKID', name: 'Kids Haircut',         type: 'SERVICE', price: 35,  duration: 30,  g: 1, sg: 1 },
  { id: 3,  code: 'SVC-BLOW',   name: 'Blow Dry',             type: 'SERVICE', price: 50,  duration: 30,  g: 1, sg: 1 },
  { id: 4,  code: 'SVC-BEARD',  name: 'Beard Trim',           type: 'SERVICE', price: 35,  duration: 20,  g: 1, sg: 1 },
  { id: 5,  code: 'SVC-UPDO',   name: 'Hair Styling / Updo',  type: 'SERVICE', price: 120, duration: 60,  g: 1, sg: 1 },
  // Hair — colour
  { id: 6,  code: 'SVC-COLOR',  name: 'Hair Colour',          type: 'SERVICE', price: 220, duration: 120, g: 1, sg: 2 },
  { id: 7,  code: 'SVC-HILITE', name: 'Highlights',           type: 'SERVICE', price: 320, duration: 150, g: 1, sg: 2 },
  { id: 8,  code: 'SVC-ROOT',   name: 'Root Touch-up',        type: 'SERVICE', price: 140, duration: 75,  g: 1, sg: 2 },
  // Hair — treatments
  { id: 9,  code: 'SVC-KERA',   name: 'Keratin Treatment',    type: 'SERVICE', price: 400, duration: 180, g: 1, sg: 3 },
  { id: 10, code: 'SVC-HAIRSP', name: 'Hair Spa',             type: 'SERVICE', price: 130, duration: 60,  g: 1, sg: 3 },
  // Nails
  { id: 11, code: 'SVC-MANI',   name: 'Manicure',             type: 'SERVICE', price: 55,  duration: 40,  g: 2, sg: 4 },
  { id: 12, code: 'SVC-GEL',    name: 'Gel Polish',           type: 'SERVICE', price: 80,  duration: 50,  g: 2, sg: 4 },
  { id: 13, code: 'SVC-PEDI',   name: 'Pedicure',             type: 'SERVICE', price: 65,  duration: 45,  g: 2, sg: 5 },
  { id: 14, code: 'SVC-NAILEX', name: 'Nail Extensions',      type: 'SERVICE', price: 160, duration: 90,  g: 2, sg: 5 },
  // Skin & spa
  { id: 15, code: 'SVC-FACIAL', name: 'Classic Facial',       type: 'SERVICE', price: 150, duration: 60,  g: 3, sg: 6 },
  { id: 16, code: 'SVC-FACGLD', name: 'Gold Facial',          type: 'SERVICE', price: 260, duration: 75,  g: 3, sg: 6 },
  { id: 17, code: 'SVC-THREAD', name: 'Threading',            type: 'SERVICE', price: 25,  duration: 15,  g: 3, sg: 6 },
  { id: 18, code: 'SVC-MASSAG', name: 'Head & Shoulder Massage', type: 'SERVICE', price: 110, duration: 45, g: 3, sg: 7 },
  // Packages
  { id: 19, code: 'PKG-BRIDAL', name: 'Bridal Package',       type: 'SERVICE', price: 1200, duration: 300, g: 4, sg: 8 },
  { id: 20, code: 'PKG-PARTY',  name: 'Party Ready Package',  type: 'SERVICE', price: 350,  duration: 120, g: 4, sg: 8 },
  // Retail (real stock — these are the lines that should decrement inventory)
  { id: 21, code: 'RET-SHAM',   name: 'Shampoo 250ml',        type: 'STOCK',   price: 45,  duration: null, g: 5, sg: 9 },
  { id: 22, code: 'RET-COND',   name: 'Conditioner 250ml',    type: 'STOCK',   price: 45,  duration: null, g: 5, sg: 9 },
  { id: 23, code: 'RET-SERUM',  name: 'Hair Serum 100ml',     type: 'STOCK',   price: 75,  duration: null, g: 5, sg: 9 },
  { id: 24, code: 'RET-OIL',    name: 'Argan Hair Oil 50ml',  type: 'STOCK',   price: 95,  duration: null, g: 5, sg: 9 },
  { id: 25, code: 'RET-MASK',   name: 'Hair Mask 200ml',      type: 'STOCK',   price: 85,  duration: null, g: 5, sg: 9 },
];

const DRY = process.argv.includes('--dry');

async function nextCompanyId(client) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(company_id), 0) + 1 AS n FROM core.company_master`
  );
  return Number(rows[0].n);
}

async function findExisting(client) {
  const { rows } = await client.query(
    `SELECT company_id FROM core.company_master WHERE company_code = $1`,
    [COMPANY_CODE]
  );
  return rows[0] ? Number(rows[0].company_id) : null;
}

async function seed(client) {
  const now = new Date().toISOString();

  let companyId = await findExisting(client);
  const isNew = companyId == null;
  if (isNew) companyId = await nextCompanyId(client);

  console.log(`${isNew ? 'Creating' : 'Updating'} company ${companyId} (${COMPANY_CODE})`);

  // 1. Company, pinned to the SALON software type.
  await client.query(
    `INSERT INTO core.company_master (
       company_id, company_code, company_name, status,
       contact_person, phone, software_type_id, created_at, updated_at
     ) VALUES ($1, $2, $3, 'ACTIVE', $4, '0000000000', $5, $6, $6)
     ON CONFLICT (company_id) DO UPDATE
       SET software_type_id = EXCLUDED.software_type_id,
           company_name     = EXCLUDED.company_name,
           updated_at       = EXCLUDED.updated_at`,
    [companyId, COMPANY_CODE, COMPANY_NAME, 'Salon Owner', SALON_SOFTWARE_TYPE_ID, now]
  );

  // 2. Head office branch. Post-085 every POS lives under branch 1 and is
  //    distinguished by station_id, not branch_id.
  await client.query(
    `INSERT INTO core.branch_master (
       company_id, branch_id, branch_code, branch_name, status, created_at, updated_at
     ) VALUES ($1, 1, 'HQ', 'Salon Main', 'ACTIVE', $2, $2)
     ON CONFLICT (company_id, branch_id) DO NOTHING`,
    [companyId, now]
  );

  // 2b. A branch row mirroring the POS station id. Required because area_master
  //     / table_master / group_master are filtered by station id but carry an FK
  //     to branch_master — see the STATION_ID comment at the top of this file.
  await client.query(
    `INSERT INTO core.branch_master (
       company_id, branch_id, branch_code, branch_name, status, created_at, updated_at
     ) VALUES ($1, $2, 'SALON', 'Salon Front Desk', 'ACTIVE', $3, $3)
     ON CONFLICT (company_id, branch_id) DO NOTHING`,
    [companyId, STATION_ID, now]
  );

  // 3. Roles. software_type uses HYPHENS here ('SALON-POS'); station_type uses
  //    UNDERSCORES ('SALON_POS'). Different vocabularies, easy to conflate.
  for (const [roleId, roleName, discount, swType] of [
    [1, 'Salon Admin',   100, 'ERP'],
    [2, 'Stylist',         0, 'SALON-POS'],
    [3, 'Receptionist',   10, 'SALON-POS'],
  ]) {
    await client.query(
      `INSERT INTO core.role_master (
         company_id, role_id, role_name, discount_percent_allowed,
         software_type, created_by, modified_by
       ) VALUES ($1, $2, $3, $4, $5, 'seed', 'seed')
       ON CONFLICT (company_id, role_id) DO UPDATE
         SET software_type = EXCLUDED.software_type`,
      [companyId, roleId, roleName, discount, swType]
    );
  }

  // Admin gets every permission; stylists/reception get the POS ones.
  await client.query(
    `INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
     SELECT $1, 1, permission_code, TRUE
       FROM core.permission_master WHERE is_active = TRUE
     ON CONFLICT (company_id, role_id, permission_code)
       DO UPDATE SET is_allowed = TRUE, updated_at = NOW()`,
    [companyId]
  );
  await client.query(
    `INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
     SELECT $1, r.role_id, p.permission_code, TRUE
       FROM core.permission_master p
       CROSS JOIN (SELECT 2 AS role_id UNION ALL SELECT 3) r
      WHERE p.is_active = TRUE AND p.permission_code LIKE 'pos.%'
     ON CONFLICT (company_id, role_id, permission_code)
       DO UPDATE SET is_allowed = TRUE, updated_at = NOW()`,
    [companyId]
  );

  // 4. Staff. Admin logs in with a password; stylists with a PIN.
  //    findLoginCandidates matches on login_name OR email, so either works.
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  await client.query(
    `INSERT INTO core.staff_master (
       company_id, staff_id, branch_id, staff_code, staff_name, designation,
       login_name, password_hash, role_id, record_status, email,
       sync_status, server_status, created_at, created_by, modified_at, modified_by
     ) VALUES ($1, 1, 1, 'U1', 'Salon Owner', 'Admin',
               $2, $3, 1, 'ACTIVE', $5, 'PENDING', 'PENDING', $4, 'seed', $4, 'seed')
     ON CONFLICT (company_id, staff_id) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           login_name    = EXCLUDED.login_name,
           email         = EXCLUDED.email,
           role_id       = EXCLUDED.role_id,
           record_status = 'ACTIVE'`,
    [companyId, LOGIN_NAME, passwordHash, now, EMAIL]
  );

  // Mark the address verified so no verification mail is required.
  // email_verified only exists post-migration-094. Probe information_schema
  // rather than catching 42703 — inside a transaction a failed statement aborts
  // the whole thing, so a try/catch here would not actually recover.
  if (EMAIL && EMAIL_VERIFIED) {
    const { rows: hasCol } = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='core' AND table_name='staff_master'
          AND column_name='email_verified' LIMIT 1`
    );
    if (hasCol.length) {
      await client.query(
        `UPDATE core.staff_master
            SET email_verified       = TRUE,
                email_verify_token   = NULL,
                email_verify_expires = NULL
          WHERE company_id = $1 AND staff_id = 1`,
        [companyId]
      );
    } else {
      console.log('  note: email_verified column absent (pre-094 schema) — skipped');
    }
  }

  let staffId = 1;
  for (const s of STYLISTS) {
    staffId += 1;
    const pinHash = await bcrypt.hash(s.pin, 12);
    await client.query(
      `INSERT INTO core.staff_master (
         company_id, staff_id, branch_id, staff_code, staff_name, designation,
         login_name, password_hash, staff_pin, role_id, record_status,
         sync_status, server_status, created_at, created_by, modified_at, modified_by
       ) VALUES ($1, $2, 1, $3, $4, 'Stylist',
                 $5, $6, $7, 2, 'ACTIVE', 'PENDING', 'PENDING', $8, 'seed', $8, 'seed')
       ON CONFLICT (company_id, staff_id) DO UPDATE
         SET staff_pin     = EXCLUDED.staff_pin,
             staff_name    = EXCLUDED.staff_name,
             record_status = 'ACTIVE'`,
      [companyId, staffId, `U${staffId}`, s.name,
       s.name.toLowerCase(), passwordHash, pinHash, now]
    );
  }

  // 5. SALON_POS station. Requires migration 104's widened chk_station_type.
  // BACKOFFICE station id 1. Migration 085 creates one of these for every
  // company that existed when it ran; a company created afterwards has none, and
  // then every backoffice user is broken: staff.branch_id 1 resolves to station 1,
  // assertStationBelongsToCompany finds nothing, and /api/areas answers
  // "Invalid station for this company".
  await client.query(
    `INSERT INTO core.station_master (
       company_id, branch_id, station_id, station_code, station_name,
       station_type, counter_no
     ) VALUES ($1, 1, 1, 'BO', 'Back Office', 'BACKOFFICE', NULL)
     ON CONFLICT (company_id, station_id) DO UPDATE
       SET station_type = EXCLUDED.station_type,
           station_name = EXCLUDED.station_name`,
    [companyId]
  );

  await client.query(
    `INSERT INTO core.station_master (
       company_id, branch_id, station_id, station_code, station_name,
       station_type, counter_no
     ) VALUES ($1, 1, $2, 'SALON1', 'Salon Front Desk', 'SALON_POS', 1)
     ON CONFLICT (company_id, station_id) DO UPDATE
       SET station_type = EXCLUDED.station_type,
           station_name = EXCLUDED.station_name`,
    [companyId, STATION_ID]
  );

  // 6. Floor + chairs. A salon chair is a core.table_master row (station_master
  //    is the till, not the furniture).
  // area_master has no area_code. supply_type is NOT NULL and constrained to
  // DINE_IN | DELIVERY | PARCEL | TAKEAWAY | GENERAL. GENERAL fits a salon floor
  // and still opens chair selection in the Flutter left panel (which only
  // suppresses it for takeaway/parcel/delivery).
  //
  // MISMATCH WORTH KNOWING: the DB uses 'DINE_IN' (underscore) while the Flutter
  // left panel branches on 'DINE IN' (space) when colouring areas. Neither value
  // here trips that path, but it is a latent bug on the restaurant side.
  // IMPORTANT — post-085 convention: for POS-scoped masters, `branch_id` holds
  // the STATION id, not the real branch. area.service.js:44 calls
  // listAreasByCompanyAndBranch(companyId, stationId), so areas seeded under
  // branch_id = 1 are invisible to a till on station 90.
  // Areas are read at the CALLER's station id (area.service.js:44 passes
  // stationId into a branch_id filter). Backoffice runs on station 1, the till on
  // station 2 — so seed both or one of them sees an empty list. Every station
  // that shows a floor plan needs its own rows; that is how post-085 works.
  for (const stationScope of [1, STATION_ID]) {
    for (const a of AREAS) {
      await client.query(
        `INSERT INTO core.area_master (
           company_id, branch_id, area_id, area_name, supply_type, kot_prefix,
           created_by, modified_by
         ) VALUES ($1, $2, $3, $4, 'GENERAL', $5, NULL, NULL)
         ON CONFLICT (company_id, branch_id, area_id) DO UPDATE
           SET area_name  = EXCLUDED.area_name,
               kot_prefix = EXCLUDED.kot_prefix`,
        [companyId, stationScope, a.areaId, a.name, a.prefix]
      );
    }
  }

  // Chairs are read the same way areas are — table.service.js filters on the
  // CALLER's station id in the branch_id column — so they need the same
  // dual-scope treatment. Seeding only branch 1 gave the till (station 2) an
  // empty chair picker while backoffice showed all 14.
  // table_id is unique per (company_id, branch_id, table_id), so the same ids
  // can be repeated under each scope.
  for (const branchScope of [1, STATION_ID]) {
    for (const c of CHAIRS) {
      await client.query(
        `INSERT INTO core.table_master (
           table_id, company_id, branch_id, area_id,
           table_no, table_name, no_of_chairs, table_format,
           created_by, modified_by
         ) VALUES ($1, $2, $6, $3, $4, $5, 1, 'SQUARE', NULL, NULL)
         ON CONFLICT (company_id, branch_id, table_id) DO UPDATE
           SET table_name = EXCLUDED.table_name,
               area_id    = EXCLUDED.area_id`,
        [c.tableId, companyId, c.areaId, c.no, c.name, branchScope]
      );
    }
  }

  // 6b. Product-grid categories. Without these the POS category strip is empty
  //     and the grid has nothing to filter by.
  // Groups are read at branchId = the CALLER's stationId (api_service.dart
  // _branchId() returns SessionManager().stationId). Backoffice is station 1,
  // the till is station 2 — seed both or the POS category strip is empty.
  for (const branchScope of [1, STATION_ID]) {
    for (const g of GROUPS) {
      await client.query(
        `INSERT INTO biz.group_master (
           group_id, company_id, branch_id, group_code, group_description, r_status
         ) VALUES ($1, $2, $5, $3, $4, 'ACTIVE')
         ON CONFLICT (company_id, branch_id, group_id) DO UPDATE
           SET group_description = EXCLUDED.group_description,
               group_code        = EXCLUDED.group_code,
               r_status          = 'ACTIVE'`,
        [g.groupId, companyId, g.code, g.name, branchScope]
      );
    }
  }

  // Sub-groups are written under branch 1 ONLY — unlike areas/chairs/groups,
  // which are duplicated per station scope. biz.sub_group_master is
  // UNIQUE (company_id, sub_group_id), so the same id cannot exist under a
  // second branch, and offset copies would no longer match
  // core.product_master.subgroup_id (which stores the base id company-wide).
  // The till still sees them: subGroup.repository.listSubGroupsByCompanyBranch
  // lists sub-groups company-wide, matching that unique constraint.
  for (const sg of SUBGROUPS) {
    await client.query(
      `INSERT INTO biz.sub_group_master (
         sub_group_id, company_id, group_id, branch_id,
         sub_group_code, sub_group_description, r_status
       ) VALUES ($1, $2, $3, 1, $4, $5, 'ACTIVE')
       ON CONFLICT (company_id, sub_group_id) DO UPDATE
         SET sub_group_description = EXCLUDED.sub_group_description,
             group_id              = EXCLUDED.group_id,
             r_status              = 'ACTIVE'`,
      [sg.subGroupId, companyId, sg.groupId, sg.code, sg.name]
    );
  }

  // 7. Catalogue. SERVICE rows carry default_duration_minutes (added by 104).
  for (const p of CATALOGUE) {
    await client.query(
      `INSERT INTO core.product_master (
         company_id, product_id, product_code, product_name, short_name,
         product_type, unit_name, pack_qty, group_id, subgroup_id,
         product_status, record_status, default_duration_minutes,
         created_by, modified_by
       ) VALUES ($1, $2, $3, $4, $5, $6, 'NOS', 1, $8, $9,
                 'ACTIVE', 'ACTIVE', $7, 'seed', 'seed')
       ON CONFLICT (company_id, product_id) DO UPDATE
         SET product_name             = EXCLUDED.product_name,
             product_code             = EXCLUDED.product_code,
             product_type             = EXCLUDED.product_type,
             group_id                 = EXCLUDED.group_id,
             subgroup_id              = EXCLUDED.subgroup_id,
             default_duration_minutes = EXCLUDED.default_duration_minutes`,
      [companyId, p.id, p.code, p.name, p.name.slice(0, 20), p.type, p.duration, p.g, p.sg]
    );

    // Inventory (and therefore price) is per branch, and /api/products joins on
    // it. The POS sends branchId = its stationId, so a row must exist for every
    // station that sells: backoffice (1) and the till (2). Without the station-2
    // row the grid renders "No products available" even though the catalogue is
    // fully populated.
    for (const branchScope of [1, STATION_ID]) {
      await client.query(
        `INSERT INTO core.product_inventory (
           company_id, branch_id, product_inventory_id, product_id,
           pack_qty, qty_on_hand, unit_price, output_tax_1_rate,
           record_status, created_by, modified_by
         ) VALUES ($1, $5, $6, $2, 1, $3, $4, 5, 'ACTIVE', 'seed', 'seed')
         ON CONFLICT (company_id, branch_id, product_id) DO UPDATE
           SET unit_price = EXCLUDED.unit_price,
               qty_on_hand = EXCLUDED.qty_on_hand`,
        [
          companyId, p.id, p.type === 'SERVICE' ? 0 : 100, p.price,
          branchScope,
          // product_inventory_id must be unique per (company, id); offset the
          // second branch's rows so they don't collide with the first's.
          branchScope === 1 ? p.id : p.id + 1000,
        ]
      );
    }
  }

  // 8. Subscription so entitlements resolve.
  //    tenant_subscription's only unique key is the subscription_id PK — there
  //    is NO unique on company_id, so ON CONFLICT (company_id) is not available.
  //    Check-then-write instead.
  const { rows: subRows } = await client.query(
    `SELECT subscription_id FROM core.tenant_subscription WHERE company_id = $1 LIMIT 1`,
    [companyId]
  );
  if (subRows.length) {
    await client.query(
      `UPDATE core.tenant_subscription
          SET plan_code = $2, status = 'trial', trial_ends_at = NOW() + INTERVAL '30 days'
        WHERE subscription_id = $1`,
      [subRows[0].subscription_id, PLAN_CODE]
    );
  } else {
    await client.query(
      `INSERT INTO core.tenant_subscription
         (company_id, plan_code, status, trial_started_at, trial_ends_at)
       VALUES ($1, $2, 'trial', NOW(), NOW() + INTERVAL '30 days')`,
      [companyId, PLAN_CODE]
    );
  }

  // 9. Turn OFF restaurant-only POS features for THIS company.
  //
  //    This must be core.tenant_feature_override, not core.software_type_feature.
  //    software_type_feature.is_granted = FALSE means only "not force-granted" —
  //    applySoftwareTypeScope still lets the plan's value through, and the 'pro'
  //    plan enables everything, so it disables nothing. applyOverrides runs LAST
  //    (entitlement.service.js:274), so is_enabled = FALSE here genuinely wins.
  //
  //    Effect: the Flutter right panel stops rendering Take Away List, Delivery,
  //    Area Change and the kitchen actions, because it gates them on exactly
  //    these entitlements. Scoped to this company only — no other tenant changes.
  // TEMPORARILY DISABLED (2026-07-28) — the salon UI is being rebuilt, and the
  // full button set must stay visible while that happens. Flip HIDE_RESTAURANT
  // back to true once the salon layout is settled, then re-run this script.
  const HIDE_RESTAURANT_FEATURES = false;

  const RESTAURANT_ONLY_FEATURES = [
    'pos.takeaway',        // no takeaway counter in a salon
    'pos.delivery',        // nothing is delivered
    'pos.dine_in',         // not a dining room
    'pos.online_orders',   // restaurant aggregator integrations
    'pos.kds',             // kitchen display
    'pos.kitchen_message', // kitchen
    'pos.recipe',          // kitchen
    'pos.production',      // kitchen
    'pos.combo',           // meal combos
    'pos.mess',            // mess / canteen
    'pos.game_zone',       // unrelated vertical
  ];

  for (const code of (HIDE_RESTAURANT_FEATURES ? RESTAURANT_ONLY_FEATURES : [])) {
    await client.query(
      `INSERT INTO core.tenant_feature_override (company_id, feature_code, is_enabled, reason)
       VALUES ($1, $2, FALSE, 'salon tenant: restaurant-only feature')
       ON CONFLICT (company_id, feature_code) DO UPDATE
         SET is_enabled = FALSE,
             reason     = EXCLUDED.reason,
             is_deleted = FALSE`,
      [companyId, code]
    );
  }

  return {
    companyId,
    isNew,
    disabledFeatures: HIDE_RESTAURANT_FEATURES ? RESTAURANT_ONLY_FEATURES.length : 0,
  };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL missing in api/.env');
    process.exit(1);
  }

  let target = 'unknown';
  try {
    const u = new URL(url);
    target = `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch { /* ignore */ }

  console.log(`Target DB : ${target}`);
  if (DRY) {
    console.log('--dry given. Would seed:');
    console.log(`  company ${COMPANY_CODE} (software_type_id=${SALON_SOFTWARE_TYPE_ID})`);
    console.log(`  1 branch, 3 roles, 1 admin + ${STYLISTS.length} stylists`);
    console.log(`  1 SALON_POS station (id ${STATION_ID}), ${CHAIRS.length} chairs`);
    console.log(`  ${CATALOGUE.filter(c => c.type === 'SERVICE').length} services, ` +
                `${CATALOGUE.filter(c => c.type !== 'SERVICE').length} retail products`);
    return;
  }

  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { companyId, isNew, disabledFeatures } = await seed(client);
    await client.query('COMMIT');

    console.log(`\n${isNew ? 'Created' : 'Updated'} salon tenant.`);
    console.log('─────────────────────────────────────────');
    console.log(`  companyId : ${companyId}`);
    console.log(`  company   : ${COMPANY_CODE} — ${COMPANY_NAME}`);
    console.log(`  stationId : ${STATION_ID}`);
    console.log(`  login     : ${LOGIN_NAME}`);
    if (EMAIL) console.log(`  email     : ${EMAIL}${EMAIL_VERIFIED ? ' (verified)' : ''}`);
    console.log(`  password  : ${PASSWORD}`);
    console.log(`  stylists  : ${STYLISTS.map(s => `${s.name} (PIN ${s.pin})`).join(', ')}`);
    console.log(`  disabled  : ${disabledFeatures} restaurant-only features (tenant override)`);
    console.log('─────────────────────────────────────────');
    if (PASSWORD_GENERATED) {
      console.log('The password and PINs above were generated for this run and are');
      console.log('NOT stored anywhere. Save them now, then change them in the app.');
      console.log('Re-running this script generates NEW credentials and overwrites these.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nSEED FAILED (rolled back)');
    console.error(`  ${err.code ? err.code + ': ' : ''}${err.message}`);
    if (err.detail) console.error(`  detail: ${err.detail}`);
    if (err.code === '42703') {
      console.error('  Hint: run `npm run migrate:salon` first — 104 adds columns this seed needs.');
    }
    if (err.code === '23514' && String(err.constraint).includes('station_type')) {
      console.error('  Hint: chk_station_type has no SALON_POS yet. Run `npm run migrate:salon`.');
    }
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
