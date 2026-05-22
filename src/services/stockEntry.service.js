import { withTransaction } from '../config/db.js';
import * as repo from '../repositories/stockEntry.repository.js';

function parseNum(v, fallback = null) {
  if (v == null || v === '' || v === '—') return fallback;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

function parseDate(v) {
  if (!v) return new Date().toISOString().slice(0, 10);
  // accept YYYY-MM-DD or DD/MM/YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const parts = String(v).split('/');
  if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
  return new Date().toISOString().slice(0, 10);
}

export async function saveEntry(pool, body, authStaff) {
  const companyId = authStaff.company_id ?? authStaff.companyId;
  const branchId  = authStaff.branch_id  ?? authStaff.branchId;
  const staffId   = authStaff.staff_id   ?? authStaff.staffId;
  const { entryId: rawId, entryNo: rawNo, docType, entryDate, remark, lines = [] } = body;

  if (!['ADJ', 'DMG', 'ASE'].includes(docType)) {
    const err = new Error('Invalid doc type'); err.status = 400; throw err;
  }

  return withTransaction(async (client) => {
    let entryId = rawId ? Number(rawId) : null;
    let isNew = !entryId;

    if (isNew) {
      entryId = await repo.nextEntryId(client, companyId, branchId);
    }

    const entryNo = rawNo?.trim() || await repo.generateEntryNo(client, companyId, branchId, docType);
    const masterRow = {
      companyId, branchId, entryId, entryNo, docType,
      entryDate: parseDate(entryDate),
      remark: remark?.trim() || null,
      createdBy: staffId,
    };

    if (isNew) {
      await repo.insertMaster(client, masterRow);
    } else {
      const updated = await repo.updateMaster(client, masterRow);
      if (!updated) {
        const err = new Error('Entry not found or already posted'); err.status = 409; throw err;
      }
    }

    await repo.deleteDetailLines(client, companyId, branchId, entryId);

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await repo.insertDetailLine(client, {
        companyId, branchId, entryId,
        lineId: i + 1,
        productId: l.productId ? Number(l.productId) : null,
        barcode: l.barcode || null,
        shortDescription: l.shortDescription || null,
        pktQty: parseNum(l.pktQty),
        pktDetails: l.pktDetails || null,
        systemQty: parseNum(l.systemQty ?? l.presentQty),
        adjQty: parseNum(l.adjustQty ?? l.adjQty),
        enteredQty: parseNum(l.enteredQty),
        physicalQty: parseNum(l.physicalQty),
        reason: l.reason || null,
        lineTotal: parseNum(l.lineTotal),
      });
    }

    return { entryId, entryNo, docType, postStatus: 'draft' };
  });
}

export async function getEntry(pool, rawId, authStaff) {
  const companyId = authStaff.company_id ?? authStaff.companyId;
  const branchId  = authStaff.branch_id  ?? authStaff.branchId;
  const entryId = Number(rawId);

  return withTransaction(async (client) => {
    const master = await repo.getMaster(client, companyId, branchId, entryId);
    if (!master) { const e = new Error('Not found'); e.status = 404; throw e; }
    const detail = await repo.getDetail(client, companyId, branchId, entryId);
    return { ...master, lines: detail };
  });
}

export async function listEntries(pool, docType, authStaff) {
  const companyId = authStaff.company_id ?? authStaff.companyId;
  const branchId  = authStaff.branch_id  ?? authStaff.branchId;
  if (!['ADJ', 'DMG', 'ASE'].includes(docType)) {
    const err = new Error('Invalid doc type'); err.status = 400; throw err;
  }
  return withTransaction((client) => repo.listMasters(client, companyId, branchId, docType));
}

