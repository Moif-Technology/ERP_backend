function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}
function s(v) {
  if (v == null || v === '') return null;
  return String(v).trim().slice(0, 500) || null;
}
function dateOrNull(v) {
  if (!v) return null;
  const d = String(v).trim();
  return d || null;
}

function toIsoDateString(v) {
  if (!v) return '';
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Discount Entries ────────────────────────────────────────────────────────

export async function listDiscountEntries(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT discount_entry_id, company_id, branch_id, barcode, short_description,
            packet_description, present_qty, sell_price, dis_price, dis_sell_price,
            disc_pct, tax_pct, tax_amount, price_with_tax, dis_amount,
            supplier, product_brand, group_name, sub_group_name,
            disc_from, disc_to, created_at
     FROM ops.discount_entry
     WHERE company_id = $1 AND branch_id = $2 AND record_status = 'ACTIVE'
     ORDER BY created_at DESC`,
    [companyId, branchId]
  );
  return rows.map(mapDiscountEntry);
}

export async function insertDiscountEntry(pool, companyId, branchId, params, createdBy) {
  const { rows } = await pool.query(
    `INSERT INTO ops.discount_entry
       (company_id, branch_id, barcode, short_description, packet_description,
        present_qty, sell_price, dis_price, dis_sell_price, disc_pct,
        tax_pct, tax_amount, price_with_tax, dis_amount,
        supplier, product_brand, group_name, sub_group_name,
        disc_from, disc_to, created_by, modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21)
     RETURNING *`,
    [
      companyId, branchId,
      s(params.barcode), s(params.shortDescription), s(params.packetDescription),
      n(params.presentQty), n(params.sellPrice), n(params.disPrice), n(params.disSellPrice), n(params.discPct),
      n(params.taxPct), n(params.taxAmount), n(params.priceWithTax), n(params.disAmount),
      s(params.supplier), s(params.productBrand), s(params.groupName), s(params.subGroupName),
      dateOrNull(params.discFrom), dateOrNull(params.discTo),
      s(createdBy),
    ]
  );
  return mapDiscountEntry(rows[0]);
}

export async function updateDiscountEntry(pool, companyId, id, params, modifiedBy) {
  const { rows } = await pool.query(
    `UPDATE ops.discount_entry SET
       barcode = $3, short_description = $4, packet_description = $5,
       present_qty = $6, sell_price = $7, dis_price = $8, dis_sell_price = $9, disc_pct = $10,
       tax_pct = $11, tax_amount = $12, price_with_tax = $13, dis_amount = $14,
       supplier = $15, product_brand = $16, group_name = $17, sub_group_name = $18,
       disc_from = $19, disc_to = $20,
       modified_by = $21, modified_at = NOW()
     WHERE company_id = $1 AND discount_entry_id = $2 AND record_status = 'ACTIVE'
     RETURNING *`,
    [
      companyId, id,
      s(params.barcode), s(params.shortDescription), s(params.packetDescription),
      n(params.presentQty), n(params.sellPrice), n(params.disPrice), n(params.disSellPrice), n(params.discPct),
      n(params.taxPct), n(params.taxAmount), n(params.priceWithTax), n(params.disAmount),
      s(params.supplier), s(params.productBrand), s(params.groupName), s(params.subGroupName),
      dateOrNull(params.discFrom), dateOrNull(params.discTo),
      s(modifiedBy),
    ]
  );
  return rows[0] ? mapDiscountEntry(rows[0]) : null;
}

export async function deleteDiscountEntry(pool, companyId, id) {
  await pool.query(
    `UPDATE ops.discount_entry SET record_status = 'DELETED', modified_at = NOW()
     WHERE company_id = $1 AND discount_entry_id = $2`,
    [companyId, id]
  );
}

export async function deleteAllDiscountEntries(pool, companyId, branchId) {
  await pool.query(
    `UPDATE ops.discount_entry SET record_status = 'DELETED', modified_at = NOW()
     WHERE company_id = $1 AND branch_id = $2 AND record_status = 'ACTIVE'`,
    [companyId, branchId]
  );
}

function mapDiscountEntry(r) {
  return {
    id: String(r.discount_entry_id),
    discountEntryId: Number(r.discount_entry_id),
    barcode: r.barcode ?? '',
    shortDescription: r.short_description ?? '',
    packetDescription: r.packet_description ?? '',
    presentQty: String(r.present_qty ?? 0),
    sellPrice: Number(r.sell_price ?? 0).toFixed(2),
    disPrice: Number(r.dis_price ?? 0).toFixed(2),
    disSellPrice: Number(r.dis_sell_price ?? 0).toFixed(2),
    discPct: String(r.disc_pct ?? 0),
    taxPct: String(r.tax_pct ?? 0),
    tax: Number(r.tax_amount ?? 0).toFixed(2),
    priceWithTax: Number(r.price_with_tax ?? 0).toFixed(2),
    disAmt: Number(r.dis_amount ?? 0).toFixed(2),
    supplier: r.supplier ?? '',
    productBrand: r.product_brand ?? '',
    group: r.group_name ?? '',
    subGroup: r.sub_group_name ?? '',
    discFrom: toIsoDateString(r.disc_from),
    discTo: toIsoDateString(r.disc_to),
    pktQty: String(r.present_qty ?? 0),
    pktDetails: r.packet_description ?? '',
    sellingPrice: Number(r.sell_price ?? 0).toFixed(2),
  };
}

// ─── Gift Vouchers ───────────────────────────────────────────────────────────

export async function listGiftVouchers(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT gift_voucher_id, company_id, branch_id, barcode, short_description,
            packet_description, present_qty, sell_price, dis_price, dis_sell_price,
            disc_pct, supplier, product_brand, group_name, sub_group_name,
            disc_from, disc_to, created_at
     FROM ops.gift_voucher
     WHERE company_id = $1 AND branch_id = $2 AND record_status = 'ACTIVE'
     ORDER BY created_at DESC`,
    [companyId, branchId]
  );
  return rows.map(mapGiftVoucher);
}

