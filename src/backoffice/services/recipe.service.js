import { withTransaction } from '../../config/db.js';
import { resolveGvTaxRate } from '../repositories/appParameter.repository.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as repo from '../repositories/recipe.repository.js';
import {
  enteredQtyFromStored,
  formatQty,
  recipeLineAmounts,
  roundMoney,
} from '../lib/recipeCost.js';

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function scope(authStaff) {
  const companyId = Number(authStaff.company_id);
  const branchId = Number(authStaff.branch_id);
  if (!companyId) fail('Company is required', 400);
  if (!branchId) fail('Branch is required', 400);
  const userName = String(authStaff.staff_name || authStaff.login_name || '').slice(0, 50) || null;
  const staffId = Number(authStaff.staff_id);
  return { companyId, branchId, userName, staffId: Number.isFinite(staffId) ? staffId : null };
}

function mapProduct(row) {
  return {
    productId: Number(row.product_id),
    productCode: row.product_code,
    barcode: row.barcode || '',
    productName: row.product_name || '',
    shortName: row.short_name || '',
    productType: row.product_type || '',
    packQty: row.pack_qty != null ? Number(row.pack_qty) : 1,
    packDescription: row.pack_description || '',
    unitName: row.unit_name || '',
    averageCost: row.average_cost != null ? Number(row.average_cost) : 0,
    uniqueId: row.unique_multi_product_id != null
      ? Number(row.unique_multi_product_id)
      : Number(row.product_id),
  };
}

function isRawMaterial(productType) {
  return String(productType || '').trim().toUpperCase() === 'RAW MATERIAL';
}

function isNormal(productType) {
  return String(productType || '').trim().toUpperCase() === 'NORMAL';
}

export async function searchProducts(pool, authStaff, query) {
  const { companyId, branchId } = scope(authStaff);
  const role = ['finished', 'raw', 'ingredient'].includes(query.role) ? query.role : 'ingredient';
  const barcode = String(query.barcode ?? '').trim();
  const search = String(query.q ?? query.search ?? '').trim();
  const exact = String(query.mode ?? '').toLowerCase() === 'exact';
  if (!barcode && !search && exact) return [];
  const rows = await repo.searchProducts(pool, {
    companyId, branchId, role, barcode: barcode || null, search: search || null, exact,
  });
  return rows.map(mapProduct);
}

export async function listRecipes(pool, authStaff, query) {
  const { companyId, branchId } = scope(authStaff);
  const rows = await repo.listRecipes(pool, companyId, branchId, {
    search: String(query.q ?? query.search ?? '').trim() || null,
    barcode: String(query.barcode ?? '').trim() || null,
  });
  return rows.map((row) => ({
    finishedProductId: Number(row.product_id),
    barcode: row.barcode || '',
    productName: row.product_name || '',
    shortName: row.short_name || '',
    productType: row.product_type || '',
    lineCount: Number(row.line_count) || 0,
    unitCostTotal: roundMoney(row.unit_cost_total),
    remarks: row.remarks || '',
    modifiedAt: row.modified_at,
  }));
}

function mapLine(row) {
  const unit = String(row.unit_name || 'PCS').toUpperCase();
  const storedQty = Number(row.recipe_qty) || 0;
  const enteredQty = enteredQtyFromStored(storedQty, unit);
  return {
    rawProductId: Number(row.raw_material_id),
    rawUniqueId: row.raw_material_unique_id != null ? Number(row.raw_material_unique_id) : Number(row.raw_material_id),
    barcode: row.barcode || '',
    productName: row.short_name || row.product_name || '',
    packDescription: row.pack_description || '',
    packQty: row.pack_qty != null ? Number(row.pack_qty) : 1,
    unit,
    storedQty,
    enteredQty,
    qtyDisplay: `${formatQty(enteredQty)}(${unit})`,
    lineCost: roundMoney(row.raw_material_cost),
  };
}

export async function getRecipe(pool, authStaff, finishedProductId) {
  const { companyId, branchId } = scope(authStaff);
  const productId = Number(finishedProductId);
  if (!productId) fail('Select finished product');
  const finished = await repo.getProductForRecipe(pool, companyId, branchId, productId);
  if (!finished) fail('Finished product not found', 404);
  if (isRawMaterial(finished.product_type)) fail('Finished product cannot be a raw material');
  const lines = await repo.listRecipeLines(pool, companyId, branchId, productId);
  const remarks = lines.length ? (lines[lines.length - 1].remarks || '') : '';
  const unitCostTotal = roundMoney(lines.reduce((sum, row) => sum + Number(row.raw_material_cost || 0), 0));
  return {
    finishedProductId: productId,
    finishedUniqueId: finished.unique_multi_product_id != null
      ? Number(finished.unique_multi_product_id)
      : productId,
    barcode: finished.barcode || '',
    productName: finished.product_name || '',
    shortName: finished.short_name || '',
    productType: finished.product_type || '',
    remarks,
    unitCostTotal,
    lines: lines.map(mapLine),
  };
}

