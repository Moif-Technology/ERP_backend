import { pool } from '../config/db.js';
import * as productService from '../services/product.service.js';

export async function listProducts(req, res) {
  try {
    const products = await productService.listProducts(pool, req.authStaff, req.query);
    return res.json({ products });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'Product tables not installed. Run database/migrations/013_core_product_master_inventory.sql' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load products' });
  }
}

export async function createProduct(req, res) {
  try {
    const created = await productService.createProduct(pool, req.body, req.authStaff);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    if (err.code === '23505') {
      const c = String(err.constraint || '');
      const dupCode = c.includes('product_code') || c.includes('uq_core_product_master_company_product_code');
      return res.status(409).json({
        message: dupCode
          ? 'Product code already exists for this company'
          : 'Duplicate product row',
        constraint: c || undefined,
      });
    }
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'Product tables not installed. Run database migrations.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not create product' });
  }
}


export async function getProduct(req, res) {
  try {
    const product = await productService.getProduct(pool, req.authStaff, req.params.id, req.query);
    return res.json({ product });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'Product tables not installed.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not load product' });
  }
}
 
export async function updateProduct(req, res) {
  try {
    const updated = await productService.updateProduct(pool, req.params.id, req.body, req.authStaff);
    return res.json(updated);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'Product tables not installed.' });
    }
    if (err.code === '23505') {
      const c = String(err.constraint || '');
      const dupCode = c.includes('product_code') || c.includes('uq_core_product_master_company_product_code');
      return res.status(409).json({
        message: dupCode
          ? 'Product code already exists for this company'
          : 'Duplicate product row',
        constraint: c || undefined,
      });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not update product' });
  }
}
