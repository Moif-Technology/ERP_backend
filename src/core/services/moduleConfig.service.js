const DEFAULT_MODULE_DEFINITIONS = {
  core: {
    name: 'Core System',
    icon: '⚙️',
    color: '#0369a1',
    features: [
      'core.users',
      'core.roles',
      'core.permissions',
      'core.settings',
    ],
  },
  backoffice: {
    name: 'Backoffice',
    icon: '📊',
    color: '#b45309',
    features: [
      'backoffice.sales',
      'backoffice.purchase',
      'backoffice.inventory',
      'backoffice.product_master',
      'backoffice.customers',
      'backoffice.suppliers',
      'backoffice.staff',
      'backoffice.reports',
      'backoffice.dashboard',
      'backoffice.stock_adjustment',
      'backoffice.manufacturing',
      'backoffice.logistics',
      'backoffice.exchange',
      'backoffice.reorder',
      'backoffice.deals_offers',
      'backoffice.damage_entry',
      'backoffice.stock_entry',
      'backoffice.product_movement',
      'backoffice.sales_quotation',
      'backoffice.purchase_order',
      'backoffice.grn',
      'backoffice.delivery_order',
    ],
  },
  pos: {
    name: 'POS',
    icon: '💳',
    color: '#be185d',
    features: [
      'pos.counter_open_close',
      'pos.product_search',
      'pos.payment_methods',
      'pos.settlement',
      'pos.hold_bill',
      'pos.price_enquiry',
      'pos.areas',
      'pos.tables',
      'pos.kot',
    ],
  },
  accounts: {
    name: 'Accounts',
    icon: '📋',
    color: '#1e40af',
    features: [
      'accounts.dashboard',
      'accounts.vouchers',
      'accounts.ledger',
      'accounts.reports',
      'accounts.payables',
      'accounts.receivables',
    ],
  },
  hr: {
    name: 'Human Resources',
    icon: '👥',
    color: '#0f766e',
    features: [
      'hr.dashboard',
      'hr.employee_master',
      'hr.attendance',
      'hr.leave',
      'hr.shifts',
      'hr.document_types',
      'hr.departments',
      'hr.reports',
    ],
  },
  crm: {
    name: 'CRM',
    icon: '📞',
    color: '#7c3aed',
    features: [
      'crm.dashboard',
      'crm.leads',
      'crm.opportunities',
      'crm.followups',
      'crm.interactions',
      'crm.lead_sources',
      'crm.lead_statuses',
      'crm.opportunity_stages',
    ],
  },
  garage: {
    name: 'Garage Management',
    icon: '🔧',
    color: '#c2410c',
    features: [
      'garage',
      'garage.workshop',
      'garage.parts',
      'garage.technicians',
    ],
  },
  service: {
    name: 'Service Management',
    icon: '🛠️',
    color: '#059669',
    features: [
      'service',
      'service.dashboard',
      'service.catalogue',
      'service.payments',
      'service.documents',
    ],
  },
  van: {
    name: 'Van Sales',
    icon: '🚐',
    color: '#e11d48',
    features: [
      'van.van_master',
      'van.route_master',
      'van.sales',
      'van.settlement',
    ],
  },
};

/**
 * Get module definitions from DB feature_master + pack_metadata, grouped by pack_code.
 * Fully dynamic: reads all packs and features from DB.
 * Falls back to defaults if DB unavailable (legacy systems).
 */
export async function getModuleDefinitions(db = null) {
  if (!db) return DEFAULT_MODULE_DEFINITIONS;

  try {
    // Query feature_master grouped by pack_code, joined with pack_metadata for display info
    const res = await db.query(`
      SELECT
        DISTINCT fm.pack_code,
        COALESCE(pm.metadata->>'name', fm.pack_code) as pack_name,
        COALESCE(pm.metadata->>'icon', '📦') as icon,
        COALESCE(pm.metadata->>'color', '#6b7280') as color,
        COALESCE(pm.metadata->>'order', 100)::INT as pack_order
      FROM core.feature_master fm
      LEFT JOIN core.pack_metadata pm ON fm.pack_code = pm.pack_code
      WHERE fm.pack_code IS NOT NULL AND fm.is_active = TRUE
      ORDER BY pack_order ASC, fm.pack_code ASC
    `);

    if (res.rows.length === 0) return DEFAULT_MODULE_DEFINITIONS;

    // Build modules object with pack info
    const modules = {};
    const packInfo = new Map();
    for (const row of res.rows) {
      packInfo.set(row.pack_code, {
        name: row.pack_name,
        icon: row.icon,
        color: row.color,
      });
      modules[row.pack_code] = {
        name: row.pack_name,
        icon: row.icon,
        color: row.color,
        features: [],
      };
    }

    // Now fetch all active features for these packs
    const packCodes = Array.from(packInfo.keys());
    if (packCodes.length === 0) return DEFAULT_MODULE_DEFINITIONS;

    const featureRes = await db.query(
      `SELECT pack_code, feature_code, feature_name, is_active
       FROM core.feature_master
       WHERE pack_code = ANY($1) AND is_active = TRUE
       ORDER BY pack_code, sort_order ASC, feature_code ASC`,
      [packCodes]
    );

    // Group features by pack_code
    for (const row of featureRes.rows) {
      if (modules[row.pack_code]) {
        modules[row.pack_code].features.push({
          code: row.feature_code,
          name: row.feature_name || row.feature_code,
        });
      }
    }

    return modules;
  } catch (err) {
    // Table doesn't exist or query failed — use defaults
    if (err.code === '42P01' || err.code === '42703') return DEFAULT_MODULE_DEFINITIONS;
    throw err;
  }
}

