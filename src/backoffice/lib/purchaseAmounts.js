/** Header discount on subtotal; tax recalculated on discounted subtotal (proportional per line). */

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function num(value, fallback = 0) {
  const parsed = parseFloat(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function lineSubAndRate(line) {
  return {
    sub: round2(num(line.subtotalAmount ?? line.subTotal ?? line.subtotal_amount, 0)),
    rate: round2(num(line.inputTax1Rate ?? line.vatPct ?? line.taxPercent ?? line.input_tax_1_rate, 0)),
  };
}

export function computeHeaderDiscount(subSum, headerDiscAmt, headerDiscPct) {
  const base = round2(subSum);
  return round2(num(headerDiscAmt, 0) + base * (num(headerDiscPct, 0) / 100));
}

/**
 * @param {Array<{ subtotalAmount?, subTotal?, vatPct?, inputTax1Rate? }>} lines
 */
export function computePurchaseAmounts(lines, { headerDiscAmt = 0, headerDiscPct = 0, roundOff = 0 } = {}) {
  const items = (lines || []).map(lineSubAndRate);
  const baseSub = round2(items.reduce((s, x) => s + x.sub, 0));
  const absBase = Math.abs(baseSub);
  const headerDiscUnsigned = computeHeaderDiscount(absBase, headerDiscAmt, headerDiscPct);
  const headerDisc = baseSub < 0 ? -headerDiscUnsigned : headerDiscUnsigned;

  let subAfterDisc;
  if (baseSub >= 0) {
    subAfterDisc = round2(Math.max(0, baseSub - headerDisc));
  } else {
    subAfterDisc = round2(-Math.max(0, absBase - Math.abs(headerDisc)));
  }

  const ratio = absBase > 0.0001 ? Math.abs(subAfterDisc) / absBase : 0;

  let sumTax = 0;
  let taxableSubAfter = 0;
  let exemptSubAfter = 0;
  for (const item of items) {
    const adjSub = round2(item.sub * ratio);
    const tax = round2(adjSub * (item.rate / 100));
    sumTax += tax;
    if (item.rate > 0.001) taxableSubAfter += adjSub;
    else exemptSubAfter += adjSub;
  }
  sumTax = round2(sumTax);
  taxableSubAfter = round2(taxableSubAfter);
  exemptSubAfter = round2(exemptSubAfter);
  const totalAmount = subAfterDisc;
  const net = round2(subAfterDisc + sumTax + num(roundOff, 0));

  return {
    baseSub,
    subAfterDisc,
    headerDisc,
    sumTax,
    taxableSubAfter,
    exemptSubAfter,
    totalAmount,
    totalBeforeRound: round2(subAfterDisc + sumTax),
    net,
    ratio,
  };
}

export function resolveHeaderDiscountFromBody(body, subSum) {
  const headerDiscAmt = round2(num(body.headerDiscAmt, 0));
  const headerDiscPct = round2(num(body.headerDiscPct ?? body.discountPercentage ?? body.discPct, 0));
  if (body.headerDiscAmt != null || body.headerDiscPct != null) {
    return { headerDiscAmt, headerDiscPct, headerDisc: computeHeaderDiscount(subSum, headerDiscAmt, headerDiscPct) };
  }
  return {
    headerDiscAmt: round2(num(body.discountAmount, 0)),
    headerDiscPct: 0,
    headerDisc: round2(num(body.discountAmount, 0)),
  };
}
