function mapRow(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    noteId: Number(r.customer_note_id),
    companyId: Number(r.company_id),
    branchId: Number(r.branch_id),
    customerId: r.customer_id != null ? Number(r.customer_id) : null,
    leadId: r.lead_id != null ? Number(r.lead_id) : null,
    opportunityId: r.opportunity_id != null ? Number(r.opportunity_id) : null,
    noteDate: r.note_date,
    noteTitle: r.note_title,
    noteText: r.note_text,
    isImportant: Boolean(r.is_important),
    createdBy: r.created_by != null ? Number(r.created_by) : null,
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
  };
}

export async function nextNoteId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(customer_note_id), 0) + 1 AS n
       FROM biz.customer_note
      WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].n);
}

export async function listByCompany(pool, companyId, filters = {}) {
  const where = [`company_id = $1`];
  const params = [companyId];
  let i = 2;

  if (filters.search) {
    where.push(`(note_title ILIKE $${i} OR note_text ILIKE $${i})`);
    params.push(`%${filters.search}%`);
    i++;
  }
  if (filters.customerId != null) { where.push(`customer_id = $${i++}`); params.push(filters.customerId); }
  if (filters.leadId != null) { where.push(`lead_id = $${i++}`); params.push(filters.leadId); }
  if (filters.opportunityId != null) { where.push(`opportunity_id = $${i++}`); params.push(filters.opportunityId); }

  const { rows } = await pool.query(
    `SELECT *
       FROM biz.customer_note
      WHERE ${where.join(' AND ')}
      ORDER BY note_date DESC, id DESC`,
    params
  );
  return rows.map(mapRow);
}

export async function findById(pool, companyId, id) {
  const { rows } = await pool.query(
    `SELECT *
       FROM biz.customer_note
      WHERE company_id = $1
        AND id = $2`,
    [companyId, id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function insert(client, p) {
  const { rows } = await client.query(
    `INSERT INTO biz.customer_note
       (company_id, branch_id, customer_note_id, customer_id, lead_id, opportunity_id,
        note_date, note_title, note_text, is_important, created_by, modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,
             COALESCE($7, NOW()),$8,$9,$10,$11,$11)
     RETURNING *`,
    [
      p.companyId, p.branchId, p.noteId, p.customerId, p.leadId, p.opportunityId,
      p.noteDate, p.noteTitle, p.noteText, Boolean(p.isImportant), p.actorStaffId,
    ]
  );
  return mapRow(rows[0]);
}

export async function update(pool, companyId, id, p) {
  const { rows } = await pool.query(
    `UPDATE biz.customer_note SET
        customer_id = $3,
        lead_id = $4,
        opportunity_id = $5,
        note_date = COALESCE($6, note_date),
        note_title = $7,
        note_text = $8,
        is_important = $9,
        modified_by = $10,
        modified_at = NOW()
      WHERE company_id = $1
        AND id = $2
      RETURNING *`,
    [
      companyId, id, p.customerId, p.leadId, p.opportunityId, p.noteDate,
      p.noteTitle, p.noteText, Boolean(p.isImportant), p.actorStaffId,
    ]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function softDelete(pool, companyId, id, actorStaffId) {
  const { rowCount } = await pool.query(
    `DELETE FROM biz.customer_note
      WHERE company_id = $1 AND id = $2`,
    [companyId, id]
  );
  return rowCount > 0;
}