export async function insertGiftVoucher(pool, companyId, branchId, params, createdBy) {
  const { rows } = await pool.query(
    `INSERT INTO ops.gift_voucher
       (company_id, branch_id, barcode, short_description, packet_description,
        present_qty, sell_price, dis_price, dis_sell_price, disc_pct,
        supplier, product_brand, group_name, sub_group_name,
        disc_from, disc_to, created_by, modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)
     RETURNING *`,
    [
      companyId, branchId,
      s(params.barcode), s(params.shortDescription), s(params.packetDescription),
      n(params.presentQty), n(params.sellPrice), n(params.disPrice), n(params.disSellPrice), n(params.discPct),
      s(params.supplier), s(params.productBrand), s(params.groupName), s(params.subGroupName),
      dateOrNull(params.discFrom), dateOrNull(params.discTo),
      s(createdBy),
    ]
  );
  return mapGiftVoucher(rows[0]);
}

export async function updateGiftVoucher(pool, companyId, id, params, modifiedBy) {
  const { rows } = await pool.query(
    `UPDATE ops.gift_voucher SET
       barcode = $3, short_description = $4, packet_description = $5,
       present_qty = $6, sell_price = $7, dis_price = $8, dis_sell_price = $9, disc_pct = $10,
       supplier = $11, product_brand = $12, group_name = $13, sub_group_name = $14,
       disc_from = $15, disc_to = $16,
       modified_by = $17, modified_at = NOW()
     WHERE company_id = $1 AND gift_voucher_id = $2 AND record_status = 'ACTIVE'
     RETURNING *`,
    [
      companyId, id,
      s(params.barcode), s(params.shortDescription), s(params.packetDescription),
      n(params.presentQty), n(params.sellPrice), n(params.disPrice), n(params.disSellPrice), n(params.discPct),
      s(params.supplier), s(params.productBrand), s(params.groupName), s(params.subGroupName),
      dateOrNull(params.discFrom), dateOrNull(params.discTo),
      s(modifiedBy),
    ]
  );
  return rows[0] ? mapGiftVoucher(rows[0]) : null;
}

export async function deleteGiftVoucher(pool, companyId, id) {
  await pool.query(
    `UPDATE ops.gift_voucher SET record_status = 'DELETED', modified_at = NOW()
     WHERE company_id = $1 AND gift_voucher_id = $2`,
    [companyId, id]
  );
}

export async function deleteAllGiftVouchers(pool, companyId, branchId) {
  await pool.query(
    `UPDATE ops.gift_voucher SET record_status = 'DELETED', modified_at = NOW()
     WHERE company_id = $1 AND branch_id = $2 AND record_status = 'ACTIVE'`,
    [companyId, branchId]
  );
}

