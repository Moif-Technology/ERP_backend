import * as moduleService from '../services/moduleConfig.service.js';

export async function getModuleConfig(req, res, next) {
  try {
    const { roleId } = req.params;
    const config = await moduleService.getModuleConfig(req.db, req.authStaff, roleId);
    res.json({ modules: config });
  } catch (err) {
    next(err);
  }
}

export async function updateModuleConfig(req, res, next) {
  try {
    const { roleId } = req.params;
    const { modules } = req.body;
    const config = await moduleService.updateModuleConfig(req.db, req.authStaff, roleId, modules);
    res.json({ modules: config });
  } catch (err) {
    next(err);
  }
}

export async function getAvailableModules(req, res, next) {
  try {
    const modules = await moduleService.getModuleDefinitions(req.db);
    res.json({ modules });
  } catch (err) {
    next(err);
  }
}
