/**
 * Data access for tenant staff roles and role permissions.
 */

export const DEFAULT_ROLE_IDS = {
  admin: 1,
  staff: 2,
  cashier: 3,
  inventory: 4,
  accountant: 5,
};

const DEFAULT_ROLES = [
  [DEFAULT_ROLE_IDS.admin, 'Admin', 100],
  [DEFAULT_ROLE_IDS.staff, 'Staff', 0],
  [DEFAULT_ROLE_IDS.cashier, 'Cashier', 0],
  [DEFAULT_ROLE_IDS.inventory, 'Inventory', 0],
  [DEFAULT_ROLE_IDS.accountant, 'Accountant', 0],
];

export async function roleBelongsToCompany(db, companyId, roleId) {
  const { rows } = await db.query(
    `SELECT 1
     FROM core.role_master
     WHERE company_id = $1
       AND role_id = $2
       AND record_status = 'ACTIVE'
     LIMIT 1`,
    [companyId, roleId]
  );
  return rows.length > 0;
}

export async function findRoleByCompany(db, companyId, roleId) {
  const { rows } = await db.query(
    `SELECT role_id, role_name, discount_percent_allowed, software_type, record_status
     FROM core.role_master
     WHERE company_id = $1
       AND role_id = $2
       AND record_status = 'ACTIVE'
     LIMIT 1`,
    [companyId, roleId]
  );
  return rows[0] ?? null;
}

export async function listRolesByCompany(db, companyId) {
  const { rows } = await db.query(
    `SELECT role_id, role_name, discount_percent_allowed, software_type, record_status
     FROM core.role_master
     WHERE company_id = $1
       AND record_status = 'ACTIVE'
     ORDER BY role_id ASC`,
    [companyId]
  );
  return rows;
}

export async function nextRoleId(db, companyId) {
  const { rows } = await db.query(
    `SELECT COALESCE(MAX(role_id), 0) + 1 AS role_id
     FROM core.role_master
     WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0]?.role_id || 1);
}

export async function insertRole(db, params) {
  const {
    companyId,
    roleId,
    roleName,
    discountPercentAllowed = 0,
    softwareType = 'ERP',
    actor = 'role-entry',
  } = params;
  const { rows } = await db.query(
    `INSERT INTO core.role_master (
      company_id, role_id, role_name, discount_percent_allowed,
      software_type, created_by, modified_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $6)
    RETURNING role_id, role_name, discount_percent_allowed, software_type, record_status`,
    [companyId, roleId, roleName, discountPercentAllowed, softwareType, actor]
  );
  return rows[0];
}

export async function updateRole(db, params) {
  const {
    companyId,
    roleId,
    roleName,
    discountPercentAllowed = 0,
    softwareType = 'ERP',
    actor = 'role-entry',
  } = params;
  const { rows } = await db.query(
    `UPDATE core.role_master
     SET role_name = $3,
         discount_percent_allowed = $4,
         software_type = $5,
         modified_at = CURRENT_TIMESTAMP,
         modified_by = $6
     WHERE company_id = $1
       AND role_id = $2
       AND record_status = 'ACTIVE'
     RETURNING role_id, role_name, discount_percent_allowed, software_type, record_status`,
    [companyId, roleId, roleName, discountPercentAllowed, softwareType, actor]
  );
  return rows[0] ?? null;
}

export async function countActiveStaffForRole(db, companyId, roleId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM core.staff_master
     WHERE company_id = $1
       AND role_id = $2
       AND record_status = 'ACTIVE'`,
    [companyId, roleId]
  );
  return Number(rows[0]?.n || 0);
}

export async function deactivateRole(db, params) {
  const { companyId, roleId, actor = 'role-entry' } = params;
  const { rows } = await db.query(
    `UPDATE core.role_master
     SET record_status = 'INACTIVE',
         modified_at = CURRENT_TIMESTAMP,
         modified_by = $3
     WHERE company_id = $1
       AND role_id = $2
       AND record_status = 'ACTIVE'
     RETURNING role_id, role_name, discount_percent_allowed, software_type, record_status`,
    [companyId, roleId, actor]
  );
  return rows[0] ?? null;
}

export async function listPermissionCatalog(db) {
  const { rows } = await db.query(
    `SELECT
        pm.permission_code,
        pm.feature_code,
        fm.feature_name,
        fm.pack_code,
        pm.action_code,
        pm.permission_name,
        pm.description,
        pm.sort_order
     FROM core.permission_master pm
     LEFT JOIN core.feature_master fm ON fm.feature_code = pm.feature_code
     WHERE pm.is_active = TRUE
     ORDER BY fm.pack_code ASC NULLS LAST, pm.feature_code ASC, pm.sort_order ASC, pm.permission_code ASC`
  );
  return rows;
}

export async function listRolePermissions(db, companyId, roleId) {
  const { rows } = await db.query(
    `SELECT rp.permission_code, rp.is_allowed
     FROM core.role_permission rp
     JOIN core.permission_master pm
       ON pm.permission_code = rp.permission_code
      AND pm.is_active = TRUE
     WHERE rp.company_id = $1
       AND rp.role_id = $2
     ORDER BY rp.permission_code ASC`,
    [companyId, roleId]
  );
  return rows;
}

