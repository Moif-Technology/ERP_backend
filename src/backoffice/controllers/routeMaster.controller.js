import { pool } from '../../config/db.js';
import * as routeService from '../services/routeMaster.service.js';

export async function listRoutes(req, res) {
  try {
    const routes = await routeService.listRoutes(pool, req.authStaff);
    return res.json({ routes });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load routes' });
  }
}

export async function createRoute(req, res) {
  try {
    const created = await routeService.createRoute(pool, req.body, req.authStaff);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') {
      const c = String(err.constraint || '');
      return res.status(409).json({
        message: c.includes('route_code')
          ? 'Route code already exists for this company'
          : 'Duplicate route record',
        constraint: c || undefined,
      });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not create route' });
  }
}

export async function updateRoute(req, res) {
  try {
    const updated = await routeService.updateRoute(pool, req.params.routeId, req.body, req.authStaff);
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Route code already exists for this company' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not update route' });
  }
}

export async function toggleRoute(req, res) {
  try {
    const updated = await routeService.toggleRoute(pool, req.params.routeId, req.authStaff);
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not toggle route status' });
  }
}

export async function listRouteCustomers(req, res) {
  try {
    const customers = await routeService.listRouteCustomers(pool, req.params.routeId, req.authStaff);
    return res.json({ customers });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not load route customers' });
  }
}

export async function setRouteCustomers(req, res) {
  try {
    const customers = await routeService.setRouteCustomers(pool, req.params.routeId, req.body, req.authStaff);
    return res.json({ customers });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') {
      return res.status(409).json({ message: 'One or more customers are already on this route' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not set route customers' });
  }
}

export async function removeRouteCustomer(req, res) {
  try {
    const result = await routeService.removeRouteCustomer(
      pool,
      req.params.routeId,
      req.params.custId,
      req.authStaff
    );
    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'Could not remove route customer' });
  }
}
