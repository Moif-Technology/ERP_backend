function mapHeader(row) {
  return {
    id:           Number(row.id),
    companyId:    Number(row.company_id),
    branchId:     Number(row.branch_id),
    requestNo:    row.request_no,
    jobCardId:    row.job_card_id == null ? null : Number(row.job_card_id),
    jcNo:         row.jc_no,
    requestDate:  row.request_date,
    expectedDeliveryDate: row.expected_delivery_date,
    requestedBy:  row.requested_by,
    technicianId: row.technician_id == null ? null : Number(row.technician_id),
    workshopId:   row.workshop_id == null ? null : Number(row.workshop_id),
    internalInvoiceNo: row.internal_invoice_no == null ? null : Number(row.internal_invoice_no),
    status:       row.status,
    syncStatus:   row.sync_status,
    recordStatus: row.record_status,
    remarks:      row.remarks,
    createdAt:    row.created_at,
    createdBy:    row.created_by,
    modifiedAt:   row.modified_at,
    modifiedBy:   row.modified_by,
  };
}

function mapLine(row) {
  return {
    id:             Number(row.id),
    partRequestId:  Number(row.part_request_id),
    lineNo:         Number(row.line_no),
    productId:      row.product_id == null ? null : Number(row.product_id),
    productCode:    row.product_code,
    description:    row.description,
    unitName:       row.unit_name,
    packQty:        Number(row.pack_qty ?? 0),
    qtyRequested:   Number(row.qty_requested),
    qtyIssued:      Number(row.qty_issued),
    unitCost:       Number(row.unit_cost ?? 0),
    lineStatus:     row.line_status,
    createdAt:      row.created_at,
  };
}

export async function getNextRequestNo(client, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(request_no,'[^0-9]','','g'),'') AS BIGINT)), 0) + 1 AS next_seq
     FROM garage.part_request
     WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId]
  );
  const seq = String(rows[0].next_seq).padStart(5, '0');
  return `PR-${seq}`;
}

export async function listPartRequests(pool, companyId, branchId, filters = {}) {
  const params = [companyId, branchId];
  let where = `WHERE pr.company_id = $1 AND pr.branch_id = $2`;

  if (filters.status) {
    params.push(filters.status);
    where += ` AND pr.status = $${params.length}`;
  }
  if (filters.jobCardId) {
    params.push(filters.jobCardId);
    where += ` AND pr.job_card_id = $${params.length}`;
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where += ` AND (pr.request_no ILIKE $${params.length} OR COALESCE(pr.jc_no,'') ILIKE $${params.length} OR COALESCE(pr.requested_by,'') ILIKE $${params.length})`;
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    where += ` AND pr.request_date >= $${params.length}`;
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    where += ` AND pr.request_date <= $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT pr.* FROM garage.part_request pr ${where} ORDER BY pr.created_at DESC, pr.id DESC`,
    params
  );
  return rows.map(mapHeader);
}

export async function findPartRequestById(pool, companyId, branchId, id) {
  const { rows: hrows } = await pool.query(
    `SELECT * FROM garage.part_request WHERE company_id = $1 AND branch_id = $2 AND id = $3 LIMIT 1`,
    [companyId, branchId, id]
  );
  if (!hrows[0]) return null;
  const header = mapHeader(hrows[0]);
  const { rows: lrows } = await pool.query(
    `SELECT * FROM garage.part_request_line WHERE part_request_id = $1 ORDER BY line_no`,
    [id]
  );
  header.lines = lrows.map(mapLine);
  return header;
}

export async function insertPartRequest(client, params) {
  const {
    companyId, branchId, requestNo, jobCardId, jcNo,
    requestDate, expectedDeliveryDate, requestedBy, technicianId, workshopId,
    internalInvoiceNo, remarks, createdBy,
  } = params;

  const { rows } = await client.query(
    `INSERT INTO garage.part_request
       (company_id, branch_id, request_no, job_card_id, jc_no, request_date,
        expected_delivery_date, requested_by, technician_id, workshop_id,
        internal_invoice_no, remarks, status, sync_status, record_status,
        created_by, modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PENDING','PENDING','ACTIVE',$13,$13)
     RETURNING *`,
    [
      companyId, branchId, requestNo, jobCardId ?? null, jcNo ?? null, requestDate,
      expectedDeliveryDate ?? null, requestedBy ?? null, technicianId ?? null,
      workshopId ?? null, internalInvoiceNo ?? null, remarks ?? null, createdBy,
    ]
  );
  return mapHeader(rows[0]);
}

