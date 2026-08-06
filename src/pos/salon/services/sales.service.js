/**
 * Salon POS settlement.
 *
 * Turns an open ops.job_master into a bill: ops.sales_master +
 * ops.sales_child + ops.sales_payment_split, then marks the job SETTLED and
 * links the two together (migration 105).
 *
 * What this does that restaurant settlement does not:
 *   - every bill line carries stylist_id and line_type, so per-stylist
 *     commission is answerable from ops.sales_child alone;
 *   - a missing stylist on the request is filled in from the job line rather
 *     than written as NULL, because the job already knows who did the work;
 *   - the job row is locked FOR UPDATE for the whole transaction, so two tills
 *     cannot both pass the "not settled yet" check and produce two bills.
 *
 * The request body is the restaurant-shaped `orderData` the Flutter client
 * already builds (kotId, items[], subTotal, netAmount, paidAmount, â€¦). Salon
 * keys are accepted alongside the legacy ones â€” `jobId` for `kotId`,
 * `stylistId` for `waiterId`, `chairId` for `tableId` â€” so the client can be
 * migrated key by key without a flag day.
 */
/**
 * Salon POS settlement — mirrors counter-pos sales save:
 *   Cash | Credit card | Credit | Multi Payment | Online | Compliment
 * Writes ops.sales_master + sales_child + sales_payment_split, then
 * hard-deletes the job master/child rows (migration 106).
 *
 * Credit / multi-payment credit also posts a Sales voucher
 * (DR customer / CR sales) so party ledger OS matches Counter-pos.
 */
import { withTransaction } from '../../../config/db.js';
import * as salesRepo from '../repositories/sales.repository.js';
import * as voucherRepo from '../../../accounts/repositories/voucher.repository.js';
import * as accountsParamRepo from '../../../accounts/repositories/accountsParameter.repository.js';
import { ensureCustomerLedgerForId } from '../../../backoffice/services/partyLedger.service.js';
import { auditUserName } from '../../../shared/lib/auditUser.js';
import {
  PM,
  normalizeBillPaymentMode,
  normalizeSplitPayMode,
  SPLIT_PAY_MODES,
  isMultiPaymentBillMode,
  isCreditBillMode,
  isComplimentBillMode,
  isOnlineBillMode,
  isCreditCardBillMode,
} from '../utils/paymentModes.js';

const PAYMENT_TOLERANCE = 0.02;

