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
