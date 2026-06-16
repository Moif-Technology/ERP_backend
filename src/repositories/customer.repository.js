/**
 * Data access for biz.customer_master (company scoped).
 */

export async function nextCustomerId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(customer_id), 0) + 1 AS next_id
     FROM biz.customer_master
     WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].next_id);
}

export async function findCustomerById(db, companyId, customerId) {
  const { rows } = await db.query(
    `SELECT customer_id, customer_code, customer_name
     FROM biz.customer_master
     WHERE company_id = $1 AND customer_id = $2
     LIMIT 1`,
    [companyId, customerId],
  );
  if (!rows[0]) return null;
  return {
    customerId: Number(rows[0].customer_id),
    customerCode: rows[0].customer_code,
    customerName: rows[0].customer_name,
  };
}

export async function countActiveCustomers(db, companyId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM biz.customer_master
     WHERE company_id = $1
       AND COALESCE(status, 'ACTIVE') = 'ACTIVE'`,
    [companyId]
  );
  return Number(rows[0]?.n || 0);
}

function emptyToNull(v) {
  if (v == null || v === '') return null;
  return v;
}

function mapRow(row) {
  return {
    customerId: Number(row.customer_id),
    companyId: Number(row.company_id),
    customerCode: row.customer_code,
    customerName: row.customer_name,
    companyName: emptyToNull(row.company_name),
    customerTaxRegNo: emptyToNull(row.customer_tax_reg_no),
    contactPerson: emptyToNull(row.contact_person),
    designation: emptyToNull(row.designation),
    address: emptyToNull(row.address),
    addressArabic: emptyToNull(row.address_arabic),
    poBox: emptyToNull(row.po_box),
    countryName: emptyToNull(row.country_name),
    cityName: emptyToNull(row.city_name),
    telephone: emptyToNull(row.telephone),
    mobileNo: emptyToNull(row.mobile_no),
    fax: emptyToNull(row.fax),
    email: emptyToNull(row.email),
    paymentMode: emptyToNull(row.payment_mode),
    creditLimit: row.credit_limit != null ? String(row.credit_limit) : '0',
    creditPeriod: row.credit_period != null ? Number(row.credit_period) : 0,
    creditBalance: row.credit_balance != null ? String(row.credit_balance) : '0',
    customerType: emptyToNull(row.customer_type),
    managedBy: row.managed_by != null ? Number(row.managed_by) : null,
    loyaltyStatus: row.loyalty_status,
    creditStatus: row.credit_status,
    remarks: emptyToNull(row.remarks),
    status: row.status,
    createdByStaffId:
      row.created_by_staff_id != null ? Number(row.created_by_staff_id) : null,
    createdOn: row.created_on ?? null,
    modifiedOn: row.modified_on ?? null,
  };
}

export async function insertCustomer(client, params) {
  const {
    companyId,
    customerId,
    customerCode,
    customerName,
    companyName,
    customerTaxRegNo,
    contactPerson,
    designation,
    address,
    addressArabic,
    poBox,
    countryName,
    cityName,
    telephone,
    fax,
    email,
    mobileNo,
    paymentMode,
    creditBalance,
    creditLimit,
    creditPeriod,
    customerType,
    managedBy,
    loyaltyStatus,
    creditStatus,
    remarks,
    customerPrefix,
    createdBy,
    modifiedBy,
    createdByStaffId,
  } = params;

  const modBy = modifiedBy ?? createdBy;

  const { rows } = await client.query(
    `INSERT INTO biz.customer_master (
        company_id, customer_id, customer_code, customer_name, company_name,
        customer_tax_reg_no, contact_person, designation, address, address_arabic, po_box,
        country_name, city_name, telephone, fax, email, mobile_no,
        payment_mode, credit_balance, credit_limit, credit_period,
        customer_type, managed_by, loyalty_status, credit_status, remarks,
        customer_prefix, status, created_by, modified_by, created_by_staff_id
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21,
        $22, $23, $24, $25, $26,
        $27, 'ACTIVE', $28, $29, $30
      )
      RETURNING customer_id, company_id, customer_code, customer_name, company_name,
                customer_tax_reg_no, contact_person, designation, address, address_arabic, po_box,
                country_name, city_name, telephone, fax, email, mobile_no,
                payment_mode, credit_balance, credit_limit, credit_period,
                customer_type, managed_by, loyalty_status, credit_status, remarks,
                status, created_by_staff_id, created_on, modified_on`,
    [
      companyId,
      customerId,
      customerCode,
      customerName,
      companyName,
      customerTaxRegNo,
      contactPerson,
      designation,
      address,
      addressArabic,
      poBox,
      countryName,
      cityName,
      telephone,
      fax,
      email,
      mobileNo,
      paymentMode,
      creditBalance,
      creditLimit,
      creditPeriod,
      customerType,
      managedBy,
      loyaltyStatus,
      creditStatus,
      remarks,
      customerPrefix,
      createdBy,
      modBy,
      createdByStaffId ?? null,
    ]
  );
  return mapRow(rows[0]);
}

/**
 * Privilege checks: fetch credit limit + outstanding balance for a customer.
 * VB: lblCreditLimit, lblCurrentOsBal from CustomerMaster + voucher_detail sum.
 */
export async function getCustomerCreditInfo(client, companyId, customerId) {
  const { rows } = await client.query(
    `SELECT credit_limit, credit_period,
            COALESCE(credit_balance, 0) AS credit_balance
     FROM biz.customer_master
     WHERE company_id = $1 AND customer_id = $2
     LIMIT 1`,
    [companyId, customerId],
  );
  if (!rows[0]) return null;
  const creditLimit = Number(rows[0].credit_limit) || 0;
  const creditPeriod = Number(rows[0].credit_period) || 0;
  const creditBalance = Number(rows[0].credit_balance) || 0;

  let osBalance = creditBalance;
  try {
    const { rows: vRows } = await client.query(
      `SELECT COALESCE(SUM(outstanding_balance), 0)::numeric AS os
       FROM accounts.voucher_detail
       WHERE company_id = $1 AND account_id = $2 AND outstanding_balance > 0`,
      [companyId, customerId],
    );
    if (vRows[0]) osBalance = Number(vRows[0].os) || creditBalance;
  } catch { /* voucher_detail may not exist */ }

  return { creditLimit, creditPeriod, osBalance };
}

export async function updateCustomer(client, companyId, customerId, params) {
  const { rows } = await client.query(
    `UPDATE biz.customer_master SET
        customer_code = $3, customer_name = $4, company_name = $5,
        customer_tax_reg_no = $6, contact_person = $7, designation = $8,
        address = $9, address_arabic = $10, po_box = $11, country_name = $12,
        city_name = $13, telephone = $14, fax = $15, email = $16, mobile_no = $17,
        payment_mode = $18, credit_balance = $19, credit_limit = $20,
        credit_period = $21, customer_type = $22, managed_by = $23,
        loyalty_status = $24, credit_status = $25, remarks = $26,
        modified_by = $27, modified_on = NOW()
     WHERE company_id = $1 AND customer_id = $2
     RETURNING customer_id, company_id, customer_code, customer_name, company_name,
               customer_tax_reg_no, contact_person, designation, address, address_arabic, po_box,
               country_name, city_name, telephone, fax, email, mobile_no,
               payment_mode, credit_balance, credit_limit, credit_period,
               customer_type, managed_by, loyalty_status, credit_status, remarks,
               status, created_by_staff_id, created_on, modified_on`,
    [
      companyId, customerId,
      params.customerCode, params.customerName, params.companyName,
      params.customerTaxRegNo, params.contactPerson, params.designation,
      params.address, params.addressArabic, params.poBox, params.countryName, params.cityName,
      params.telephone, params.fax, params.email, params.mobileNo,
      params.paymentMode, params.creditBalance, params.creditLimit, params.creditPeriod,
      params.customerType, params.managedBy, params.loyaltyStatus, params.creditStatus,
      params.remarks, params.modifiedBy,
    ]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listCustomersByCompany(pool, companyId, limit, search = '') {
  const cap = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const q = String(search || '').trim();
  const params = [companyId];
  let where = `WHERE company_id = $1 AND (status IS NULL OR status = 'ACTIVE')`;
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (
      customer_code ILIKE $2
      OR customer_name ILIKE $2
      OR COALESCE(company_name, '') ILIKE $2
      OR COALESCE(mobile_no, '') ILIKE $2
      OR COALESCE(telephone, '') ILIKE $2
      OR COALESCE(email, '') ILIKE $2
    )`;
  }
  params.push(cap);
  const { rows } = await pool.query(
    `SELECT customer_id, company_id, customer_code, customer_name, company_name,
            customer_tax_reg_no, contact_person, designation, address, address_arabic, po_box,
            country_name, city_name, telephone, fax, email, mobile_no,
            payment_mode, credit_balance, credit_limit, credit_period,
            customer_type, managed_by, loyalty_status, credit_status, remarks,
            status, created_by_staff_id, created_on, modified_on
     FROM biz.customer_master
     ${where}
     ORDER BY customer_name ASC
     LIMIT $${params.length}`,
    params
  );
  return rows.map(mapRow);
}
