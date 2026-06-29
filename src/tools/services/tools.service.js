import { withTransaction } from '../../config/db.js';
import { nextDocNo, SEQUENCE_DEFS } from '../../shared/services/docSequence.service.js';
import * as repo from '../repositories/tools.repository.js';

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

export async function importRows(_pool, authStaff, body) {
  const ctx = context(authStaff);
  const entityType = text(body.entityType).toLowerCase();
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
  if (!['products', 'customers', 'suppliers', 'opening-stock'].includes(entityType)) {
    throw Object.assign(new Error('Unsupported import entity'), { status: 400 });
  }
  if (!rows.length) throw Object.assign(new Error('No rows supplied'), { status: 400 });

  const result = await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tools-import:${ctx.companyId}:${entityType}`]);
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
          let productCode = text(pick(row, 'product_code', 'productCode', 'code'));
          const barcode = text(pick(row, 'barcode'));
          if (!productName) throw new Error('Product name is required');
          if (!productCode) productCode = await nextDocNo(client, { ...ctx, sequenceCode: 'PRODUCT' });
          if (await repo.findProduct(client, ctx.companyId, productCode, barcode)) throw new Error('Product code or barcode already exists');
          await repo.insertProduct(client, {
            ...ctx, productId: nextProductId++, inventoryId: nextInventoryId++, productCode, barcode, productName,
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
  const products = await repo.exportRows(pool, ctx.companyId, ctx.branchId, 'products');
  const search = text(query.search).toLowerCase();
  return products.filter((p) => !search || [p.product_name, p.product_code, p.barcode].some((v) => text(v).toLowerCase().includes(search))).slice(0, 500);
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
