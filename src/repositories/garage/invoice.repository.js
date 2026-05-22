function mapHeader(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    branchId: Number(row.branch_id),
    invoiceNo: row.invoice_no,
    jobCardId: row.job_card_id == null ? null : Number(row.job_card_id),
    jcNo: row.jc_no,
    vehicleId: row.vehicle_id == null ? null : Number(row.vehicle_id),
    customerId: row.customer_id == null ? null : Number(row.customer_id),
    customerName: row.customer_name,
    regNo: row.reg_no,
    invoiceDate: row.invoice_date,
    labourAmount: Number(row.labour_amount ?? 0),
    sparesAmount: Number(row.spares_amount ?? 0),
    subletAmount: Number(row.sublet_amount ?? 0),
    consumableAmount: Number(row.consumable_amount ?? 0),
    lubricantAmount: Number(row.lubricant_amount ?? 0),
    grossAmount: Number(row.gross_amount ?? 0),
    discount: Number(row.discount ?? 0),
    vatAmount: Number(row.vat_amount ?? 0),
    totalAmount: Number(row.total_amount ?? 0),
    status: row.status,
    createdAt: row.created_at,
    createdBy: row.created_by,
    modifiedAt: row.modified_at,
    modifiedBy: row.modified_by,
  };
}

function mapLine(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    invoiceId: Number(row.invoice_id),
    lineNo: Number(row.line_no),
    lineType: row.line_type,
    description: row.description,
    qty: Number(row.qty ?? 1),
    rate: Number(row.rate ?? 0),
    amount: Number(row.amount ?? 0),
    refId: row.ref_id == null ? null : Number(row.ref_id),
    createdAt: row.created_at,
  };
}

export async function nextInvoiceNo(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(invoice_no,'[^0-9]','','g'),'') AS BIGINT)),0)+1 AS next_seq
     FROM garage.invoice WHERE company_id=$1 AND branch_id=$2`,
    [companyId, branchId]
  );
  return `GI-${String(rows[0].next_seq).padStart(5, '0')}`;
}

export async function listInvoices(pool, companyId, branchId, filters) {
  const params = [companyId, branchId];
  let where = `WHERE company_id=$1 AND branch_id=$2`;
  if (filters.status) { params.push(filters.status); where += ` AND status=$${params.length}`; }
  if (filters.customerId) { params.push(filters.customerId); where += ` AND customer_id=$${params.length}`; }
  if (filters.dateFrom) { params.push(filters.dateFrom); where += ` AND invoice_date>=$${params.length}`; }
  if (filters.dateTo) { params.push(filters.dateTo); where += ` AND invoice_date<=$${params.length}`; }
  const { rows } = await pool.query(
    `SELECT * FROM garage.invoice ${where} ORDER BY created_at DESC`,
    params
  );
  return rows.map(mapHeader);
}

export async function findInvoiceById(pool, companyId, branchId, id) {
  const { rows: hrows } = await pool.query(
    `SELECT * FROM garage.invoice WHERE company_id=$1 AND branch_id=$2 AND id=$3 LIMIT 1`,
    [companyId, branchId, id]
  );
  if (!hrows[0]) return null;
  const header = mapHeader(hrows[0]);
  const { rows: lrows } = await pool.query(
    `SELECT * FROM garage.invoice_line WHERE invoice_id=$1 ORDER BY line_no`,
    [id]
  );
  header.lines = lrows.map(mapLine);
  return header;
}

export async function findInvoiceByJobCard(pool, companyId, branchId, jcNo) {
  const { rows: hrows } = await pool.query(
    `SELECT * FROM garage.invoice WHERE company_id=$1 AND branch_id=$2 AND jc_no=$3 ORDER BY id DESC LIMIT 1`,
    [companyId, branchId, jcNo]
  );
  if (!hrows[0]) return null;
  const header = mapHeader(hrows[0]);
  const { rows: lrows } = await pool.query(
    `SELECT * FROM garage.invoice_line WHERE invoice_id=$1 ORDER BY line_no`,
    [header.id]
  );
  header.lines = lrows.map(mapLine);
  return header;
}

export async function insertInvoice(client, p) {
  const { rows } = await client.query(
    `INSERT INTO garage.invoice
       (company_id,branch_id,invoice_no,job_card_id,jc_no,vehicle_id,customer_id,customer_name,reg_no,
        invoice_date,labour_amount,spares_amount,sublet_amount,consumable_amount,lubricant_amount,
        gross_amount,discount,vat_amount,total_amount,status,created_by,modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'DRAFT',$20,$20) RETURNING *`,
    [p.companyId, p.branchId, p.invoiceNo, p.jobCardId, p.jcNo, p.vehicleId,
     p.customerId, p.customerName, p.regNo, p.invoiceDate,
     p.labourAmount, p.sparesAmount, p.subletAmount, p.consumableAmount, p.lubricantAmount,
     p.grossAmount, p.discount, p.vatAmount, p.totalAmount, p.createdBy]
  );
  return mapHeader(rows[0]);
}

export async function insertInvoiceLines(client, invoiceId, companyId, lines) {
  const inserted = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const { rows } = await client.query(
      `INSERT INTO garage.invoice_line (company_id,invoice_id,line_no,line_type,description,qty,rate,amount,ref_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [companyId, invoiceId, i + 1, l.lineType, l.description, l.qty ?? 1, l.rate ?? 0, l.amount ?? 0, l.refId ?? null]
    );
    inserted.push(mapLine(rows[0]));
  }
  return inserted;
}

export async function updateInvoiceAmounts(client, companyId, branchId, id, p) {
  const { rows } = await client.query(
    `UPDATE garage.invoice SET
       labour_amount=$4,spares_amount=$5,sublet_amount=$6,consumable_amount=$7,lubricant_amount=$8,
       gross_amount=$9,discount=$10,vat_amount=$11,total_amount=$12,
       modified_at=NOW(),modified_by=$13
     WHERE company_id=$1 AND branch_id=$2 AND id=$3 AND status='DRAFT' RETURNING *`,
    [companyId, branchId, id,
     p.labourAmount, p.sparesAmount, p.subletAmount, p.consumableAmount, p.lubricantAmount,
     p.grossAmount, p.discount, p.vatAmount, p.totalAmount, p.modifiedBy]
  );
  return rows[0] ? mapHeader(rows[0]) : null;
}

export async function setInvoiceStatus(pool, companyId, branchId, id, status, modifiedBy) {
  const { rows } = await pool.query(
    `UPDATE garage.invoice SET status=$4,modified_at=NOW(),modified_by=$5
     WHERE company_id=$1 AND branch_id=$2 AND id=$3 RETURNING *`,
    [companyId, branchId, id, status, modifiedBy]
  );
  return rows[0] ? mapHeader(rows[0]) : null;
}

export async function deleteInvoiceLines(client, invoiceId) {
  await client.query(`DELETE FROM garage.invoice_line WHERE invoice_id=$1`, [invoiceId]);
}
