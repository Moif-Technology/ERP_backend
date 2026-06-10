import { pool } from '../../config/db.js';
import * as svc from '../services/dealsOffers.service.js';

function handleErr(res, err, fallbackMsg) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.code === '42P01') return res.status(503).json({ message: 'Run migration 041_deals_offers.sql first' });
  console.error(err);
  return res.status(500).json({ message: fallbackMsg });
}

// ─── Discounts ───────────────────────────────────────────────────────────────

export async function listDiscounts(req, res) {
  try {
    const items = await svc.listDiscountEntries(pool, req.authStaff);
    return res.json({ items });
  } catch (e) { return handleErr(res, e, 'Could not load discount entries'); }
}

export async function createDiscount(req, res) {
  try {
    const item = await svc.createDiscountEntry(pool, req.authStaff, req.body);
    return res.status(201).json(item);
  } catch (e) { return handleErr(res, e, 'Could not create discount entry'); }
}

export async function updateDiscount(req, res) {
  try {
    const item = await svc.updateDiscountEntry(pool, req.authStaff, req.params.id, req.body);
    return res.json(item);
  } catch (e) { return handleErr(res, e, 'Could not update discount entry'); }
}

export async function deleteDiscount(req, res) {
  try {
    await svc.deleteDiscountEntry(pool, req.authStaff, req.params.id);
    return res.json({ ok: true });
  } catch (e) { return handleErr(res, e, 'Could not delete discount entry'); }
}

export async function deleteAllDiscounts(req, res) {
  try {
    await svc.deleteAllDiscountEntries(pool, req.authStaff);
    return res.json({ ok: true });
  } catch (e) { return handleErr(res, e, 'Could not delete discount entries'); }
}

// ─── Gift Vouchers ────────────────────────────────────────────────────────────

export async function listGiftVouchers(req, res) {
  try {
    const items = await svc.listGiftVouchers(pool, req.authStaff);
    return res.json({ items });
  } catch (e) { return handleErr(res, e, 'Could not load gift vouchers'); }
}

export async function createGiftVoucher(req, res) {
  try {
    const item = await svc.createGiftVoucher(pool, req.authStaff, req.body);
    return res.status(201).json(item);
  } catch (e) { return handleErr(res, e, 'Could not create gift voucher'); }
}

export async function updateGiftVoucher(req, res) {
  try {
    const item = await svc.updateGiftVoucher(pool, req.authStaff, req.params.id, req.body);
    return res.json(item);
  } catch (e) { return handleErr(res, e, 'Could not update gift voucher'); }
}

export async function deleteGiftVoucher(req, res) {
  try {
    await svc.deleteGiftVoucher(pool, req.authStaff, req.params.id);
    return res.json({ ok: true });
  } catch (e) { return handleErr(res, e, 'Could not delete gift voucher'); }
}

export async function deleteAllGiftVouchers(req, res) {
  try {
    await svc.deleteAllGiftVouchers(pool, req.authStaff);
    return res.json({ ok: true });
  } catch (e) { return handleErr(res, e, 'Could not delete gift vouchers'); }
}

// ─── Offer Packets ────────────────────────────────────────────────────────────

export async function listOfferPackets(req, res) {
  try {
    const items = await svc.listOfferPackets(pool, req.authStaff);
    return res.json({ items });
  } catch (e) { return handleErr(res, e, 'Could not load offer packets'); }
}

export async function createOfferPacket(req, res) {
  try {
    const item = await svc.createOfferPacket(pool, req.authStaff, req.body);
    return res.status(201).json(item);
  } catch (e) { return handleErr(res, e, 'Could not create offer packet'); }
}

export async function getOfferPacket(req, res) {
  try {
    const item = await svc.getOfferPacket(pool, req.authStaff, req.params.id);
    return res.json(item);
  } catch (e) { return handleErr(res, e, 'Could not load offer packet'); }
}

export async function deleteOfferPacket(req, res) {
  try {
    await svc.deleteOfferPacket(pool, req.authStaff, req.params.id);
    return res.json({ ok: true });
  } catch (e) { return handleErr(res, e, 'Could not delete offer packet'); }
}

// ─── Packing Entries ──────────────────────────────────────────────────────────

export async function listPackingEntries(req, res) {
  try {
    const items = await svc.listPackingEntries(pool, req.authStaff);
    return res.json({ items });
  } catch (e) { return handleErr(res, e, 'Could not load packing entries'); }
}

export async function createPackingEntry(req, res) {
  try {
    const item = await svc.createPackingEntry(pool, req.authStaff, req.body);
    return res.status(201).json(item);
  } catch (e) { return handleErr(res, e, 'Could not create packing entry'); }
}

export async function updatePackingEntry(req, res) {
  try {
    const item = await svc.updatePackingEntry(pool, req.authStaff, req.params.id, req.body);
    return res.json(item);
  } catch (e) { return handleErr(res, e, 'Could not update packing entry'); }
}

export async function deletePackingEntry(req, res) {
  try {
    await svc.deletePackingEntry(pool, req.authStaff, req.params.id);
    return res.json({ ok: true });
  } catch (e) { return handleErr(res, e, 'Could not delete packing entry'); }
}

export async function deleteAllPackingEntries(req, res) {
  try {
    await svc.deleteAllPackingEntries(pool, req.authStaff);
    return res.json({ ok: true });
  } catch (e) { return handleErr(res, e, 'Could not delete packing entries'); }
}

// ─── Unpacking Entries ────────────────────────────────────────────────────────

export async function listUnpackingEntries(req, res) {
  try {
    const items = await svc.listUnpackingEntries(pool, req.authStaff);
    return res.json({ items });
  } catch (e) { return handleErr(res, e, 'Could not load unpacking entries'); }
}

export async function createUnpackingEntry(req, res) {
  try {
    const item = await svc.createUnpackingEntry(pool, req.authStaff, req.body);
    return res.status(201).json(item);
  } catch (e) { return handleErr(res, e, 'Could not create unpacking entry'); }
}

export async function updateUnpackingEntry(req, res) {
  try {
    const item = await svc.updateUnpackingEntry(pool, req.authStaff, req.params.id, req.body);
    return res.json(item);
  } catch (e) { return handleErr(res, e, 'Could not update unpacking entry'); }
}

export async function deleteUnpackingEntry(req, res) {
  try {
    await svc.deleteUnpackingEntry(pool, req.authStaff, req.params.id);
    return res.json({ ok: true });
  } catch (e) { return handleErr(res, e, 'Could not delete unpacking entry'); }
}

export async function deleteAllUnpackingEntries(req, res) {
  try {
    await svc.deleteAllUnpackingEntries(pool, req.authStaff);
    return res.json({ ok: true });
  } catch (e) { return handleErr(res, e, 'Could not delete unpacking entries'); }
}
