function mapVehicleRow(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    branchId: Number(row.branch_id),
    vehicleId: Number(row.vehicle_id),
    model: row.model,
    regNo: row.registration_no,
    emirates: row.emirate,
    plateColor: row.plate_colour,
    bodyColor: row.body_colour,
    chassisNo: row.chassis_no,
    engineNo: row.engine_no,
    plateCode: row.plate_code,
    regDate: row.registration_date,
    regExpOn: row.expiry_date,
    doorIgKey: row.door_key,
    remarks: row.remarks,
    purchaseInvoiceNo: row.purchase_invoice_no,
    purchaseAmount: row.purchase_amount == null ? null : Number(row.purchase_amount),
    purchaseDate: row.purchase_date,
    insuranceNo: row.insurance_no,
    insuranceCompany: row.insurance_company,
    insuranceAmount: row.insurance_amount == null ? null : Number(row.insurance_amount),
    vehicleStatus: row.vehicle_status,
    warrantyPolicy: row.warranty_policy,
    carCategory: row.car_category,
    serialNo: row.serial_no == null ? null : Number(row.serial_no),
    carGroupId: row.car_group_id == null ? null : Number(row.car_group_id),
    carGroupName: row.car_group_name ?? null,
    carSubGroupId: row.car_subgroup_id == null ? null : Number(row.car_subgroup_id),
    carSubGroupName: row.car_sub_group_name ?? null,
    warrantyKm: row.warranty_km == null ? null : Number(row.warranty_km),
    imageUrl: row.image_url,
    customerId: row.customer_id == null ? null : Number(row.customer_id),
    linkedCustomerName: row.linked_customer_name ?? null,
    linkedCustomerCode: row.linked_customer_code ?? null,
    syncStatus: row.sync_status,
    createdAt: row.created_at,
    createdBy: row.created_by,
    modifiedAt: row.modified_at,
    modifiedBy: row.modified_by,
  };
}

export async function nextVehicleId(client, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(vehicle_id), 0) + 1 AS next_id
     FROM garage.vehicle_master
     WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId]
  );
  return Number(rows[0].next_id);
}

const vehicleSelectSql = `
  SELECT
    vm.*,
    cg.car_group_name,
    sg.car_sub_group_name,
    cm.customer_name AS linked_customer_name,
    cm.customer_code AS linked_customer_code
  FROM garage.vehicle_master vm
  LEFT JOIN garage.car_group cg
    ON cg.company_id = vm.company_id
   AND cg.car_group_id = vm.car_group_id
  LEFT JOIN garage.car_sub_group sg
    ON sg.company_id = vm.company_id
   AND sg.car_sub_group_id = vm.car_subgroup_id
  LEFT JOIN biz.customer_master cm
    ON cm.id = vm.customer_id
`;

export async function listVehicles(pool, companyId, branchId, search = null) {
  const params = [companyId, branchId];
  let whereSql = `WHERE vm.company_id = $1 AND vm.branch_id = $2`;

  if (search) {
    params.push(`%${search}%`);
    whereSql += `
      AND (
        vm.registration_no ILIKE $3
        OR COALESCE(vm.model, '') ILIKE $3
        OR COALESCE(vm.chassis_no, '') ILIKE $3
        OR COALESCE(vm.engine_no, '') ILIKE $3
        OR COALESCE(cg.car_group_name, '') ILIKE $3
        OR COALESCE(sg.car_sub_group_name, '') ILIKE $3
      )`;
  }

  const { rows } = await pool.query(
    `${vehicleSelectSql}
     ${whereSql}
     ORDER BY vm.created_at DESC, vm.vehicle_id DESC`,
    params
  );
  return rows.map(mapVehicleRow);
}

export async function findVehicleById(pool, companyId, branchId, id) {
  const { rows } = await pool.query(
    `${vehicleSelectSql}
     WHERE vm.company_id = $1
       AND vm.branch_id = $2
       AND vm.id = $3
     LIMIT 1`,
    [companyId, branchId, id]
  );
  return rows[0] ? mapVehicleRow(rows[0]) : null;
}

