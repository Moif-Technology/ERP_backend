import { withTransaction } from '../../config/db.js';
import { nextDocNo, SEQUENCE_DEFS } from '../../shared/services/docSequence.service.js';
import * as repo from '../repositories/tools.repository.js';
import * as groupRepo from '../../backoffice/repositories/group.repository.js';
import * as subGroupRepo from '../../backoffice/repositories/subGroup.repository.js';
import { findBarcodeConflict, setMasterBarcode } from '../../backoffice/repositories/product.repository.js';
import { assertBarcodesUnique } from '../../backoffice/services/product.service.js';

function context(authStaff) {
  const companyId = Number(authStaff?.company_id);
  const branchId = Number(authStaff?.branch_id);
  if (!companyId || !branchId) throw Object.assign(new Error('Company and branch context are required'), { status: 400 });
  return {
    companyId,
    branchId,
    actor: String(authStaff?.staff_name || authStaff?.login_name || 'system').slice(0, 100),
  };
}
const text = (v) => String(v ?? '').trim();
const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const pick = (r, ...keys) => {
  for (const key of keys) if (r[key] !== undefined && r[key] !== null && String(r[key]).trim() !== '') return r[key];
  return '';
};

// Match group / sub-group by name in the import branch; create missing ones like Group Entry does.
// Not cached across rows: a failed row rolls back its savepoint, which would leave a cached id dangling.
async function resolveGroups(client, ctx, groupName, subGroupName) {
  if (!groupName) {
    if (subGroupName) throw new Error('group_name is required when sub_group_name is given');
    return { groupId: null, subGroupId: null };
  }
  const { companyId, branchId } = ctx;
  let groupId = await repo.findGroupByName(client, companyId, branchId, groupName);
  if (groupId == null) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [`biz.group_master:${companyId}:${branchId}`]);
    groupId = await groupRepo.nextGroupId(client, companyId, branchId);
    await groupRepo.insertGroup(client, {
      groupId, companyId, branchId,
      groupCode: await nextDocNo(client, { companyId, branchId, sequenceCode: 'GROUP' }),
      groupDescription: groupName.slice(0, 300), groupDescriptionArabic: '',
      keyCode: 0, keyShift: 0,
      sortOrder: await groupRepo.nextSortOrder(client, companyId, branchId),
    });
  }
  if (!subGroupName) return { groupId, subGroupId: null };
  let subGroupId = await repo.findSubGroupByName(client, companyId, branchId, groupId, subGroupName);
  if (subGroupId == null) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [`biz.sub_group_master:${companyId}`]);
    subGroupId = await subGroupRepo.nextSubGroupId(client, companyId);
    await subGroupRepo.insertSubGroup(client, {
      subGroupId, companyId, branchId, groupId,
      subGroupCode: await nextDocNo(client, { companyId, branchId, sequenceCode: 'SUB_GROUP' }),
      subGroupDescription: subGroupName.slice(0, 300), subGroupDescriptionArabic: null,
    });
  }
  return { groupId, subGroupId };
}

