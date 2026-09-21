import { withTransaction } from '../../config/db.js';
import * as areaRepo from '../repositories/area.repository.js';
import * as tableRepo from '../repositories/table.repository.js';
import * as floorRepo from '../repositories/floorDesign.repository.js';
import { resolveMasterBranchId } from '../../shared/locationScope.js';

function bad(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function parsePosInt(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.trunc(n);
}

function parsePct(raw, fallback = 0) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

function parsePctSize(raw, fallback = 0) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(0.5, Math.min(100, n));
}

/** TableFloorDesignerFrm.IsPointInsideBorder — ray-cast, no border => allow. */
export function isPointInsideBorder(p, points) {
  if (!Array.isArray(points) || points.length < 3) return true;
  let inside = false;
  let j = points.length - 1;
  for (let i = 0; i < points.length; i += 1) {
    const pi = points[i];
    const pj = points[j];
    const intersects =
      pi.y > p.y !== pj.y > p.y &&
      p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y + 0.00001) + pi.x;
    if (intersects) inside = !inside;
    j = i;
  }
  return inside;
}

async function masterBranchId(pool, authStaff) {
  const companyId = Number(authStaff.company_id);
  const branchId = await resolveMasterBranchId(pool, companyId, authStaff);
  if (branchId == null) throw bad('stationId is required');
  return { companyId, branchId };
}

function gridFallback(index, countHint = 6) {
  const col = index % 6;
  const row = Math.floor(index / 6);
  const w = 6.67;
  const h = 8.57;
  return {
    posXPercent: 1.67 + col * (w + 1),
    posYPercent: 2.86 + row * (h + 1.7),
    widthPercent: w,
    heightPercent: h,
    _unused: countHint,
  };
}

export async function getFloorDesign(pool, areaIdRaw, authStaff) {
  const areaId = parsePosInt(areaIdRaw);
  if (areaId == null) throw bad('Select Area first.');
  const { companyId, branchId } = await masterBranchId(pool, authStaff);

  const area = await areaRepo.findArea(pool, companyId, branchId, areaId);
  if (!area) throw bad('Invalid Area...', 404);
  if (Number(area.tableCreationType) !== 0) {
    throw bad('Select a Manual table area.');
  }

  const [border, shapes, layouts, tables] = await Promise.all([
    floorRepo.listBorderPoints(pool, companyId, branchId, areaId),
    floorRepo.listShapes(pool, companyId, branchId, areaId),
    floorRepo.listTableLayouts(pool, companyId, branchId, areaId),
    tableRepo.listTablesByArea(pool, companyId, branchId, areaId),
  ]);

  const layoutById = new Map(layouts.map((l) => [l.tableId, l]));
  const placed = tables.map((t, idx) => {
    const lay = layoutById.get(t.tableId);
    if (lay) {
      return {
        tableId: t.tableId,
        tableName: t.tableName,
        tableNo: t.tableNo,
        noOfChairs: t.noOfChairs,
        tableFormat: t.tableFormat || 'SQUARE',
        posXPercent: lay.posXPercent,
        posYPercent: lay.posYPercent,
        widthPercent: lay.widthPercent,
        heightPercent: lay.heightPercent,
        rotationDeg: lay.rotationDeg,
        hasLayout: true,
      };
    }
    const g = gridFallback(idx);
    return {
      tableId: t.tableId,
      tableName: t.tableName,
      tableNo: t.tableNo,
      noOfChairs: t.noOfChairs,
      tableFormat: t.tableFormat || 'SQUARE',
      posXPercent: g.posXPercent,
      posYPercent: g.posYPercent,
      widthPercent: g.widthPercent,
      heightPercent: g.heightPercent,
      rotationDeg: 0,
      hasLayout: false,
    };
  });

  return {
    areaId,
    areaName: area.areaName,
    hasFloor: layouts.length > 0 || border.length > 0,
    borderClosed: border.length >= 3,
    border,
    shapes,
    tables: placed,
  };
}

