/**
 * Data access for core.company_master.
 */

export async function lockCompanyMasterForInsert(client) {
  await client.query('LOCK TABLE core.company_master IN SHARE ROW EXCLUSIVE MODE');
}

export async function nextCompanyId(client) {
  const { rows } = await client.query(
    'SELECT COALESCE(MAX(company_id), 0) + 1 AS company_id FROM core.company_master'
  );
  return Number(rows[0].company_id);
}

export async function isCompanyCodeTaken(client, companyCode) {
  const { rows } = await client.query(
    'SELECT 1 FROM core.company_master WHERE company_code = $1 LIMIT 1',
    [companyCode]
  );
  return rows.length > 0;
}

export async function insertCompany(client, params) {
  const { companyId, companyCode, companyName, contactPerson, phone, now } = params;
  await client.query(
    `INSERT INTO core.company_master (
      company_id, company_code, company_name, company_address, status,
      contact_person, phone, created_at, updated_at
    ) VALUES ($1, $2, $3, NULL, 'ACTIVE', $4, $5, $6, $6)`,
    [companyId, companyCode, companyName, contactPerson, phone || null, now]
  );
}