const round2 = (n) => Math.round(n * 100) / 100;
// Blank cell = leave unchanged (null); anything else must be a non-negative number.
const optNum = (r, ...keys) => {
  const v = pick(r, ...keys);
  if (v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${keys[0]} must be a non-negative number`);
  return n;
};

// "Update existing" product import: match by product_code (fallback barcode) and update
// barcode, costs and branch selling price. unit_price is stored excl. VAT; output_tax_1_rate is VAT %.
async function updateExistingProduct(client, ctx, row) {
  const productCode = text(pick(row, 'product_code', 'productCode', 'code'));
  const barcode = text(pick(row, 'barcode')).slice(0, 50);
  if (!productCode && !barcode) throw new Error('product_code or barcode is required');
  let product = productCode ? await repo.findProductForUpdate(client, ctx.companyId, ctx.branchId, { productCode }) : null;
  let matchedByBarcode = false;
  if (!product && barcode) {
    product = await repo.findProductForUpdate(client, ctx.companyId, ctx.branchId, { barcode });
    matchedByBarcode = true;
  }
  if (!product) throw new Error(productCode ? `Product code ${productCode} not found` : `Barcode ${barcode} not found`);
  if (product.ambiguous) throw new Error(`Barcode ${barcode} matches more than one product`);
  if (product.product_inventory_id == null) throw new Error('Product has no inventory in this branch');

  const averageCost = optNum(row, 'average_cost', 'averageCost');
  const purchaseCost = optNum(row, 'purchase_cost', 'last_purchase_cost', 'purchaseCost');
  const priceExcl = optNum(row, 'price_excl_vat', 'unit_price', 'priceExclVat');
  const vatPct = optNum(row, 'vat_percent', 'vat_pct', 'vatPercent');
  const priceIncl = optNum(row, 'price_incl_vat', 'selling_price', 'priceInclVat');
  if (vatPct != null && vatPct > 100) throw new Error('vat_percent must be between 0 and 100');

  const rate = vatPct ?? num(product.output_tax_1_rate);
  const currentExcl = num(product.unit_price);
  let unitPrice = priceExcl;
  if (priceIncl != null) {
    const fromIncl = round2(priceIncl / (1 + rate / 100));
    const consistent = priceExcl != null && Math.abs(round2(priceExcl * (1 + rate / 100)) - priceIncl) <= 0.01;
    if (priceExcl == null || (!consistent && Math.abs(priceExcl - currentExcl) < 0.005)) unitPrice = fromIncl;
    else if (!consistent) throw new Error(`price_excl_vat ${priceExcl} and price_incl_vat ${priceIncl} disagree at VAT ${rate}%`);
  }
  const vatAmount = unitPrice != null || vatPct != null ? round2((unitPrice ?? currentExcl) * rate / 100) : null;

  const barcodeChanged = Boolean(barcode) && !matchedByBarcode
    && barcode.toLowerCase() !== text(product.barcode).toLowerCase();
  if (barcodeChanged) {
    await assertBarcodesUnique(client, ctx.companyId, [barcode], Number(product.product_id));
    await setMasterBarcode(client, ctx.companyId, Number(product.product_id), barcode, ctx.actor.slice(0, 50));
  }
  if (!barcodeChanged && [averageCost, purchaseCost, unitPrice, vatPct].every((v) => v == null)) {
    throw new Error('Nothing to update (all value columns blank)');
  }
  await repo.updateInventoryPricing(client, {
    ...ctx, productId: Number(product.product_id),
    averageCost, purchaseCost, unitPrice, vatPct, vatAmount,
  });
}

export async function importRows(_pool, authStaff, body) {
  const ctx = context(authStaff);
  const entityType = text(body.entityType).toLowerCase();
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
  if (!['products', 'products-update', 'customers', 'suppliers', 'opening-stock'].includes(entityType)) {
    throw Object.assign(new Error('Unsupported import entity'), { status: 400 });
  }
  if (!rows.length) throw Object.assign(new Error('No rows supplied'), { status: 400 });

  const result = await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tools-import:${ctx.companyId}:${entityType}`]);
    if (entityType === 'products-update') {
      // Same company-wide lock product entry takes, so barcode claims can't race.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [`core.product_master:${ctx.companyId}`]);
    }
    const errors = [];
    let success = 0;
    let nextProductId = await repo.nextScopedId(client, 'core.product_master', 'product_id', ctx.companyId);
    let nextInventoryId = await repo.nextScopedId(client, 'core.product_inventory', 'product_inventory_id', ctx.companyId);
    let nextCustomerId = await repo.nextScopedId(client, 'biz.customer_master', 'customer_id', ctx.companyId);
    let nextSupplierId = await repo.nextScopedId(client, 'biz.supplier_master', 'supplier_id', ctx.companyId);

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] || {};
      await client.query('SAVEPOINT tool_import_row');
      try {
        if (entityType === 'products') {
          const productName = text(pick(row, 'product_name', 'productName', 'name'));
          const productCode = text(pick(row, 'product_code', 'productCode', 'code'));
          const barcode = text(pick(row, 'barcode'));
          if (!productName) throw new Error('Product name is required');
          if (!productCode) throw new Error('Product code is required');
          if (await repo.findProduct(client, ctx.companyId, productCode, barcode)) throw new Error('Product code or barcode already exists');
          if (barcode && await findBarcodeConflict(client, ctx.companyId, [barcode])) throw new Error('Product code or barcode already exists');
          const { groupId, subGroupId } = await resolveGroups(
            client, ctx,
            text(pick(row, 'group_name', 'groupName', 'group', 'category')),
            text(pick(row, 'sub_group_name', 'subGroupName', 'sub_group', 'subgroup', 'sub_category')),
          );
          await repo.insertProduct(client, {
            ...ctx, productId: nextProductId++, inventoryId: nextInventoryId++, productCode, barcode, productName,
            groupId, subGroupId,
            shortName: text(pick(row, 'short_name', 'shortName')),
            brandName: text(pick(row, 'brand_name', 'brandName')),
            unitName: text(pick(row, 'unit_name', 'unitName')),
            productType: text(pick(row, 'product_type', 'productType')),
            stockType: text(pick(row, 'stock_type', 'stockType')),
            qtyOnHand: num(pick(row, 'qty_on_hand', 'qtyOnHand')),
            averageCost: num(pick(row, 'average_cost', 'averageCost')),
            unitPrice: num(pick(row, 'unit_price', 'unitPrice')),
            reorderLevel: num(pick(row, 'reorder_level', 'reorderLevel')),
            reorderQty: num(pick(row, 'reorder_qty', 'reorderQty')),
            locationCode: text(pick(row, 'location_code', 'locationCode')),
          });
        } else if (entityType === 'products-update') {
          await updateExistingProduct(client, ctx, row);
        } else if (entityType === 'customers') {
          const customerName = text(pick(row, 'customer_name', 'customerName', 'name'));
          let customerCode = text(pick(row, 'customer_code', 'customerCode', 'code'));
          if (!customerName) throw new Error('Customer name is required');
          if (!customerCode) customerCode = await nextDocNo(client, { ...ctx, sequenceCode: 'CUSTOMER' });
          await repo.insertCustomer(client, {
            ...ctx, customerId: nextCustomerId++, customerCode, customerName,
            companyName: text(pick(row, 'company_name', 'companyName')),
            taxNo: text(pick(row, 'customer_tax_reg_no', 'taxNo')),
            contactPerson: text(pick(row, 'contact_person', 'contactPerson')),
            address: text(pick(row, 'address')), cityName: text(pick(row, 'city_name', 'cityName')),
            countryName: text(pick(row, 'country_name', 'countryName')),
            telephone: text(pick(row, 'telephone')), email: text(pick(row, 'email')),
            mobileNo: text(pick(row, 'mobile_no', 'mobileNo')),
            paymentMode: text(pick(row, 'payment_mode', 'paymentMode')),
            creditLimit: num(pick(row, 'credit_limit', 'creditLimit')),
            creditPeriod: num(pick(row, 'credit_period', 'creditPeriod')),
            customerType: text(pick(row, 'customer_type', 'customerType')),
          });
        } else if (entityType === 'suppliers') {
          const supplierName = text(pick(row, 'supplier_name', 'supplierName', 'name'));
          let supplierCode = text(pick(row, 'supplier_code', 'supplierCode', 'code'));
          if (!supplierName) throw new Error('Supplier name is required');
          if (!supplierCode) supplierCode = await nextDocNo(client, { ...ctx, sequenceCode: 'SUPPLIER' });
          await repo.insertSupplier(client, {
            ...ctx, supplierId: nextSupplierId++, supplierCode, supplierName,
            mobileNo: text(pick(row, 'mobile_no', 'mobileNo')), email: text(pick(row, 'email')),
          });
        } else {
          const productCode = text(pick(row, 'product_code', 'productCode', 'code'));
          if (!productCode) throw new Error('Product code is required');
          const updated = await repo.updateOpeningStock(client, {
            ...ctx, productCode, qtyOnHand: num(pick(row, 'qty_on_hand', 'qtyOnHand')),
            averageCost: num(pick(row, 'average_cost', 'averageCost')),
          });
          if (!updated) throw new Error('Product was not found in this branch');
        }
        await client.query('RELEASE SAVEPOINT tool_import_row');
        success += 1;
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT tool_import_row');
        await client.query('RELEASE SAVEPOINT tool_import_row');
        errors.push({ row: index + 2, message: error.message, data: row });
      }
    }
    const status = errors.length === 0 ? 'COMPLETED' : success ? 'PARTIAL' : 'FAILED';
    const job = await repo.insertJob(client, {
      ...ctx, jobType: 'IMPORT', entityType, fileName: text(body.fileName),
      status, totalRows: rows.length, successRows: success, failedRows: errors.length, errorRows: errors,
    });
    await repo.insertAudit(client, {
      ...ctx, action: 'IMPORT', entityType, entityId: String(job.job_id),
      summary: `${success}/${rows.length} rows imported`, metadata: { failedRows: errors.length },
    });
    return { job, errors };
  });
  return result;
}