function mapGiftVoucher(r) {
  return {
    id: String(r.gift_voucher_id),
    giftVoucherId: Number(r.gift_voucher_id),
    barcode: r.barcode ?? '',
    shortDescription: r.short_description ?? '',
    packetDescription: r.packet_description ?? '',
    presentQty: String(r.present_qty ?? 0),
    sellPrice: Number(r.sell_price ?? 0).toFixed(2),
    disPrice: Number(r.dis_price ?? 0).toFixed(2),
    disSellPrice: Number(r.dis_sell_price ?? 0).toFixed(2),
    discPct: String(r.disc_pct ?? 0),
    supplier: r.supplier ?? '',
    productBrand: r.product_brand ?? '',
    group: r.group_name ?? '',
    subGroup: r.sub_group_name ?? '',
    discFrom: toIsoDateString(r.disc_from),
    discTo: toIsoDateString(r.disc_to),
    dateFrom: r.disc_from ? formatDDMMYYYY(r.disc_from) : '',
    dateTo: r.disc_to ? formatDDMMYYYY(r.disc_to) : '',
  };
}

function formatDDMMYYYY(d) {
  if (!d) return '';
  const str = String(d).slice(0, 10);
  const [y, m, day] = str.split('-');
  if (!y || !m || !day) return str;
  return `${day}/${m}/${y}`;
}

// ─── Offer Packets ───────────────────────────────────────────────────────────

export async function listOfferPackets(pool, companyId, branchId) {
  const { rows: packets } = await pool.query(
    `SELECT offer_packet_id, own_ref_no, barcode, description, short_description,
            supplier_name, product_brand, group_name, unit_cost, unit_price,
            selling_price, last_purchase, profit_pct, product_type, location_code,
            margin_pct, pkt_qty, pkt_details, remark, created_at
     FROM ops.offer_packet
     WHERE company_id = $1 AND branch_id = $2 AND record_status = 'ACTIVE'
     ORDER BY created_at DESC`,
    [companyId, branchId]
  );
  return packets.map(mapOfferPacket);
}

export async function getOfferPacketWithLines(pool, companyId, id) {
  const { rows: packets } = await pool.query(
    `SELECT * FROM ops.offer_packet
     WHERE company_id = $1 AND offer_packet_id = $2 AND record_status = 'ACTIVE'`,
    [companyId, id]
  );
  if (!packets[0]) return null;
  const { rows: lines } = await pool.query(
    `SELECT * FROM ops.offer_packet_line WHERE offer_packet_id = $1 ORDER BY line_id`,
    [id]
  );
  return { ...mapOfferPacket(packets[0]), lines: lines.map(mapOfferPacketLine) };
}

