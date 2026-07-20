/**
 * Document sequence service.
 *
 * core.document_sequence is the single source of truth for ALL human-visible
 * document numbers in the system (invoice_no, purchase_no, group_code, grn_no, …).
 *
 * Internal DB primary keys (sales_id, purchase_id, …) remain global auto-increments.
 * This service generates ONLY the business-visible sequential codes.
 *
 * Usage (inside a transaction):
 *   const invoiceNo = await nextDocNo(client, { companyId, branchId, sequenceCode: 'SALES', fiscalYear: 2026 });
 *   // → "INV-0042"
 */

/**
 * Sequence definitions — one entry per document type.
 * module: logical grouping for admin UI and filtering.
 * resetRule: NEVER = lifetime counter, YEARLY = resets each fiscal year.
 */
export const SEQUENCE_DEFS = {

  // ── BACKOFFICE — Master codes (NEVER reset) ─────────────────────────────
  GROUP:         { module: 'BACKOFFICE', prefix: 'GRP', padLength: 3, resetRule: 'NEVER',  sequenceName: 'Group Code' },
  SUB_GROUP:     { module: 'BACKOFFICE', prefix: 'SGP', padLength: 3, resetRule: 'NEVER',  sequenceName: 'Sub Group Code' },
  SUB_SUB_GROUP: { module: 'BACKOFFICE', prefix: 'SSG', padLength: 3, resetRule: 'NEVER',  sequenceName: 'Sub Sub Group Code' },
  CUSTOMER:      { module: 'BACKOFFICE', prefix: 'CUS', padLength: 5, resetRule: 'NEVER',  sequenceName: 'Customer Code' },
  SUPPLIER:      { module: 'BACKOFFICE', prefix: 'SUP', padLength: 5, resetRule: 'NEVER',  sequenceName: 'Supplier Code' },
  PRODUCT:       { module: 'BACKOFFICE', prefix: 'PRD', padLength: 6, resetRule: 'NEVER',  sequenceName: 'Product Code' },

  // ── BACKOFFICE — Transactional (YEARLY reset) ────────────────────────────
  SALES:          { module: 'BACKOFFICE', prefix: 'INV', padLength: 4, resetRule: 'YEARLY', sequenceName: 'Sales Invoice' },
  SALES_RETURN:   { module: 'BACKOFFICE', prefix: 'RTN', padLength: 4, resetRule: 'YEARLY', sequenceName: 'Sales Return' },
  PURCHASE:       { module: 'BACKOFFICE', prefix: 'PO',  padLength: 4, resetRule: 'YEARLY', sequenceName: 'Purchase Order' },
  PURCHASE_RETURN:{ module: 'BACKOFFICE', prefix: 'PRN', padLength: 4, resetRule: 'YEARLY', sequenceName: 'Purchase Return' },
  GRN:            { module: 'BACKOFFICE', prefix: 'GRN', padLength: 4, resetRule: 'YEARLY', sequenceName: 'Goods Receipt Note' },
  QUOTATION:      { module: 'BACKOFFICE', prefix: 'QT',  padLength: 4, resetRule: 'YEARLY', sequenceName: 'Quotation' },
  LPO:            { module: 'BACKOFFICE', prefix: 'LPO', padLength: 4, resetRule: 'YEARLY', sequenceName: 'Local Purchase Order' },
  DELIVERY:       { module: 'BACKOFFICE', prefix: 'DO',  padLength: 4, resetRule: 'YEARLY', sequenceName: 'Delivery Order' },
  TRANSFER:       { module: 'BACKOFFICE', prefix: 'TRF', padLength: 4, resetRule: 'YEARLY', sequenceName: 'Stock Transfer' },
  STOCK_ADJ:      { module: 'BACKOFFICE', prefix: 'SA',  padLength: 4, resetRule: 'YEARLY', sequenceName: 'Stock Adjustment' },
  STOCK_DMG:      { module: 'BACKOFFICE', prefix: 'DM',  padLength: 5, resetRule: 'YEARLY', sequenceName: 'Damage Entry' },
  STOCK_ASE:      { module: 'BACKOFFICE', prefix: 'AS',  padLength: 5, resetRule: 'YEARLY', sequenceName: 'Stock Audit Entry' },
  OPENING_STOCK:      { module: 'BACKOFFICE', prefix: 'OS',  padLength: 4, resetRule: 'YEARLY', sequenceName: 'Opening Stock Entry' },
  MATERIAL_REQUEST:   { module: 'BACKOFFICE', prefix: 'MRQ', padLength: 4, resetRule: 'YEARLY', sequenceName: 'Material Request' },
  ORDER_FORM:         { module: 'BACKOFFICE', prefix: 'OF',  padLength: 4, resetRule: 'YEARLY', sequenceName: 'LPO Order Form' },
  VAN_SALES:          { module: 'BACKOFFICE', prefix: 'VS',  padLength: 4, resetRule: 'YEARLY', sequenceName: 'Van Sale Invoice' },
  VAN_SETTLEMENT:     { module: 'BACKOFFICE', prefix: 'VST', padLength: 4, resetRule: 'YEARLY', sequenceName: 'Van Sale Settlement' },

  // ── ACCOUNTS — Master codes ───────────────────────────────────────────────
  // (none currently — accounts uses transactional vouchers only)

  // ── ACCOUNTS — Transactional (YEARLY reset) ──────────────────────────────
  RECEIPT:        { module: 'ACCOUNTS', prefix: 'RCP', padLength: 4, resetRule: 'YEARLY', sequenceName: 'Receipt Voucher' },
  PAYMENT:        { module: 'ACCOUNTS', prefix: 'PV',  padLength: 4, resetRule: 'YEARLY', sequenceName: 'Payment Voucher' },
  JOURNAL:        { module: 'ACCOUNTS', prefix: 'JV',  padLength: 4, resetRule: 'YEARLY', sequenceName: 'Journal Voucher' },
  CONTRA:         { module: 'ACCOUNTS', prefix: 'CV',  padLength: 4, resetRule: 'YEARLY', sequenceName: 'Contra Voucher' },
  DEBIT_NOTE:     { module: 'ACCOUNTS', prefix: 'DN',  padLength: 4, resetRule: 'YEARLY', sequenceName: 'Debit Note' },
  CREDIT_NOTE:    { module: 'ACCOUNTS', prefix: 'CN',  padLength: 4, resetRule: 'YEARLY', sequenceName: 'Credit Note' },
  EXPENSE:        { module: 'ACCOUNTS', prefix: 'EXP', padLength: 4, resetRule: 'YEARLY', sequenceName: 'Expense Voucher' },
  INCOME:         { module: 'ACCOUNTS', prefix: 'INC', padLength: 4, resetRule: 'YEARLY', sequenceName: 'Income Voucher' },
  VOUCHER:        { module: 'ACCOUNTS', prefix: 'VCH', padLength: 4, resetRule: 'YEARLY', sequenceName: 'General Voucher' },

  // ── HR — Master codes (NEVER reset) ─────────────────────────────────────
  STAFF:          { module: 'HR', prefix: 'STF', padLength: 5, resetRule: 'NEVER', sequenceName: 'Staff Code' },
  EMPLOYEE:       { module: 'HR', prefix: 'EMP', padLength: 5, resetRule: 'NEVER', sequenceName: 'Employee Code' },

  // ── CRM — Master codes (NEVER reset) ────────────────────────────────────
  LEAD:           { module: 'CRM', prefix: 'LD',  padLength: 5, resetRule: 'NEVER', sequenceName: 'Lead Code' },
  OPPORTUNITY:    { module: 'CRM', prefix: 'OPP', padLength: 5, resetRule: 'NEVER', sequenceName: 'Opportunity Code' },

  // ── GARAGE — Master codes ────────────────────────────────────────────────
  // (none currently)

  // ── GARAGE — Transactional (YEARLY reset) ────────────────────────────────
  JOB_CARD:       { module: 'GARAGE', prefix: 'JC',  padLength: 5, resetRule: 'YEARLY', sequenceName: 'Job Card' },
  PRE_JOB_CARD:   { module: 'GARAGE', prefix: 'PJC', padLength: 5, resetRule: 'YEARLY', sequenceName: 'Pre Job Card' },
  ESTIMATION:     { module: 'GARAGE', prefix: 'EST', padLength: 5, resetRule: 'YEARLY', sequenceName: 'Estimation' },
  GATE_PASS:      { module: 'GARAGE', prefix: 'GP',  padLength: 5, resetRule: 'YEARLY', sequenceName: 'Gate Pass' },
  GARAGE_INVOICE: { module: 'GARAGE', prefix: 'GI',  padLength: 5, resetRule: 'YEARLY', sequenceName: 'Garage Invoice' },
  PART_REQUEST:   { module: 'GARAGE', prefix: 'PR',  padLength: 5, resetRule: 'YEARLY', sequenceName: 'Part Request' },
  SUBLET_LPO:     { module: 'GARAGE', prefix: 'SLO', padLength: 5, resetRule: 'YEARLY', sequenceName: 'Sublet LPO' },
  SUBLET_JOB:     { module: 'GARAGE', prefix: 'SJ',  padLength: 5, resetRule: 'YEARLY', sequenceName: 'Sublet Job' },
  TECHNICIAN:     { module: 'GARAGE', prefix: 'TCH', padLength: 4, resetRule: 'NEVER',  sequenceName: 'Technician Code' },

  // ── RESTAURANT — Master codes ────────────────────────────────────────────
  // (none currently)

  // ── RESTAURANT — Transactional ───────────────────────────────────────────
  KOT:            { module: 'RESTAURANT', prefix: 'KOT', padLength: 4, resetRule: 'NEVER',  sequenceName: 'Kitchen Order Ticket' },
  ADVANCE_PAYMENT:{ module: 'RESTAURANT', prefix: 'ADV', padLength: 4, resetRule: 'YEARLY', sequenceName: 'Advance Payment' },
  PARTY_ORDER:    { module: 'RESTAURANT', prefix: 'POR', padLength: 4, resetRule: 'YEARLY', sequenceName: 'Party Order' },
  PRODUCTION:     { module: 'RESTAURANT', prefix: 'PRO', padLength: 4, resetRule: 'YEARLY', sequenceName: 'Production Entry' },
  PRO_REQUEST:    { module: 'RESTAURANT', prefix: 'PRQ', padLength: 4, resetRule: 'YEARLY', sequenceName: 'Product Transfer Request' },
  PRO_RECEIPT:    { module: 'RESTAURANT', prefix: 'PRC', padLength: 4, resetRule: 'YEARLY', sequenceName: 'Product Transfer Receipt' },

  // ── COUNTER_POS — Transactional ──────────────────────────────────────────
  HOLD_BILL:      { module: 'COUNTER_POS', prefix: 'HLD', padLength: 4, resetRule: 'NEVER',  sequenceName: 'Hold Bill' },
  COUNTER_CLOSE:  { module: 'COUNTER_POS', prefix: 'CCL', padLength: 4, resetRule: 'YEARLY', sequenceName: 'Counter Close' },

  // ── SERVICE — Master codes (NEVER reset) ─────────────────────────────────
  SERVICE_CODE:   { module: 'SERVICE', prefix: 'SVC', padLength: 4, resetRule: 'NEVER',  sequenceName: 'Service Code' },

  // ── SERVICE — Transactional (YEARLY reset) ───────────────────────────────
  CASE:           { module: 'SERVICE', prefix: 'SC',  padLength: 4, resetRule: 'YEARLY', sequenceName: 'Case' },
  CASE_INVOICE:   { module: 'SERVICE', prefix: 'SCI', padLength: 4, resetRule: 'YEARLY', sequenceName: 'Case Invoice' },
};