function parseCompanyId(authStaff) {
  const companyId = Number(authStaff?.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid session company');
    err.status = 401;
    throw err;
  }
  return companyId;
}

function parseRoleId(raw) {
  const roleId = Number(raw);
  if (!Number.isFinite(roleId) || roleId < 1) {
    const err = new Error('Invalid roleId');
    err.status = 400;
    throw err;
  }
  return Math.trunc(roleId);
}

/**
 * Get allowed modules for a software type.
 * Enforces isolation: HR type can ONLY see HR modules, POS can ONLY see POS, etc.
 */
function getAllowedModulesByType(softwareType) {
  const typeMap = {
    'RESTAURANT': new Set(['core', 'pos', 'backoffice']),
    'RESTAURANT-POS': new Set(['core', 'pos', 'backoffice']),
    'POS': new Set(['core', 'pos', 'backoffice']),
    'COUNTER-POS': new Set(['core', 'pos', 'backoffice']),
    'SALON': new Set(['core', 'pos']),
    'LAUNDRY': new Set(['core', 'pos']),
    'GARAGE': new Set(['core', 'garage', 'backoffice']),
    'HR': new Set(['core', 'hr']),
    'CRM': new Set(['core', 'crm']),
    'ERP': new Set(['core', 'backoffice', 'accounts', 'hr', 'crm', 'garage', 'van', 'service']),
  };

  return typeMap[softwareType] || new Set(['core', 'backoffice']);
}

/**
 * Get company's software type and enforced allowed modules.
 */
async function getCompanySoftwareType(db, companyId) {
  const res = await db.query(
    `SELECT COALESCE(st.software_code, 'ERP') as software_type
     FROM backoffice.company_master c
     LEFT JOIN core.software_type_master st ON c.software_type_id = st.software_type_id
     WHERE c.company_id = $1`,
    [companyId]
  );

  if (res.rows.length === 0) return 'ERP';
  return res.rows[0].software_type;
}

/**
 * Map company software types to allowed role software types.
 * SALON company uses SALON-POS roles, etc.
 */
const ALLOWED_ROLE_TYPES_BY_COMPANY_MC = {
  'SALON': new Set(['SALON-POS', 'ERP']),
  'LAUNDRY': new Set(['LAUNDRY-POS', 'ERP']),
  'GARAGE': new Set(['GARAGE', 'ERP']),
  'HR': new Set(['HR', 'ERP']),
  'CRM': new Set(['CRM', 'ERP']),
  'RESTAURANT': new Set(['RESTAURANT-POS', 'ERP']),
  'POS': new Set(['POS', 'COUNTER-POS', 'ERP']),
  'ERP': new Set(['ERP', 'RESTAURANT-POS', 'COUNTER-POS', 'SALON-POS', 'LAUNDRY-POS', 'GARAGE', 'HR', 'CRM', 'VAN']),
};

/**
 * Validate admin can only manage roles of their software type.
 * ERP admins can manage all; others only their own type.
 */
async function validateAdminCanManageRole(db, authStaff, roleId) {
  const adminSoftwareType = authStaff.software_type_code || 'ERP';

  // ERP admins can manage everything
  if (adminSoftwareType === 'ERP') return true;

  // Get role's software type
  const roleRes = await db.query(
    'SELECT software_type FROM core.role_master WHERE role_id = $1',
    [roleId]
  );

  if (roleRes.rows.length === 0) return false;

  const roleSoftwareType = roleRes.rows[0].software_type || 'ERP';

  // Check if admin's type can manage this role's type
  const allowedTypes = ALLOWED_ROLE_TYPES_BY_COMPANY_MC[adminSoftwareType] || new Set(['ERP']);
  if (!allowedTypes.has(roleSoftwareType)) {
    const err = new Error(
      `You can only manage [${adminSoftwareType}] roles. ` +
      `This role is [${roleSoftwareType}].`
    );
    err.status = 403;
    throw err;
  }

  return true;
}

