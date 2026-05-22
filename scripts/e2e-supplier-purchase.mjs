/**
 * E2E: login → create supplier → list suppliers → create purchase (save-only path).
 * Usage (PowerShell):
 *   $env:E2E_API_BASE='http://localhost:5000'
 *   $env:E2E_USER='you@example.com'; $env:E2E_PASS='yourpassword'
 *   node scripts/e2e-supplier-purchase.mjs
 */
const base = (process.env.E2E_API_BASE || 'http://localhost:5000').replace(/\/$/, '');
const username = process.env.E2E_USER || '';
const password = process.env.E2E_PASS || '';

if (!username || !password) {
  console.error('Set E2E_USER and E2E_PASS environment variables.');
  process.exit(1);
}

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}: ${json?.message || text}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

const stamp = Date.now();
const supplierCode = `T${String(stamp).slice(-8)}`;

console.log('1) Login…');
const login = await api('/api/auth/login', {
  method: 'POST',
  body: { username, password },
});
const token = login.accessToken;
const stationId = login.session?.user?.stationId;
if (!token) throw new Error('No accessToken');
if (stationId == null || Number(stationId) < 1) {
  throw new Error('No stationId (branch) on session — set staff branch in DB.');
}
const branchId = Number(stationId);
console.log('   OK — branchId from session:', branchId);

console.log('2) Create supplier…', supplierCode);
const created = await api('/api/suppliers', {
  method: 'POST',
  token,
  body: {
    supplierCode,
    supplierName: `E2E Supplier ${stamp}`,
    mobileNo: '500000001',
    email: `e2e-${stamp}@example.test`,
  },
});
const supplierId = created.supplierId;
if (!supplierId) throw new Error('No supplierId in response');
console.log('   OK — supplierId:', supplierId);

console.log('3) List suppliers (contains new id)…');
const list = await api(`/api/suppliers?limit=500`, { token });
const found = (list.suppliers || []).some((s) => Number(s.supplierId) === Number(supplierId));
if (!found) throw new Error('New supplier not in list');
console.log('   OK');

console.log('4) Load one product for branch…');
const prodRes = await api(`/api/products?branchId=${branchId}`, { token });
const products = prodRes.products || [];
if (!products.length) throw new Error('No products for branch — add a product first.');
const p0 = products[0];
const productId = Number(p0.productId);
if (!productId) throw new Error('Invalid product row');
console.log('   OK — productId:', productId, p0.productCode || '');

const line = {
  productId,
  qty: 1,
  focQty: 0,
  actualCost: 10.5,
  sellingPrice: 10.5,
  discPct: 0,
  discAmt: 0,
  subTotal: 10.5,
  vatPct: 5,
  vatAmt: 0.53,
  total: 11.03,
  unitName: 'PCS',
};

console.log('5) POST purchase (no GRN/LPO)…');
const purchaseBody = {
  branchId,
  supplierId,
  grnId: null,
  lpoMasterId: null,
  supplierInvoiceNo: `INV-E2E-${stamp}`,
  purchaseDate: new Date().toISOString().slice(0, 10),
  invoiceAmount: 11.03,
  netAmount: 11.03,
  paymentMode: 'Cash',
  paymentNow: true,
  remark: 'E2E script',
  lines: [line],
};

const saved = await api('/api/purchases', { method: 'POST', token, body: purchaseBody });
console.log('   OK — purchase:', saved);

console.log('\nAll steps passed.');