/**
 * Formats a sequence row into a document number string.
 * padLength <= 3  → no dash  → "GRP001"
 * padLength >= 4  → dash     → "INV-0042"
 */
function formatDocNo(prefix, padLength, value) {
  const num = String(value).padStart(padLength, '0');
  if (!prefix) return num;
  return padLength <= 3 ? `${prefix}${num}` : `${prefix}-${num}`;
}

/**
 * Ensure a sequence row exists for (companyId, branchId, sequenceCode, fiscalYear).
 * Creates it with ON CONFLICT DO NOTHING — safe for concurrent calls and new companies/branches.
 */
export async function ensureDocSeqRow(client, { companyId, branchId, sequenceCode, fiscalYear = null }) {
  const def = SEQUENCE_DEFS[sequenceCode];
  if (!def) throw new Error(`Unknown sequence code: ${sequenceCode}`);

  const effectiveFiscalYear = def.resetRule === 'YEARLY'
    ? (fiscalYear ?? new Date().getFullYear())
    : null;

  await client.query(
    `INSERT INTO core.document_sequence
       (company_id, branch_id, sequence_code, sequence_name,
        prefix, pad_length, reset_rule, fiscal_year, module,
        current_value, step_value, is_active,
        created_by, modified_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 1, true, 0, 0)
     ON CONFLICT (company_id, branch_id, sequence_code,
                  COALESCE(fiscal_year, 0), COALESCE(fiscal_month, 0))
     DO NOTHING`,
    [
      companyId,
      branchId,
      sequenceCode,
      def.sequenceName,
      def.prefix,
      def.padLength,
      def.resetRule,
      effectiveFiscalYear,
      def.module,
    ],
  );
}

