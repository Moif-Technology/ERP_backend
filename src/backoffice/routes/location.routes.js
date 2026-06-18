import { Router } from 'express';
import * as locationController from '../controllers/location.controller.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireAnyFeature } from '../../middleware/entitlementMiddleware.js';

export const locationRouter = Router();

locationRouter.use(authMiddleware);
locationRouter.use(requireAnyFeature(['backoffice.product_master', 'core.users']));

locationRouter.get('/',                locationController.listLocations);
locationRouter.post('/',               locationController.createLocation);
locationRouter.patch('/:locationId',   locationController.updateLocation);
locationRouter.delete('/:locationId',  locationController.deleteLocation);