export async function insertOfferPacket(pool, companyId, branchId, header, lines, createdBy) {
  const { rows } = await pool.query(
    `INSERT INTO ops.offer_packet
       (company_id, branch_id, barcode, description, short_description,
        supplier_name, product_brand, group_name, unit_cost, unit_price,
        selling_price, last_purchase, profit_pct, product_type, location_code,
        pkt_qty, pkt_details, margin_pct, remark, created_by, modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20)
     RETURNING *`,
    [
      companyId, branchId,
      s(header.barcode), s(header.description), s(header.shortDescription),
      s(header.supplierName), s(header.productBrand), s(header.groupName),
      n(header.unitCost), n(header.unitPrice),
      n(header.sellingPrice || header.unitPrice), n(header.lastPurchase || header.unitCost),
      n(header.profitPct), s(header.productType), s(header.location),
      n(header.pktQty), s(header.pktDetails), n(header.marginPct),
      s(header.remark), s(createdBy),
    ]
  );
  const packet = rows[0];
  const packetId = Number(packet.offer_packet_id);

  if (lines && lines.length > 0) {
    for (const line of lines) {
      await pool.query(
        `INSERT INTO ops.offer_packet_line
           (offer_packet_id, company_id, barcode, short_description, unit,
            unit_cost, unit_price, qty, packet_qty, total_cost, total_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          packetId, companyId,
          s(line.barcode), s(line.shortDescription), s(line.unit),
          n(line.unitCost), n(line.unitPrice), n(line.qty), n(line.packetQty),
          n(line.totalCost), n(line.totalPrice),
        ]
      );
    }
  }
  return mapOfferPacket(packet);
}

export async function deleteOfferPacket(pool, companyId, id) {
  await pool.query(
    `UPDATE ops.offer_packet SET record_status = 'DELETED', modified_at = NOW()
     WHERE company_id = $1 AND offer_packet_id = $2`,
    [companyId, id]
  );
}

function mapOfferPacket(r) {
  const unitCost = Number(r.unit_cost ?? 0);
  const unitPrice = Number(r.unit_price ?? 0);
  const sellingPrice = Number(r.selling_price ?? 0);
  const marginPct = Number(r.margin_pct ?? 0);
  return {
    id: String(r.offer_packet_id),
    offerPacketId: Number(r.offer_packet_id),
    ownRefNo: r.own_ref_no ?? `OPL-${String(r.offer_packet_id).padStart(5, '0')}`,
    supplierRefNo: `SUP-${String(r.offer_packet_id).padStart(4, '0')}`,
    barcode: r.barcode ?? '',
    shortDescription: r.short_description ?? '',
    description: r.description ?? '',
    supplierName: r.supplier_name ?? '',
    productBrand: r.product_brand ?? '',
    pktDetails: r.pkt_details ?? '',
    pktQty: String(r.pkt_qty ?? 0),
    unitCost: unitCost.toFixed(2),
    lastPurchase: Number(r.last_purchase ?? 0).toFixed(2),
    unitPrice: unitPrice.toFixed(2),
    sellingPrice: sellingPrice.toFixed(2),
    productType: r.product_type ?? '',
    location: r.location_code ?? '',
    marginPct: marginPct.toFixed(2),
    profitPct: String(r.profit_pct ?? 0),
    remark: r.remark ?? '',
    groupName: r.group_name ?? '',
  };
}

function mapOfferPacketLine(r) {
  return {
    id: String(r.line_id),
    lineId: Number(r.line_id),
    barcode: r.barcode ?? '',
    shortDescription: r.short_description ?? '',
    unit: r.unit ?? '',
    unitCost: Number(r.unit_cost ?? 0).toFixed(2),
    unitPrice: Number(r.unit_price ?? 0).toFixed(2),
    qty: String(r.qty ?? 0),
    packetQty: String(r.packet_qty ?? 0),
    totalCost: Number(r.total_cost ?? 0).toFixed(2),
    totalPrice: Number(r.total_price ?? 0).toFixed(2),
  };
}

// ─── Offer Packing Entries ───────────────────────────────────────────────────

export async function listPackingEntries(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT packing_id, barcode, short_description, packing_details,
            unit_price, qty_on_hand, offer_qty, amount, created_at
     FROM ops.offer_packing_entry
     WHERE company_id = $1 AND branch_id = $2 AND record_status = 'ACTIVE'
     ORDER BY created_at DESC`,
    [companyId, branchId]
  );
  return rows.map(mapPackingEntry);
}

export async function insertPackingEntry(pool, companyId, branchId, params, createdBy) {
  const offerQty = n(params.offerQty);
  const unitPrice = n(params.unitPrice || params.rate);
  const amount = n(params.amount) || (offerQty * unitPrice);
  const { rows } = await pool.query(
    `INSERT INTO ops.offer_packing_entry
       (company_id, branch_id, barcode, short_description, packing_details,
        unit_price, qty_on_hand, offer_qty, amount, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      companyId, branchId,
      s(params.barcode), s(params.shortDescription), s(params.packingDetails || params.pktDetails),
      unitPrice, n(params.qtyOnHand || params.pktQty), offerQty,
      Number(amount).toFixed(4),
      s(createdBy),
    ]
  );
  return mapPackingEntry(rows[0]);
}

export async function updatePackingEntry(pool, companyId, id, params) {
  const offerQty = n(params.offerQty);
  const unitPrice = n(params.unitPrice || params.rate);
  const amount = n(params.amount) || (offerQty * unitPrice);
  const { rows } = await pool.query(
    `UPDATE ops.offer_packing_entry SET
       barcode = $3, short_description = $4, packing_details = $5,
       unit_price = $6, qty_on_hand = $7, offer_qty = $8, amount = $9
     WHERE company_id = $1 AND packing_id = $2 AND record_status = 'ACTIVE'
     RETURNING *`,
    [
      companyId, id,
      s(params.barcode), s(params.shortDescription), s(params.packingDetails || params.pktDetails),
      unitPrice, n(params.qtyOnHand || params.pktQty), offerQty, Number(amount).toFixed(4),
    ]
  );
  return rows[0] ? mapPackingEntry(rows[0]) : null;
}

export async function deletePackingEntry(pool, companyId, id) {
  await pool.query(
    `UPDATE ops.offer_packing_entry SET record_status = 'DELETED'
     WHERE company_id = $1 AND packing_id = $2`,
    [companyId, id]
  );
}

export async function deleteAllPackingEntries(pool, companyId, branchId) {
  await pool.query(
    `UPDATE ops.offer_packing_entry SET record_status = 'DELETED'
     WHERE company_id = $1 AND branch_id = $2 AND record_status = 'ACTIVE'`,
    [companyId, branchId]
  );
}

function mapPackingEntry(r) {
  const uPrice = Number(r.unit_price ?? 0);
  const oQty = Number(r.offer_qty ?? 0);
  return {
    id: String(r.packing_id),
    packingId: Number(r.packing_id),
    barcode: r.barcode ?? '',
    shortDescription: r.short_description ?? '',
    pktDetails: r.packing_details ?? '',
    packingDetails: r.packing_details ?? '',
    rate: uPrice.toFixed(2),
    unitPrice: uPrice.toFixed(2),
    pktQty: String(r.qty_on_hand ?? 0),
    qtyOnHand: String(r.qty_on_hand ?? 0),
    offerPackQty: '0',
    offerQty: String(oQty),
    amount: Number(r.amount ?? 0).toFixed(2),
  };
}

// ─── Offer Unpacking Entries ─────────────────────────────────────────────────

export async function listUnpackingEntries(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT unpacking_id, barcode, short_description, packing_details,
            unit_price, qty_on_hand, loose_qty, amount, created_at
     FROM ops.offer_unpacking_entry
     WHERE company_id = $1 AND branch_id = $2 AND record_status = 'ACTIVE'
     ORDER BY created_at DESC`,
    [companyId, branchId]
  );
  return rows.map(mapUnpackingEntry);
}

export async function insertUnpackingEntry(pool, companyId, branchId, params, createdBy) {
  const looseQty = n(params.looseQty || params.newQty);
  const unitPrice = n(params.unitPrice || params.rate);
  const amount = n(params.amount) || (looseQty * unitPrice);
  const { rows } = await pool.query(
    `INSERT INTO ops.offer_unpacking_entry
       (company_id, branch_id, barcode, short_description, packing_details,
        unit_price, qty_on_hand, loose_qty, amount, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      companyId, branchId,
      s(params.barcode), s(params.shortDescription), s(params.packingDetails || params.pktDetails),
      unitPrice, n(params.qtyOnHand || params.pktQty), looseQty,
      Number(amount).toFixed(4),
      s(createdBy),
    ]
  );
  return mapUnpackingEntry(rows[0]);
}

export async function updateUnpackingEntry(pool, companyId, id, params) {
  const looseQty = n(params.looseQty || params.newQty);
  const unitPrice = n(params.unitPrice || params.rate);
  const amount = n(params.amount) || (looseQty * unitPrice);
  const { rows } = await pool.query(
    `UPDATE ops.offer_unpacking_entry SET
       barcode = $3, short_description = $4, packing_details = $5,
       unit_price = $6, qty_on_hand = $7, loose_qty = $8, amount = $9
     WHERE company_id = $1 AND unpacking_id = $2 AND record_status = 'ACTIVE'
     RETURNING *`,
    [
      companyId, id,
      s(params.barcode), s(params.shortDescription), s(params.packingDetails || params.pktDetails),
      unitPrice, n(params.qtyOnHand || params.pktQty), looseQty, Number(amount).toFixed(4),
    ]
  );
  return rows[0] ? mapUnpackingEntry(rows[0]) : null;
}

export async function deleteUnpackingEntry(pool, companyId, id) {
  await pool.query(
    `UPDATE ops.offer_unpacking_entry SET record_status = 'DELETED'
     WHERE company_id = $1 AND unpacking_id = $2`,
    [companyId, id]
  );
}

export async function deleteAllUnpackingEntries(pool, companyId, branchId) {
  await pool.query(
    `UPDATE ops.offer_unpacking_entry SET record_status = 'DELETED'
     WHERE company_id = $1 AND branch_id = $2 AND record_status = 'ACTIVE'`,
    [companyId, branchId]
  );
}

function mapUnpackingEntry(r) {
  const uPrice = Number(r.unit_price ?? 0);
  return {
    id: String(r.unpacking_id),
    unpackingId: Number(r.unpacking_id),
    barcode: r.barcode ?? '',
    shortDescription: r.short_description ?? '',
    pktDetails: r.packing_details ?? '',
    packingDetails: r.packing_details ?? '',
    rate: uPrice.toFixed(2),
    unitPrice: uPrice.toFixed(2),
    pktQty: String(r.qty_on_hand ?? 0),
    qtyOnHand: String(r.qty_on_hand ?? 0),
    unpackQty: '0',
    looseQty: String(r.loose_qty ?? 0),
    amount: Number(r.amount ?? 0).toFixed(2),
  };
}
