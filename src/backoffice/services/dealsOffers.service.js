import * as repo from '../repositories/dealsOffers.repository.js';

function authInfo(authStaff) {
  return {
    companyId: Number(authStaff.company_id),
    branchId: Number(authStaff.branch_id),
    userLabel: (authStaff.staff_name || 'system').slice(0, 100),
  };
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round4(value) {
  return Math.round(toFiniteNumber(value, 0) * 10000) / 10000;
}

function round2(value) {
  return Math.round(toFiniteNumber(value, 0) * 100) / 100;
}

function normalizeDiscountBody(body) {
  const sellPrice = Math.max(0, round4(body.sellPrice));
  let discPct = Math.max(0, round4(body.discPct));
  let disAmount = Math.max(0, round4(body.disAmount));
  let disSellPrice = Math.max(0, round4(body.disSellPrice));
  let disPrice = Math.max(0, round4(body.disPrice));

  if (discPct > 0) {
    disAmount = round4((sellPrice * discPct) / 100);
    disSellPrice = Math.max(0, round4(sellPrice - disAmount));
    disPrice = disAmount;
  } else if (disSellPrice > 0 && sellPrice > 0 && disSellPrice <= sellPrice) {
    disAmount = round4(sellPrice - disSellPrice);
    disPrice = disAmount;
    discPct = sellPrice > 0 ? round4((disAmount / sellPrice) * 100) : 0;
  } else if (disAmount > 0 && sellPrice > 0 && disAmount <= sellPrice) {
    disPrice = disAmount;
    disSellPrice = Math.max(0, round4(sellPrice - disAmount));
    discPct = round4((disAmount / sellPrice) * 100);
  } else {
    disAmount = 0;
    disPrice = 0;
    disSellPrice = sellPrice;
    discPct = 0;
  }

  return {
    ...body,
    sellPrice,
    disPrice,
    disSellPrice,
    discPct,
    disAmount,
  };
}

function normalizeGiftVoucherBody(body) {
  return {
    ...body,
    disPrice: 0,
    disSellPrice: 0,
    discPct: 0,
  };
}

// ─── Discount Entries ─────────────────────────────────────────────────────────

export async function listDiscountEntries(pool, authStaff) {
  const { companyId, branchId } = authInfo(authStaff);
  return repo.listDiscountEntries(pool, companyId, branchId);
}

export async function createDiscountEntry(pool, authStaff, body) {
  const { companyId, branchId, userLabel } = authInfo(authStaff);
  return repo.insertDiscountEntry(pool, companyId, branchId, normalizeDiscountBody(body), userLabel);
}

export async function updateDiscountEntry(pool, authStaff, id, body) {
  const { companyId } = authInfo(authStaff);
  const row = await repo.updateDiscountEntry(pool, companyId, id, normalizeDiscountBody(body), authStaff.staff_name || 'system');
  if (!row) {
    const e = new Error('Discount entry not found');
    e.status = 404;
    throw e;
  }
  return row;
}

export async function deleteDiscountEntry(pool, authStaff, id) {
  const { companyId } = authInfo(authStaff);
  await repo.deleteDiscountEntry(pool, companyId, id);
}

export async function deleteAllDiscountEntries(pool, authStaff) {
  const { companyId, branchId } = authInfo(authStaff);
  await repo.deleteAllDiscountEntries(pool, companyId, branchId);
}

// ─── Gift Vouchers ────────────────────────────────────────────────────────────

export async function listGiftVouchers(pool, authStaff) {
  const { companyId, branchId } = authInfo(authStaff);
  return repo.listGiftVouchers(pool, companyId, branchId);
}

export async function createGiftVoucher(pool, authStaff, body) {
  const { companyId, branchId, userLabel } = authInfo(authStaff);
  return repo.insertGiftVoucher(pool, companyId, branchId, normalizeGiftVoucherBody(body), userLabel);
}

export async function updateGiftVoucher(pool, authStaff, id, body) {
  const { companyId } = authInfo(authStaff);
  const row = await repo.updateGiftVoucher(pool, companyId, id, normalizeGiftVoucherBody(body), authStaff.staff_name || 'system');
  if (!row) {
    const e = new Error('Gift voucher not found');
    e.status = 404;
    throw e;
  }
  return row;
}

export async function deleteGiftVoucher(pool, authStaff, id) {
  const { companyId } = authInfo(authStaff);
  await repo.deleteGiftVoucher(pool, companyId, id);
}

export async function deleteAllGiftVouchers(pool, authStaff) {
  const { companyId, branchId } = authInfo(authStaff);
  await repo.deleteAllGiftVouchers(pool, companyId, branchId);
}

// ─── Offer Packets ────────────────────────────────────────────────────────────

export async function listOfferPackets(pool, authStaff) {
  const { companyId, branchId } = authInfo(authStaff);
  return repo.listOfferPackets(pool, companyId, branchId);
}

export async function createOfferPacket(pool, authStaff, body) {
  const { companyId, branchId, userLabel } = authInfo(authStaff);
  const { header, lines } = body;
  if (!header) {
    const e = new Error('header is required');
    e.status = 400;
    throw e;
  }
  return repo.insertOfferPacket(pool, companyId, branchId, header, lines || [], userLabel);
}

export async function getOfferPacket(pool, authStaff, id) {
  const { companyId } = authInfo(authStaff);
  const packet = await repo.getOfferPacketWithLines(pool, companyId, id);
  if (!packet) {
    const e = new Error('Offer packet not found');
    e.status = 404;
    throw e;
  }
  return packet;
}

export async function deleteOfferPacket(pool, authStaff, id) {
  const { companyId } = authInfo(authStaff);
  await repo.deleteOfferPacket(pool, companyId, id);
}

// ─── Packing Entries ──────────────────────────────────────────────────────────

export async function listPackingEntries(pool, authStaff) {
  const { companyId, branchId } = authInfo(authStaff);
  return repo.listPackingEntries(pool, companyId, branchId);
}

export async function createPackingEntry(pool, authStaff, body) {
  const { companyId, branchId, userLabel } = authInfo(authStaff);
  return repo.insertPackingEntry(pool, companyId, branchId, body, userLabel);
}

export async function updatePackingEntry(pool, authStaff, id, body) {
  const { companyId } = authInfo(authStaff);
  const row = await repo.updatePackingEntry(pool, companyId, id, body);
  if (!row) {
    const e = new Error('Packing entry not found');
    e.status = 404;
    throw e;
  }
  return row;
}

export async function deletePackingEntry(pool, authStaff, id) {
  const { companyId } = authInfo(authStaff);
  await repo.deletePackingEntry(pool, companyId, id);
}

export async function deleteAllPackingEntries(pool, authStaff) {
  const { companyId, branchId } = authInfo(authStaff);
  await repo.deleteAllPackingEntries(pool, companyId, branchId);
}

// ─── Unpacking Entries ────────────────────────────────────────────────────────

export async function listUnpackingEntries(pool, authStaff) {
  const { companyId, branchId } = authInfo(authStaff);
  return repo.listUnpackingEntries(pool, companyId, branchId);
}

export async function createUnpackingEntry(pool, authStaff, body) {
  const { companyId, branchId, userLabel } = authInfo(authStaff);
  return repo.insertUnpackingEntry(pool, companyId, branchId, body, userLabel);
}

export async function updateUnpackingEntry(pool, authStaff, id, body) {
  const { companyId } = authInfo(authStaff);
  const row = await repo.updateUnpackingEntry(pool, companyId, id, body);
  if (!row) {
    const e = new Error('Unpacking entry not found');
    e.status = 404;
    throw e;
  }
  return row;
}

export async function deleteUnpackingEntry(pool, authStaff, id) {
  const { companyId } = authInfo(authStaff);
  await repo.deleteUnpackingEntry(pool, companyId, id);
}

export async function deleteAllUnpackingEntries(pool, authStaff) {
  const { companyId, branchId } = authInfo(authStaff);
  await repo.deleteAllUnpackingEntries(pool, companyId, branchId);
}
