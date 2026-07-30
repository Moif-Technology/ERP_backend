import { Router } from 'express';
import * as bio from '../controllers/biometric.controller.js';

// Device-facing half of the biometric bridge.
//
// Deliberately NOT behind authMiddleware or requireFeature: the caller is the
// office push agent (attendance-api/adms-lite.js), which has no staff login and
// no session cookie. It presents a device token instead, and every handler
// resolves that token to a company/branch itself.
//
// Must be mounted BEFORE the session-protected hrRouter, because Express
// matches mounts in order and /api/hr/* would otherwise demand a staff JWT.
export const biometricDeviceRouter = Router();

// Lets the agent verify its token and see which tenant it is pushing as,
// without sending any data.
biometricDeviceRouter.get('/ping', bio.devicePing);

// The push itself: a batch of per-person-per-day totals.
biometricDeviceRouter.post('/sync', bio.deviceSync);

// The agent polls this; claiming is a side effect of reading.
biometricDeviceRouter.get('/jobs', bio.deviceJobs);
biometricDeviceRouter.post('/jobs/:jobId/failed', bio.deviceJobFailed);
