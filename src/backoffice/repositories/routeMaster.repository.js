/**
 * Data access for ops.route_master and ops.route_customer (company scoped).
 */

export async function nextRouteId(db, companyId) {
  const { rows } = await db.query(
    `SELECT COALESCE(MAX(route_id), 0) + 1 AS next_id
     FROM ops.route_master
     WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].next_id);
}

export async function listRoutes(db, companyId) {
  const { rows } = await db.query(
    `SELECT id, company_id, branch_id, route_id, route_code, route_name, description,
            is_active, created_at, created_by, modified_at, modified_by
     FROM ops.route_master
     WHERE company_id = $1
     ORDER BY route_id ASC`,
    [companyId]
  );
  return rows.map(mapRouteRow);
}

export async function findRoute(db, companyId, routeId) {
  const { rows } = await db.query(
    `SELECT id, company_id, branch_id, route_id, route_code, route_name, description,
            is_active, created_at, created_by, modified_at, modified_by
     FROM ops.route_master
     WHERE company_id = $1 AND route_id = $2
     LIMIT 1`,
    [companyId, routeId]
  );
  if (!rows[0]) return null;
  return mapRouteRow(rows[0]);
}

export async function insertRoute(db, params) {
  const { companyId, branchId, routeId, routeCode, routeName, description, actor } = params;
  const { rows } = await db.query(
    `INSERT INTO ops.route_master
       (company_id, branch_id, route_id, route_code, route_name, description,
        is_active, created_at, created_by, modified_at, modified_by)
     VALUES ($1, $2, $3, $4, $5, $6,
             TRUE, NOW(), $7, NOW(), $7)
     RETURNING id, company_id, branch_id, route_id, route_code, route_name, description,
               is_active, created_at, created_by, modified_at, modified_by`,
    [companyId, branchId, routeId, routeCode, routeName, description ?? null, actor]
  );
  return mapRouteRow(rows[0]);
}

export async function updateRoute(db, params) {
  const { companyId, routeId, routeCode, routeName, description, actor } = params;
  const { rows } = await db.query(
    `UPDATE ops.route_master
     SET route_code = $3, route_name = $4, description = $5,
         modified_at = NOW(), modified_by = $6
     WHERE company_id = $1 AND route_id = $2
     RETURNING id, company_id, branch_id, route_id, route_code, route_name, description,
               is_active, created_at, created_by, modified_at, modified_by`,
    [companyId, routeId, routeCode, routeName, description ?? null, actor]
  );
  if (!rows[0]) return null;
  return mapRouteRow(rows[0]);
}

export async function toggleRouteActive(db, companyId, routeId, isActive, actor) {
  const { rows } = await db.query(
    `UPDATE ops.route_master
     SET is_active = $3, modified_at = NOW(), modified_by = $4
     WHERE company_id = $1 AND route_id = $2
     RETURNING id, company_id, branch_id, route_id, route_code, route_name, description,
               is_active, created_at, created_by, modified_at, modified_by`,
    [companyId, routeId, isActive, actor]
  );
  if (!rows[0]) return null;
  return mapRouteRow(rows[0]);
}

export async function listRouteCustomers(db, companyId, routeId) {
  const { rows } = await db.query(
    `SELECT rc.id, rc.company_id, rc.route_id, rc.customer_id, rc.sort_order,
            rc.created_at, rc.created_by,
            cm.customer_code, cm.customer_name
     FROM ops.route_customer rc
     JOIN biz.customer_master cm
       ON cm.company_id = rc.company_id
      AND cm.customer_id = rc.customer_id
     WHERE rc.company_id = $1 AND rc.route_id = $2
     ORDER BY rc.sort_order ASC, rc.id ASC`,
    [companyId, routeId]
  );
  return rows.map(mapRouteCustomerRow);
}

export async function replaceRouteCustomers(db, companyId, routeId, customerIds, actor) {
  await db.query(
    `DELETE FROM ops.route_customer
     WHERE company_id = $1 AND route_id = $2`,
    [companyId, routeId]
  );

  if (!customerIds || customerIds.length === 0) return [];

  const values = customerIds.map((custId, idx) => {
    const base = idx * 5;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, NOW(), $${base + 5})`;
  });

  const flatParams = customerIds.flatMap((custId, idx) => [
    companyId,
    routeId,
    Number(custId),
    idx + 1,
    actor,
  ]);

  const { rows } = await db.query(
    `INSERT INTO ops.route_customer
       (company_id, route_id, customer_id, sort_order, created_at, created_by)
     VALUES ${values.join(', ')}
     RETURNING id, company_id, route_id, customer_id, sort_order, created_at, created_by`,
    flatParams
  );
  return rows.map((r) => ({
    id: Number(r.id),
    companyId: Number(r.company_id),
    routeId: Number(r.route_id),
    customerId: Number(r.customer_id),
    sortOrder: Number(r.sort_order),
    createdAt: r.created_at ?? null,
    createdBy: r.created_by ?? null,
  }));
}

export async function removeRouteCustomer(db, companyId, routeId, customerId) {
  const { rowCount } = await db.query(
    `DELETE FROM ops.route_customer
     WHERE company_id = $1 AND route_id = $2 AND customer_id = $3`,
    [companyId, routeId, customerId]
  );
  return rowCount > 0;
}

function mapRouteRow(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    branchId: row.branch_id != null ? Number(row.branch_id) : null,
    routeId: Number(row.route_id),
    routeCode: row.route_code,
    routeName: row.route_name,
    description: row.description ?? null,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at ?? null,
    createdBy: row.created_by ?? null,
    modifiedAt: row.modified_at ?? null,
    modifiedBy: row.modified_by ?? null,
  };
}

function mapRouteCustomerRow(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    routeId: Number(row.route_id),
    customerId: Number(row.customer_id),
    sortOrder: Number(row.sort_order),
    customerCode: row.customer_code,
    customerName: row.customer_name,
    createdAt: row.created_at ?? null,
    createdBy: row.created_by ?? null,
  };
}