function num(v, d = 0) {
  if (v == null || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function parseLong(v) {
  const n = num(v, 0);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.trunc(n);
}

function str(v, max = 200) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  if (code) err.code = code;
  return err;
}

function conflict(message, code) {
  const err = new Error(message);
  err.status = 409;
  if (code) err.code = code;
  return err;
}

function itemsFromBody(body) {
  const raw = body.items ?? body.Items;
  return Array.isArray(raw) ? raw : [];
}

function buildPaymentSplits(body, paymentMode, netAmount) {
  const mode = normalizeBillPaymentMode(paymentMode || PM.CASH);
  const net = num(netAmount, 0);

  if (!isMultiPaymentBillMode(mode)) return [];

  const raw = Array.isArray(body?.paymentSplits) ? body.paymentSplits : [];
  const norm = raw
    .map((s) => ({
      payMode: normalizeSplitPayMode(s?.payMode),
      amount: num(s?.amount, 0),
      tip: num(s?.tip, 0),
      refNo: String(s?.refNo ?? '').trim(),
      creditCardTypeId:
        s?.creditCardTypeId != null ? Number(s.creditCardTypeId) : null,
    }))
    .filter((s) => SPLIT_PAY_MODES.has(s.payMode) && s.amount > 0);

  if (!norm.length) {
    throw badRequest('MULTIPAYMENT requires paymentSplits', 'NO_SPLITS');
  }

  const sum = norm.reduce((a, s) => a + num(s.amount, 0), 0);
  if (Math.abs(sum - net) > PAYMENT_TOLERANCE) {
    throw badRequest(
      `Split total (${sum.toFixed(3)}) must equal netAmount (${net.toFixed(3)})`,
      'SPLIT_MISMATCH'
    );
  }
  return norm;
}

function readTotals(body, paymentMode) {
  const mode = normalizeBillPaymentMode(paymentMode);
  const net = num(body.netAmount, 0);
  if (net <= 0) throw badRequest('netAmount must be greater than 0', 'BAD_NET');

  let paid = num(body.paidAmount, 0);
  if (isCreditBillMode(mode) || isComplimentBillMode(mode)) {
    // Credit posts O/S; Compliment collects nothing.
    paid = isComplimentBillMode(mode) ? 0 : (paid > 0 ? paid : 0);
  } else if (isMultiPaymentBillMode(mode)) {
    paid = net;
  } else if (paid + PAYMENT_TOLERANCE < net) {
    throw badRequest('paidAmount must be at least netAmount', 'UNDERPAID');
  }

  const subTotal = num(body.subTotal ?? body.subTotalM, 0);
  return {
    net,
    paid,
    subTotal,
    discountAmount: num(body.discountAmount, 0),
    taxableAmount: num(body.taxableAmount, subTotal),
    tax1: num(body.tax1Amount ?? body.tax1AmountM, 0),
    tax2: num(body.tax2AmountM ?? body.tax2Amount, 0),
    tax3: num(body.tax3AmountM ?? body.tax3Amount, 0),
    tax1Rate: num(body.tax1RateM ?? body.tax1Rate, 0),
    tax2Rate: num(body.tax2RateM ?? body.tax2Rate, 0),
    tax3Rate: num(body.tax3RateM ?? body.tax3Rate, 0),
    roundOffAdj: num(body.roundOffAdj, 0),
    balancePaid: Math.max(0, paid - net),
  };
}

/**
 * Resolve one request item against the job it came from.
 *
 * `jobLinesByLineId` / `jobLinesByProductId` come from ops.job_child.
 * Preference order for the stylist and the line type is: what the client sent,
 * then the matching job line, then the job's primary stylist. A SERVICE line
 * that still has no stylist after all that is rejected rather than written â€”
 * ops.job_child already refuses such a row (chk_salon_service_needs_
 * stylist), and letting the bill disagree with the job would silently lose the
 * commission record.
 */
function normaliseLineType(v) {
  return String(v ?? '').trim().toUpperCase() === 'SERVICE' ? 'SERVICE' : 'PRODUCT';
}

function resolveLine(item, ctx) {
  const { jobLinesByLineId, jobLinesByProductId, primaryStylistId } = ctx;

  const productId = parseLong(item.productId ?? item.ProductID ?? item.product_id);
  if (productId == null) return null;

  const jobLineId = parseLong(
    item.lineId ?? item.LineID ?? item.kotChildID ?? item.kotChildId ?? item.KotChildID
  );
  const jobLine =
    (jobLineId != null ? jobLinesByLineId.get(jobLineId) : null) ??
    jobLinesByProductId.get(productId) ??
    null;

  const qty = num(item.qty ?? item.Qty, 0);
  if (qty <= 0) throw badRequest(`Invalid qty for product ${productId}`, 'BAD_QTY');

  const unitPrice = num(item.unitPrice ?? item.UnitPrice, 0);
  const discount = num(item.discount ?? item.Discount ?? item.itemDisc ?? item.ItemDisc, 0);
  const subTotal =
    num(item.subTotalC ?? item.SubTotalC ?? item.subTotal ?? item.SubTotal, 0) ||
    qty * unitPrice - discount;

  const tax1 = num(item.tax1AmountC ?? item.Tax1AmountC ?? item.tax1Amount, 0);
  const tax2 = num(item.tax2AmountC ?? item.Tax2AmountC, 0);
  const tax3 = num(item.tax3AmountC ?? item.Tax3AmountC, 0);

  const lineType =
    item.lineType ?? item.LineType
      ? normaliseLineType(item.lineType ?? item.LineType)
      : normaliseLineType(jobLine?.line_type);

  const stylistId =
    parseLong(item.stylistId ?? item.StylistID ?? item.stylistID) ??
    (jobLine?.stylist_id != null ? Number(jobLine.stylist_id) : null) ??
    primaryStylistId;

  if (lineType === 'SERVICE' && stylistId == null) {
    throw badRequest(
      `Service line for product ${productId} has no stylist. Assign a stylist before settling.`,
      'SERVICE_NEEDS_STYLIST'
    );
  }

  return {
    jobLineId: jobLine?.line_id != null ? Number(jobLine.line_id) : jobLineId,
    productId,
    shortDescription:
      str(item.shortDescription ?? item.ShortDescription ?? item.itemName ?? item.ItemName, 200) ??
      'Item',
    groupId: parseLong(item.groupId ?? item.GroupID ?? item.dgvGrpID),
    qty,
    unitPrice,
    unitCost: num(item.unitCost ?? item.UnitCost, 0),
    packQty: num(item.packQty ?? item.PackQty, 1) || 1,
    discountAmount: discount,
    subtotalAmount: subTotal,
    tax1Amount: tax1,
    tax2Amount: tax2,
    tax3Amount: tax3,
    tax1Rate: num(item.tax1RateC ?? item.Tax1RateC ?? item.taxPerc ?? item.TaxPerc, 0),
    tax2Rate: num(item.tax2RateC ?? item.Tax2RateC, 0),
    tax3Rate: num(item.tax3RateC ?? item.Tax3RateC, 0),
    lineTotal: num(item.lineTotal ?? item.LineTotal, 0) || subTotal + tax1 + tax2 + tax3,
    stylistId,
    lineType,
    modifier: item.modifier != null ? String(item.modifier).slice(0, 2000) : null,
  };
}

/**
 * Resolve the CR-side "Sales" ledger for a credit-sale voucher.
 * Same lookup order as counter-pos.
 */
async function resolveSalesCrLedger(client, companyId, branchId) {
  let id = await accountsParamRepo.getParameterAccountId(
    client, companyId, branchId, 'BOSalesCRLedgerCredit'
  );
  if (id) return id;
  id = await accountsParamRepo.getParameterAccountId(
    client, companyId, branchId, 'DEFAULT_SALES_LEDGER'
  );
  if (id) return id;
  const { rows } = await client.query(
    `SELECT account_id
       FROM accounts.account_head_master
      WHERE company_id = $1
        AND (UPPER(COALESCE(account_type, '')) = 'INCOME' OR account_head ILIKE '%sales%')
        AND (record_status IS NULL OR TRIM(UPPER(record_status)) = 'ACTIVE')
      ORDER BY account_id ASC
      LIMIT 1`,
    [companyId]
  );
  if (rows[0]) return Number(rows[0].account_id);
  return accountsParamRepo.getParameterAccountId(
    client, companyId, branchId, accountsParamRepo.PARAM_DEFAULT_CASH_LEDGER
  );
}

/**
 * Post a Sales Voucher for a credit bill (Tally-style two-line journal):
 *   DR Customer ledger  netAmount  (raises outstanding / OS)
 *   CR Sales ledger     netAmount  (keeps journal balanced)
 */
async function postCreditSaleVoucher(client, args) {
  const { companyId, branchId, salesId, billNo, customerId, netAmount, staffId } = args;

  const custAccountId = await ensureCustomerLedgerForId(
    client, companyId, branchId, customerId
  );
  if (!custAccountId) {
    const err = new Error(
      `Customer ${customerId} has no receivable ledger — cannot post credit sale to accounts`
    );
    err.status = 400;
    err.code = 'NO_CUSTOMER_LEDGER';
    throw err;
  }

  const salesLedgerId = await resolveSalesCrLedger(client, companyId, branchId);
  if (!salesLedgerId) {
    const err = new Error(
      'Sales CR ledger not configured (BOSalesCRLedgerCredit / DEFAULT_SALES_LEDGER) — cannot post credit sale'
    );
    err.status = 400;
    err.code = 'NO_SALES_LEDGER';
    throw err;
  }

  const voucherTypeId =
    (await voucherRepo.getVoucherTypeId(client, companyId, 'SalesEntryVoucherName', branchId)) ?? 1;
  const voucherPrefix =
    (await voucherRepo.getVoucherPrefix(client, companyId, voucherTypeId)) || 'SVT';

  const voucherMasterId = await voucherRepo.nextVoucherMasterId(client, companyId, branchId);
  const auditBy = String(staffId ?? 'SALON-POS').slice(0, 50);
  // Match Counter-POS creation mode so accounts / invoice / settlement treat OS the same.
  const billRef = String(billNo ?? salesId);

  await voucherRepo.insertVoucherMaster(client, {
    companyId,
    branchId,
    voucherMasterId,
    voucherTypeId,
    autoVoucherNo: Number(billNo ?? salesId),
    manualVoucherNo: billRef,
    voucherPrefix,
    voucherDate: new Date(),
    referenceNo: billRef,
    voucherAmount: netAmount,
    remarks: `Credit Sale ${billRef}`,
    postStatus: 'POSTED',
    creationMode: 'COUNTER-POS',
    voucherPostedId: salesId,
    counterCloseNo: 'PENDING',
    recordStatus: 'ACTIVE',
    createdBy: auditBy,
  });

  let detailSeq = await voucherRepo.nextVoucherDetailId(client, companyId, branchId);

  await voucherRepo.insertVoucherDetail(client, {
    companyId,
    branchId,
    voucherDetailId: detailSeq++,
    voucherMasterId,
    accountId: custAccountId,
    debitAmount: netAmount,
    creditAmount: 0,
    outstandingBalance: netAmount,
    narration: `Credit Sale ${billRef}`,
    postStatus: 'POSTED',
    recordStatus: 'ACTIVE',
    createdBy: auditBy,
  });

  await voucherRepo.insertVoucherDetail(client, {
    companyId,
    branchId,
    voucherDetailId: detailSeq++,
    voucherMasterId,
    accountId: salesLedgerId,
    debitAmount: 0,
    creditAmount: netAmount,
    outstandingBalance: 0,
    narration: `Credit Sale ${billRef}`,
    postStatus: 'POSTED',
    recordStatus: 'ACTIVE',
    createdBy: auditBy,
  });

  return voucherMasterId;
}

function tenderAmounts(mode, totals, splits) {
  if (isMultiPaymentBillMode(mode)) {
    const cash = splits.filter((s) => s.payMode === PM.CASH).reduce((a, s) => a + num(s.amount, 0), 0);
    const card = splits
      .filter((s) => s.payMode === PM.CREDITCARD)
      .reduce((a, s) => a + num(s.amount, 0), 0);
    const online = splits
      .filter((s) => s.payMode === PM.ONLINE)
      .reduce((a, s) => a + num(s.amount, 0), 0);
    const credit = splits
      .filter((s) => s.payMode === PM.CREDIT)
      .reduce((a, s) => a + num(s.amount, 0), 0);
    return {
      cashAmount: cash,
      creditCardAmount: card + online,
      creditAmount: credit,
      paidAmount: totals.net,
      balancePaid: 0,
    };
  }
  if (isComplimentBillMode(mode)) {
    return { cashAmount: 0, creditCardAmount: 0, creditAmount: 0, paidAmount: 0, balancePaid: 0 };
  }
  if (isCreditBillMode(mode)) {
    return {
      cashAmount: 0,
      creditCardAmount: 0,
      creditAmount: totals.net,
      paidAmount: 0,
      balancePaid: 0,
    };
  }
  if (isCreditCardBillMode(mode) || isOnlineBillMode(mode)) {
    return {
      cashAmount: 0,
      creditCardAmount: totals.paid,
      creditAmount: 0,
      paidAmount: totals.paid,
      balancePaid: totals.balancePaid,
    };
  }
  return {
    cashAmount: totals.paid,
    creditCardAmount: 0,
    creditAmount: 0,
    paidAmount: totals.paid,
    balancePaid: totals.balancePaid,
  };
}

export async function settleSale(pool, body, authStaff) {
  const companyId = Number(authStaff.company_id);
  const branchId = Number(authStaff.branch_id);

  const requestedStationId = parseLong(
    body.stationId ?? body.StationID ?? authStaff.station_id ?? authStaff.branch_id
  );

  const jobId = parseLong(body.jobId ?? body.kotId ?? body.JobID ?? body.kotMasterId);
  if (jobId == null) throw badRequest('jobId is required', 'NO_JOB');

  const items = itemsFromBody(body);
  if (!items.length) throw badRequest('items array is required', 'NO_ITEMS');

  const paymentMode = normalizeBillPaymentMode(body.paymentMode ?? body.PaymentMode);
  const totals = readTotals(body, paymentMode);
  const splits = buildPaymentSplits(body, paymentMode, totals.net);
  const tender = tenderAmounts(paymentMode, totals, splits);

  const auditBy = auditUserName(authStaff);
  const staffPk = parseLong(authStaff.id) ?? parseLong(authStaff.staff_id);
  const counterNo = num(body.counterNo, 1);
  const onlineSource = str(body.onlineSource ?? body.OnlineSource, 80);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `ops.salon_sales_settle:${companyId}`,
    ]);

    const job = await salesRepo.findJobForSettlement(client, companyId, jobId);
    if (!job) {
      const err = new Error(`Job ${jobId} not found`);
      err.status = 404;
      err.code = 'JOB_NOT_FOUND';
      throw err;
    }

    // Jobs are saved on the SALON_POS till. SessionManager often still holds the
    // BACKOFFICE station id from username/password login â€” use the job's till.
    const jobStationId = Number(job.station_id ?? job.branch_id);
    if (!Number.isFinite(jobStationId) || jobStationId < 1) {
      throw badRequest('Job has no station', 'NO_STATION');
    }
    if (requestedStationId != null && requestedStationId !== jobStationId) {
      const { rows: stRows } = await client.query(
        `SELECT station_type
           FROM core.station_master
          WHERE company_id = $1 AND station_id = $2 AND is_deleted = FALSE
          LIMIT 1`,
        [companyId, requestedStationId]
      );
      if (stRows[0]?.station_type === 'SALON_POS') {
        throw badRequest('Job belongs to a different station', 'WRONG_STATION');
      }
    }
    const stationId = jobStationId;

    if (String(job.job_status).toUpperCase() === 'SETTLED' || job.sales_id != null) {
      throw conflict('Job is already settled', 'ALREADY_SETTLED');
    }
    if (String(job.job_status).toUpperCase() === 'CANCELLED') {
      throw conflict('Job was cancelled and cannot be settled', 'JOB_CANCELLED');
    }

    const customerId =
      parseLong(body.customerId ?? body.CustomerID) ??
      (job.customer_id != null ? Number(job.customer_id) : null);

    if (isCreditBillMode(paymentMode) && customerId == null) {
      throw badRequest('Customer is required for Credit settlement', 'NO_CUSTOMER');
    }
    if (
      isMultiPaymentBillMode(paymentMode) &&
      tender.creditAmount > PAYMENT_TOLERANCE &&
      customerId == null
    ) {
      throw badRequest('Customer is required when Multi Payment includes Credit', 'NO_CUSTOMER');
    }

    const jobLines = await salesRepo.listJobLinesForSettlement(client, companyId, jobId);
    const jobLinesByLineId = new Map(jobLines.map((l) => [Number(l.line_id), l]));
    const jobLinesByProductId = new Map();
    for (const l of jobLines) {
      const pid = Number(l.product_id);
      if (!jobLinesByProductId.has(pid)) jobLinesByProductId.set(pid, l);
    }

    const primaryStylistId =
      job.primary_stylist_id != null ? Number(job.primary_stylist_id) : null;
    const lines = items
      .map((it) => resolveLine(it, { jobLinesByLineId, jobLinesByProductId, primaryStylistId }))
      .filter(Boolean);

    if (!lines.length) {
      throw badRequest('No valid line items (productId required)', 'NO_VALID_ITEMS');
    }

    const salesId = await salesRepo.nextSalesId(client, companyId);
    const billNo = await salesRepo.nextBillNo(client, companyId, stationId);

    await salesRepo.insertSalesMaster(client, {
      companyId,
      salesId,
      branchId,
      stationId,
      jobId,
      counterNo,
      billNo,
      customerId,
      paymentMode,
      creditCardNo:
        isCreditCardBillMode(paymentMode) || isOnlineBillMode(paymentMode)
          ? str(body.creditCardNo ?? body.paymentRefNo, 50)
          : null,
      amount: totals.net,
      cashAmount: tender.cashAmount,
      creditAmount: tender.creditAmount,
      creditCardAmount: tender.creditCardAmount,
      paidAmount: tender.paidAmount,
      balancePaid: tender.balancePaid,
      discountAmount: totals.discountAmount,
      subtotalAmount: totals.subTotal,
      taxableAmount: totals.taxableAmount,
      tax1Amount: totals.tax1,
      tax2Amount: totals.tax2,
      tax3Amount: totals.tax3,
      tax1Rate: totals.tax1Rate,
      tax2Rate: totals.tax2Rate,
      tax3Rate: totals.tax3Rate,
      roundOffAdj: totals.roundOffAdj,
      stylistId: parseLong(body.stylistId ?? body.waiterId) ?? primaryStylistId,
      chairId:
        parseLong(body.chairId ?? body.tableId) ??
        (job.chair_id != null ? Number(job.chair_id) : null),
      areaId:
        parseLong(body.areaId) ?? (job.area_id != null ? Number(job.area_id) : null),
      noOfCustomers: Math.max(0, Math.trunc(num(body.noOfCustomer ?? body.noOfCustomers, 0))),
      staffId: staffPk,
      remarks: str(body.comments ?? body.remarks, 200),
      onlineSource: isOnlineBillMode(paymentMode) ? onlineSource : null,
      createdBy: auditBy,
      modifiedBy: auditBy,
    });

    for (const line of lines) {
      const salesChildId = await salesRepo.nextSalesChildId(client, companyId);
      await salesRepo.insertSalesChild(client, {
        companyId,
        salesChildId,
        salesId,
        branchId,
        stationId,
        ...line,
        createdBy: auditBy,
        modifiedBy: auditBy,
      });
    }

    if (isMultiPaymentBillMode(paymentMode) && splits.length) {
      await salesRepo.insertPaymentSplits(client, {
        companyId,
        salesId,
        branchId,
        counterNo,
        staffId: staffPk,
        splits,
      });
    } else if (!isComplimentBillMode(paymentMode) && !isCreditBillMode(paymentMode)) {
      const payMode =
        isOnlineBillMode(paymentMode)
          ? PM.ONLINE
          : isCreditCardBillMode(paymentMode)
            ? PM.CREDITCARD
            : PM.CASH;
      await salesRepo.insertSalesPaymentSplit(client, {
        companyId,
        salesId,
        payerNo: 1,
        payMode,
        billAmount: tender.paidAmount || totals.net,
        branchId,
        counterId: counterNo,
        staffId: staffPk,
        refNo: str(body.paymentRefNo ?? onlineSource, 100),
      });
    } else if (isCreditBillMode(paymentMode)) {
      await salesRepo.insertSalesPaymentSplit(client, {
        companyId,
        salesId,
        payerNo: 1,
        payMode: PM.CREDIT,
        billAmount: totals.net,
        branchId,
        counterId: counterNo,
        staffId: staffPk,
        refNo: str(body.paymentRefNo, 100),
      });
    } else if (isComplimentBillMode(paymentMode)) {
      await salesRepo.insertSalesPaymentSplit(client, {
        companyId,
        salesId,
        payerNo: 1,
        payMode: PM.COMPLIMENT,
        billAmount: totals.net,
        branchId,
        counterId: counterNo,
        staffId: staffPk,
        refNo: str(body.complimentApprovedBy, 100),
      });
    }

    // Credit-sale accounting voucher (DR customer / CR sales) — same as Counter-pos.
    const creditOs = isCreditBillMode(paymentMode)
      ? totals.net
      : (isMultiPaymentBillMode(paymentMode) ? tender.creditAmount : 0);
    let creditVoucherId = null;
    if (creditOs > PAYMENT_TOLERANCE && customerId != null) {
      try {
        await client.query('SAVEPOINT credit_voucher');
        creditVoucherId = await postCreditSaleVoucher(client, {
          companyId,
          branchId,
          salesId,
          billNo,
          customerId: Number(customerId),
          netAmount: creditOs,
          staffId: staffPk ?? auditBy,
        });
        await client.query('RELEASE SAVEPOINT credit_voucher');
      } catch (vErr) {
        await client.query('ROLLBACK TO SAVEPOINT credit_voucher').catch(() => {});
        if (vErr.code === '42P01' || vErr.code === '42703') {
          console.warn('[salon-pos] Voucher tables missing — credit OS not posted to accounts');
        } else {
          // Fail the settle so credit bills never save without accounts OS.
          throw vErr;
        }
      }
    }

    // Sales fully written — remove the working job rows.
    const deleted = await salesRepo.deleteJobAfterSettlement(client, companyId, jobId);
    if (!deleted) {
      throw conflict('Job could not be cleared after settlement', 'JOB_DELETE_FAILED');
    }

    const outstandingBalance = salesRepo.resolveSalesOutstandingBalance({
      paymentMode,
      amount: totals.net,
      creditAmount: tender.creditAmount,
    });

    return {
      ok: true,
      success: true,
      salesId: String(salesId),
      billNo: String(billNo),
      jobId: String(jobId),
      jobNo: job.job_no ?? '',
      paymentMode,
      balancePaid: String(tender.balancePaid),
      outstandingBalance: String(outstandingBalance),
      creditVoucherId: creditVoucherId != null ? String(creditVoucherId) : null,
      lines: lines.length,
      message: 'Settlement saved. Job cleared.',
    };
  });
}

