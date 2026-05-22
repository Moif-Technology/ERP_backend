import { withTransaction } from '../../config/db.js';
import {
  requireBranchId,
  requireCompanyId,
  toIntOrNull,
  toNumberOrNull,
  trimOrNull,
} from '../../utils/crmHelpers.js';
import * as repo from '../../repositories/garage/vehicleMaster.repository.js';

function toDateOrNull(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function toNonNegativeNumber(v, fallback = 0) {
  const n = toNumberOrNull(v);
  if (n == null) return fallback;
  if (n < 0) {
    const err = new Error('Numeric fields cannot be negative');
    err.status = 400;
    throw err;
  }
  return n;
}

function toNonNegativeInteger(v, fallback = 0) {
  const n = toIntOrNull(v);
  if (n == null) return fallback;
  if (n < 0) {
    const err = new Error('Warranty KM cannot be negative');
    err.status = 400;
    throw err;
  }
  return n;
}

function buildPayload(body) {
  return {
    regNo: String(body.regNo ?? '').trim().slice(0, 30),
    plateCode: trimOrNull(body.plateCode, 50),
    plateColor: trimOrNull(body.plateColor, 20),
    emirates: trimOrNull(body.emirates, 20),
    bodyColor: trimOrNull(body.bodyColor, 20),
    engineNo: trimOrNull(body.engineNo, 50),
    model: trimOrNull(body.model, 30),
    chassisNo: trimOrNull(body.chassisNo, 50),
    carCategory: trimOrNull(body.carCategory, 50),
    carGroupId: toIntOrNull(body.carGroup),
    carSubGroupId: toIntOrNull(body.carSubGroup),
    doorIgKey: trimOrNull(body.doorIgKey, 100),
    regDate: toDateOrNull(body.regDate),
    regExpOn: toDateOrNull(body.regExpOn),
    purchaseInvoiceNo: trimOrNull(body.purchaseInvoiceNo, 15),
    purchaseAmount: toNonNegativeNumber(body.purchaseAmount, 0),
    purchaseDate: toDateOrNull(body.purchaseDate),
    insuranceNo: trimOrNull(body.insuranceNo, 50),
    insuranceCompany: trimOrNull(body.insuranceCompany, 200),
    insuranceAmount: toNonNegativeNumber(body.insuranceAmount, 0),
    warrantyKm: toNonNegativeInteger(body.warrantyKm, 0),
    remarks: trimOrNull(body.remarks, 1500),
    warrantyPolicy: trimOrNull(body.warrantyPolicy, 500),
    customerId: toIntOrNull(body.customerId),
  };
}

function actorLabel(authStaff) {
  return trimOrNull(authStaff?.staff_name, 50) || trimOrNull(authStaff?.login_name, 50) || 'system';
}

export async function createVehicle(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const payload = buildPayload(body);
  const createdBy = actorLabel(authStaff);
  if (!payload.regNo) {
    const err = new Error('regNo is required');
    err.status = 400;
    throw err;
  }

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `garage.vehicle_master:${companyId}:${branchId}`,
    ]);
    const vehicleId = await repo.nextVehicleId(client, companyId, branchId);

    return repo.insertVehicle(client, {
      companyId,
      branchId,
      vehicleId,
      model: payload.model,
      regNo: payload.regNo,
      emirates: payload.emirates,
      plateColor: payload.plateColor,
      bodyColor: payload.bodyColor,
      chassisNo: payload.chassisNo,
      engineNo: payload.engineNo,
      plateCode: payload.plateCode,
      regDate: payload.regDate,
      regExpOn: payload.regExpOn,
      doorIgKey: payload.doorIgKey,
      remarks: payload.remarks,
      purchaseInvoiceNo: payload.purchaseInvoiceNo,
      purchaseAmount: payload.purchaseAmount,
      purchaseDate: payload.purchaseDate,
      insuranceNo: payload.insuranceNo,
      insuranceCompany: payload.insuranceCompany,
      insuranceAmount: payload.insuranceAmount,
      vehicleStatus: 'ACTIVE',
      warrantyPolicy: payload.warrantyPolicy,
      carCategory: payload.carCategory,
      serialNo: null,
      carGroupId: payload.carGroupId,
      carSubGroupId: payload.carSubGroupId,
      warrantyKm: payload.warrantyKm,
      imageUrl: null,
      syncStatus: 'pending',
      customerId: payload.customerId,
      createdBy,
    });
  });
}

export async function listVehicles(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, query);
  const search = trimOrNull(query.q, 120);
  return repo.listVehicles(pool, companyId, branchId, search);
}

export async function getVehicleById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, {});
  const vehicle = await repo.findVehicleById(pool, companyId, branchId, Number(id));
  if (!vehicle) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }
  return vehicle;
}

export async function updateVehicle(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const payload = buildPayload(body);
  const modifiedBy = actorLabel(authStaff);
  if (!payload.regNo) {
    const err = new Error('regNo is required');
    err.status = 400;
    throw err;
  }
  const updated = await repo.updateVehicle(pool, companyId, branchId, Number(id), {
    model: payload.model,
    regNo: payload.regNo,
    emirates: payload.emirates,
    plateColor: payload.plateColor,
    bodyColor: payload.bodyColor,
    chassisNo: payload.chassisNo,
    engineNo: payload.engineNo,
    plateCode: payload.plateCode,
    regDate: payload.regDate,
    regExpOn: payload.regExpOn,
    doorIgKey: payload.doorIgKey,
    remarks: payload.remarks,
    purchaseInvoiceNo: payload.purchaseInvoiceNo,
    purchaseAmount: payload.purchaseAmount,
    purchaseDate: payload.purchaseDate,
    insuranceNo: payload.insuranceNo,
    insuranceCompany: payload.insuranceCompany,
    insuranceAmount: payload.insuranceAmount,
    vehicleStatus: 'ACTIVE',
    warrantyPolicy: payload.warrantyPolicy,
    carCategory: payload.carCategory,
    serialNo: null,
    carGroupId: payload.carGroupId,
    carSubGroupId: payload.carSubGroupId,
    warrantyKm: payload.warrantyKm,
    imageUrl: null,
    syncStatus: 'pending',
    customerId: payload.customerId,
    modifiedBy,
  });
  if (!updated) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }
  return updated;
}