export async function saveFloorDesign(pool, areaIdRaw, body, authStaff) {
  const areaId = parsePosInt(areaIdRaw);
  if (areaId == null) throw bad('Select Area first.');
  const { companyId, branchId } = await masterBranchId(pool, authStaff);

  const area = await areaRepo.findArea(pool, companyId, branchId, areaId);
  if (!area) throw bad('Invalid Area...', 404);
  if (Number(area.tableCreationType) !== 0) {
    throw bad('Select a Manual table area.');
  }

  const borderIn = Array.isArray(body?.border) ? body.border : [];
  const border = borderIn.map((pt) => ({
    x: parsePct(pt.posXPercent ?? pt.x),
    y: parsePct(pt.posYPercent ?? pt.y),
  }));

  if (border.length < 3 || body?.borderClosed === false) {
    throw bad(
      'Please complete the floor border.\nClick again near the starting point to close the loop.',
    );
  }

  const masterTables = await tableRepo.listTablesByArea(pool, companyId, branchId, areaId);
  const masterById = new Map(masterTables.map((t) => [t.tableId, t]));

  const tablesIn = Array.isArray(body?.tables) ? body.tables : [];
  const tables = tablesIn.map((t) => {
    const tableId = parsePosInt(t.tableId ?? t.TableID);
    if (tableId == null) throw bad('Invalid table on floor.');
    const master = masterById.get(tableId);
    if (!master) throw bad('Invalid table on floor.');
    const w = parsePctSize(t.widthPercent ?? t.w, 6.67);
    const h = parsePctSize(t.heightPercent ?? t.h, 8.57);
    const x = parsePct(t.posXPercent ?? t.x);
    const y = parsePct(t.posYPercent ?? t.y);
    return {
      tableId,
      tableName: master.tableName,
      x,
      y,
      w,
      h,
      rotationDeg: Number.isFinite(Number(t.rotationDeg)) ? Math.trunc(Number(t.rotationDeg)) : 0,
    };
  });

  const seen = new Set();
  for (const t of tables) {
    if (seen.has(t.tableId)) throw bad('Duplicate table on floor.');
    seen.add(t.tableId);
  }
  for (const master of masterTables) {
    if (!seen.has(master.tableId)) {
      throw bad(`Table ${master.tableName} is missing from the floor.`);
    }
  }

  const outside = [];
  for (const t of tables) {
    const center = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
    if (!isPointInsideBorder(center, border)) outside.push(t.tableName);
  }
  if (outside.length) {
    throw bad(
      `These tables are outside the floor boundary:\n${outside.join(', ')}\nPlease move them inside the border before saving.`,
    );
  }

  const shapesIn = Array.isArray(body?.shapes) ? body.shapes : [];
  const shapes = shapesIn.map((s) => {
    const shapeType = String(s.shapeType ?? s.type ?? 'ZONE')
      .trim()
      .toUpperCase()
      .slice(0, 20);
    if (!shapeType) throw bad('Invalid floor shape.');
    const textRaw = s.displayText ?? s.text;
    return {
      shapeType,
      x: parsePct(s.posXPercent ?? s.x),
      y: parsePct(s.posYPercent ?? s.y),
      w: parsePctSize(s.widthPercent ?? s.w, 8),
      h: parsePctSize(s.heightPercent ?? s.h, 4),
      backColorArgb:
        s.backColorArgb == null || s.backColorArgb === ''
          ? null
          : Math.trunc(Number(s.backColorArgb)),
      borderColorArgb:
        s.borderColorArgb == null || s.borderColorArgb === ''
          ? null
          : Math.trunc(Number(s.borderColorArgb)),
      displayText:
        textRaw == null || String(textRaw).trim() === ''
          ? null
          : String(textRaw).trim().slice(0, 100),
      fontSize: s.fontSize == null || s.fontSize === '' ? null : Number(s.fontSize),
    };
  });

  await withTransaction(async (client) => {
    await floorRepo.deleteLayout(client, companyId, branchId, areaId);
    let seq = 1;
    for (const pt of border) {
      await floorRepo.insertBorderPoint(client, {
        companyId,
        branchId,
        areaId,
        sequenceNo: seq,
        posXPercent: pt.x,
        posYPercent: pt.y,
      });
      seq += 1;
    }
    for (const s of shapes) {
      await floorRepo.insertShape(client, {
        companyId,
        branchId,
        areaId,
        shapeType: s.shapeType,
        posXPercent: s.x,
        posYPercent: s.y,
        widthPercent: s.w,
        heightPercent: s.h,
        backColorArgb: Number.isFinite(s.backColorArgb) ? s.backColorArgb : null,
        borderColorArgb: Number.isFinite(s.borderColorArgb) ? s.borderColorArgb : null,
        displayText: s.displayText,
        fontSize: Number.isFinite(s.fontSize) ? s.fontSize : null,
      });
    }
    for (const t of tables) {
      await floorRepo.insertTableLayout(client, {
        companyId,
        branchId,
        areaId,
        tableId: t.tableId,
        posXPercent: t.x,
        posYPercent: t.y,
        widthPercent: t.w,
        heightPercent: t.h,
        rotationDeg: t.rotationDeg,
      });
    }
  });

  return { ok: true, areaId, message: 'Floor border and tables saved successfully.' };
}
