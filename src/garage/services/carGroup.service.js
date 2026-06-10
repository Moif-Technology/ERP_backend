import { withTransaction } from '../../config/db.js';
import * as repo from '../repositories/carGroup.repository.js';

export async function listCarGroups(pool, authStaff) {
  const companyId = Number(authStaff.company_id);
  return repo.listCarGroups(pool, companyId);
}

export async function createCarGroup(pool, body, authStaff) {
  const companyId   = Number(authStaff.company_id);
  const carGroupName = String(body.carGroupName ?? '').trim();
  if (!carGroupName) {
    const err = new Error('carGroupName is required');
    err.status = 400;
    throw err;
  }
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `garage.car_group:${companyId}`,
    ]);
    const carGroupId = await repo.nextCarGroupId(client, companyId);
    return repo.insertCarGroup(client, {
      carGroupId,
      companyId,
      carGroupName: carGroupName.slice(0, 50),
    });
  });
}

export async function deleteCarGroup(pool, authStaff, carGroupId) {
  const companyId = Number(authStaff.company_id);
  const id = Number(carGroupId);
  if (!Number.isFinite(id) || id < 1) {
    const err = new Error('Invalid carGroupId');
    err.status = 400;
    throw err;
  }
  const deleted = await repo.deleteCarGroup(pool, companyId, id);
  if (!deleted) {
    const err = new Error('Car group not found');
    err.status = 404;
    throw err;
  }
}