function resolveCounterCloseStatus(row) {
  if (row.counter_close_no != null) return String(row.counter_close_no);
  const st = String(row.counter_close_status ?? '').trim();
  if (!st || st === 'PENDING') return 'PENDING';
  return st;
}

function toIsoDate(value, fallback) {
  if (value == null || String(value).trim() === '') return fallback;
  const s = String(value).trim();
  // yyyy-MM-dd or full ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // dd/MM/yyyy or dd/MM/yyyy HH:mm
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return fallback;
}

/** GET Sales Viewer list — Flutter PascalCase rows. */
export async function listSalesViewer(pool, authStaff, query = {}) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    throw badRequest('company_id required');
  }
  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = toIsoDate(query.dateFrom ?? query.fromDate ?? query.fromDateTime, today);
  const dateTo = toIsoDate(query.dateTo ?? query.toDate ?? query.toDateTime, today);

  const rows = await salesRepo.listPostedSales(pool, {
    companyId,
    dateFrom,
    dateTo,
    filterKey: query.filter ?? query.filterKey ?? null,
    searchQuery: query.q ?? query.search ?? query.searchQuery ?? '',
    limit: query.limit,
  });

  return rows.map((r) => ({
    SalesID: String(r.sales_id),
    BillNo: String(r.bill_no),
    CounterNo: String(r.counter_no ?? ''),
    BillDate: r.bill_date,
    BillTime: r.bill_time ?? r.bill_date,
    PaymentMode: normalizeBillPaymentMode(r.payment_mode ?? PM.CASH),
    CustomerName: r.customer_name ?? 'Walk-in',
    SalesManName: r.staff_name ?? '',
    SubTotalM: Number(r.subtotal_amount ?? 0),
    TaxableAmount: Number(r.taxable_amount ?? 0),
    Tax1AmountM: Number(r.tax_1_amount ?? 0),
    DiscountAmount: Number(r.discount_amount ?? 0),
    RoundOffAdj: Number(r.round_off_adjustment ?? 0),
    Amount: Number(r.amount ?? 0),
    CreditCardNo: r.credit_card_no ?? '',
    Remarks: r.remarks?.trim() || '',
    CounterCloseStatus: resolveCounterCloseStatus(r),
  }));
}