export async function postEntry(pool, rawId, authStaff) {
  const companyId = authStaff.company_id ?? authStaff.companyId;
  const branchId  = authStaff.branch_id  ?? authStaff.branchId;
  const staffId   = authStaff.staff_id   ?? authStaff.staffId;
  const entryId = Number(rawId);

  return withTransaction(async (client) => {
    const master = await repo.getMaster(client, companyId, branchId, entryId);
    if (!master) { const e = new Error('Entry not found'); e.status = 404; throw e; }
    if (master.post_status === 'posted') {
      const e = new Error('Already posted'); e.status = 409; throw e;
    }

    const rows = await repo.getDetail(client, companyId, branchId, entryId);
    const transType = master.doc_type; // ADJ / DMG / ASE

    for (const line of rows) {
      if (!line.product_id) continue;
      const inv = await repo.getInventory(client, companyId, branchId, line.product_id);
      const currentQty = inv ? Number(inv.qty_on_hand) : 0;
      const adjQty = Number(line.adj_qty ?? 0);
      const newQty = currentQty + adjQty;

      await repo.adjustInventoryQty(client, companyId, branchId, line.product_id, adjQty);

      const logId = await repo.nextProductLogId(client, companyId, branchId);
      await repo.insertProductLog(client, {
        companyId, branchId, logId,
        productId: line.product_id,
        transactionType: transType,
        transactionId: entryId,
        qty: adjQty,
        balanceQty: newQty,
        unitCost: inv ? Number(inv.unit_cost) : 0,
        unitPrice: inv ? Number(inv.unit_price) : 0,
        createdBy: staffId,
      });
    }

    await repo.postEntry(client, companyId, branchId, entryId, staffId);
    return { entryId, postStatus: 'posted' };
  });
}

export async function unpostEntry(pool, rawId, authStaff) {
  const companyId = authStaff.company_id ?? authStaff.companyId;
  const branchId  = authStaff.branch_id  ?? authStaff.branchId;
  const entryId = Number(rawId);

  return withTransaction(async (client) => {
    const master = await repo.getMaster(client, companyId, branchId, entryId);
    if (!master) { const e = new Error('Entry not found'); e.status = 404; throw e; }
    if (master.post_status !== 'posted') {
      const e = new Error('Entry is not posted'); e.status = 409; throw e;
    }

    const rows = await repo.getDetail(client, companyId, branchId, entryId);
    for (const line of rows) {
      if (!line.product_id) continue;
      const reversal = -Number(line.adj_qty ?? 0);
      await repo.adjustInventoryQty(client, companyId, branchId, line.product_id, reversal);
    }

    await repo.deleteProductLogsByEntry(client, companyId, branchId, entryId, master.doc_type);
    await repo.unpostEntry(client, companyId, branchId, entryId);
    return { entryId, postStatus: 'draft' };
  });
}

export async function deleteEntry(pool, rawId, authStaff) {
  const companyId = authStaff.company_id ?? authStaff.companyId;
  const branchId  = authStaff.branch_id  ?? authStaff.branchId;
  const entryId = Number(rawId);

  return withTransaction(async (client) => {
    const master = await repo.getMaster(client, companyId, branchId, entryId);
    if (!master) { const e = new Error('Entry not found'); e.status = 404; throw e; }
    if (master.post_status === 'posted') {
      const e = new Error('Cannot delete a posted entry — unpost first'); e.status = 409; throw e;
    }
    await repo.deleteMasterAndDetail(client, companyId, branchId, entryId);
    return { deleted: true };
  });
}

export async function getReorderList(pool, authStaff) {
  const companyId = authStaff.company_id ?? authStaff.companyId;
  const branchId  = authStaff.branch_id  ?? authStaff.branchId;
  return withTransaction((client) => repo.getReorderList(client, companyId, branchId));
}

export async function getDraftEnteredQty(pool, query, authStaff) {
  const companyId = authStaff.company_id ?? authStaff.companyId;
  const branchId  = authStaff.branch_id  ?? authStaff.branchId;
  const productId = query.productId ? Number(query.productId) : null;
  if (!productId) {
    const err = new Error('productId is required');
    err.status = 400;
    throw err;
  }
  return withTransaction((client) => repo.getDraftEnteredQty(client, companyId, branchId, productId));
}

export async function getProductMovement(pool, query, authStaff) {
  const companyId = authStaff.company_id ?? authStaff.companyId;
  const branchId  = authStaff.branch_id  ?? authStaff.branchId;
  const params = {
    productId: query.productId ? Number(query.productId) : null,
    barcode: query.barcode?.trim() || null,
    fromDate: query.fromDate || null,
    toDate: query.toDate || null,
    group: query.group?.trim() || null,
    subGroup: query.subGroup?.trim() || null,
    subSubGroup: query.subSubGroup?.trim() || null,
    unit: query.unit?.trim() || null,
    location: query.location?.trim() || null,
    packetDescription: query.packetDescription?.trim() || null,
  };
  return withTransaction((client) => repo.getProductMovement(client, companyId, branchId, params));
}
