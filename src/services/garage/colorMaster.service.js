import { withTransaction } from '../../config/db.js';
import * as repo from '../../repositories/garage/colorMaster.repository.js';

export async function listColors(pool, authStaff) {
  const companyId = Number(authStaff.company_id);
  return repo.listColors(pool, companyId);
}

export async function createColor(pool, body, authStaff) {
  const companyId = Number(authStaff.company_id);

  const colorName = String(body.colorName ?? '').trim();
  if (!colorName) {
    const err = new Error('colorName is required');
    err.status = 400;
    throw err;
  }

  const colorCode = body.colorCode ? String(body.colorCode).trim().slice(0, 50) : null;

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `garage.color_master:${companyId}`,
    ]);
    const colorId = await repo.nextColorId(client, companyId);
    return repo.insertColor(client, { colorId, companyId, colorCode, colorName: colorName.slice(0, 100) });
  });
}

export async function deleteColor(pool, authStaff, colorId) {
  const companyId = Number(authStaff.company_id);
  const id = Number(colorId);
  if (!Number.isFinite(id) || id < 1) {
    const err = new Error('Invalid colorId');
    err.status = 400;
    throw err;
  }
  const deleted = await repo.deleteColor(pool, companyId, id);
  if (!deleted) {
    const err = new Error('Color not found');
    err.status = 404;
    throw err;
  }
}
