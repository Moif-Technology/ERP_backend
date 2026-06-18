/**
 * ops.delivery_order_master / ops.delivery_order_child; numbering via core.document_sequence.
 */

export const DELIVERY_ORDER_SEQUENCE_CODE = 'delivery_order';

export async function nextDeliveryOrderSequenceNumber(client, companyId, branchId, { createdBy = 'system' } = {}) {
  const actor = String(createdBy || 'system').slice(0, 50);
  const lockKey = `core.docseq:${companyId}:${branchId}:${DELIVERY_ORDER_SEQUENCE_CODE}`;
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [lockKey]);

  const sel = await client.query(
    `SELECT id, current_value, step_value, prefix
     FROM core.document_sequence
     WHERE company_id = $1
       AND branch_id = $2
       AND sequence_code = $3
       AND is_active IS TRUE
     FOR UPDATE`,
    [companyId, branchId, DELIVERY_ORDER_SEQUENCE_CODE],
  );

  let next;
  let prefix;

  if (sel.rows.length === 0) {
    next = 1;
    prefix = 'DO';
    await client.query(
      `INSERT INTO core.document_sequence (
         company_id, branch_id, sequence_code, sequence_name,
         current_value, step_value, prefix, is_active,
         created_on, modified_on, created_by, modified_by
       ) VALUES ($1, $2, $3, $4, $5, 1, $6, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $7, $7)`,
      [companyId, branchId, DELIVERY_ORDER_SEQUENCE_CODE, 'Delivery order', next, prefix, actor],
    );
  } else {
    const row = sel.rows[0];
    const step = Number(row.step_value) >= 1 ? Number(row.step_value) : 1;
    next = Number(row.current_value) + step;
    const rawPrefix = row.prefix != null ? String(row.prefix).trim() : '';
    prefix = rawPrefix !== '' ? rawPrefix : 'DO';
    await client.query(
      `UPDATE core.document_sequence
       SET current_value = $1, modified_on = CURRENT_TIMESTAMP, modified_by = $2
       WHERE id = $3`,
      [next, actor, row.id],
    );
  }

  return { seqNum: next, prefix };
}

export function formatDeliveryOrderNo(seq, prefix = 'DO') {
  const p = String(prefix || 'DO')
    .replace(/-+$/g, '')
    .trim() || 'DO';
  const n = Number(seq);
  if (!Number.isFinite(n) || n < 1) return `${p}-000001`;
  return `${p}-${String(n).padStart(6, '0')}`;
}

export async function nextDeliveryOrderId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(delivery_order_id), 0) + 1 AS n
     FROM ops.delivery_order_master WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].n);
}

export async function nextDeliveryOrderChildId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(delivery_order_child_id), 0) + 1 AS n
     FROM ops.delivery_order_child WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].n);
}

export async function insertDeliveryOrderMaster(client, row) {
  const {
    companyId,
    deliveryOrderId,
    branchId,
    deliveryOrderNo,
    deliveryOrderDate,
    quotationNo,
    quotationId,
    customerLpoNo,
    customerId,
    customerName,
    salesmanId,
    counterNo,
    discount,
    subTotal,
    taxableAmount,
    tax1Amount,
    tax2Amount,
    tax3Amount,
    tax1Rate,
    tax2Rate,
    tax3Rate,
    roundOffAdjustment,
    totalAmount,
    postStatus,
    remarks,
    printCount,
    deliveryBy,
    receivedBy,
    recordStatus,
    prefix,
    deliveryOrderNoNumeric,
    createdBy,
    modifiedBy,
    createdByStaffId,
  } = row;

  await client.query(
    `INSERT INTO ops.delivery_order_master (
        company_id, delivery_order_id, branch_id, delivery_order_no, delivery_order_date,
        quotation_no, quotation_id, customer_lpo_no, customer_id, customer_name,
        salesman_id, counter_no, discount, sub_total, taxable_amount,
        tax_1_amount, tax_2_amount, tax_3_amount,
        tax_1_rate, tax_2_rate, tax_3_rate,
        round_off_adjustment, total_amount, post_status, remarks, print_count,
        delivery_by, received_by, record_status, prefix, delivery_order_no_numeric,
        created_by, modified_by, created_by_staff_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
      )`,
    [
      companyId,
      deliveryOrderId,
      branchId,
      deliveryOrderNo,
      deliveryOrderDate,
      quotationNo,
      quotationId,
      customerLpoNo,
      customerId,
      customerName,
      salesmanId,
      counterNo,
      discount,
      subTotal,
      taxableAmount,
      tax1Amount,
      tax2Amount,
      tax3Amount,
      tax1Rate,
      tax2Rate,
      tax3Rate,
      roundOffAdjustment,
      totalAmount,
      postStatus,
      remarks,
      printCount,
      deliveryBy,
      receivedBy,
      recordStatus,
      prefix,
      deliveryOrderNoNumeric,
      createdBy,
      modifiedBy,
      createdByStaffId ?? null,
    ],
  );
}

