import { Router } from 'express';
import {
  requirePlatformAuth,
  requireCapability,
} from '../../middleware/platformAuth.middleware.js';
import * as repo from '../repositories/catalog.repository.js';

export const catalogRouter = Router();

catalogRouter.use(requirePlatformAuth);

function handle(res, p) {
  return p.then((d) => res.json(d)).catch((e) => res.status(e.status || 500).json({ message: e.message }));
}

catalogRouter.get('/features', requireCapability('feature.manage'), (req, res) =>
  handle(res, repo.listFeatures().then((rows) => ({ features: rows })))
);
catalogRouter.put('/features', requireCapability('feature.manage'), (req, res) =>
  handle(res, repo.upsertFeature(req.body).then((row) => ({ feature: row })))
);

catalogRouter.get('/limits', requireCapability('limit.manage'), (req, res) =>
  handle(res, repo.listLimits().then((rows) => ({ limits: rows })))
);
catalogRouter.put('/limits', requireCapability('limit.manage'), (req, res) =>
  handle(res, repo.upsertLimit(req.body).then((row) => ({ limit: row })))
);

catalogRouter.get('/plans', requireCapability('plan.manage'), (req, res) =>
  handle(res, repo.listPlans().then((rows) => ({ plans: rows })))
);
catalogRouter.put('/plans', requireCapability('plan.manage'), (req, res) =>
  handle(res, repo.upsertPlan(req.body || {}).then((row) => ({ plan: row })))
);
catalogRouter.get('/plans/:planCode/features', requireCapability('plan.manage'), (req, res) =>
  handle(res, repo.listPlanFeatures(req.params.planCode).then((rows) => ({ features: rows })))
);
catalogRouter.put('/plans/:planCode/features', requireCapability('plan.manage'), (req, res) =>
  handle(
    res,
    repo
      .setPlanFeature(req.params.planCode, req.body?.featureCode, !!req.body?.isEnabled)
      .then((row) => ({ planFeature: row }))
  )
);
catalogRouter.get('/plans/:planCode/limits', requireCapability('plan.manage'), (req, res) =>
  handle(res, repo.listPlanLimits(req.params.planCode).then((rows) => ({ limits: rows })))
);
catalogRouter.put('/plans/:planCode/limits', requireCapability('plan.manage'), (req, res) =>
  handle(
    res,
    repo
      .setPlanLimit(req.params.planCode, req.body?.limitCode, Number(req.body?.limitValue))
      .then((row) => ({ planLimit: row }))
  )
);
