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

/**
 * Resolve a registration `softwareTypeCode` (RESTAURANT, POS, GARAGE, SALON, …)
 * to core.software_type_master.software_type_id.
 *
 * Read from the table rather than a hardcoded map: the map that used to live in
 * registration.service.js silently fell behind twice — SERVICE (id 7) and SALON
 * (id 8) were both added to the table without anyone updating the constant, so
 * registering either type produced a company with software_type_id NULL and no
 * feature scoping at all. Returns null for an unknown or inactive code, which
 * the caller treats as "legacy tenant, no software-type scoping".
 */
export async function findSoftwareTypeIdByCode(client, softwareCode) {
  const code = String(softwareCode || '').trim();
  if (!code) return null;
  const { rows } = await client.query(
    `SELECT software_type_id
       FROM core.software_type_master
      WHERE UPPER(software_code) = UPPER($1)
        AND is_active = TRUE
      ORDER BY software_type_id
      LIMIT 1`,
    [code]
  );
  return rows.length ? Number(rows[0].software_type_id) : null;
}

export async function isCompanyCodeTaken(client, companyCode) {
  const { rows } = await client.query(
    'SELECT 1 FROM core.company_master WHERE company_code = $1 LIMIT 1',
    [companyCode]
  );
  return rows.length > 0;
}

export async function insertCompany(client, params) {
  const { companyId, companyCode, companyName, contactPerson, phone, now, softwareTypeId = null } = params;
  await client.query(
    `INSERT INTO core.company_master (
      company_id, company_code, company_name, company_address, status,
      contact_person, phone, software_type_id, created_at, updated_at
    ) VALUES ($1, $2, $3, NULL, 'ACTIVE', $4, $5, $6, $7, $7)`,
    [companyId, companyCode, companyName, contactPerson, phone || null, softwareTypeId, now]
  );
}

export async function getCompanyProfile(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT
       company_id, company_code, company_name, company_address,
       contact_person, phone, email, website,
       vat_trn, trade_license, po_box, city, country,
       logo_data, currency, fiscal_year_start, decimal_places,
       status, created_at, updated_at
     FROM core.company_master
     WHERE company_id = $1`,
    [companyId]
  );
  return rows[0] || null;
}

export async function updateCompanyProfile(pool, companyId, fields) {
  const {
    companyName, companyAddress, contactPerson, phone, email, website,
    vatTrn, tradeLicense, poBox, city, country,
    logoData, currency, fiscalYearStart, decimalPlaces,
  } = fields;
  const { rows } = await pool.query(
    `UPDATE core.company_master SET
       company_name        = $1,
       company_address     = $2,
       contact_person      = $3,
       phone               = $4,
       email               = $5,
       website             = $6,
       vat_trn             = $7,
       trade_license       = $8,
       po_box              = $9,
       city                = $10,
       country             = $11,
       logo_data           = COALESCE($12, logo_data),
       currency            = $13,
       fiscal_year_start   = $14,
       decimal_places      = $15,
       updated_at          = NOW()
     WHERE company_id = $16
     RETURNING
       company_id, company_code, company_name, company_address,
       contact_person, phone, email, website,
       vat_trn, trade_license, po_box, city, country,
       logo_data, currency, fiscal_year_start, decimal_places,
       status, updated_at`,
    [
      companyName || null, companyAddress || null, contactPerson || null,
      phone || null, email || null, website || null,
      vatTrn || null, tradeLicense || null, poBox || null,
      city || null, country || null,
      logoData || null,
      currency || 'AED', fiscalYearStart || '01-01',
      decimalPlaces != null ? Number(decimalPlaces) : 2,
      companyId,
    ]
  );
  return rows[0] || null;
}

export async function listBranchesForProfile(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT branch_id, branch_code, branch_name, status
     FROM core.branch_master
     WHERE company_id = $1
     ORDER BY branch_id ASC`,
    [companyId]
  );
  return rows;
}
