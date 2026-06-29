const ACTIVE = "COALESCE(record_status, 'ACTIVE') = 'ACTIVE'";

export async function listJobs(db, companyId, limit = 100) {
  const { rows } = await db.query(
    `SELECT job_id, job_type, entity_type, file_name, status, total_rows,
            success_rows, failed_rows, error_rows, created_by, created_at
       FROM core.tool_job_history
      WHERE company_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [companyId, limit],
  );
  return rows;
}

export async function insertJob(db, row) {
  const { rows } = await db.query(
    `INSERT INTO core.tool_job_history
       (company_id, branch_id, job_type, entity_type, file_name, status,
        total_rows, success_rows, failed_rows, error_rows, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
     RETURNING *`,
    [
      row.companyId, row.branchId, row.jobType, row.entityType, row.fileName,
      row.status, row.totalRows, row.successRows, row.failedRows,
      JSON.stringify(row.errorRows || []), row.actor,
    ],
  );
  return rows[0];
}

export async function insertAudit(db, row) {
  await db.query(
    `INSERT INTO core.tool_audit_log
       (company_id, branch_id, actor, action, entity_type, entity_id, summary, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      row.companyId, row.branchId, row.actor, row.action, row.entityType,
      row.entityId || null, row.summary || null, JSON.stringify(row.metadata || {}),
    ],
  );
}

export async function insertSystemLog(db, row) {
  await db.query(
    `INSERT INTO core.tool_system_log
       (company_id, branch_id, level, source, message, details, actor, action,
        entity_type, entity_id, http_method, request_path, status_code, duration_ms)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      row.companyId, row.branchId, row.level || 'INFO', row.source || 'TOOLS',
      row.message, JSON.stringify(row.details || {}), row.actor || null, row.action || null,
      row.entityType || null, row.entityId || null, row.httpMethod || null,
      row.requestPath || null, row.statusCode || null, row.durationMs || null,
    ],
  );
}

export async function listAudit(db, companyId, { search = '', action = '', limit = 200 } = {}) {
  const { rows } = await db.query(
    `SELECT audit_id, branch_id, actor, action, entity_type, entity_id,
            summary, metadata, created_at
       FROM core.tool_audit_log
      WHERE company_id = $1
        AND ($2 = '' OR action = $2)
        AND ($3 = '' OR actor ILIKE '%' || $3 || '%' OR entity_type ILIKE '%' || $3 || '%'
             OR summary ILIKE '%' || $3 || '%')
      ORDER BY created_at DESC
      LIMIT $4`,
    [companyId, action, search, limit],
  );
  return rows;
}

export async function listSystemLogs(db, companyId, { level = '', source = '', action = '', search = '', limit = 500 } = {}) {
  const { rows } = await db.query(
    `SELECT log_id, branch_id, level, source, message, actor, action,
            entity_type, entity_id, status_code, created_at
       FROM core.tool_system_log
      WHERE company_id = $1
        AND ($2 = '' OR level = $2)
        AND ($3 = '' OR source = $3)
        AND ($4 = '' OR action = $4)
        AND ($5 = '' OR actor ILIKE '%' || $5 || '%' OR message ILIKE '%' || $5 || '%'
             OR entity_type ILIKE '%' || $5 || '%' OR entity_id ILIKE '%' || $5 || '%')
      ORDER BY created_at DESC
      LIMIT $6`,
    [companyId, level, source, action, search, Math.min(Number(limit) || 500, 2000)],
  );
  return rows;
}

export async function databaseHealth(db, companyId) {
  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM core.product_master WHERE company_id=$1) AS products,
       (SELECT COUNT(*)::int FROM biz.customer_master WHERE company_id=$1) AS customers,
       (SELECT COUNT(*)::int FROM biz.supplier_master WHERE company_id=$1) AS suppliers,
       (SELECT COUNT(*)::int FROM core.tool_job_history WHERE company_id=$1) AS tool_jobs,
       pg_database_size(current_database())::bigint AS database_bytes,
       NOW() AS checked_at`,
    [companyId],
  );
  return rows[0];
}

export async function exportRows(db, companyId, branchId, entityType) {
  const queries = {
    products: {
      sql: `SELECT m.product_id, m.product_code, m.barcode, m.product_name, m.short_name, m.brand_name,
                   m.unit_name, m.product_type, m.stock_type, i.qty_on_hand, i.unit_price,
                   i.average_cost, i.reorder_level, i.reorder_qty, i.location_code
              FROM core.product_master m
              LEFT JOIN core.product_inventory i ON i.company_id=m.company_id
               AND i.product_id=m.product_id AND i.branch_id=$2
             WHERE m.company_id=$1 AND ${ACTIVE.replaceAll('record_status', 'm.record_status')}
             ORDER BY m.product_name`,
    },
    customers: {
      sql: `SELECT customer_code, customer_name, company_name, customer_tax_reg_no,
                   contact_person, address, city_name, country_name, telephone, email,
                   mobile_no, payment_mode, credit_limit, credit_period, customer_type, status
              FROM biz.customer_master WHERE company_id=$1 ORDER BY customer_name`,
      params: [companyId],
    },
    suppliers: {
      sql: `SELECT supplier_code, supplier_name, mobile_no, email, record_status
              FROM biz.supplier_master WHERE company_id=$1 ORDER BY supplier_name`,
      params: [companyId],
    },
    stock: {
      sql: `SELECT m.product_code, m.barcode, m.product_name, i.qty_on_hand,
                   i.average_cost, i.unit_price, i.reorder_level, i.reorder_qty, i.location_code
              FROM core.product_inventory i
              JOIN core.product_master m ON m.company_id=i.company_id AND m.product_id=i.product_id
             WHERE i.company_id=$1 AND i.branch_id=$2 ORDER BY m.product_name`,
    },
    sequences: {
      sql: `SELECT module, sequence_code, sequence_name, prefix, current_value,
                   pad_length, reset_rule, fiscal_year, is_active
              FROM core.document_sequence
             WHERE company_id=$1 AND branch_id=$2 ORDER BY module, sequence_name`,
    },
  };
  const q = queries[entityType];
  if (!q) throw Object.assign(new Error('Unsupported export entity'), { status: 400 });
  const { rows } = await db.query(q.sql, q.params || [companyId, branchId]);
  return rows;
}

export async function nextScopedId(db, table, idColumn, companyId) {
  const allowed = new Set([
    'core.product_master:product_id',
    'core.product_inventory:product_inventory_id',
    'biz.customer_master:customer_id',
    'biz.supplier_master:supplier_id',
  ]);
  if (!allowed.has(`${table}:${idColumn}`)) throw new Error('Unsafe identifier');
  const { rows } = await db.query(
    `SELECT COALESCE(MAX(${idColumn}),0)::bigint + 1 AS id FROM ${table} WHERE company_id=$1`,
    [companyId],
  );
  return Number(rows[0].id);
}

export async function findProduct(db, companyId, productCode, barcode) {
  const { rows } = await db.query(
    `SELECT product_id FROM core.product_master
      WHERE company_id=$1 AND (LOWER(product_code)=LOWER($2) OR ($3 <> '' AND barcode=$3))
      LIMIT 1`,
    [companyId, productCode, barcode || ''],
  );
  return rows[0] || null;
}

export async function insertProduct(db, p) {
  await db.query(
    `INSERT INTO core.product_master
       (company_id, product_id, product_code, barcode, product_name, short_name,
        brand_name, unit_name, product_type, stock_type, pack_qty, product_status,
        record_status, created_by, modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,'ACTIVE','ACTIVE',$11,$11)`,
    [p.companyId,p.productId,p.productCode,p.barcode||null,p.productName,p.shortName||null,
      p.brandName||null,p.unitName||null,p.productType||null,p.stockType||null,p.actor],
  );
  await db.query(
    `INSERT INTO core.product_inventory
       (company_id, branch_id, product_inventory_id, product_id, pack_qty, qty_on_hand,
        average_cost, last_purchase_cost, unit_price, reorder_level, reorder_qty,
        location_code, record_status, created_by, modified_by)
     VALUES ($1,$2,$3,$4,1,$5,$6,$6,$7,$8,$9,$10,'ACTIVE',$11,$11)`,
    [p.companyId,p.branchId,p.inventoryId,p.productId,p.qtyOnHand,p.averageCost,p.unitPrice,
      p.reorderLevel,p.reorderQty,p.locationCode||null,p.actor],
  );
}

export async function insertCustomer(db, p) {
  await db.query(
    `INSERT INTO biz.customer_master
       (company_id, customer_id, customer_code, customer_name, company_name,
        customer_tax_reg_no, contact_person, address, city_name, country_name,
        telephone, email, mobile_no, payment_mode, credit_limit, credit_period,
        customer_type, status, created_by, modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'ACTIVE',$18,$18)`,
    [p.companyId,p.customerId,p.customerCode,p.customerName,p.companyName||null,p.taxNo||null,
      p.contactPerson||null,p.address||null,p.cityName||null,p.countryName||null,p.telephone||null,
      p.email||null,p.mobileNo||null,p.paymentMode||null,p.creditLimit,p.creditPeriod,
      p.customerType||null,p.actor],
  );
}

export async function insertSupplier(db, p) {
  await db.query(
    `INSERT INTO biz.supplier_master
       (company_id, supplier_id, supplier_code, supplier_name, mobile_no, email,
        record_status, created_by, modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7,$7)`,
    [p.companyId,p.supplierId,p.supplierCode,p.supplierName,p.mobileNo||null,p.email||null,p.actor],
  );
}

export async function updateOpeningStock(db, p) {
  const { rowCount } = await db.query(
    `UPDATE core.product_inventory i SET qty_on_hand=$4, average_cost=$5,
            last_purchase_cost=$5, modified_by=$6, modified_at=NOW()
       FROM core.product_master m
      WHERE i.company_id=$1 AND i.branch_id=$2 AND i.product_id=m.product_id
        AND m.company_id=i.company_id AND LOWER(m.product_code)=LOWER($3)`,
    [p.companyId,p.branchId,p.productCode,p.qtyOnHand,p.averageCost,p.actor],
  );
  return rowCount;
}

export async function duplicateGroups(db, companyId, entityType) {
  const queries = {
    products: `SELECT LOWER(TRIM(product_name)) duplicate_key, COUNT(*)::int count,
                      JSON_AGG(JSON_BUILD_OBJECT('id',product_id,'code',product_code,'name',product_name,'contact',barcode)) records
                 FROM core.product_master WHERE company_id=$1 AND record_status='ACTIVE'
                GROUP BY LOWER(TRIM(product_name)) HAVING COUNT(*) > 1 ORDER BY count DESC`,
    customers: `SELECT LOWER(TRIM(customer_name)) duplicate_key, COUNT(*)::int count,
                       JSON_AGG(JSON_BUILD_OBJECT('id',customer_id,'code',customer_code,'name',customer_name,'contact',COALESCE(mobile_no,email))) records
                  FROM biz.customer_master WHERE company_id=$1 AND status='ACTIVE'
                 GROUP BY LOWER(TRIM(customer_name)) HAVING COUNT(*) > 1 ORDER BY count DESC`,
    suppliers: `SELECT LOWER(TRIM(supplier_name)) duplicate_key, COUNT(*)::int count,
                       JSON_AGG(JSON_BUILD_OBJECT('id',supplier_id,'code',supplier_code,'name',supplier_name,'contact',COALESCE(mobile_no,email))) records
                  FROM biz.supplier_master WHERE company_id=$1 AND record_status='ACTIVE'
                 GROUP BY LOWER(TRIM(supplier_name)) HAVING COUNT(*) > 1 ORDER BY count DESC`,
  };
  if (!queries[entityType]) throw Object.assign(new Error('Unsupported duplicate entity'), { status: 400 });
  const { rows } = await db.query(queries[entityType], [companyId]);
  return rows;
}

export async function bulkUpdateProducts(db, companyId, branchId, ids, changes, actor) {
  const masterSets = [];
  const masterValues = [companyId, ids];
  const inventorySets = [];
  const inventoryValues = [companyId, branchId, ids];
  const masterMap = { brandName: 'brand_name', unitName: 'unit_name', productType: 'product_type', stockType: 'stock_type' };
  const invMap = { unitPrice: 'unit_price', reorderLevel: 'reorder_level', reorderQty: 'reorder_qty', locationCode: 'location_code', discountPercentage: 'discount_percentage' };
  for (const [key, col] of Object.entries(masterMap)) {
    if (changes[key] !== undefined && changes[key] !== '') {
      masterValues.push(changes[key]);
      masterSets.push(`${col}=$${masterValues.length}`);
    }
  }
  for (const [key, col] of Object.entries(invMap)) {
    if (changes[key] !== undefined && changes[key] !== '') {
      inventoryValues.push(changes[key]);
      inventorySets.push(`${col}=$${inventoryValues.length}`);
    }
  }
  let updated = 0;
  if (masterSets.length) {
    masterValues.push(actor);
    const result = await db.query(
      `UPDATE core.product_master SET ${masterSets.join(',')}, modified_by=$${masterValues.length}, modified_at=NOW()
        WHERE company_id=$1 AND product_id=ANY($2::bigint[])`,
      masterValues,
    );
    updated = Math.max(updated, result.rowCount);
  }
  if (inventorySets.length) {
    inventoryValues.push(actor);
    const result = await db.query(
      `UPDATE core.product_inventory SET ${inventorySets.join(',')}, modified_by=$${inventoryValues.length}, modified_at=NOW()
        WHERE company_id=$1 AND branch_id=$2 AND product_id=ANY($3::bigint[])`,
      inventoryValues,
    );
    updated = Math.max(updated, result.rowCount);
  }
  return updated;
}

export async function listSequences(db, companyId, branchId) {
  const { rows } = await db.query(
    `SELECT sequence_code, sequence_name, module, prefix, current_value, pad_length,
            reset_rule, fiscal_year, is_active
       FROM core.document_sequence WHERE company_id=$1 AND branch_id=$2
      ORDER BY module, sequence_name`,
    [companyId, branchId],
  );
  return rows;
}

export async function backupSnapshot(db, companyId, branchId) {
  const [products, customers, suppliers, sequences] = await Promise.all([
    exportRows(db, companyId, branchId, 'products'),
    exportRows(db, companyId, branchId, 'customers'),
    exportRows(db, companyId, branchId, 'suppliers'),
    exportRows(db, companyId, branchId, 'sequences'),
  ]);
  return { products, customers, suppliers, sequences };
}
