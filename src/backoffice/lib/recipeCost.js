/** Units on Recipe Details Entry (cboUnit). */
export const RECIPE_UNITS = ['GM', 'KG', 'ML', 'LT', 'METER', 'PCS'];

export function normalizeRecipeUnit(unit) {
  const u = String(unit ?? '').trim().toUpperCase();
  if (!RECIPE_UNITS.includes(u)) {
    const err = new Error('Unit must be GM, KG, ML, LT, METER, or PCS');
    err.status = 400;
    throw err;
  }
  return u;
}

/**
 * VB btnAdd_Click:
 * KG / LT / METER — store the entered qty; cost = average cost × qty
 * GM / ML — store qty / 1000 (KG or LT); cost = (average cost / 1000) × entered qty
 * PCS — store the entered qty; cost = average cost × qty
 */
export function recipeLineAmounts(averageCost, enteredQty, unit) {
  const u = normalizeRecipeUnit(unit);
  const qty = Number(enteredQty);
  if (!Number.isFinite(qty) || qty <= 0) {
    const err = new Error('Enter qty');
    err.status = 400;
    throw err;
  }
  const cost = Number(averageCost);
  const costVal = Number.isFinite(cost) ? cost : 0;
  if (u === 'GM' || u === 'ML') {
    return {
      unit: u,
      enteredQty: qty,
      storedQty: qty / 1000,
      lineCost: (costVal / 1000) * qty,
    };
  }
  return {
    unit: u,
    enteredQty: qty,
    storedQty: qty,
    lineCost: costVal * qty,
  };
}

/** VB RecipiePopulation: GM/ML display is stored base qty × 1000. */
export function enteredQtyFromStored(storedQty, unit) {
  const stored = Number(storedQty) || 0;
  const u = String(unit ?? '').trim().toUpperCase();
  if (u === 'GM' || u === 'ML') return stored * 1000;
  return stored;
}

export function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

export function formatQty(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '0';
  return String(parseFloat(x.toFixed(6)));
}
