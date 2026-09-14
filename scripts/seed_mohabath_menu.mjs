/**
 * Import the restaurant menu from SQL Server MoifCore into Test1 Head Office
 * (company 1, branch 1 — Deyno Pro Till).
 *
 * Source:
 *   SB\SQLEXPRESS / MoifCore
 *   GroupMaster + ProductMaster + ProductChild (StationID 10)
 *
 * SQL Server IDs are bigint and are kept as group_id / product_id.
 * Tax is forced to 0% (source rates are already 0).
 *
 * Usage:
 *   node scripts/seed_mohabath_menu.mjs
 *
 * Connection overrides:
 *   MSSQL_SERVER  MSSQL_USER  MSSQL_PASSWORD  MSSQL_DATABASE
 */
import dotenv from 'dotenv';
import path from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const COMPANY_ID = 1;
const BRANCH_ID = 1;
const TAX_RATE = 0;
const CODE_PREFIX = 'MOH-';
const SQL_STATION_ID = 10;

const MSSQL = {
  server: process.env.MSSQL_SERVER || 'SB\\SQLEXPRESS',
  user: process.env.MSSQL_USER || 'sa',
  password: process.env.MSSQL_PASSWORD || 'gtarc',
  database: process.env.MSSQL_DATABASE || 'MoifCore',
};

const GROUPS_TSV = path.join(__dirname, '_mohabath_groups.tsv');
const SUBGROUPS_TSV = path.join(__dirname, '_mohabath_subgroups.tsv');
const PRODUCTS_TSV = path.join(__dirname, '_mohabath_products.tsv');

function slug(name) {
  const s = String(name || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (s || 'GROUP').slice(0, 40);
}

function parseTsv(filePath, expectedCols) {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const rows = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith('Msg ')) continue;
    const cols = trimmed.split('\t');
    if (cols.length < expectedCols) continue;
    rows.push(cols.map((c) => String(c ?? '').trim()));
  }
  return rows;
}

