import { Router } from 'express';
import * as stationController from '../controllers/station.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const stationRouter = Router();

stationRouter.use(authMiddleware);
stationRouter.get('/',                requireAnyFeature(['core.users']), stationController.listStations);
stationRouter.post('/',               requireAnyFeature(['core.users']), stationController.createStation);
stationRouter.patch('/:stationId',    requireAnyFeature(['core.users']), stationController.updateStation);
stationRouter.delete('/:stationId',   requireAnyFeature(['core.users']), stationController.deleteStation);
