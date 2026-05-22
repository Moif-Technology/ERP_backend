/**
 * core.document_reference_map — multi-document links (legacy MultiReferenceTable).
 */

export async function nextDocumentReferenceId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(document_reference_id), 0) + 1 AS n
     FROM core.document_reference_map WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].n);
}

export async function deleteBySourceAndType(client, companyId, sourceDocId, sourceDocType, refType) {
  await client.query(
    `DELETE FROM core.document_reference_map
     WHERE company_id = $1 AND source_doc_id = $2
       AND source_doc_type = $3 AND reference_doc_type = $4`,
    [companyId, sourceDocId, sourceDocType, refType],
  );
}

export async function insertDocumentReference(client, row) {
  await client.query(
    `INSERT INTO core.document_reference_map (
       company_id, branch_id, document_reference_id,
       source_doc_id, source_doc_type, source_doc_no,
       reference_doc_id, reference_doc_type, reference_doc_no,
       sync_status, record_status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      row.companyId, row.branchId, row.documentReferenceId,
      row.sourceDocId, row.sourceDocType, row.sourceDocNo,
      row.referenceDocId, row.referenceDocType, row.referenceDocNo,
      row.syncStatus || 'PENDING', row.recordStatus || 'ACTIVE',
    ],
  );
}