function exportFromSqlServer() {
  const sqlcmd = process.platform === 'win32' ? 'sqlcmd' : 'sqlcmd';
  const common = [
    '-S', MSSQL.server,
    '-U', MSSQL.user,
    '-P', MSSQL.password,
    '-d', MSSQL.database,
    '-h', '-1',
    '-s', '\t',
    '-W',
    '-f', '65001',
  ];

  execFileSync(sqlcmd, [
    ...common,
    '-o', GROUPS_TSV,
    '-Q',
    `SET NOCOUNT ON; SELECT CAST(GroupID AS varchar(30)), ISNULL(GroupCode,''), ISNULL(GroupDescription,'') FROM GroupMaster ORDER BY GroupID;`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync(sqlcmd, [
    ...common,
    '-o', SUBGROUPS_TSV,
    '-Q',
    `SET NOCOUNT ON; SELECT CAST(SubGroupID AS varchar(30)), CAST(GroupID AS varchar(30)), ISNULL(SubGroupCode,''), ISNULL(SubGroupDescription,'') FROM SubGroupMaster ORDER BY GroupID, SubGroupDescription;`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync(sqlcmd, [
    ...common,
    '-o', PRODUCTS_TSV,
    '-Q',
    `SET NOCOUNT ON; SELECT CAST(pm.ProductID AS varchar(30)), ISNULL(pm.Description,''), ISNULL(pm.ShortDescription,''), CAST(pm.GroupID AS varchar(30)), CAST(pc.UnitPrice AS varchar(20)), CAST(ISNULL(pc.Tax1Rate,0) AS varchar(20)), ISNULL(pm.BarCode,''), ISNULL(pm.DescriptionArabic,''), ISNULL(pm.ProductType,''), ISNULL(pm.Unit,'NOS'), CAST(ISNULL(pm.SubGroupID,0) AS varchar(30)) FROM ProductMaster pm INNER JOIN ProductChild pc ON pc.ProductID = pm.ProductID AND pc.StationID = pm.StationID WHERE pm.StationID = ${SQL_STATION_ID} ORDER BY pm.GroupID, pm.ProductID;`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function loadCatalogue() {
  try {
    exportFromSqlServer();
    console.log(`Exported MoifCore Station ${SQL_STATION_ID} via sqlcmd (${MSSQL.server}).`);
  } catch (err) {
    if (!existsSync(GROUPS_TSV) || !existsSync(PRODUCTS_TSV)) {
      throw new Error(`sqlcmd export failed and no cached TSV found: ${err.message}`);
    }
    console.log('sqlcmd export failed — using cached TSV files.');
    console.log(String(err.message || err));
  }

  const groupRows = parseTsv(GROUPS_TSV, 3);
  const subGroupRows = existsSync(SUBGROUPS_TSV) ? parseTsv(SUBGROUPS_TSV, 4) : [];
  const productRows = parseTsv(PRODUCTS_TSV, 7);
  if (!groupRows.length) throw new Error('No GroupMaster rows to import');
  if (!productRows.length) throw new Error('No ProductMaster/ProductChild rows to import');

  const groups = groupRows.map((cols, i) => {
    const sqlId = cols[0];
    const name = cols[2] || cols[1] || `GROUP ${i + 1}`;
    return {
      id: Number(sqlId),
      sqlId,
      code: `${CODE_PREFIX}${slug(name)}`,
      name: name.slice(0, 300),
      sort: i + 1,
    };
  });

  const usedCodes = new Set();
  for (const g of groups) {
    let code = g.code;
    let n = 2;
    while (usedCodes.has(code)) {
      code = `${g.code}-${n}`;
      n += 1;
    }
    g.code = code.slice(0, 50);
    usedCodes.add(g.code);
  }

  const groupIds = new Set(groups.map((g) => g.id));
  const products = [];
  for (const cols of productRows) {
    const sqlId = cols[0];
    const name = (cols[1] || cols[2] || '').slice(0, 150);
    const shortName = (cols[2] || name).slice(0, 150);
    const groupId = Number(cols[3]);
    if (!name || !groupIds.has(groupId)) continue;
    const price = Number(cols[4]) || 0;
    const barcode = (cols[6] || '').slice(0, 50) || null;
    const arabic = (cols[7] || '').slice(0, 200) || null;
    const unit = (cols[9] || 'NOS').trim() || 'NOS';
    const subGroupId = Number(cols[10]) || 0;
    const id = Number(sqlId);
    products.push({
      id,
      code: `${CODE_PREFIX}${String(id).slice(-5)}`,
      name,
      shortName,
      barcode,
      arabic,
      productType: 'FOOD',
      unit: unit.slice(0, 50),
      price,
      g: groupId,
      sg: subGroupId > 0 ? subGroupId : null,
    });
  }

  const usedProductCodes = new Set();
  for (const p of products) {
    let code = p.code;
    let n = 2;
    while (usedProductCodes.has(code)) {
      code = `${p.code}-${n}`;
      n += 1;
    }
    p.code = code.slice(0, 50);
    usedProductCodes.add(p.code);
  }

  const subGroups = subGroupRows
    .map((cols) => {
      const id = Number(cols[0]);
      const groupId = Number(cols[1]);
      const name = (cols[3] || cols[2] || '').trim();
      if (!id || !groupIds.has(groupId) || !name) return null;
      return {
        id,
        groupId,
        code: `${CODE_PREFIX}SG-${slug(name)}`.slice(0, 50),
        name: name.slice(0, 300),
      };
    })
    .filter(Boolean);

  const usedSgCodes = new Set();
  for (const sg of subGroups) {
    let code = sg.code;
    let n = 2;
    while (usedSgCodes.has(code)) {
      code = `${sg.code}-${n}`;
      n += 1;
    }
    sg.code = code.slice(0, 50);
    usedSgCodes.add(sg.code);
  }

  return { groups, subGroups, products };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');

  const { groups, subGroups, products } = loadCatalogue();
  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE biz.group_master
          SET group_code = LEFT('OLD-' || group_id::text || '-' || group_code, 50),
              r_status = 'INACTIVE',
              is_deleted = TRUE,
              modified_at = NOW()
        WHERE company_id = $1
          AND branch_id = $2
          AND group_code LIKE $3
          AND COALESCE(is_deleted, FALSE) = FALSE`,
      [COMPANY_ID, BRANCH_ID, `${CODE_PREFIX}%`],
    );

    await client.query(
      `UPDATE core.product_master
          SET product_code = LEFT('OLD-' || product_id::text || '-' || product_code, 50),
              product_status = 'INACTIVE',
              record_status = 'INACTIVE',
              is_deleted = TRUE,
              modified_by = 'mohabath_seed',
              modified_at = NOW()
        WHERE company_id = $1
          AND product_code LIKE $2
          AND COALESCE(is_deleted, FALSE) = FALSE`,
      [COMPANY_ID, `${CODE_PREFIX}%`],
    );

    await client.query(
      `UPDATE core.product_inventory i
          SET record_status = 'INACTIVE',
              is_deleted = TRUE,
              modified_by = 'mohabath_seed',
              modified_at = NOW()
         FROM core.product_master m
        WHERE m.company_id = i.company_id
          AND m.product_id = i.product_id
          AND i.company_id = $1
          AND i.branch_id = $2
          AND m.product_code LIKE $3`,
      [COMPANY_ID, BRANCH_ID, `OLD-%`],
    );

    for (const g of groups) {
      await client.query(
        `INSERT INTO biz.group_master (
           group_id, company_id, branch_id, group_code, group_description,
           sort_order, r_status, is_deleted
         ) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', FALSE)
         ON CONFLICT (company_id, branch_id, group_id) DO UPDATE
           SET group_code = EXCLUDED.group_code,
               group_description = EXCLUDED.group_description,
               sort_order = EXCLUDED.sort_order,
               r_status = 'ACTIVE',
               is_deleted = FALSE,
               modified_at = NOW()`,
        [g.id, COMPANY_ID, BRANCH_ID, g.code, g.name, g.sort],
      );
    }

    for (const sg of subGroups) {
      await client.query(
        `INSERT INTO biz.sub_group_master (
           sub_group_id, company_id, branch_id, group_id, sub_group_code,
           sub_group_description, r_status
         ) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
         ON CONFLICT (company_id, sub_group_id) DO UPDATE
           SET group_id = EXCLUDED.group_id,
               branch_id = EXCLUDED.branch_id,
               sub_group_code = EXCLUDED.sub_group_code,
               sub_group_description = EXCLUDED.sub_group_description,
               r_status = 'ACTIVE'`,
        [sg.id, COMPANY_ID, BRANCH_ID, sg.groupId, sg.code, sg.name],
      );
    }

    for (const p of products) {
      await client.query(
        `INSERT INTO core.product_master (
           company_id, product_id, product_code, barcode, product_name, short_name,
           description_arabic, product_type, unit_name, pack_qty, group_id, subgroup_id,
           product_status, record_status, is_deleted,
           created_by, modified_by
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, 1, $10, $11,
           'ACTIVE', 'ACTIVE', FALSE,
           'mohabath_seed', 'mohabath_seed'
         )
         ON CONFLICT (company_id, product_id) DO UPDATE
           SET product_code = EXCLUDED.product_code,
               barcode = EXCLUDED.barcode,
               product_name = EXCLUDED.product_name,
               short_name = EXCLUDED.short_name,
               description_arabic = EXCLUDED.description_arabic,
               product_type = EXCLUDED.product_type,
               unit_name = EXCLUDED.unit_name,
               group_id = EXCLUDED.group_id,
               subgroup_id = EXCLUDED.subgroup_id,
               product_status = 'ACTIVE',
               record_status = 'ACTIVE',
               is_deleted = FALSE,
               modified_by = 'mohabath_seed',
               modified_at = NOW()`,
        [COMPANY_ID, p.id, p.code, p.barcode, p.name, p.shortName, p.arabic, p.productType, p.unit, p.g, p.sg],
      );

      await client.query(
        `INSERT INTO core.product_inventory (
           company_id, branch_id, product_inventory_id, product_id,
           pack_qty, qty_on_hand, unit_price, output_tax_1_rate, output_tax_1_amount,
           record_status, is_deleted, created_by, modified_by
         ) VALUES (
           $1, $2, $3, $4,
           1, 0, $5, $6, 0,
           'ACTIVE', FALSE, 'mohabath_seed', 'mohabath_seed'
         )
         ON CONFLICT (company_id, branch_id, product_id) DO UPDATE
           SET unit_price = EXCLUDED.unit_price,
               output_tax_1_rate = EXCLUDED.output_tax_1_rate,
               output_tax_1_amount = 0,
               record_status = 'ACTIVE',
               is_deleted = FALSE,
               modified_by = 'mohabath_seed',
               modified_at = NOW()`,
        [COMPANY_ID, BRANCH_ID, p.id, p.id, p.price, TAX_RATE],
      );
    }

    await client.query('COMMIT');

    const listed = await client.query(
      `SELECT g.group_description, COUNT(*)::int AS items
         FROM core.product_master m
         JOIN core.product_inventory i
           ON i.company_id = m.company_id AND i.product_id = m.product_id AND i.branch_id = $2
         JOIN biz.group_master g
           ON g.company_id = m.company_id AND g.branch_id = $2 AND g.group_id = m.group_id
        WHERE m.company_id = $1
          AND m.product_code LIKE $3
          AND m.record_status = 'ACTIVE'
        GROUP BY g.sort_order, g.group_description
        ORDER BY g.sort_order`,
      [COMPANY_ID, BRANCH_ID, `${CODE_PREFIX}%`],
    );

    console.log('─────────────────────────────────────────');
    console.log(`Mohabath menu on company ${COMPANY_ID} / branch ${BRANCH_ID}`);
    console.log(`  source : ${MSSQL.database} GroupMaster + ProductMaster + ProductChild`);
    console.log(`  tax %  : ${TAX_RATE}`);
    console.log(`  groups : ${groups.length}`);
    console.log(`  sub-groups : ${subGroups.length}`);
    console.log(`  items  : ${products.length}`);
    for (const r of listed.rows) {
      console.log(`  ${r.group_description}  (${r.items})`);
    }
    console.log('─────────────────────────────────────────');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