/** GET Sales Viewer bill detail — Flutter salesMaster / salesItems shape. */
export async function getSalesViewerBill(pool, authStaff, salesIdRaw) {
  const companyId = Number(authStaff.company_id);
  const salesId = Number(salesIdRaw);
  if (!Number.isFinite(companyId) || companyId < 1) {
    throw badRequest('company_id required');
  }
  if (!Number.isFinite(salesId) || salesId < 1) {
    throw badRequest('salesId required');
  }

  const detail = await salesRepo.getPostedBillDetail(pool, companyId, salesId);
  if (!detail) {
    const err = new Error('Bill not found');
    err.status = 404;
    throw err;
  }

  const m = detail.master;
  const paymentMode = normalizeBillPaymentMode(m.payment_mode ?? PM.CASH);

  return {
    salesMaster: {
      SalesID: String(m.sales_id),
      BillNo: String(m.bill_no),
      BillDate: m.bill_date,
      BillTime: m.bill_time ?? m.bill_date,
      PaymentMode: paymentMode,
      CustomerName: m.customer_name ?? 'Walk-in',
      SalesManName: m.staff_name ?? '',
      CashierName: m.staff_name ?? '',
      CounterNo: String(m.counter_no ?? ''),
      CreditCardNo: m.credit_card_no ?? '',
      SubTotalM: Number(m.subtotal_amount ?? 0),
      TaxableAmount: Number(m.taxable_amount ?? 0),
      Tax1AmountM: Number(m.tax_1_amount ?? 0),
      Tax1RateM: Number(m.tax_1_rate ?? 0),
      DiscountAmount: Number(m.discount_amount ?? 0),
      RoundOffAdj: Number(m.round_off_adjustment ?? 0),
      Amount: Number(m.amount ?? 0),
      PaidAmount: Number(m.paid_amount ?? 0),
      BalancePaid: Number(m.balance_paid ?? 0),
      Remarks: m.remarks?.trim() || '',
      CounterCloseStatus: resolveCounterCloseStatus(m),
    },
    salesItems: detail.items.map((it) => ({
      BarCode: it.product_code ?? '',
      ShortDescription: it.short_description ?? '',
      Qty: Number(it.qty ?? 0),
      UnitPrice: Number(it.unit_price ?? 0),
      DiscountAmount: Number(it.discount_amount ?? 0),
      SubTotalC: Number(it.subtotal_amount ?? 0),
      Tax1AmountC: Number(it.tax_1_amount ?? 0),
      Tax1RateC: Number(it.tax_1_rate ?? 0),
      LineTotal: Number(it.line_total ?? 0),
    })),
    paymentSplits: detail.splits.map((s) => ({
      payerNo: Number(s.payer_no),
      payMode: s.pay_mode,
      amount: Number(s.bill_amount ?? 0),
      tip: Number(s.tip_amount ?? 0),
      refNo: s.ref_no ?? '',
    })),
  };
}

