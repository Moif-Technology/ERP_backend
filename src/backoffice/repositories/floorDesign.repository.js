/**
 * core.area_floor_shape / area_table_layout / area_floor_border_point
 * (legacy AreaFloorShape, AreaTableLayout, AreaFloorBorderPoint).
 */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapBorder(row) {
  return {
    sequenceNo: num(row.sequence_no),
    posXPercent: num(row.pos_x_percent),
    posYPercent: num(row.pos_y_percent),
  };
}

function mapShape(row) {
  return {
    shapeType: String(row.shape_type || '').toUpperCase(),
    posXPercent: num(row.pos_x_percent),
    posYPercent: num(row.pos_y_percent),
    widthPercent: num(row.width_percent),
    heightPercent: num(row.height_percent),
    backColorArgb: row.back_color_argb == null ? null : num(row.back_color_argb),
    borderColorArgb: row.border_color_argb == null ? null : num(row.border_color_argb),
    displayText: row.display_text == null ? '' : String(row.display_text),
    fontSize: row.font_size == null ? null : num(row.font_size),
  };
}

function mapLayout(row) {
  return {
    tableId: num(row.table_id),
    posXPercent: num(row.pos_x_percent),
    posYPercent: num(row.pos_y_percent),
    widthPercent: row.width_percent == null ? 0 : num(row.width_percent),
    heightPercent: row.height_percent == null ? 0 : num(row.height_percent),
    rotationDeg: row.rotation_deg == null ? 0 : num(row.rotation_deg),
  };
}

export async function listBorderPoints(db, companyId, branchId, areaId) {
  const { rows } = await db.query(
    `SELECT sequence_no, pos_x_percent, pos_y_percent
       FROM core.area_floor_border_point
      WHERE company_id = $1 AND branch_id = $2 AND area_id = $3
      ORDER BY sequence_no`,
    [companyId, branchId, areaId],
  );
  return rows.map(mapBorder);
}

export async function listShapes(db, companyId, branchId, areaId) {
  const { rows } = await db.query(
    `SELECT shape_type, pos_x_percent, pos_y_percent,
            width_percent, height_percent,
            back_color_argb, border_color_argb, display_text, font_size
       FROM core.area_floor_shape
      WHERE company_id = $1 AND branch_id = $2 AND area_id = $3
      ORDER BY id`,
    [companyId, branchId, areaId],
  );
  return rows.map(mapShape);
}

export async function listTableLayouts(db, companyId, branchId, areaId) {
  const { rows } = await db.query(
    `SELECT table_id, pos_x_percent, pos_y_percent,
            width_percent, height_percent, rotation_deg
       FROM core.area_table_layout
      WHERE company_id = $1 AND branch_id = $2 AND area_id = $3`,
    [companyId, branchId, areaId],
  );
  return rows.map(mapLayout);
}

export async function deleteLayout(client, companyId, branchId, areaId) {
  await client.query(
    `DELETE FROM core.area_floor_border_point
      WHERE company_id = $1 AND branch_id = $2 AND area_id = $3`,
    [companyId, branchId, areaId],
  );
  await client.query(
    `DELETE FROM core.area_floor_shape
      WHERE company_id = $1 AND branch_id = $2 AND area_id = $3`,
    [companyId, branchId, areaId],
  );
  await client.query(
    `DELETE FROM core.area_table_layout
      WHERE company_id = $1 AND branch_id = $2 AND area_id = $3`,
    [companyId, branchId, areaId],
  );
}

export async function insertBorderPoint(client, params) {
  const { companyId, branchId, areaId, sequenceNo, posXPercent, posYPercent } = params;
  await client.query(
    `INSERT INTO core.area_floor_border_point
        (company_id, branch_id, area_id, sequence_no, pos_x_percent, pos_y_percent, sync_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')`,
    [companyId, branchId, areaId, sequenceNo, posXPercent, posYPercent],
  );
}

export async function insertShape(client, params) {
  const {
    companyId,
    branchId,
    areaId,
    shapeType,
    posXPercent,
    posYPercent,
    widthPercent,
    heightPercent,
    backColorArgb,
    borderColorArgb,
    displayText,
    fontSize,
  } = params;
  await client.query(
    `INSERT INTO core.area_floor_shape (
        company_id, branch_id, area_id, shape_type,
        pos_x_percent, pos_y_percent, width_percent, height_percent,
        back_color_argb, border_color_argb, display_text, font_size, sync_status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'PENDING'
      )`,
    [
      companyId,
      branchId,
      areaId,
      shapeType,
      posXPercent,
      posYPercent,
      widthPercent,
      heightPercent,
      backColorArgb,
      borderColorArgb,
      displayText,
      fontSize,
    ],
  );
}

export async function insertTableLayout(client, params) {
  const {
    companyId,
    branchId,
    areaId,
    tableId,
    posXPercent,
    posYPercent,
    widthPercent,
    heightPercent,
    rotationDeg,
  } = params;
  await client.query(
    `INSERT INTO core.area_table_layout (
        company_id, branch_id, area_id, table_id,
        pos_x_percent, pos_y_percent, width_percent, height_percent,
        rotation_deg, sync_status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING'
      )`,
    [
      companyId,
      branchId,
      areaId,
      tableId,
      posXPercent,
      posYPercent,
      widthPercent,
      heightPercent,
      rotationDeg ?? 0,
    ],
  );
}