/**
 * Atomically increment and return the next document number.
 * MUST be called inside a transaction (client = transaction client).
 * Auto-creates the sequence row if missing (new company, branch, or fiscal year).
 *
 * @param {object} client        - pg transaction client
 * @param {object} opts
 * @param {number} opts.companyId
 * @param {number} opts.branchId
 * @param {string} opts.sequenceCode  - key from SEQUENCE_DEFS
 * @param {number} [opts.fiscalYear]  - auto-detected from current date if omitted
 * @returns {Promise<string>} formatted document number e.g. "INV-0042"
 */
export async function nextDocNo(client, { companyId, branchId, sequenceCode, fiscalYear }) {
  const def = SEQUENCE_DEFS[sequenceCode];
  if (!def) throw new Error(`Unknown sequence code: ${sequenceCode}`);

  const effectiveFiscalYear = def.resetRule === 'YEARLY'
    ? (fiscalYear ?? new Date().getFullYear())
    : null;

  await ensureDocSeqRow(client, { companyId, branchId, sequenceCode, fiscalYear: effectiveFiscalYear });

  const { rows } = await client.query(
    `UPDATE core.document_sequence
     SET current_value = current_value + step_value,
         modified_at   = NOW()
     WHERE company_id    = $1
       AND branch_id     = $2
       AND sequence_code = $3
       AND is_deleted    = false
       AND is_active     = true
       AND (
         ($4::int IS NULL AND fiscal_year IS NULL)
         OR fiscal_year = $4
       )
     RETURNING current_value, prefix, pad_length`,
    [companyId, branchId, sequenceCode, effectiveFiscalYear],
  );

  if (!rows.length) {
    throw new Error(
      `Document sequence not found: ${sequenceCode} company=${companyId} branch=${branchId} year=${effectiveFiscalYear}`,
    );
  }

  const { current_value, prefix, pad_length } = rows[0];
  return formatDocNo(prefix, Number(pad_length), Number(current_value));
}

/**
 * Peek at the NEXT number without incrementing.
 * Use for display/preview only — not for saving to DB.
 */
export async function peekNextDocNo(client, { companyId, branchId, sequenceCode, fiscalYear }) {
  const def = SEQUENCE_DEFS[sequenceCode];
  if (!def) throw new Error(`Unknown sequence code: ${sequenceCode}`);

  const effectiveFiscalYear = def.resetRule === 'YEARLY'
    ? (fiscalYear ?? new Date().getFullYear())
    : null;

  await ensureDocSeqRow(client, { companyId, branchId, sequenceCode, fiscalYear: effectiveFiscalYear });

  const { rows } = await client.query(
    `SELECT current_value, prefix, pad_length
     FROM core.document_sequence
     WHERE company_id    = $1
       AND branch_id     = $2
       AND sequence_code = $3
       AND is_deleted    = false
       AND is_active     = true
       AND (
         ($4::int IS NULL AND fiscal_year IS NULL)
         OR fiscal_year = $4
       )`,
    [companyId, branchId, sequenceCode, effectiveFiscalYear],
  );

  if (!rows.length) return null;
  const { current_value, prefix, pad_length } = rows[0];
  return formatDocNo(prefix, Number(pad_length), Number(current_value) + 1);
}
