import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/entitlementMiddleware.js';
import * as ctrl from '../controllers/dealsOffers.controller.js';

export const dealsOffersRouter = Router();

dealsOffersRouter.use(authMiddleware);
dealsOffersRouter.use(requireFeature('backoffice.deals_offers'));

// Discount entries
dealsOffersRouter.get('/discounts',            ctrl.listDiscounts);
dealsOffersRouter.post('/discounts',           ctrl.createDiscount);
dealsOffersRouter.put('/discounts/:id',        ctrl.updateDiscount);
dealsOffersRouter.delete('/discounts/all',     ctrl.deleteAllDiscounts);
dealsOffersRouter.delete('/discounts/:id',     ctrl.deleteDiscount);

// Gift vouchers
dealsOffersRouter.get('/gift-vouchers',            ctrl.listGiftVouchers);
dealsOffersRouter.post('/gift-vouchers',           ctrl.createGiftVoucher);
dealsOffersRouter.put('/gift-vouchers/:id',        ctrl.updateGiftVoucher);
dealsOffersRouter.delete('/gift-vouchers/all',     ctrl.deleteAllGiftVouchers);
dealsOffersRouter.delete('/gift-vouchers/:id',     ctrl.deleteGiftVoucher);

// Offer packets
dealsOffersRouter.get('/offer-packets',         ctrl.listOfferPackets);
dealsOffersRouter.post('/offer-packets',        ctrl.createOfferPacket);
dealsOffersRouter.get('/offer-packets/:id',     ctrl.getOfferPacket);
dealsOffersRouter.delete('/offer-packets/:id',  ctrl.deleteOfferPacket);

// Packing entries
dealsOffersRouter.get('/packing-entries',            ctrl.listPackingEntries);
dealsOffersRouter.post('/packing-entries',           ctrl.createPackingEntry);
dealsOffersRouter.put('/packing-entries/:id',        ctrl.updatePackingEntry);
dealsOffersRouter.delete('/packing-entries/all',     ctrl.deleteAllPackingEntries);
dealsOffersRouter.delete('/packing-entries/:id',     ctrl.deletePackingEntry);

// Unpacking entries
dealsOffersRouter.get('/unpacking-entries',            ctrl.listUnpackingEntries);
dealsOffersRouter.post('/unpacking-entries',           ctrl.createUnpackingEntry);
dealsOffersRouter.put('/unpacking-entries/:id',        ctrl.updateUnpackingEntry);
dealsOffersRouter.delete('/unpacking-entries/all',     ctrl.deleteAllUnpackingEntries);
dealsOffersRouter.delete('/unpacking-entries/:id',     ctrl.deleteUnpackingEntry);