export async function exportData(pool, authStaff, entityType) {
  const ctx = context(authStaff);
  const rows = await repo.exportRows(pool, ctx.companyId, ctx.branchId, text(entityType).toLowerCase());
  const job = await repo.insertJob(pool, {
    ...ctx, jobType: 'EXPORT', entityType, fileName: null, status: 'COMPLETED',
    totalRows: rows.length, successRows: rows.length, failedRows: 0, errorRows: [],
  });
  await repo.insertAudit(pool, { ...ctx, action: 'EXPORT', entityType, entityId: String(job.job_id), summary: `${rows.length} rows exported` });
  return { rows, generatedAt: new Date().toISOString() };
}

export const listJobs = (pool, authStaff) => repo.listJobs(pool, context(authStaff).companyId);
export const listAudit = (pool, authStaff, query) => repo.listAudit(pool, context(authStaff).companyId, query);
export function toTenantBasicLog(row) {
  return {
    log_id: row.log_id,
    branch_id: row.branch_id,
    level: row.level,
    source: row.source,
    message: row.message,
    actor: row.actor,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    status_code: row.status_code,
    created_at: row.created_at,
  };
}
export async function systemLogs(pool, authStaff, query) {
  const ctx = context(authStaff);
  const [logs, health] = await Promise.all([
    repo.listSystemLogs(pool, ctx.companyId, query),
    repo.databaseHealth(pool, ctx.companyId),
  ]);
  return { logs: logs.map(toTenantBasicLog), health };
}
export const findDuplicates = (pool, authStaff, entityType) =>
  repo.duplicateGroups(pool, context(authStaff).companyId, text(entityType).toLowerCase());

