import { withTransaction } from '../../config/db.js';
import { requireBranchId, requireCompanyId, trimOrNull, toIntOrNull } from '../../utils/crmHelpers.js';
import * as repo from '../repositories/invoice.repository.js';
import { nextDocNo } from '../../shared/services/docSequence.service.js';

const VAT_RATE = 0.05;

function actorLabel(a) { return trimOrNull(a?.staff_name, 50) || trimOrNull(a?.login_name, 50) || 'system'; }
function toNonNeg(v) { const n = v == null ? null : Number(v); return n == null || Number.isNaN(n) || n < 0 ? 0 : n; }
function toDateOrNull(v) {
  if (v == null || v === '') return new Date().toISOString().slice(0, 10);
  const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

async function fetchAutoLines(pool, companyId, branchId, jobCardId, jcNo) {
  const lines = [];

  // Labour lines from job_card_line
  if (jobCardId) {
    const { rows: labourRows } = await pool.query(
      `SELECT jcl.description, jcl.std_time AS qty, jcl.selling_price AS rate,
              (jcl.std_time * jcl.selling_price) AS amount, jcl.id AS ref_id
       FROM garage.job_card_line jcl
       WHERE jcl.job_card_id=$1`,
      [jobCardId]
    );
    labourRows.forEach(r => lines.push({
      lineType: 'LABOUR',
      description: r.description,
      qty: Number(r.qty ?? 1),
      rate: Number(r.rate ?? 0),
      amount: Number(r.amount ?? 0),
      refId: Number(r.ref_id),
    }));
  }

  // Spare lines from ISSUED part_request_lines
  if (jcNo) {
    const { rows: spareRows } = await pool.query(
      `SELECT prl.description, prl.qty_issued AS qty, prl.unit_cost AS rate,
              (prl.qty_issued * prl.unit_cost) AS amount, prl.id AS ref_id
       FROM garage.part_request pr
       JOIN garage.part_request_line prl ON prl.part_request_id = pr.id
       WHERE pr.jc_no=$1 AND pr.company_id=$2 AND prl.line_status IN ('PARTIAL','ISSUED')`,
      [jcNo, companyId]
    );
    spareRows.forEach(r => lines.push({
      lineType: 'SPARE',
      description: r.description,
      qty: Number(r.qty ?? 0),
      rate: Number(r.rate ?? 0),
      amount: Number(r.amount ?? 0),
      refId: Number(r.ref_id),
    }));
  }

  // Sublet lines
  if (jcNo) {
    const { rows: subletRows } = await pool.query(
      `SELECT description, 1 AS qty, amount AS rate, amount, id AS ref_id
       FROM garage.sublet_job WHERE jc_no=$1 AND company_id=$2 AND branch_id=$3 AND status='POSTED'`,
      [jcNo, companyId, branchId]
    );
    subletRows.forEach(r => lines.push({
      lineType: 'SUBLET',
      description: r.description,
      qty: 1,
      rate: Number(r.rate ?? 0),
      amount: Number(r.amount ?? 0),
      refId: Number(r.ref_id),
    }));
  }

  // Consumable lines
  if (jcNo) {
    const { rows: consRows } = await pool.query(
      `SELECT description, qty, unit_cost AS rate, total_cost AS amount, id AS ref_id
       FROM garage.consumable_usage WHERE jc_no=$1 AND company_id=$2 AND branch_id=$3`,
      [jcNo, companyId, branchId]
    );
    consRows.forEach(r => lines.push({
      lineType: 'CONSUMABLE',
      description: r.description,
      qty: Number(r.qty ?? 0),
      rate: Number(r.rate ?? 0),
      amount: Number(r.amount ?? 0),
      refId: Number(r.ref_id),
    }));
  }

  // Lubricant lines
  if (jcNo) {
    const { rows: lubRows } = await pool.query(
      `SELECT description, qty, unit_cost AS rate, total_cost AS amount, id AS ref_id
       FROM garage.lubricant_usage WHERE jc_no=$1 AND company_id=$2 AND branch_id=$3`,
      [jcNo, companyId, branchId]
    );
    lubRows.forEach(r => lines.push({
      lineType: 'LUBRICANT',
      description: r.description,
      qty: Number(r.qty ?? 0),
      rate: Number(r.rate ?? 0),
      amount: Number(r.amount ?? 0),
      refId: Number(r.ref_id),
    }));
  }

  return lines;
}

function calcAmounts(lines, discount = 0) {
  const labourAmount = lines.filter(l => l.lineType === 'LABOUR').reduce((s, l) => s + l.amount, 0);
  const sparesAmount = lines.filter(l => l.lineType === 'SPARE').reduce((s, l) => s + l.amount, 0);
  const subletAmount = lines.filter(l => l.lineType === 'SUBLET').reduce((s, l) => s + l.amount, 0);
  const consumableAmount = lines.filter(l => l.lineType === 'CONSUMABLE').reduce((s, l) => s + l.amount, 0);
  const lubricantAmount = lines.filter(l => l.lineType === 'LUBRICANT').reduce((s, l) => s + l.amount, 0);
  const grossAmount = labourAmount + sparesAmount + subletAmount + consumableAmount + lubricantAmount;
  const afterDiscount = grossAmount - discount;
  const vatAmount = Math.round(afterDiscount * VAT_RATE * 100) / 100;
  const totalAmount = afterDiscount + vatAmount;
  return { labourAmount, sparesAmount, subletAmount, consumableAmount, lubricantAmount, grossAmount, vatAmount, totalAmount };
}

export async function listInvoices(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, query);
  return repo.listInvoices(pool, companyId, branchId, {
    status: trimOrNull(query.status, 20),
    customerId: toIntOrNull(query.customerId),
    dateFrom: trimOrNull(query.dateFrom, 10),
    dateTo: trimOrNull(query.dateTo, 10),
  });
}

