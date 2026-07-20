import { pool } from '../../config/db.js';

/**
 * Ensures feature_master has the complete catalog.
 * Uses ON CONFLICT DO UPDATE so names/types are always corrected.
 * Uses ON CONFLICT DO NOTHING for plan_feature so user changes are preserved.
 */
export async function ensureFeatureCatalog() {
  await pool.query(`
    INSERT INTO core.feature_master
      (feature_code, feature_name, pack_code, parent_feature_code, feature_type, sort_order)
    VALUES
      -- Core pack
      ('core',                    'Core',                   'core',       NULL,       'pack',    10),
      ('core.company_profile',    'Company profile',        'core',       'core',     'feature', 11),
      ('core.branches',           'Branches',               'core',       'core',     'feature', 12),
      ('core.users',              'Users',                  'core',       'core',     'feature', 13),
      ('core.roles',              'Roles',                  'core',       'core',     'feature', 14),
      ('core.permissions',        'Permissions',            'core',       'core',     'feature', 15),
      ('core.customers',          'Customers',              'core',       'core',     'feature', 17),
      ('core.suppliers',          'Suppliers',              'core',       'core',     'feature', 18),
      ('core.settings',           'Settings',               'core',       'core',     'feature', 21),

      -- POS pack
      ('pos',                     'Point of Sale',          'pos',        NULL,       'pack',   100),
      ('pos.billing',             'Billing',                'pos',        'pos',      'feature',101),
      ('pos.takeaway',            'Takeaway',               'pos',        'pos',      'feature',102),
      ('pos.dine_in',             'Dine in',                'pos',        'pos',      'feature',103),
      ('pos.tables',              'Tables',                 'pos',        'pos',      'feature',104),
      ('pos.areas',               'Areas',                  'pos',        'pos',      'feature',105),
      ('pos.kot',                 'KOT',                    'pos',        'pos',      'feature',106),
      ('pos.settlement',          'Settlement',             'pos',        'pos',      'feature',108),
      ('pos.cash_payment',        'Cash payment',           'pos',        'pos',      'feature',109),
      ('pos.card_payment',        'Card payment',           'pos',        'pos',      'feature',110),
      ('pos.discount',            'Discount',               'pos',        'pos',      'feature',113),
      ('pos.void_bill',           'Void bill',              'pos',        'pos',      'feature',114),
      ('pos.counter_open_close',  'Counter open/close',     'pos',        'pos',      'feature',116),
      ('pos.counter_reports',     'Counter reports',        'pos',        'pos',      'feature',117),
      ('pos.customer_selection',  'Customer selection',     'pos',        'pos',      'feature',118),
      ('pos.product_search',      'Product search',         'pos',        'pos',      'feature',119),
      ('pos.cash_in_out',         'Cash in/out',            'pos',        'pos',      'feature',126),
      ('pos.product_master',      'POS product master',     'pos',        'pos',      'feature',129),

      -- Backoffice pack
      ('backoffice',              'Backoffice',             'backoffice', NULL,       'pack',   200),
      ('backoffice.dashboard',    'Dashboard',              'backoffice', 'backoffice','feature',201),
      ('backoffice.inventory',    'Inventory',              'backoffice', 'backoffice','feature',202),
      ('backoffice.product_master','Product master',        'backoffice', 'backoffice','feature',203),
      ('backoffice.product_group','Product group',          'backoffice', 'backoffice','feature',204),
      ('backoffice.sub_sub_group','Sub-sub-group master',   'backoffice', 'backoffice','feature',204),
      ('backoffice.stock_entry',  'Stock entry',            'backoffice', 'backoffice','feature',205),
      ('backoffice.stock_adjustment','Stock adjustment',    'backoffice', 'backoffice','feature',206),
      ('backoffice.damage_entry', 'Damage entry',           'backoffice', 'backoffice','feature',207),
      ('backoffice.purchase',     'Purchase',               'backoffice', 'backoffice','feature',208),
      ('backoffice.purchase_order','Purchase order',        'backoffice', 'backoffice','feature',209),
      ('backoffice.grn',          'Goods receive note',     'backoffice', 'backoffice','feature',210),
      ('backoffice.sales',        'Sales',                  'backoffice', 'backoffice','feature',211),
      ('backoffice.sales_quotation','Sales quotation',      'backoffice', 'backoffice','feature',212),
      ('backoffice.delivery_order','Delivery order',        'backoffice', 'backoffice','feature',213),
      ('backoffice.accounts',     'Accounts & Financials',  'backoffice', 'backoffice','feature',214),
      ('backoffice.vouchers',     'Vouchers',               'backoffice', 'backoffice','feature',215),
      ('backoffice.reports',      'Reports',                'backoffice', 'backoffice','feature',216),
      ('backoffice.deals_offers', 'Deals & offers',         'backoffice', 'backoffice','feature',217),
      ('backoffice.customers',    'Customers',              'backoffice', 'backoffice','feature',218),
      ('backoffice.suppliers',    'Suppliers',              'backoffice', 'backoffice','feature',219),
      ('backoffice.staff',        'Staff',                  'backoffice', 'backoffice','feature',220),
      ('backoffice.area_master',  'Area master',            'backoffice', 'backoffice','feature',221),
      ('backoffice.table_master', 'Table master',           'backoffice', 'backoffice','feature',222),
      ('backoffice.reorder',      'Reorder',                'backoffice', 'backoffice','feature',223),
      ('backoffice.product_movement','Product movement',    'backoffice', 'backoffice','feature',224),
      ('backoffice.exchange',     'Exchange / Currency',    'backoffice', 'backoffice','feature',225),
      ('backoffice.manufacturing','Manufacturing',          'backoffice', 'backoffice','feature',226),
      ('backoffice.logistics',    'Logistics',              'backoffice', 'backoffice','feature',227),
      ('backoffice.configuration','Configuration',          'backoffice', 'backoffice','feature',228),

      -- HR pack
      ('hr',                      'Human Resources',        'hr',         NULL,       'pack',   300),
      ('hr.dashboard',            'HR dashboard',           'hr',         'hr',       'feature',304),
      ('hr.employee_master',      'Employee master',        'hr',         'hr',       'feature',301),
      ('hr.attendance',           'Attendance',             'hr',         'hr',       'feature',302),
      ('hr.leave',                'Leave',                  'hr',         'hr',       'feature',303),
      ('hr.shifts',               'Shifts',                 'hr',         'hr',       'feature',305),
      ('hr.departments',          'Departments',            'hr',         'hr',       'feature',306),
      ('hr.document_types',       'Document types',         'hr',         'hr',       'feature',308),
      ('hr.reports',              'HR reports',             'hr',         'hr',       'feature',309),

      -- CRM pack
      ('crm',                     'CRM',                    'crm',        NULL,       'pack',   400),
      ('crm.dashboard',           'CRM dashboard',          'crm',        'crm',      'feature',401),
      ('crm.leads',               'Leads',                  'crm',        'crm',      'feature',402),
      ('crm.lead_sources',        'Lead sources',           'crm',        'crm',      'feature',403),
      ('crm.lead_statuses',       'Lead statuses',          'crm',        'crm',      'feature',404),
      ('crm.opportunities',       'Opportunities',          'crm',        'crm',      'feature',405),
      ('crm.opportunity_stages',  'Opportunity stages',     'crm',        'crm',      'feature',406),
      ('crm.followups',           'Follow-ups',             'crm',        'crm',      'feature',407),
      ('crm.interactions',        'Interactions',           'crm',        'crm',      'feature',408),

      -- Garage pack
      ('garage',                  'Garage',                 'garage',     NULL,       'pack',   500),
      ('garage.dashboard',        'Dashboard',              'garage',     'garage',   'feature',501),
      ('garage.vehicle_master',   'Vehicle master',         'garage',     'garage',   'feature',502),
      ('garage.job_cards',        'Job cards',              'garage',     'garage',   'feature',504),
      ('garage.estimates',        'Estimates',              'garage',     'garage',   'feature',507),
      ('garage.technicians',      'Technicians',            'garage',     'garage',   'feature',506),
      ('garage.parts_usage',      'Parts & inventory',      'garage',     'garage',   'feature',508),
      ('garage.sublet',           'Sublet jobs',            'garage',     'garage',   'feature',509),
      ('garage.punching',         'Punching / time log',    'garage',     'garage',   'feature',510),
      ('garage.invoices',         'Invoices',               'garage',     'garage',   'feature',511),
      ('garage.reports',          'Garage reports',         'garage',     'garage',   'feature',512),

      -- POS — additional operations
      ('pos.reprint_bill',         'Reprint bill',            'pos', 'pos',  'feature', 120),
      ('pos.return_bill',          'Return / refund',         'pos', 'pos',  'feature', 121),
      ('pos.delivery',             'Delivery',                'pos', 'pos',  'feature', 122),
      ('pos.order_list',           'Order list',              'pos', 'pos',  'feature', 123),
      ('pos.no_sale',              'No sale',                 'pos', 'pos',  'feature', 124),
      ('pos.price_change',         'Price change',            'pos', 'pos',  'feature', 125),
      ('pos.online_orders',        'Online orders',           'pos', 'pos',  'feature', 127),
      ('pos.credit',               'Credit sales',            'pos', 'pos',  'feature', 128),
      ('pos.discount.admin',       'Admin discount',          'pos', 'pos',  'feature', 115),

      -- POS — KOT sub-features
      ('pos.kot.dummy_bill',       'Dummy bill (KOT)',        'pos', 'pos',  'feature', 130),
      ('pos.kot.join_split',       'Join / split tables',     'pos', 'pos',  'feature', 131),
      ('pos.kot.item_cancel',      'KOT item cancel',         'pos', 'pos',  'feature', 132),

      -- POS — settlement methods
      ('pos.settlement.cash',      'Cash settlement',         'pos', 'pos',  'feature', 140),
      ('pos.settlement.card',      'Card settlement',         'pos', 'pos',  'feature', 141),
      ('pos.settlement.credit',    'Credit settlement',       'pos', 'pos',  'feature', 142),
      ('pos.day_close',            'Day close',               'pos', 'pos',  'feature', 150),

      -- POS — 3-panel UI controls
      ('pos.ui.groups_panel',      'Groups panel (left)',     'pos', 'pos',  'feature', 160),
      ('pos.ui.subgroups_panel',   'Subgroups panel (center)','pos', 'pos', 'feature', 161),
      ('pos.ui.areas_panel',       'Areas panel',             'pos', 'pos',  'feature', 162),
      ('pos.ui.tables_panel',      'Tables panel',            'pos', 'pos',  'feature', 163),

      -- POS — masters and setup
      ('pos.subgroup_master',      'Subgroup master',         'pos', 'pos',  'feature', 170),
      ('pos.group_master',         'Group master',            'pos', 'pos',  'feature', 171),
      ('pos.printer_setup',        'Printer setup',           'pos', 'pos',  'feature', 172),
      ('pos.recipe',               'Recipe',                  'pos', 'pos',  'feature', 173),
      ('pos.combo',                'Combo items',             'pos', 'pos',  'feature', 174),
      ('pos.barcode',              'Barcode',                 'pos', 'pos',  'feature', 175),
      ('pos.kds',                  'Kitchen display (KDS)',   'pos', 'pos',  'feature', 176),
      ('pos.mess',                 'Mess / canteen',          'pos', 'pos',  'feature', 177),
      ('pos.settings',             'POS settings',            'pos', 'pos',  'feature', 178),

      -- POS — reports
      ('pos.stock_reports',        'Stock reports',           'pos', 'pos',  'feature', 180),
      ('pos.advanced_reports',     'Advanced reports',        'pos', 'pos',  'feature', 181),
      ('pos.vat_reports',          'VAT reports',             'pos', 'pos',  'feature', 182),
      ('pos.report_export',        'Report export',           'pos', 'pos',  'feature', 183),

      -- POS — advanced operations
      ('pos.stock_transfer',       'Stock transfer',          'pos', 'pos',  'feature', 185),
      ('pos.production',           'Production',              'pos', 'pos',  'feature', 186),
      ('pos.purchase',             'POS purchase',            'pos', 'pos',  'feature', 187),

      -- POS — top-bar extras
      ('pos.user_setup',           'User setup',              'pos', 'pos',  'feature', 188),
      ('pos.privilege_setup',      'Privilege setup',         'pos', 'pos',  'feature', 189),
      ('pos.language_setup',       'Language setup',          'pos', 'pos',  'feature', 190),
      ('pos.kitchen_message',      'Kitchen message',         'pos', 'pos',  'feature', 191),
      ('pos.vat',                  'VAT',                     'pos', 'pos',  'feature', 192),
      ('pos.notes',                'Notes entry',             'pos', 'pos',  'feature', 193),
      ('pos.customer_display',     'Customer display',        'pos', 'pos',  'feature', 194),
      ('pos.multi_supplier',       'Multi-supplier',          'pos', 'pos',  'feature', 195),
      ('pos.sync_tools',           'Sync tools',              'pos', 'pos',  'feature', 196),
      ('pos.cashier_change',       'Cashier change',          'pos', 'pos',  'feature', 197),
      ('pos.game_zone',            'Game zone',               'pos', 'pos',  'feature', 198),
      ('pos.offline_mode',         'Offline mode',            'pos', 'pos',  'feature', 199),

      -- POS — cart column toggles
      ('pos.ui.cart.kot_label',    'Cart KOT label',          'pos', 'pos',  'feature', 200),
      ('pos.ui.cart.customer_selector', 'Cart customer selector', 'pos', 'pos', 'feature', 201),
      ('pos.ui.cart.add_customer', 'Cart add-customer button','pos', 'pos',  'feature', 202),
      ('pos.ui.cart.modifier',     'Cart modifier column',    'pos', 'pos',  'feature', 203),
      ('pos.ui.cart.qty_controls', 'Cart qty controls',       'pos', 'pos',  'feature', 204),
      ('pos.ui.cart.unit_price',   'Cart unit-price column',  'pos', 'pos',  'feature', 205),
      ('pos.ui.cart.subtotal',     'Cart subtotal column',    'pos', 'pos',  'feature', 206),
      ('pos.ui.cart.tax',          'Cart tax column',         'pos', 'pos',  'feature', 207),
      ('pos.ui.cart.line_total',   'Cart line-total column',  'pos', 'pos',  'feature', 208),
      ('pos.ui.cart.delete',       'Cart delete button',      'pos', 'pos',  'feature', 209),

      -- POS — cart action row
      ('pos.kot.save',             'Save KOT button',         'pos', 'pos',  'feature', 210),
      ('pos.kot.save_without_area','Save KOT without area',   'pos', 'pos',  'feature', 211),
      ('pos.quantity_change',      'Quantity change',         'pos', 'pos',  'feature', 212),

      -- POS — totals bar
      ('pos.ui.totals.subtotal',   'Totals subtotal',         'pos', 'pos',  'feature', 213),
      ('pos.ui.totals.tax',        'Totals tax',              'pos', 'pos',  'feature', 214),
      ('pos.ui.totals.grand_total','Totals grand total',      'pos', 'pos',  'feature', 215),

      -- POS — KOT print actions
      ('pos.kot.print',            'KOT print',               'pos', 'pos',  'feature', 216),
      ('pos.kot.reprint',          'KOT reprint',             'pos', 'pos',  'feature', 217),
      ('pos.kot.comments',         'KOT comments',            'pos', 'pos',  'feature', 218),

      -- Van Sales pack
      ('van',              'Van Sales',   'van', NULL,  'pack',    700),
      ('van.dashboard',    'Dashboard',   'van', 'van', 'feature', 701),
      ('van.sales',        'Sales',       'van', 'van', 'feature', 702),
      ('van.customers',    'Customers',   'van', 'van', 'feature', 703),
      ('van.products',     'Products',    'van', 'van', 'feature', 704),
      ('van.day_summary',  'Day summary', 'van', 'van', 'feature', 705),
      ('van.reports',      'Van reports',     'van', 'van', 'feature', 706),
      ('van.van_master',   'Van master',      'van', 'van', 'feature', 707),
      ('van.route_master', 'Route master',    'van', 'van', 'feature', 708),
      ('van.assignment',   'Day assignment',  'van', 'van', 'feature', 709),

      -- Accounts pack (standalone financial module)
      ('accounts',               'Accounts',             'accounts', NULL,       'pack',   600),
      ('accounts.dashboard',     'Accounts dashboard',   'accounts', 'accounts', 'feature',601),
      ('accounts.vouchers',      'Vouchers',             'accounts', 'accounts', 'feature',602),
      ('accounts.receivables',   'Receivables',          'accounts', 'accounts', 'feature',603),
      ('accounts.payables',      'Payables',             'accounts', 'accounts', 'feature',604),
      ('accounts.ledger',        'Ledger & trial balance','accounts','accounts', 'feature',605),
      ('accounts.reports',       'Financial reports',    'accounts', 'accounts', 'feature',606),

      -- POS — legacy alias gates
      ('pos.kot_join_split',       'KOT join/split (legacy)', 'pos', 'pos',  'feature', 219),
      ('pos.item_cancel',          'Item cancel (legacy)',    'pos', 'pos',  'feature', 220),

      -- POS — settlement variants
      ('pos.settlement.direct',    'Direct settlement',       'pos', 'pos',  'feature', 221),
      ('pos.settlement.unsaved_cart', 'Settle unsaved cart',  'pos', 'pos',  'feature', 222),
      ('pos.settlement.change',    'Change settlement',       'pos', 'pos',  'feature', 223)

    ON CONFLICT (feature_code) DO UPDATE SET
      feature_name         = EXCLUDED.feature_name,
      pack_code            = EXCLUDED.pack_code,
      parent_feature_code  = EXCLUDED.parent_feature_code,
      feature_type         = EXCLUDED.feature_type,
      sort_order           = EXCLUDED.sort_order,
      updated_at           = NOW()
  `);

  // Seed plan_feature rows for any missing entries (DO NOTHING = keep user changes)
  await pool.query(`
    INSERT INTO core.plan_feature (plan_code, feature_code, is_enabled)
    SELECT p.plan_code, f.feature_code,
      CASE
        WHEN p.plan_code = 'custom' THEN TRUE
        WHEN p.plan_code = 'pro'    THEN TRUE
        WHEN p.plan_code = 'standard' AND f.pack_code = 'accounts' THEN FALSE
        WHEN p.plan_code = 'standard' AND f.pack_code IN ('core','backoffice','pos') THEN TRUE
        WHEN p.plan_code IN ('pro','custom') AND f.pack_code = 'van' THEN TRUE
        WHEN p.plan_code = 'basic' AND f.feature_code IN (
          'core','core.company_profile','core.branches','core.users','core.roles',
          'core.customers','core.suppliers','core.settings',
          'backoffice','backoffice.dashboard','backoffice.sales','backoffice.customers',
          'backoffice.suppliers','backoffice.product_master','backoffice.reports'
        ) THEN TRUE
        ELSE FALSE
      END
    FROM core.plan_master p
    CROSS JOIN core.feature_master f
    WHERE p.plan_code IN ('basic','standard','pro','custom')
      AND f.is_active = TRUE
    ON CONFLICT (plan_code, feature_code) DO NOTHING
  `);

  await pool.query(`
    INSERT INTO core.permission_master
      (permission_code, feature_code, action_code, permission_name, is_active, sort_order)
    SELECT
      f.feature_code || '.' || a.action_code,
      f.feature_code,
      a.action_code,
      f.feature_name || ' - ' || INITCAP(a.action_code),
      TRUE,
      f.sort_order * 10 + a.sort_offset
    FROM core.feature_master f
    CROSS JOIN (VALUES
      ('view', 1),
      ('create', 2),
      ('edit', 3),
      ('delete', 4)
    ) AS a(action_code, sort_offset)
    WHERE f.is_active = TRUE
      AND f.feature_type = 'feature'
    ON CONFLICT (permission_code) DO NOTHING
  `);

  await pool.query(`
    INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
    SELECT rm.company_id, rm.role_id, pm.permission_code, TRUE
    FROM core.role_master rm
    CROSS JOIN core.permission_master pm
    WHERE rm.role_id = 1
      AND rm.record_status = 'ACTIVE'
      AND pm.is_active = TRUE
    ON CONFLICT (company_id, role_id, permission_code)
    DO UPDATE SET is_allowed = TRUE, updated_at = NOW()
  `);
}
