import { withTransaction } from '../../config/db.js';
import * as salesRepo from '../../pos/restaurant-pos/repositories/sales.repository.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as saleEntryRepo from '../repositories/saleEntry.repository.js';
import * as accountHeadRepo from '../../accounts/repositories/accountHead.repository.js';
import * as voucherRepo from '../../accounts/repositories/voucher.repository.js';
import * as docRefRepo from '../../shared/repositories/documentReference.repository.js';
import * as stockRepo from '../../shared/repositories/stock.repository.js';
import * as txnExpenseRepo from '../../shared/repositories/transactionExpense.repository.js';
import * as deliveryOrderRepo from '../repositories/deliveryOrder.repository.js';
import * as productRepo from '../repositories/product.repository.js';
import * as customerRepo from '../repositories/customer.repository.js';
import { auditStaffId } from '../../pos/restaurant-pos/lib/staffAudit.js';

function num(v, d = 0) {
  if (v == null || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function nullableLong(v) {
  const n = num(v, 0);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.trunc(n);
}

function str(v, max = 200) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function parseBranchId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

function mapSaleRowToApi(row) {
  return {
    salesId: Number(row.sales_id),
    branchId: Number(row.branch_id),
    counterNo: row.counter_no != null ? String(row.counter_no) : null,
    billNo: row.bill_no != null ? String(row.bill_no) : '',
    billDate: row.bill_date,
    billTime: row.bill_time,
    paymentMode: row.payment_mode,
    customerId: row.customer_id != null ? Number(row.customer_id) : null,
    customerCode: row.customer_code,
    customerName: row.customer_name,
    trnNo: row.customer_tax_reg_no,
    salesMan: row.staff_name,
    subTotal: row.subtotal_amount != null ? String(row.subtotal_amount) : '0',
    discount: row.discount_amount != null ? String(row.discount_amount) : '0',
    taxAmount: row.tax_amount != null ? String(row.tax_amount) : '0',
    roundOffAdjustment: row.round_off_adjustment != null ? String(row.round_off_adjustment) : '0',
    amount: row.amount != null ? String(row.amount) : '0',
    remarks: row.remarks,
    quotationId: row.quotation_id != null ? Number(row.quotation_id) : null,
    deliveryOrderId: row.delivery_order_id != null ? Number(row.delivery_order_id) : null,
    postStatus: 'POSTED',
    counterClose: 'PENDING',
    transactionType: row.payment_mode || null,
  };
}

export async function listSales(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  let branchId = parseBranchId(query.branchId);
  if (branchId == null) branchId = parseBranchId(authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const okBranch = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!okBranch) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }
  const rows = await saleEntryRepo.listSales(pool, companyId, branchId, query.limit, query.offset);
  return rows.map(mapSaleRowToApi);
}

/**
 * POST /api/sales — full VB-equivalent save:
 *   1.  Validate + Privilege checks (min price, loss sale, minus stock, credit limit)
 *   2.  SalesMaster INSERT
 *   3.  SalesChild INSERT (per line, with quotation_id + do_id)
 *   4.  SalesPaymentSplit
 *   5.  ERP fields (quotation_id, delivery_order_id, receipt_ledger_id on header)
 *   6.  MultiReferenceTable (document_reference_map for QTN + DO links)
 *   7.  Customer-as-debtor ledger validation
 *   8.  VoucherMaster + VoucherDetail (double-entry journal)
 *   9.  PayNow receipt voucher (if cash/card)
 *  10.  Stock update (product_log_entry)
 *  11.  TransactionExpenseDetail (cash account head expense line)
 *  12.  DO status update (DOMaster → INVOICED)
 */
export async function createSale(pool, body, authStaff) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid company on session');
    err.status = 400;
    throw err;
  }

  let branchId = parseBranchId(body.branchId);
  if (branchId == null) branchId = parseBranchId(authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const okBranch = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!okBranch) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }

  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) {
    const err = new Error('At least one line is required');
    err.status = 400;
    throw err;
  }

  const quotationIdOpt = nullableLong(body.quotationId);
  const deliveryOrderIdOpt = nullableLong(body.deliveryOrderId);

  let sumLineTotal = 0;
  let sumSub = 0;
  let sumTax = 0;
  const normalized = [];

  for (let i = 0; i < lines.length; i += 1) {
    const L = lines[i] || {};
    const productId = Math.trunc(num(L.productId, 0));
    if (productId < 1) {
      const err = new Error(`Line ${i + 1}: productId is required (pick a product from the catalog)`);
      err.status = 400;
      throw err;
    }
    const qty = num(L.qty, 0);
    if (qty <= 0) {
      const err = new Error(`Line ${i + 1}: qty must be > 0`);
      err.status = 400;
      throw err;
    }
    const unitPrice = round2(num(L.unitPrice, 0));
    const unitCost = round2(num(L.unitCost, 0));
    const disc = round2(num(L.discountAmount ?? L.discAmt ?? L.itemDiscount, 0));
    const subL = round2(num(L.subtotalAmount ?? L.subTotal, qty * unitPrice - disc));
    const tax1 = round2(num(L.taxAmt ?? L.tax1Amount, 0));
    const r1 = round2(num(L.taxPercent ?? L.tax1Rate, 0));
    const lt = round2(num(L.lineTotal, subL + tax1));

    sumLineTotal += lt;
    sumSub += subL;
    sumTax += tax1;

    const desc = str(L.shortDescription ?? L.productDescription, 200) || 'Item';

    normalized.push({
      productId,
      qty,
      unitPrice,
      unitCost,
      packQty: Math.max(num(L.packQty, 1), 0.0001),
      discountAmount: disc,
      subtotalAmount: subL,
      tax1Amount: tax1,
      tax2Amount: 0,
      tax3Amount: 0,
      tax1Rate: r1,
      tax2Rate: 0,
      tax3Rate: 0,
      lineTotal: lt,
      shortDescription: desc.slice(0, 50),
      quotationId: nullableLong(L.quotationId),
      doId: nullableLong(L.doId ?? L.deliveryOrderId),
    });
  }

  sumLineTotal = round2(sumLineTotal);
  sumSub = round2(sumSub);
  sumTax = round2(sumTax);

  const headerDiscAmt = round2(num(body.headerDiscAmt, 0));
  const headerDiscPct = round2(num(body.headerDiscPct, 0));
  const headerDisc = round2(headerDiscAmt + sumLineTotal * (headerDiscPct / 100));
  const roundOff = round2(num(body.roundOffAdjustment ?? body.roundOff, 0));
  const netClient = round2(num(body.netAmount, 0));
  const netExpected = round2(sumLineTotal - headerDisc + roundOff);

  if (Math.abs(netExpected - netClient) > 0.05) {
    const err = new Error(
      `Net amount does not match lines and discounts (expected ${netExpected.toFixed(2)}, got ${netClient.toFixed(2)})`,
    );
    err.status = 400;
    throw err;
  }

  if (netClient <= 0) {
    const err = new Error('netAmount must be > 0');
    err.status = 400;
    throw err;
  }

  const paymentModeRaw = str(body.paymentMode, 50) || 'CASH';
  const paymentMode = paymentModeRaw.toUpperCase().includes('CREDIT')
    ? paymentModeRaw.toUpperCase().includes('CARD') ? 'CREDITCARD' : 'CREDIT'
    : 'CASH';

  const receiptLedgerId = nullableLong(body.receiptLedgerId ?? body.accountHeadId);
  if (paymentMode === 'CASH' || paymentMode === 'CREDITCARD') {
    if (receiptLedgerId == null) {
      const err = new Error('Account head (receipt ledger) is required for cash or card sales');
      err.status = 400;
      throw err;
    }
    const head = await accountHeadRepo.findAccountHead(pool, companyId, receiptLedgerId);
    if (!head) {
      const err = new Error('Invalid or non-posting account head for this company');
      err.status = 400;
      throw err;
    }
  }

  // ───── STEP 1b: Privilege checks (VB CheckPrivilage + credit checks) ─────
  const privilegeWarnings = [];

  // STEP 7: Customer-as-debtor ledger validation (VB CreateTransactionLeadgers check)
  const customerId = nullableLong(body.customerId);
  let customerHasLedger = false;
  if (customerId != null) {
    const custHead = await accountHeadRepo.findAccountHead(pool, companyId, customerId);
    if (custHead) {
      customerHasLedger = true;
    } else {
      privilegeWarnings.push(
        `Customer (ID ${customerId}) does not have a ledger in AccountHeadMaster — ` +
        'accounting voucher for this customer will be skipped.',
      );
    }
  }
  for (let i = 0; i < normalized.length; i += 1) {
    const L = normalized[i];
    if (L.unitPrice <= 0 && L.qty > 0) {
      privilegeWarnings.push(`Line ${i + 1}: Zero unit price is not allowed.`);
    }
    try {
      const pricing = await productRepo.getProductPricingForPrivilege(pool, companyId, branchId, L.productId);
      if (pricing) {
        if (pricing.minimumRetailPrice > 0 && L.unitPrice < pricing.minimumRetailPrice) {
          privilegeWarnings.push(
            `Line ${i + 1}: Unit price ${L.unitPrice.toFixed(2)} is below minimum retail price ${pricing.minimumRetailPrice.toFixed(2)}.`,
          );
        }
        const lineProfit = (L.unitPrice * L.qty) - (pricing.averageCost * L.qty) - L.discountAmount;
        if (pricing.averageCost > 0 && lineProfit < 0) {
          privilegeWarnings.push(
            `Line ${i + 1}: Loss sale — selling below cost (profit: ${lineProfit.toFixed(2)}).`,
          );
        }
        const sellingQty = L.qty;
        if (pricing.qtyOnHand < sellingQty) {
          privilegeWarnings.push(
            `Line ${i + 1}: Minus stock — available ${pricing.qtyOnHand.toFixed(2)}, selling ${sellingQty}.`,
          );
        }
      }
    } catch { /* product_inventory may not exist for all products */ }
  }

  if (paymentMode === 'CREDIT' && customerId != null) {
    try {
      const creditInfo = await customerRepo.getCustomerCreditInfo(pool, companyId, customerId);
      if (creditInfo && creditInfo.creditLimit > 0) {
        const newBalance = creditInfo.osBalance + netClient;
        if (newBalance > creditInfo.creditLimit) {
          privilegeWarnings.push(
            `Credit limit exceeded: limit ${creditInfo.creditLimit.toFixed(2)}, ` +
            `current OS ${creditInfo.osBalance.toFixed(2)}, this sale ${netClient.toFixed(2)}, ` +
            `new balance ${newBalance.toFixed(2)}.`,
          );
        }
      }
    } catch { /* customer credit info may not be available */ }
  }

  if (privilegeWarnings.length > 0 && !body.overridePrivilegeChecks) {
    const err = new Error(
      'Privilege check warnings:\n' + privilegeWarnings.join('\n'),
    );
    err.status = 422;
    err.warnings = privilegeWarnings;
    err.requiresOverride = true;
    throw err;
  }

  let paid = round2(num(body.paidAmount, netClient));
  if (paid < netClient - 0.05) {
    const err = new Error('paidAmount must be >= netAmount');
    err.status = 400;
    throw err;
  }

  const counterNo = Math.max(1, Math.trunc(num(body.counterNo, 1)));

  const cashAmount = paymentMode === 'CASH' ? paid : 0;
  const creditAmount = paymentMode === 'CREDIT' ? netClient : 0;
  const creditCardAmount = paymentMode === 'CREDITCARD' ? paid : 0;
  const balancePaid = round2(Math.max(0, paid - netClient));

  const auditBy = auditStaffId(authStaff);
  const staffPk = nullableLong(authStaff.staff_id) ?? nullableLong(authStaff.id);

  const remarksParts = [];
  if (body.salesTerms) remarksParts.push(String(body.salesTerms).trim());
  if (body.billing?.salesTerms) remarksParts.push(String(body.billing.salesTerms).trim());
  if (quotationIdOpt) remarksParts.push(`Q:${quotationIdOpt}`);
  if (deliveryOrderIdOpt) remarksParts.push(`DO:${deliveryOrderIdOpt}`);
  const remarks = str(remarksParts.filter(Boolean).join(' | '), 200);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [`ops.sales_erp:${companyId}`]);

    // ───── STEP 3: SalesMaster INSERT ─────
    const salesId = await salesRepo.nextSalesId(client, companyId);
    const billNo = await salesRepo.nextBillNo(client, companyId, branchId);

    await salesRepo.insertSalesMaster(client, {
      companyId,
      salesId,
      branchId,
      kotMasterId: null,
      counterNo,
      billNo,
      customerId,
      paymentMode,
      creditCardNo: paymentMode === 'CREDITCARD' ? str(body.creditCardNo ?? body.billing?.creditCardNo, 50) : null,
      amount: netClient,
      cashAmount,
      creditAmount,
      creditCardAmount,
      paidAmount: paid,
      balancePaid,
      discountAmount: headerDisc,
      subtotalAmount: sumSub,
      taxableAmount: sumSub,
      tax1Amount: sumTax,
      tax2Amount: 0,
      tax3Amount: 0,
      tax1Rate: sumSub > 0.0001 ? round2((sumTax / sumSub) * 100) : 0,
      tax2Rate: 0,
      tax3Rate: 0,
      roundOffAdj: roundOff,
      waiterId: null,
      tableId: null,
      areaId: null,
      noOfCustomers: 0,
      staffId: staffPk,
      remarks,
      createdBy: auditBy,
      modifiedBy: auditBy,
    });

    // ───── STEP 3b: ERP header fields ─────
    try {
      await saleEntryRepo.updateSalesMasterErpFields(client, companyId, salesId, {
        quotationId: quotationIdOpt,
        deliveryOrderId: deliveryOrderIdOpt,
        receiptLedgerId: paymentMode === 'CASH' || paymentMode === 'CREDITCARD' ? receiptLedgerId : null,
      });
    } catch (e) {
      if (e.code === '42703') {
        const err = new Error(
          'sales_master is missing ERP columns. Apply migrations 029 (quotation/do) and 031 (receipt_ledger_id).',
        );
        err.status = 503;
        throw err;
      }
      throw e;
    }

    // ───── STEP 4: SalesChild INSERT (per line with quotation_id + do_id) ─────
    for (const L of normalized) {
      const salesChildId = await salesRepo.nextSalesChildId(client, companyId);
      await salesRepo.insertSalesChild(client, {
        companyId,
        salesChildId,
        salesId,
        branchId,
        kotChildId: null,
        productId: L.productId,
        shortDescription: L.shortDescription,
        groupId: null,
        qty: L.qty,
        unitPrice: L.unitPrice,
        unitCost: L.unitCost,
        packQty: L.packQty,
        discountAmount: L.discountAmount,
        lineTotal: L.lineTotal,
        tax1Amount: L.tax1Amount,
        tax2Amount: L.tax2Amount,
        tax3Amount: L.tax3Amount,
        tax1Rate: L.tax1Rate,
        tax2Rate: L.tax2Rate,
        tax3Rate: L.tax3Rate,
        subtotalAmount: L.subtotalAmount,
        modifier: null,
        createdBy: auditBy,
        modifiedBy: auditBy,
        quotationId: L.quotationId,
        doId: L.doId,
      });

      // ───── STEP 10: Stock update (product_log_entry) ─────
      try {
        await client.query('SAVEPOINT stock_update');
        const currentQty = await stockRepo.getStockQty(client, companyId, branchId, L.productId);
        const newQty = round2(currentQty - L.qty);
        if (newQty < 0) {
          const label = L.shortDescription || `Product #${L.productId}`;
          const err = new Error(
            `Insufficient stock for "${label}": available ${currentQty}, requested ${L.qty}`,
          );
          err.status = 400;
          throw err;
        }
        const logId = await stockRepo.nextProductLogId(client, companyId);
        await stockRepo.insertProductLogEntry(client, {
          companyId,
          branchId,
          productLogId: logId,
          productId: L.productId,
          transactionType: 'SALES',
          transactionId: salesId,
          qty: -L.qty,
          balanceQty: newQty,
          unitCost: L.unitCost,
          unitPrice: L.unitPrice,
          createdBy: auditBy,
        });
        // Keep product_inventory.qty_on_hand in step with the log so stock
        // reports (closing qty) and movement history agree.
        await stockRepo.adjustQtyOnHand(client, companyId, branchId, L.productId, -L.qty);
        await client.query('RELEASE SAVEPOINT stock_update');
      } catch (stockErr) {
        await client.query('ROLLBACK TO SAVEPOINT stock_update');
        if (stockErr.code === '42P01' || stockErr.code === '42703') {
          console.warn('product_log_entry schema mismatch — stock update skipped');
        } else {
          throw stockErr;
        }
      }
    }

    // ───── STEP 4b: SalesPaymentSplit ─────
    await salesRepo.insertSalesPaymentSplit(client, {
      companyId,
      salesId,
      payerNo: 1,
      payMode: paymentMode === 'CREDITCARD' ? 'CARD' : paymentMode === 'CREDIT' ? 'CREDIT' : 'CASH',
      billAmount: paid,
      branchId,
      counterId: counterNo,
      staffId: staffPk,
      refNo: str(body.paymentRefNo, 100),
    });

    // ───── STEP 6: MultiReferenceTable (document_reference_map) ─────
    try {
      await client.query('SAVEPOINT doc_ref_save');
      // Quotation links
      const qtnIds = [];
      if (quotationIdOpt) qtnIds.push(quotationIdOpt);
      for (const L of normalized) {
        if (L.quotationId && !qtnIds.includes(L.quotationId)) qtnIds.push(L.quotationId);
      }
      if (qtnIds.length > 0) {
        await docRefRepo.deleteBySourceAndType(client, companyId, salesId, 'SL', 'QU');
        for (const qid of qtnIds) {
          const refId = await docRefRepo.nextDocumentReferenceId(client, companyId);
          await docRefRepo.insertDocumentReference(client, {
            companyId,
            branchId,
            documentReferenceId: refId,
            sourceDocId: salesId,
            sourceDocType: 'SL',
            sourceDocNo: String(billNo),
            referenceDocId: qid,
            referenceDocType: 'QU',
            referenceDocNo: String(qid),
          });
        }
      }

      // DO links
      const doIds = [];
      if (deliveryOrderIdOpt) doIds.push(deliveryOrderIdOpt);
      for (const L of normalized) {
        if (L.doId && !doIds.includes(L.doId)) doIds.push(L.doId);
      }
      if (doIds.length > 0) {
        await docRefRepo.deleteBySourceAndType(client, companyId, salesId, 'SL', 'DO');
        for (const did of doIds) {
          const refId = await docRefRepo.nextDocumentReferenceId(client, companyId);
          await docRefRepo.insertDocumentReference(client, {
            companyId,
            branchId,
            documentReferenceId: refId,
            sourceDocId: salesId,
            sourceDocType: 'SL',
            sourceDocNo: String(billNo),
            referenceDocId: did,
            referenceDocType: 'DO',
            referenceDocNo: String(did),
          });
        }
      }
    } catch (docRefErr) {
      await client.query('ROLLBACK TO SAVEPOINT doc_ref_save').catch(() => {});
      if (docRefErr.code === '42P01' || docRefErr.code === '42703') {
        console.warn('document_reference_map table missing — doc links skipped');
      } else {
        throw docRefErr;
      }
    }

    // ───── STEP 8: VoucherMaster + VoucherDetail (double-entry journal) ─────
    let salesVoucherId = null;
    try {
      await client.query('SAVEPOINT voucher_save');
      const salesVoucherTypeId = await voucherRepo.getVoucherTypeId(client, companyId, 'SalesEntryVoucherName', branchId) || 1;
      const voucherPrefix = await voucherRepo.getVoucherPrefix(client, companyId, salesVoucherTypeId) || 'SVT';

      const vMasterId = await voucherRepo.nextVoucherMasterId(client, companyId, branchId);
      const autoNo = await voucherRepo.nextAutoVoucherNo(client, companyId, branchId, salesVoucherTypeId);

      await voucherRepo.insertVoucherMaster(client, {
        companyId,
        branchId,
        voucherMasterId: vMasterId,
        voucherTypeId: salesVoucherTypeId,
        autoVoucherNo: autoNo,
        voucherPrefix,
        referenceNo: String(billNo),
        voucherAmount: netClient,
        remarks: `SVT: ${billNo}`,
        postStatus: 'PENDING',
        creationMode: 'INVENTORYACCOUNTS',
        voucherPostedId: salesId,
        counterCloseNo: 'PENDING',
        recordStatus: 'ACTIVE',
        createdBy: auditBy,
      });
      salesVoucherId = vMasterId;

      let detailSeq = await voucherRepo.nextVoucherDetailId(client, companyId, branchId);

      // Line 1: Customer (Debtor) — DR = netAmount (only if customer has a ledger)
      if (customerId != null && customerHasLedger) {
        await voucherRepo.insertVoucherDetail(client, {
          companyId,
          branchId,
          voucherDetailId: detailSeq++,
          voucherMasterId: vMasterId,
          accountId: customerId,
          creditAmount: 0,
          debitAmount: netClient,
          outstandingBalance: paymentMode === 'CREDIT' ? netClient : 0,
          narration: `SVT: ${billNo}`,
          postStatus: 'PENDING',
          recordStatus: 'ACTIVE',
          createdBy: auditBy,
        });
      }

      // Line 2: Sales CR Ledger — CR = subTotal
      if (receiptLedgerId != null || customerId != null) {
        const salesCrLedgerId = receiptLedgerId || customerId;
        await voucherRepo.insertVoucherDetail(client, {
          companyId,
          branchId,
          voucherDetailId: detailSeq++,
          voucherMasterId: vMasterId,
          accountId: salesCrLedgerId,
          creditAmount: sumSub,
          debitAmount: 0,
          outstandingBalance: 0,
          narration: `SVT: ${billNo}`,
          postStatus: 'PENDING',
          recordStatus: 'ACTIVE',
          createdBy: auditBy,
        });
      }

      // Line 3: Discount DR (if any)
      if (headerDisc > 0 && receiptLedgerId != null) {
        await voucherRepo.insertVoucherDetail(client, {
          companyId,
          branchId,
          voucherDetailId: detailSeq++,
          voucherMasterId: vMasterId,
          accountId: receiptLedgerId,
          creditAmount: headerDisc,
          debitAmount: 0,
          outstandingBalance: 0,
          narration: `Discount SVT: ${billNo}`,
          postStatus: 'PENDING',
          recordStatus: 'ACTIVE',
          createdBy: auditBy,
        });
      }

      // Line 4: Tax CR (if any)
      if (sumTax > 0 && receiptLedgerId != null) {
        await voucherRepo.insertVoucherDetail(client, {
          companyId,
          branchId,
          voucherDetailId: detailSeq++,
          voucherMasterId: vMasterId,
          accountId: receiptLedgerId,
          creditAmount: sumTax,
          debitAmount: 0,
          outstandingBalance: 0,
          narration: `Tax SVT: ${billNo}`,
          postStatus: 'PENDING',
          recordStatus: 'ACTIVE',
          createdBy: auditBy,
        });
      }

      // Line 5: Round-off (if any)
      if (roundOff !== 0 && receiptLedgerId != null) {
        await voucherRepo.insertVoucherDetail(client, {
          companyId,
          branchId,
          voucherDetailId: detailSeq++,
          voucherMasterId: vMasterId,
          accountId: receiptLedgerId,
          creditAmount: roundOff > 0 ? roundOff : 0,
          debitAmount: roundOff < 0 ? Math.abs(roundOff) : 0,
          outstandingBalance: 0,
          narration: `RoundOff SVT: ${billNo}`,
          postStatus: 'PENDING',
          recordStatus: 'ACTIVE',
          createdBy: auditBy,
        });
      }

      // ───── STEP 9: PayNow receipt voucher (cash/card) — only if customer has ledger
      if ((paymentMode === 'CASH' || paymentMode === 'CREDITCARD') && receiptLedgerId != null && customerId != null && customerHasLedger) {
        const recVoucherTypeId = await voucherRepo.getVoucherTypeId(client, companyId, 'ReceiptVoucherNameCustomer', branchId) || 2;
        const recPrefix = await voucherRepo.getVoucherPrefix(client, companyId, recVoucherTypeId) || 'RCV';

        const recMasterId = await voucherRepo.nextVoucherMasterId(client, companyId, branchId);
        const recAutoNo = await voucherRepo.nextAutoVoucherNo(client, companyId, branchId, recVoucherTypeId);

        await voucherRepo.insertVoucherMaster(client, {
          companyId,
          branchId,
          voucherMasterId: recMasterId,
          voucherTypeId: recVoucherTypeId,
          autoVoucherNo: recAutoNo,
          voucherPrefix: recPrefix,
          referenceNo: String(billNo),
          voucherAmount: paid,
          remarks: `RCV: ${billNo}`,
          postStatus: 'POSTED',
          creationMode: 'INVENTORYACCOUNTS',
          voucherPostedId: salesId,
          counterCloseNo: 'PENDING',
          recordStatus: 'ACTIVE',
          createdBy: auditBy,
        });

        let recDetailSeq = await voucherRepo.nextVoucherDetailId(client, companyId, branchId);

        // DR: Cash/Card account (receipt_ledger_id)
        await voucherRepo.insertVoucherDetail(client, {
          companyId,
          branchId,
          voucherDetailId: recDetailSeq++,
          voucherMasterId: recMasterId,
          accountId: receiptLedgerId,
          creditAmount: 0,
          debitAmount: paid,
          outstandingBalance: 0,
          narration: `RCV: ${billNo}`,
          postStatus: 'POSTED',
          recordStatus: 'ACTIVE',
          createdBy: auditBy,
        });

        // CR: Customer (debtor cleared)
        await voucherRepo.insertVoucherDetail(client, {
          companyId,
          branchId,
          voucherDetailId: recDetailSeq++,
          voucherMasterId: recMasterId,
          accountId: customerId,
          creditAmount: paid,
          debitAmount: 0,
          outstandingBalance: 0,
          narration: `RCV: ${billNo}`,
          postStatus: 'POSTED',
          recordStatus: 'ACTIVE',
          createdBy: auditBy,
        });
      }
    } catch (voucherErr) {
      await client.query('ROLLBACK TO SAVEPOINT voucher_save').catch(() => {});
      if (voucherErr.code === '42P01' || voucherErr.code === '42703') {
        console.warn('Voucher tables missing — accounting entries skipped');
      } else {
        throw voucherErr;
      }
    }

    // ───── STEP 11: TransactionExpenseDetail (cash account head expense line) ─────
    if (receiptLedgerId != null && (paymentMode === 'CASH' || paymentMode === 'CREDITCARD')) {
      try {
        await client.query('SAVEPOINT txn_expense_save');
        await txnExpenseRepo.deleteByTransactionMaster(client, companyId, salesId, 'SALES');
        const txnExpId = await txnExpenseRepo.nextTransactionExpenseId(client, companyId);
        await txnExpenseRepo.insertTransactionExpenseDetail(client, {
          companyId,
          branchId,
          transactionExpenseId: txnExpId,
          transactionMasterId: salesId,
          ledgerId: receiptLedgerId,
          description: 'SALES',
          referenceNo: String(billNo),
          amount: netClient,
          transactionType: 'SALES',
          expenseType: paymentMode === 'CREDITCARD' ? 'CREDIT CARD SALES' : 'CASH SALES',
          taxRate: sumSub > 0.0001 ? round2((sumTax / sumSub) * 100) : 0,
          createdBy: auditBy,
        });
      } catch (txnErr) {
        await client.query('ROLLBACK TO SAVEPOINT txn_expense_save').catch(() => {});
        if (txnErr.code === '42P01' || txnErr.code === '42703') {
          console.warn('transaction_expense_detail table/column issue — expense line skipped');
        } else {
          throw txnErr;
        }
      }
    }

    // ───── STEP 12: DO status update (DOMaster → INVOICED) ─────
    const allDoIds = [];
    if (deliveryOrderIdOpt) allDoIds.push(deliveryOrderIdOpt);
    for (const L of normalized) {
      if (L.doId && !allDoIds.includes(L.doId)) allDoIds.push(L.doId);
    }
    if (allDoIds.length > 0) {
      try {
        await deliveryOrderRepo.markDOsInvoiced(client, companyId, allDoIds, salesId, billNo);
      } catch (doErr) {
        if (doErr.code === '42703' || doErr.code === '42P01') {
          console.warn('DO invoice_status column or table issue — DO status update skipped');
        } else {
          throw doErr;
        }
      }
    }

    return {
      ok: true,
      salesId: String(salesId),
      billNo: String(billNo),
      netAmount: String(netClient),
      receiptLedgerId:
        paymentMode === 'CASH' || paymentMode === 'CREDITCARD' ? String(receiptLedgerId) : null,
      salesVoucherId: salesVoucherId ? String(salesVoucherId) : null,
      privilegeWarnings: privilegeWarnings.length > 0 ? privilegeWarnings : undefined,
      message: 'Sale saved.',
    };
  });
}
