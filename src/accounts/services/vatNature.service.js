import * as vatNatureRepo from '../repositories/vatNature.repository.js';
import * as accountHeadRepo from '../repositories/accountHead.repository.js';
import { seedVatNatures, STANDARD_VAT_NATURES } from '../repositories/accountsSeed.repository.js';

function resolveCompanyId(authStaff) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid company on session');
    err.status = 400;
    throw err;
  }
  return companyId;
}

/** Ensure standard VAT nature rows exist for this company (idempotent). Returns false if table missing. */
export async function ensureCompanyVatNaturesSeeded(db, companyId) {
  try {
    const rows = await vatNatureRepo.listVatNatures(db, companyId);
    if (!rows.length) {
      await seedVatNatures(db, companyId, 'vat-nature-auto');
    }
    return true;
  } catch (e) {
    if (e.code === '42P01') return false;
    throw e;
  }
}

/** Lookup nature row; auto-seed standard list when id is known but row missing. */
export async function findOrSeedVatNature(db, companyId, vatNatureId) {
  const id = Number(vatNatureId);
  let row = await vatNatureRepo.findVatNature(db, companyId, id);
  if (row) return row;
  const isStandard = STANDARD_VAT_NATURES.some(([sid]) => sid === id);
  if (!isStandard) return null;
  const seeded = await ensureCompanyVatNaturesSeeded(db, companyId);
  if (!seeded) return null;
  return vatNatureRepo.findVatNature(db, companyId, id);
}

export function filterNaturesForParentAccount(parentAccountNo, natures) {
  const no = String(parentAccountNo || '').trim();
  if (no.startsWith('12')) {
    return natures.filter((n) => n.vatNatureType === 'Purchase');
  }
  if (no.startsWith('13')) {
    return natures.filter((n) => n.vatNatureType === 'Sales');
  }
  if (no.startsWith('04-02') || no === '04-02') {
    return natures.filter((n) => ['VatIN', 'VatOUT', 'VatINDiscount', 'VatOUTDiscount'].includes(n.vatNatureType));
  }
  if (no.startsWith('05') || no.startsWith('08')) {
    return natures.filter((n) => n.vatNatureType === 'VatIN' || n.vatNatureId === 9);
  }
  if (no.startsWith('06') || no.startsWith('09')) {
    return natures.filter((n) => n.vatNatureType === 'VatOUT' || n.vatNatureId === 10);
  }
  return natures;
}

export async function listVatNatures(pool, authStaff, query = {}) {
  const companyId = resolveCompanyId(authStaff);
  let rows = [];
  try {
    await ensureCompanyVatNaturesSeeded(pool, companyId);
    rows = await vatNatureRepo.listVatNatures(pool, companyId);
  } catch (e) {
    if (e.code !== '42P01') throw e;
    rows = STANDARD_VAT_NATURES.map(([id, name, type]) => ({
      vat_nature_id: id,
      vat_nature_name: name,
      vat_nature_type: type,
    }));
  }

  const mapped = rows.map((r) => ({
    vatNatureId: Number(r.vat_nature_id),
    vatNatureName: r.vat_nature_name,
    vatNatureType: r.vat_nature_type || null,
  }));
  const parentAccountNo = query.parentAccountNo != null ? String(query.parentAccountNo) : '';
  const parentAccId = query.parentAccId != null ? Number(query.parentAccId) : null;
  if (parentAccountNo) {
    return { vatNatures: filterNaturesForParentAccount(parentAccountNo, mapped) };
  }
  if (parentAccId) {
    const parent = await accountHeadRepo.findAccountHead(pool, companyId, parentAccId);
    if (parent?.account_no) {
      return { vatNatures: filterNaturesForParentAccount(parent.account_no, mapped) };
    }
  }
  return { vatNatures: mapped };
}
