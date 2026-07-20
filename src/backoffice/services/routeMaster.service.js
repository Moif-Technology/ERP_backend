import { withTransaction } from '../../config/db.js';
import * as routeRepo from '../repositories/routeMaster.repository.js';

function trim(v) {
  if (v == null) return '';
  return String(v).trim();
}

function authContext(authStaff) {
  return {
    companyId: Number(authStaff.company_id),
    branchId: authStaff.branch_id != null ? Number(authStaff.branch_id) : null,
    actor: String(authStaff.staff_id ?? 'system'),
  };
}

export async function listRoutes(pool, authStaff) {
  const { companyId } = authContext(authStaff);
  return routeRepo.listRoutes(pool, companyId);
}

export async function createRoute(pool, body, authStaff) {
  const { companyId, branchId, actor } = authContext(authStaff);

  const routeCode = trim(body.routeCode);
  if (!routeCode) {
    const err = new Error('routeCode is required');
    err.status = 400;
    throw err;
  }

  const routeName = trim(body.routeName);
  if (!routeName) {
    const err = new Error('routeName is required');
    err.status = 400;
    throw err;
  }

  const description = trim(body.description) || null;

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `ops.route_master:${companyId}`,
    ]);
    const routeId = await routeRepo.nextRouteId(client, companyId);
    return routeRepo.insertRoute(client, { companyId, branchId, routeId, routeCode, routeName, description, actor });
  });
}

export async function updateRoute(pool, routeId, body, authStaff) {
  const { companyId, actor } = authContext(authStaff);
  const id = Number(routeId);
  if (!Number.isFinite(id) || id < 1) {
    const err = new Error('Invalid routeId');
    err.status = 400;
    throw err;
  }

  const routeCode = trim(body.routeCode);
  if (!routeCode) {
    const err = new Error('routeCode is required');
    err.status = 400;
    throw err;
  }

  const routeName = trim(body.routeName);
  if (!routeName) {
    const err = new Error('routeName is required');
    err.status = 400;
    throw err;
  }

  const description = trim(body.description) || null;

  const existing = await routeRepo.findRoute(pool, companyId, id);
  if (!existing) {
    const err = new Error('Route not found');
    err.status = 404;
    throw err;
  }

  const updated = await routeRepo.updateRoute(pool, { companyId, routeId: id, routeCode, routeName, description, actor });
  if (!updated) {
    const err = new Error('Route not found');
    err.status = 404;
    throw err;
  }
  return updated;
}

export async function toggleRoute(pool, routeId, authStaff) {
  const { companyId, actor } = authContext(authStaff);
  const id = Number(routeId);
  if (!Number.isFinite(id) || id < 1) {
    const err = new Error('Invalid routeId');
    err.status = 400;
    throw err;
  }

  const existing = await routeRepo.findRoute(pool, companyId, id);
  if (!existing) {
    const err = new Error('Route not found');
    err.status = 404;
    throw err;
  }

  const updated = await routeRepo.toggleRouteActive(pool, companyId, id, !existing.isActive, actor);
  if (!updated) {
    const err = new Error('Route not found');
    err.status = 404;
    throw err;
  }
  return updated;
}

export async function listRouteCustomers(pool, routeId, authStaff) {
  const { companyId } = authContext(authStaff);
  const id = Number(routeId);
  if (!Number.isFinite(id) || id < 1) {
    const err = new Error('Invalid routeId');
    err.status = 400;
    throw err;
  }

  const existing = await routeRepo.findRoute(pool, companyId, id);
  if (!existing) {
    const err = new Error('Route not found');
    err.status = 404;
    throw err;
  }

  return routeRepo.listRouteCustomers(pool, companyId, id);
}

export async function setRouteCustomers(pool, routeId, body, authStaff) {
  const { companyId, actor } = authContext(authStaff);
  const id = Number(routeId);
  if (!Number.isFinite(id) || id < 1) {
    const err = new Error('Invalid routeId');
    err.status = 400;
    throw err;
  }

  const customerIds = body.customerIds;
  if (!Array.isArray(customerIds)) {
    const err = new Error('customerIds must be an array');
    err.status = 400;
    throw err;
  }

  const sanitized = customerIds.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n >= 1);

  return withTransaction(async (client) => {
    const existing = await routeRepo.findRoute(client, companyId, id);
    if (!existing) {
      const err = new Error('Route not found');
      err.status = 404;
      throw err;
    }
    return routeRepo.replaceRouteCustomers(client, companyId, id, sanitized, actor);
  });
}

export async function removeRouteCustomer(pool, routeId, customerId, authStaff) {
  const { companyId } = authContext(authStaff);
  const rid = Number(routeId);
  const cid = Number(customerId);
  if (!Number.isFinite(rid) || rid < 1) {
    const err = new Error('Invalid routeId');
    err.status = 400;
    throw err;
  }
  if (!Number.isFinite(cid) || cid < 1) {
    const err = new Error('Invalid customerId');
    err.status = 400;
    throw err;
  }

  const existing = await routeRepo.findRoute(pool, companyId, rid);
  if (!existing) {
    const err = new Error('Route not found');
    err.status = 404;
    throw err;
  }

  const deleted = await routeRepo.removeRouteCustomer(pool, companyId, rid, cid);
  if (!deleted) {
    const err = new Error('Customer not found on this route');
    err.status = 404;
    throw err;
  }
  return { routeId: rid, customerId: cid, removed: true };
}