function reportDateRange(query = {}) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    dateFrom: toIsoDate(query.dateFrom ?? query.fromDate ?? query.fromDateTime, today),
    dateTo: toIsoDate(query.dateTo ?? query.toDate ?? query.toDateTime, today),
  };
}

function optionalId(raw) {
  if (raw == null || String(raw).trim() === '' || String(raw).trim().toLowerCase() === 'all') {
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function money(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0;
}

/** GET salesman-wise aggregate report. */
export async function salesmanWiseReport(pool, authStaff, query = {}) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    throw badRequest('company_id required');
  }
  const { dateFrom, dateTo } = reportDateRange(query);
  const rows = await salesRepo.salesmanWiseSales(pool, {
    companyId,
    dateFrom,
    dateTo,
    staffId: optionalId(query.staffId ?? query.salesmanId),
  });
  return rows.map((r) => ({
    staffId: r.staff_id != null ? Number(r.staff_id) : null,
    staffName: r.staff_name ?? 'UNASSIGNED',
    billCount: Number(r.bill_count ?? 0),
    subtotal: money(r.subtotal),
    discount: money(r.discount),
    taxable: money(r.taxable),
    tax: money(r.tax),
    roundOff: money(r.round_off),
    net: money(r.net),
    cash: money(r.cash),
    card: money(r.card),
    credit: money(r.credit),
  }));
}