export async function saveRecipe(pool, authStaff, finishedProductId, body) {
  const { companyId, branchId, userName, staffId } = scope(authStaff);
  const productId = Number(finishedProductId || body.finishedProductId);
  if (!productId) fail('Select finished product');
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length === 0) fail('Add at least one raw material');
  const remarks = String(body.remarks ?? '').trim().slice(0, 200);

  const ok = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!ok) fail('Invalid branch for this company');

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `core.recipe_detail:${companyId}`,
    ]);

    const finished = await repo.getProductForRecipe(client, companyId, branchId, productId);
    if (!finished) fail('Finished product not found', 404);
    if (isRawMaterial(finished.product_type)) fail('Finished product cannot be a raw material');

    const prepared = [];
    for (const line of lines) {
      const rawId = Number(line.rawProductId ?? line.rawMaterialId);
      if (!rawId) fail('Select an item');
      if (rawId === productId) fail('Finished product cannot be added as its own raw material');
      const raw = await repo.getProductForRecipe(client, companyId, branchId, rawId);
      if (!raw) fail('Item not found');
      if (isNormal(raw.product_type)) fail('Normal items cannot be used as recipe raw material');
      const amounts = recipeLineAmounts(raw.average_cost, line.enteredQty ?? line.qty, line.unit);
      const sentCost = line.lineCost != null && line.lineCost !== '' ? Number(line.lineCost) : null;
      const lineCost = sentCost != null && Number.isFinite(sentCost)
        ? sentCost
        : amounts.lineCost;
      prepared.push({
        raw,
        storedQty: Number(amounts.storedQty.toFixed(10)),
        unit: amounts.unit,
        lineCost: roundMoney(lineCost),
      });
    }

    await repo.deleteRecipeLines(client, companyId, branchId, productId);

    let nextId = await repo.nextRecipeDetailId(client, companyId);
    const finishedUniqueId = finished.unique_multi_product_id != null
      ? Number(finished.unique_multi_product_id)
      : productId;

    for (const line of prepared) {
      const rawUniqueId = line.raw.unique_multi_product_id != null
        ? Number(line.raw.unique_multi_product_id)
        : Number(line.raw.product_id);
      await repo.insertRecipeLine(client, {
        companyId,
        branchId,
        recipeDetailId: nextId,
        finishedProductId: productId,
        finishedProductUniqueId: finishedUniqueId,
        rawMaterialId: Number(line.raw.product_id),
        rawMaterialUniqueId: rawUniqueId,
        recipeQty: line.storedQty,
        unitName: line.unit,
        remarks,
        rawMaterialCost: line.lineCost,
        staffId,
      });
      nextId += 1;
    }

    const unitCostTotal = roundMoney(prepared.reduce((sum, line) => sum + line.lineCost, 0));
    const taxRate = Number(await resolveGvTaxRate(client, companyId, branchId)) || 0;
    const inputTaxAmount = roundMoney(unitCostTotal * (taxRate / 100));
    const updated = await repo.updateFinishedProductCost(client, {
      companyId,
      branchId,
      productId,
      unitCost: unitCostTotal,
      inputTaxAmount,
      inputTaxRate: taxRate,
      userName,
    });
    if (!updated) fail('Not done properly at last purchase cost');
    await repo.updateSupplierCost(client, {
      companyId, branchId, productId, unitCost: unitCostTotal, staffId,
    });

    return {
      finishedProductId: productId,
      unitCostTotal,
      inputTaxAmount,
      inputTaxRate: taxRate,
      lineCount: prepared.length,
    };
  });
}

export async function deleteRecipe(pool, authStaff, finishedProductId) {
  const { companyId, branchId } = scope(authStaff);
  const productId = Number(finishedProductId);
  if (!productId) fail('Select finished product');
  const removed = await repo.deleteRecipeLines(pool, companyId, branchId, productId);
  if (!removed) fail('Recipe not found', 404);
  return { finishedProductId: productId, removed };
}