export async function insertVehicle(client, params) {
  const {
    companyId,
    branchId,
    vehicleId,
    model,
    regNo,
    emirates,
    plateColor,
    bodyColor,
    chassisNo,
    engineNo,
    plateCode,
    regDate,
    regExpOn,
    doorIgKey,
    remarks,
    purchaseInvoiceNo,
    purchaseAmount,
    purchaseDate,
    insuranceNo,
    insuranceCompany,
    insuranceAmount,
    vehicleStatus,
    warrantyPolicy,
    carCategory,
    serialNo,
    carGroupId,
    carSubGroupId,
    warrantyKm,
    imageUrl,
    syncStatus,
    customerId,
    createdBy,
  } = params;

  const { rows } = await client.query(
    `INSERT INTO garage.vehicle_master (
      company_id,
      branch_id,
      vehicle_id,
      model,
      registration_no,
      emirate,
      plate_colour,
      body_colour,
      chassis_no,
      engine_no,
      plate_code,
      registration_date,
      expiry_date,
      door_key,
      remarks,
      purchase_invoice_no,
      purchase_amount,
      purchase_date,
      insurance_no,
      insurance_company,
      insurance_amount,
      vehicle_status,
      warranty_policy,
      car_category,
      serial_no,
      car_group_id,
      car_subgroup_id,
      warranty_km,
      image_url,
      sync_status,
      created_by,
      modified_by,
      customer_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
      $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
      $31, $31, $32
    )
    RETURNING *`,
    [
      companyId,
      branchId,
      vehicleId,
      model,
      regNo,
      emirates,
      plateColor,
      bodyColor,
      chassisNo,
      engineNo,
      plateCode,
      regDate,
      regExpOn,
      doorIgKey,
      remarks,
      purchaseInvoiceNo,
      purchaseAmount,
      purchaseDate,
      insuranceNo,
      insuranceCompany,
      insuranceAmount,
      vehicleStatus,
      warrantyPolicy,
      carCategory,
      serialNo,
      carGroupId,
      carSubGroupId,
      warrantyKm,
      imageUrl,
      syncStatus,
      createdBy,
      customerId ?? null,
    ]
  );
  return mapVehicleRow(rows[0]);
}

export async function updateVehicle(pool, companyId, branchId, id, params) {
  const {
    model,
    regNo,
    emirates,
    plateColor,
    bodyColor,
    chassisNo,
    engineNo,
    plateCode,
    regDate,
    regExpOn,
    doorIgKey,
    remarks,
    purchaseInvoiceNo,
    purchaseAmount,
    purchaseDate,
    insuranceNo,
    insuranceCompany,
    insuranceAmount,
    vehicleStatus,
    warrantyPolicy,
    carCategory,
    serialNo,
    carGroupId,
    carSubGroupId,
    warrantyKm,
    imageUrl,
    syncStatus,
    customerId,
    modifiedBy,
  } = params;

  const { rows } = await pool.query(
    `WITH updated AS (
       UPDATE garage.vehicle_master
       SET
         model = $4,
         registration_no = $5,
         emirate = $6,
         plate_colour = $7,
         body_colour = $8,
         chassis_no = $9,
         engine_no = $10,
         plate_code = $11,
         registration_date = $12,
         expiry_date = $13,
         door_key = $14,
         remarks = $15,
         purchase_invoice_no = $16,
         purchase_amount = $17,
         purchase_date = $18,
         insurance_no = $19,
         insurance_company = $20,
         insurance_amount = $21,
         vehicle_status = $22,
         warranty_policy = $23,
         car_category = $24,
         serial_no = $25,
         car_group_id = $26,
         car_subgroup_id = $27,
         warranty_km = $28,
         image_url = $29,
         sync_status = $30,
         customer_id = $32,
         modified_at = CURRENT_TIMESTAMP,
         modified_by = $31
       WHERE company_id = $1
         AND branch_id = $2
         AND id = $3
       RETURNING *
     )
     SELECT
       updated.*,
       cg.car_group_name,
       sg.car_sub_group_name,
       cm.customer_name AS linked_customer_name,
       cm.customer_code AS linked_customer_code
     FROM updated
     LEFT JOIN garage.car_group cg
       ON cg.company_id = updated.company_id
      AND cg.car_group_id = updated.car_group_id
     LEFT JOIN garage.car_sub_group sg
       ON sg.company_id = updated.company_id
      AND sg.car_sub_group_id = updated.car_subgroup_id
     LEFT JOIN biz.customer_master cm
       ON cm.id = updated.customer_id`,
    [
      companyId,
      branchId,
      id,
      model,
      regNo,
      emirates,
      plateColor,
      bodyColor,
      chassisNo,
      engineNo,
      plateCode,
      regDate,
      regExpOn,
      doorIgKey,
      remarks,
      purchaseInvoiceNo,
      purchaseAmount,
      purchaseDate,
      insuranceNo,
      insuranceCompany,
      insuranceAmount,
      vehicleStatus,
      warrantyPolicy,
      carCategory,
      serialNo,
      carGroupId,
      carSubGroupId,
      warrantyKm,
      imageUrl,
      syncStatus,
      modifiedBy,
      customerId ?? null,
    ]
  );
  return rows[0] ? mapVehicleRow(rows[0]) : null;
}