export async function bulkUpdate(pool, authStaff, body) {
  const ctx = context(authStaff);
  const ids = [...new Set((body.ids || []).map(Number).filter(Number.isFinite))].slice(0, 1000);
  if (!ids.length) throw Object.assign(new Error('Select at least one product'), { status: 400 });
  const updated = await repo.bulkUpdateProducts(pool, ctx.companyId, ctx.branchId, ids, body.changes || {}, ctx.actor);
  await repo.insertAudit(pool, {
    ...ctx, action: 'BULK_UPDATE', entityType: 'products', summary: `${updated} products updated`,
    metadata: { ids, changes: body.changes || {} },
  });
  return { updated };
}

export async function labels(pool, authStaff, query) {
  const ctx = context(authStaff);
  const id = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  return repo.labelProducts(pool, ctx.companyId, ctx.branchId, {
    search: text(query.search),
    groupId: id(query.groupId),
    subGroupId: id(query.subGroupId),
  });
}

export async function sequences(pool, authStaff) {
  const ctx = context(authStaff);
  const rows = await repo.listSequences(pool, ctx.companyId, ctx.branchId);
  return rows.map((row) => {
    const def = SEQUENCE_DEFS[row.sequence_code];
    const nextValue = Number(row.current_value) + 1;
    const digits = String(nextValue).padStart(Number(row.pad_length), '0');
    return { ...row, nextPreview: Number(row.pad_length) <= 3 ? `${row.prefix || ''}${digits}` : `${row.prefix || ''}-${digits}`, definition: def || null };
  });
}

export async function backup(pool, authStaff) {
  const ctx = context(authStaff);
  const data = await repo.backupSnapshot(pool, ctx.companyId, ctx.branchId);
  await repo.insertAudit(pool, { ...ctx, action: 'BACKUP', entityType: 'company-data', summary: 'Master data backup generated' });
  await repo.insertSystemLog(pool, {
    ...ctx, level: 'INFO', source: 'TOOLS', action: 'BACKUP',
    entityType: 'company data', message: 'Master data backup generated',
  });
  return { version: 1, generatedAt: new Date().toISOString(), companyId: ctx.companyId, branchId: ctx.branchId, data };
}

export async function restore(pool, authStaff, body) {
  const ctx = context(authStaff);
  if (text(body.confirmation) !== 'RESTORE') throw Object.assign(new Error('Type RESTORE to confirm'), { status: 400 });
  const backupData = body.backup?.data;
  if (!backupData || !Array.isArray(backupData.products)) throw Object.assign(new Error('Invalid backup file'), { status: 400 });
  // Restore is intentionally additive/update-safe: feed supported master rows through the same validated importer.
  const summaries = [];
  for (const [entityType, rows] of [['products', backupData.products], ['customers', backupData.customers || []], ['suppliers', backupData.suppliers || []]]) {
    if (!rows.length) continue;
    const imported = await importRows(pool, authStaff, { entityType, rows, fileName: 'backup-restore.json' });
    summaries.push({ entityType, job: imported.job });
  }
  await repo.insertAudit(pool, { ...ctx, action: 'RESTORE', entityType: 'company-data', summary: 'Additive master data restore completed' });
  return { summaries };
}