export async function getInvoiceById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const item = await repo.findInvoiceById(pool, companyId, branchId, Number(id));
  if (!item) { const e = new Error('Invoice not found'); e.status = 404; throw e; }
  return item;
}

export async function getInvoiceByJobCard(pool, jcNo, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  return repo.findInvoiceByJobCard(pool, companyId, branchId, jcNo);
}

export async function createInvoice(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const createdBy = actorLabel(authStaff);

  const jobCardId = toIntOrNull(body.jobCardId);
  const jcNo = trimOrNull(body.jcNo, 30);
  const discount = toNonNeg(body.discount);
  const invoiceDate = toDateOrNull(body.invoiceDate);

  const autoLines = await fetchAutoLines(pool, companyId, branchId, jobCardId, jcNo);
  const manualLines = Array.isArray(body.lines) ? body.lines.map(l => ({
    lineType: trimOrNull(l.lineType, 30) || 'LABOUR',
    description: trimOrNull(l.description, 500),
    qty: toNonNeg(l.qty) || 1,
    rate: toNonNeg(l.rate),
    amount: toNonNeg(l.amount),
    refId: toIntOrNull(l.refId),
  })) : [];

  const lines = autoLines.length > 0 ? autoLines : manualLines;
  const amounts = calcAmounts(lines, discount);

  return withTransaction(async (client) => {
    const invoiceNo = await nextDocNo(client, { companyId, branchId, sequenceCode: 'GARAGE_INVOICE', fiscalYear: new Date().getFullYear() });
    const header = await repo.insertInvoice(client, {
      companyId, branchId, invoiceNo, jobCardId, jcNo,
      vehicleId: toIntOrNull(body.vehicleId),
      customerId: toIntOrNull(body.customerId),
      customerName: trimOrNull(body.customerName, 150),
      regNo: trimOrNull(body.regNo, 30),
      invoiceDate,
      discount,
      ...amounts,
      createdBy,
    });
    const insertedLines = await repo.insertInvoiceLines(client, header.id, companyId, lines);
    return { ...header, lines: insertedLines };
  });
}

export async function updateInvoice(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const modifiedBy = actorLabel(authStaff);
  const discount = toNonNeg(body.discount);

  const existing = await repo.findInvoiceById(pool, companyId, branchId, Number(id));
  if (!existing) { const e = new Error('Invoice not found'); e.status = 404; throw e; }
  if (existing.status !== 'DRAFT') { const e = new Error('Only DRAFT invoices can be edited'); e.status = 409; throw e; }

  const lines = Array.isArray(body.lines) ? body.lines.map(l => ({
    lineType: trimOrNull(l.lineType, 30) || 'LABOUR',
    description: trimOrNull(l.description, 500),
    qty: toNonNeg(l.qty) || 1,
    rate: toNonNeg(l.rate),
    amount: toNonNeg(l.amount),
    refId: toIntOrNull(l.refId),
  })) : existing.lines;

  const amounts = calcAmounts(lines, discount);

  return withTransaction(async (client) => {
    const header = await repo.updateInvoiceAmounts(client, companyId, branchId, Number(id), { ...amounts, discount, modifiedBy });
    if (!header) { const e = new Error('Invoice not found or not editable'); e.status = 404; throw e; }
    await repo.deleteInvoiceLines(client, header.id);
    const insertedLines = await repo.insertInvoiceLines(client, header.id, companyId, lines);
    return { ...header, lines: insertedLines };
  });
}

export async function postInvoice(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const item = await repo.findInvoiceById(pool, companyId, branchId, Number(id));
  if (!item) { const e = new Error('Invoice not found'); e.status = 404; throw e; }
  if (item.status === 'POSTED') { const e = new Error('Already posted'); e.status = 409; throw e; }
  return repo.setInvoiceStatus(pool, companyId, branchId, Number(id), 'POSTED', actorLabel(authStaff));
}

export async function cancelInvoice(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const item = await repo.findInvoiceById(pool, companyId, branchId, Number(id));
  if (!item) { const e = new Error('Invoice not found'); e.status = 404; throw e; }
  if (item.status === 'CANCELLED') { const e = new Error('Already cancelled'); e.status = 409; throw e; }
  return repo.setInvoiceStatus(pool, companyId, branchId, Number(id), 'CANCELLED', actorLabel(authStaff));
}