/** GET item-wise aggregate report. */
export async function itemWiseReport(pool, authStaff, query = {}) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    throw badRequest('company_id required');
  }
  const { dateFrom, dateTo } = reportDateRange(query);
  const rows = await salesRepo.itemWiseSales(pool, {
    companyId,
    dateFrom,
    dateTo,
    productId: optionalId(query.productId ?? query.itemId),
  });
  return rows.map((r) => ({
    productId: r.product_id != null ? Number(r.product_id) : null,
    productCode: r.product_code ?? '',
    productName: r.product_name ?? 'UNKNOWN',
    groupName: r.group_name ?? '',
    qty: money(r.qty),
    subtotal: money(r.subtotal),
    discount: money(r.discount),
    tax: money(r.tax),
    net: money(r.net),
  }));
}

/** GET group-wise aggregate report. */
export async function groupWiseReport(pool, authStaff, query = {}) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    throw badRequest('company_id required');
  }
  const { dateFrom, dateTo } = reportDateRange(query);
  const rows = await salesRepo.groupWiseSales(pool, {
    companyId,
    dateFrom,
    dateTo,
    groupId: optionalId(query.groupId),
  });
  return rows.map((r) => ({
    groupId: r.group_id != null ? Number(r.group_id) : null,
    groupName: r.group_name ?? 'UNASSIGNED',
    billCount: Number(r.bill_count ?? 0),
    qty: money(r.qty),
    subtotal: money(r.subtotal),
    discount: money(r.discount),
    tax: money(r.tax),
    net: money(r.net),
  }));
}

