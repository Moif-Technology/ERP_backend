import { pool } from '../config/db.js';
import * as deliveryOrderService from '../services/deliveryOrder.service.js';

export async function createDeliveryOrder(req, res) {
  try {
    const result = await deliveryOrderService.createDeliveryOrder(pool, req.body, req.authStaff);
    return res.status(201).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    if (err.code === '42P01' || err.code === '23503') {
      return res.status(503).json({
        message:
          err.code === '42P01'
            ? 'Delivery order tables not installed. Run database/migrations/024_ops_delivery_order.sql'
            : 'Invalid reference (customer, product, branch, or quotation).',
      });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not create delivery order' });
  }
}

export async function getDeliveryOrder(req, res) {
  try {
    const result = await deliveryOrderService.getDeliveryOrder(
      pool,
      req.authStaff,
      req.params.deliveryOrderId,
    );
    return res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'Delivery order tables not installed.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load delivery order' });
  }
}

export async function listDeliveryOrders(req, res) {
  try {
    const rows = await deliveryOrderService.listDeliveryOrders(pool, req.authStaff, req.query);
    return res.json({ deliveryOrders: rows });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'Delivery order tables not installed.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not list delivery orders' });
  }
}