export async function insertPartRequestLines(client, partRequestId, lines) {
  if (!lines || lines.length === 0) return [];
  const inserted = [];
  for (let i = 0; i < lines.length; i++) {
    const { productId, productCode, description, unitName, packQty, qtyRequested, unitCost } = lines[i];
    const { rows } = await client.query(
      `INSERT INTO garage.part_request_line
         (part_request_id, line_no, product_id, product_code, description, unit_name, pack_qty, qty_requested, qty_issued, unit_cost, line_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,'PENDING')
       RETURNING *`,
      [
        partRequestId, i + 1, productId ?? null, productCode ?? null,
        description ?? null, unitName ?? null, packQty ?? 0, qtyRequested ?? 0,
        unitCost ?? 0,
      ]
    );
    inserted.push(mapLine(rows[0]));
  }
  return inserted;
}

export async function updatePartRequest(client, companyId, branchId, id, params) {
  const {
    jobCardId, jcNo, requestDate, expectedDeliveryDate, requestedBy,
    technicianId, workshopId, internalInvoiceNo, remarks, modifiedBy,
  } = params;
  const { rows } = await client.query(
    `UPDATE garage.part_request SET
       job_card_id=$4, jc_no=$5, request_date=$6, expected_delivery_date=$7,
       requested_by=$8, technician_id=$9, workshop_id=$10, internal_invoice_no=$11,
       remarks=$12, modified_at=CURRENT_TIMESTAMP, modified_by=$13
     WHERE company_id=$1 AND branch_id=$2 AND id=$3
     RETURNING *`,
    [
      companyId, branchId, id, jobCardId ?? null, jcNo ?? null, requestDate,
      expectedDeliveryDate ?? null, requestedBy ?? null, technicianId ?? null,
      workshopId ?? null, internalInvoiceNo ?? null, remarks ?? null, modifiedBy,
    ]
  );
  return rows[0] ? mapHeader(rows[0]) : null;
}

export async function replacePartRequestLines(client, partRequestId, lines) {
  await client.query(`DELETE FROM garage.part_request_line WHERE part_request_id = $1`, [partRequestId]);
  return insertPartRequestLines(client, partRequestId, lines);
}

export async function issuePartRequestLines(client, pool, partRequestId, companyId, branchId, lineUpdates, modifiedBy) {
  const { rows: lineRows } = await pool.query(
    `SELECT * FROM garage.part_request_line WHERE part_request_id = $1 ORDER BY line_no`,
    [partRequestId]
  );

  for (const upd of lineUpdates) {
    const existing = lineRows.find((l) => Number(l.id) === Number(upd.id));
    if (!existing) continue;
    const qtyIssued = Math.max(0, Number(upd.qtyIssued ?? 0));

    await client.query(
      `UPDATE garage.part_request_line
       SET qty_issued = $2,
           line_status = CASE WHEN $2 >= qty_requested THEN 'ISSUED' WHEN $2 > 0 THEN 'PARTIAL' ELSE 'PENDING' END
       WHERE id = $1`,
      [upd.id, qtyIssued]
    );

    if (qtyIssued > 0 && existing.product_id) {
      await client.query(
        `UPDATE core.product_inventory
         SET qty_on_hand = qty_on_hand - $1
         WHERE product_id = $2 AND branch_id = $3`,
        [qtyIssued, existing.product_id, branchId]
      );
    }
  }

  const { rows: updatedLines } = await client.query(
    `SELECT * FROM garage.part_request_line WHERE part_request_id = $1 ORDER BY line_no`,
    [partRequestId]
  );

  const allIssued   = updatedLines.every((l) => l.line_status === 'ISSUED');
  const anyIssued   = updatedLines.some((l) => l.line_status !== 'PENDING');
  const newStatus   = allIssued ? 'FULLY_ISSUED' : anyIssued ? 'PARTIALLY_ISSUED' : 'PENDING';

  const { rows: hrows } = await client.query(
    `UPDATE garage.part_request
     SET status=$3, modified_at=CURRENT_TIMESTAMP, modified_by=$4
     WHERE id=$1 AND company_id=$2
     RETURNING *`,
    [partRequestId, companyId, newStatus, modifiedBy]
  );

  const header = mapHeader(hrows[0]);
  header.lines = updatedLines.map(mapLine);
  return header;
}

export async function cancelPartRequest(pool, companyId, branchId, id, modifiedBy) {
  const { rows } = await pool.query(
    `UPDATE garage.part_request
     SET status='CANCELLED', modified_at=CURRENT_TIMESTAMP, modified_by=$4
     WHERE company_id=$1 AND branch_id=$2 AND id=$3
     RETURNING *`,
    [companyId, branchId, id, modifiedBy]
  );
  return rows[0] ? mapHeader(rows[0]) : null;
}