async function getRoleExists(db, companyId, roleId) {
  const row = await db.query(
    'SELECT role_id FROM core.role_master WHERE company_id = $1 AND role_id = $2',
    [companyId, roleId]
  );
  return row.rows.length > 0;
}

/**
 * Get module configuration for a role.
 * Reads from role_module_config table if available.
 * Returns object like: { backoffice: true, pos: { feature1: true, feature2: false }, ... }
 */
export async function getModuleConfig(db, authStaff, roleIdRaw) {
  const companyId = parseCompanyId(authStaff);
  const roleId = parseRoleId(roleIdRaw);

  const exists = await getRoleExists(db, companyId, roleId);
  if (!exists) {
    const err = new Error('Role not found');
    err.status = 404;
    throw err;
  }

  // Validate admin can only access roles of their software type
  await validateAdminCanManageRole(db, authStaff, roleId);

  // Try to fetch from role_module_config (may not exist for legacy installs)
  try {
    const res = await db.query(
      `SELECT module_code, feature_config
       FROM core.role_module_config
       WHERE company_id = $1 AND role_id = $2`,
      [companyId, roleId]
    );

    if (res.rows.length === 0) return {};

    const config = {};
    for (const row of res.rows) {
      if (row.feature_config) {
        config[row.module_code] = row.feature_config;
      } else {
        config[row.module_code] = true; // Module enabled, all features
      }
    }
    return config;
  } catch (err) {
    // Table doesn't exist in legacy installs — return empty config
    if (err.code === '42P01') return {};
    throw err;
  }
}

/**
 * Save module configuration for a role.
 * Validates module/feature codes exist AND enforces software type restrictions.
 * Example: HR software type can ONLY enable core + hr modules, not pos/service.
 */
export async function updateModuleConfig(db, authStaff, roleIdRaw, config) {
  const companyId = parseCompanyId(authStaff);
  const roleId = parseRoleId(roleIdRaw);

  const exists = await getRoleExists(db, companyId, roleId);
  if (!exists) {
    const err = new Error('Role not found');
    err.status = 404;
    throw err;
  }

  if (!config || typeof config !== 'object') {
    const err = new Error('config must be an object');
    err.status = 400;
    throw err;
  }

  // Validate admin can only manage roles of their software type
  await validateAdminCanManageRole(db, authStaff, roleId);

  // Get company's software type to enforce module restrictions
  const softwareType = await getCompanySoftwareType(db, companyId);
  const allowedModules = getAllowedModulesByType(softwareType);

  // Get valid modules from DB
  const moduleDefs = await getModuleDefinitions(db);
  const validModuleCodes = Object.keys(moduleDefs);

  // Validate all module codes
  for (const moduleCode of Object.keys(config)) {
    // Check if module code is valid (exists in DB)
    if (!validModuleCodes.includes(moduleCode)) {
      const err = new Error(`Invalid module code: ${moduleCode}`);
      err.status = 400;
      throw err;
    }

    // CHECK SOFTWARE TYPE RESTRICTION: Enforce that only allowed modules can be configured
    if (!allowedModules.has(moduleCode)) {
      const err = new Error(
        `Module "${moduleCode}" not allowed for software type "${softwareType}". ` +
        `Allowed modules: ${Array.from(allowedModules).join(', ')}`
      );
      err.status = 403;
      err.allowedModules = Array.from(allowedModules);
      err.softwareType = softwareType;
      throw err;
    }

    const moduleConfig = config[moduleCode];
    if (moduleConfig === true || moduleConfig === false) continue;
    if (typeof moduleConfig !== 'object') {
      const err = new Error(`Module config must be boolean or object: ${moduleCode}`);
      err.status = 400;
      throw err;
    }

    // If it's an object, validate feature codes
    const validFeatureCodes = moduleDefs[moduleCode].features.map(f => f.code);
    for (const featureCode of Object.keys(moduleConfig)) {
      if (!validFeatureCodes.includes(featureCode)) {
        const err = new Error(`Invalid feature ${featureCode} for module ${moduleCode}`);
        err.status = 400;
        throw err;
      }
    }
  }

  // Try to upsert into role_module_config
  try {
    // Delete existing config first
    await db.query(
      'DELETE FROM core.role_module_config WHERE company_id = $1 AND role_id = $2',
      [companyId, roleId]
    );

    // Insert new config
    for (const [moduleCode, moduleConfig] of Object.entries(config)) {
      const featureConfig = (typeof moduleConfig === 'object') ? moduleConfig : null;
      await db.query(
        `INSERT INTO core.role_module_config (company_id, role_id, module_code, feature_config)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (company_id, role_id, module_code) DO UPDATE SET feature_config = $4`,
        [companyId, roleId, moduleCode, JSON.stringify(featureConfig)]
      );
    }
  } catch (err) {
    // Table doesn't exist in legacy installs — this is OK, just skip persistence
    if (err.code !== '42P01') throw err;
  }

  return config;
}
