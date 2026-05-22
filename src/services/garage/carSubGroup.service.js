import { withTransaction } from '../../config/db.js';
import * as repo from '../../repositories/garage/carSubGroup.repository.js';

export async function listCarSubGroups(pool, authStaff, carGroupId) {
  const companyId = Number(authStaff.company_id);
  const gid = carGroupId ? Number(carGroupId) : null;
  return repo.listCarSubGroups(pool, companyId, gid);
}

export async function createCarSubGroup(pool, body, authStaff) {
  const companyId      = Number(authStaff.company_id);
  const carSubGroupName = String(body.carSubGroupName ?? '').trim();
  if (!carSubGroupName) {
    const err = new Error('carSubGroupName is required');
    err.status = 400;
    throw err;
  }
  const carGroupId = Number(body.carGroupId);
  if (!Number.isFinite(carGroupId) || carGroupId < 1) {
    const err = new Error('carGroupId is required');
    err.status = 400;
    throw err;
  }
  const exists = await repo.carGroupExists(pool, companyId, carGroupId);
  if (!exists) {
    const err = new Error('Car group not found');
    err.status = 404;
    throw err;
  }
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `garage.car_sub_group:${companyId}`,
    ]);
    const carSubGroupId = await repo.nextCarSubGroupId(client, companyId);
    return repo.insertCarSubGroup(client, {
      carSubGroupId,
      companyId,
      carGroupId,
      carSubGroupName: carSubGroupName.slice(0, 50),
    });
  });
}

export async function deleteCarSubGroup(pool, authStaff, carSubGroupId) {
  const companyId = Number(authStaff.company_id);
  const id = Number(carSubGroupId);
  if (!Number.isFinite(id) || id < 1) {
    const err = new Error('Invalid carSubGroupId');
    err.status = 400;
    throw err;
  }
  const deleted = await repo.deleteCarSubGroup(pool, companyId, id);
  if (!deleted) {
    const err = new Error('Car sub group not found');
    err.status = 404;
    throw err;
  }
}