export async function insertDeliveryOrderChild(client, row) {
  const {
    companyId,
    branchId,
    deliveryOrderChildId,
    deliveryOrderId,
    productId,
    serialNo,
    barcode,
    shortDescription,
    packetDetails,
    unitName,
    groupId,
    qty,
    unitPrice,
    itemDiscount,
    tax1Amount,
    tax2Amount,
    tax3Amount,
    tax1Rate,
    tax2Rate,
    tax3Rate,
    subtotalAmount,
    lineTotal,
    quotationId,
    recordStatus,
    postStatus,
    createdBy,
    modifiedBy,
  } = row;

  await client.query(
    `INSERT INTO ops.delivery_order_child (
        company_id, branch_id, delivery_order_child_id, delivery_order_id, product_id,
        serial_no, barcode, short_description, packet_details, unit_name, group_id,
        qty, unit_price, item_discount,
        tax_1_amount, tax_2_amount, tax_3_amount,
        tax_1_rate, tax_2_rate, tax_3_rate,
        subtotal_amount, line_total, quotation_id,
        record_status, post_status, created_by, modified_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
      )`,
    [
      companyId,
      branchId,
      deliveryOrderChildId,
      deliveryOrderId,
      productId,
      serialNo,
      barcode,
      shortDescription,
      packetDetails,
      unitName,
      groupId,
      qty,
      unitPrice,
      itemDiscount,
      tax1Amount,
      tax2Amount,
      tax3Amount,
      tax1Rate,
      tax2Rate,
      tax3Rate,
      subtotalAmount,
      lineTotal,
      quotationId,
      recordStatus,
      postStatus,
      createdBy,
      modifiedBy,
    ],
  );
}

export async function getQuotationHeaderForLink(pool, companyId, quotationId) {
  const { rows } = await pool.query(
    `SELECT quotation_id, branch_id, quotation_no
     FROM ops.quotation_master
     WHERE company_id = $1 AND quotation_id = $2
       AND (record_status IS NULL OR record_status = 'ACTIVE')
     LIMIT 1`,
    [companyId, quotationId],
  );
  return rows[0] || null;
}

export async function getDeliveryOrderByBusinessId(pool, companyId, deliveryOrderId) {
  const { rows: masters } = await pool.query(
    `SELECT *
     FROM ops.delivery_order_master
     WHERE company_id = $1 AND delivery_order_id = $2
     LIMIT 1`,
    [companyId, deliveryOrderId],
  );
  if (!masters.length) return null;
  const { rows: children } = await pool.query(
    `SELECT *
     FROM ops.delivery_order_child
     WHERE company_id = $1 AND delivery_order_id = $2
     ORDER BY id ASC`,
    [companyId, deliveryOrderId],
  );
  return { master: masters[0], children };
}

/**
 * Mark one or more DOs as INVOICED after a sale is saved.
 * VB: UPDATE DOMaster SET InvoiceStatus='INVOICED', SalesInvoiceID=<salesId>, BillNo=<billNo>
 */
export async function markDOsInvoiced(client, companyId, doIds, salesId, billNo) {
  if (!doIds || doIds.length === 0) return;
  const placeholders = doIds.map((_, i) => `$${i + 4}`).join(',');
  await client.query(
    `UPDATE ops.delivery_order_master
     SET invoice_status = 'INVOICED',
         sales_invoice_id = $2,
         bill_no = $3,
         modified_on = NOW()
     WHERE company_id = $1
       AND delivery_order_id IN (${placeholders})`,
    [companyId, salesId, String(billNo), ...doIds],
  );
}

/**
 * Reverse: clear invoice link when sale is deleted/edited away from DO.
 */
export async function clearDOInvoiceStatus(client, companyId, doIds) {
  if (!doIds || doIds.length === 0) return;
  const placeholders = doIds.map((_, i) => `$${i + 2}`).join(',');
  await client.query(
    `UPDATE ops.delivery_order_master
     SET invoice_status = 'PENDING',
         sales_invoice_id = 0,
         bill_no = '0',
         modified_on = NOW()
     WHERE company_id = $1
       AND delivery_order_id IN (${placeholders})`,
    [companyId, ...doIds],
  );
}

export async function listDeliveryOrders(pool, companyId, branchId, limit, offset, { excludeInvoiced = false } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const invoiceFilter = excludeInvoiced
    ? `AND (invoice_status IS NULL OR UPPER(TRIM(invoice_status)) != 'INVOICED')`
    : '';
  const { rows } = await pool.query(
    `SELECT delivery_order_id, branch_id, delivery_order_no, delivery_order_date, customer_id, customer_name,
            total_amount, post_status, record_status, discount, round_off_adjustment, quotation_no,
            invoice_status
     FROM ops.delivery_order_master
     WHERE company_id = $1 AND branch_id = $2 AND (record_status IS NULL OR record_status = 'ACTIVE')
     ${invoiceFilter}
     ORDER BY delivery_order_date DESC, delivery_order_id DESC
     LIMIT $3 OFFSET $4`,
    [companyId, branchId, lim, off],
  );
  return rows;
}
