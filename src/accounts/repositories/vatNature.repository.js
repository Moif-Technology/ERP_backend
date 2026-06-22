/** accounts.vat_nature_master — nature of transaction for ledgers & tax reports. */

export async function listVatNatures(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT vat_nature_id, vat_nature_name, vat_nature_type, record_status
     FROM accounts.vat_nature_master
     WHERE company_id = $1
       AND (record_status IS NULL OR TRIM(UPPER(record_status)) = 'ACTIVE')
     ORDER BY vat_nature_id ASC`,
    [companyId],
  );
  return rows;
}

export async function findVatNature(pool, companyId, vatNatureId) {
  const { rows } = await pool.query(
    `SELECT vat_nature_id, vat_nature_name, vat_nature_type
     FROM accounts.vat_nature_master
     WHERE company_id = $1 AND vat_nature_id = $2
       AND (record_status IS NULL OR TRIM(UPPER(record_status)) = 'ACTIVE')
     LIMIT 1`,
    [companyId, vatNatureId],
  );
  return rows[0] || null;
}