export async function listValidPermissionCodes(db, permissionCodes) {
  if (!permissionCodes.length) return [];
  const { rows } = await db.query(
    `SELECT permission_code
     FROM core.permission_master
     WHERE permission_code = ANY($1::varchar[])
       AND is_active = TRUE`,
    [permissionCodes]
  );
  return rows.map((row) => row.permission_code);
}

export async function listValidPermissionsWithFeatures(db, permissionCodes) {
  if (!permissionCodes.length) return [];
  const { rows } = await db.query(
    `SELECT permission_code, feature_code
     FROM core.permission_master
     WHERE permission_code = ANY($1::varchar[])
       AND is_active = TRUE`,
    [permissionCodes]
  );
  return rows;
}

export async function replaceRolePermissions(db, companyId, roleId, permissionCodes) {
  await db.query(
    `DELETE FROM core.role_permission
     WHERE company_id = $1
       AND role_id = $2`,
    [companyId, roleId]
  );

  if (permissionCodes.length) {
    await db.query(
      `INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
       SELECT $1, $2, unnest($3::varchar[]), TRUE`,
      [companyId, roleId, permissionCodes]
    );
  }

  await db.query(
    `UPDATE core.role_master
     SET modified_at = CURRENT_TIMESTAMP,
         modified_by = 'role-permissions'
     WHERE company_id = $1
       AND role_id = $2`,
    [companyId, roleId]
  );
}

export async function seedDefaultTenantRoles(db, companyId, actor = 'entitlement-seed') {
  for (const [roleId, roleName, discountPercentAllowed] of DEFAULT_ROLES) {
    await db.query(
      `INSERT INTO core.role_master (
        company_id, role_id, role_name, discount_percent_allowed,
        software_type, created_by, modified_by
      ) VALUES ($1, $2, $3, $4, 'ERP', $5, $5)
      ON CONFLICT (company_id, role_id) DO NOTHING`,
      [companyId, roleId, roleName, discountPercentAllowed, actor]
    );
  }

  await seedAdminPermissions(db, companyId);
  await seedStaffPermissions(db, companyId);
  await seedCashierPermissions(db, companyId);
  await seedInventoryPermissions(db, companyId);
  await seedAccountantPermissions(db, companyId);
}

async function seedAdminPermissions(db, companyId) {
  await db.query(
    `INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
     SELECT $1, $2, permission_code, TRUE
     FROM core.permission_master
     WHERE is_active = TRUE
     ON CONFLICT (company_id, role_id, permission_code)
     DO UPDATE SET is_allowed = TRUE, updated_at = NOW()`,
    [companyId, DEFAULT_ROLE_IDS.admin]
  );
}

async function seedStaffPermissions(db, companyId) {
  await db.query(
    `INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
     SELECT $1, $2, permission_code, TRUE
     FROM core.permission_master
     WHERE action_code = 'view'
       AND feature_code IN (
         'core.company_profile',
         'core.customers',
         'core.suppliers',
         'backoffice.dashboard',
         'backoffice.reports'
       )
     ON CONFLICT (company_id, role_id, permission_code)
     DO UPDATE SET is_allowed = TRUE, updated_at = NOW()`,
    [companyId, DEFAULT_ROLE_IDS.staff]
  );
}

async function seedCashierPermissions(db, companyId) {
  await seedPermissionList(db, companyId, DEFAULT_ROLE_IDS.cashier, [
    'pos.billing.view',
    'pos.billing.create',
    'pos.kot.view',
    'pos.kot.create',
    'pos.settlement.view',
    'pos.settlement.create',
    'pos.tables.view',
    'pos.customer_selection.view',
    'pos.product_search.view',
    'pos.discount.view',
  ]);
}

async function seedInventoryPermissions(db, companyId) {
  await db.query(
    `INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
     SELECT $1, $2, permission_code, TRUE
     FROM core.permission_master
     WHERE feature_code IN (
       'backoffice.inventory',
       'backoffice.product_master',
       'backoffice.product_group',
       'backoffice.stock_entry',
       'backoffice.stock_adjustment',
       'backoffice.purchase',
       'backoffice.purchase_order',
       'backoffice.grn',
       'backoffice.suppliers'
     )
     ON CONFLICT (company_id, role_id, permission_code)
     DO UPDATE SET is_allowed = TRUE, updated_at = NOW()`,
    [companyId, DEFAULT_ROLE_IDS.inventory]
  );
}

async function seedAccountantPermissions(db, companyId) {
  await db.query(
    `INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
     SELECT $1, $2, permission_code, TRUE
     FROM core.permission_master
     WHERE feature_code IN (
       'backoffice.accounts',
       'backoffice.vouchers',
       'backoffice.sales',
       'backoffice.sales_quotation',
       'backoffice.delivery_order',
       'backoffice.reports'
     )
     ON CONFLICT (company_id, role_id, permission_code)
     DO UPDATE SET is_allowed = TRUE, updated_at = NOW()`,
    [companyId, DEFAULT_ROLE_IDS.accountant]
  );
}

async function seedPermissionList(db, companyId, roleId, permissionCodes) {
  await db.query(
    `INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
     SELECT $1, $2, pm.permission_code, TRUE
     FROM core.permission_master pm
     WHERE pm.permission_code = ANY($3::varchar[])
     ON CONFLICT (company_id, role_id, permission_code)
     DO UPDATE SET is_allowed = TRUE, updated_at = NOW()`,
    [companyId, roleId, permissionCodes]
  );
}
