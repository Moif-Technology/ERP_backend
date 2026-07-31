import { Router } from 'express';
import * as tenantModuleConfigService from '../services/tenantModuleConfig.service.js';

const router = Router();

/**
 * GET /api/tenant-module-config/:companyId
 * Get all module configurations for a company (Super Admin only)
 */
router.get('/:companyId', async (req, res, next) => {
  try {
    const companyId = Number(req.params.companyId);
    if (!Number.isFinite(companyId) || companyId < 1) {
      return res.status(400).json({ error: 'Invalid companyId' });
    }

    const config = await tenantModuleConfigService.getTenantModuleConfig(req.pool, companyId);
    return res.json(config);
  } catch (err) {
    return next(err);
  }
});

/**
 * PUT /api/tenant-module-config/:companyId
 * Bulk update module configuration for a company
 * Body: { module_code: is_enabled, ... }
 * Example: { "pos": true, "backoffice": false, "crm": true }
 */
router.put('/:companyId', async (req, res, next) => {
  try {
    const companyId = Number(req.params.companyId);
    if (!Number.isFinite(companyId) || companyId < 1) {
      return res.status(400).json({ error: 'Invalid companyId' });
    }

    const config = await tenantModuleConfigService.updateTenantModuleConfigBulk(
      req.pool,
      req.authStaff,
      companyId,
      req.body
    );

    return res.json(config);
  } catch (err) {
    return next(err);
  }
});

/**
 * PATCH /api/tenant-module-config/:companyId/:moduleCode
 * Update single module for a company
 * Body: { is_enabled: true/false }
 */
router.patch('/:companyId/:moduleCode', async (req, res, next) => {
  try {
    const companyId = Number(req.params.companyId);
    const moduleCode = String(req.params.moduleCode).trim();
    const isEnabled = req.body?.is_enabled;

    if (!Number.isFinite(companyId) || companyId < 1) {
      return res.status(400).json({ error: 'Invalid companyId' });
    }
    if (!moduleCode) {
      return res.status(400).json({ error: 'Invalid moduleCode' });
    }
    if (typeof isEnabled !== 'boolean') {
      return res.status(400).json({ error: 'is_enabled must be boolean' });
    }

    const result = await tenantModuleConfigService.updateTenantModuleConfig(
      req.pool,
      req.authStaff,
      companyId,
      moduleCode,
      isEnabled
    );

    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/tenant-module-config/:companyId/enabled
 * Get list of enabled modules (not config object)
 * Returns: ['core', 'pos', 'backoffice', ...]
 */
router.get('/:companyId/enabled', async (req, res, next) => {
  try {
    const companyId = Number(req.params.companyId);
    if (!Number.isFinite(companyId) || companyId < 1) {
      return res.status(400).json({ error: 'Invalid companyId' });
    }

    const enabled = await tenantModuleConfigService.getEnabledModulesForCompany(req.pool, companyId);
    return res.json({ enabledModules: enabled });
  } catch (err) {
    return next(err);
  }
});

export default router;
