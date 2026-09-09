# Dashboard Module — Salon/Laundry Analytics API

Read-only API endpoints for real-time sales, staff, inventory, and customer analytics dashboards.

## Endpoints

### Counter Close (Shift Settlement)

**GET** `/api/salon-dashboard/counter-close/summary?date=YYYY-MM-DD`
- Shift summary: staff name, total revenue, transaction count, cash/card/credit breakdown
- Returns: `{ shift_id, staff_name, total_revenue, total_transactions, cash_revenue, card_revenue, credit_revenue, expenses, expected_cash }`

**GET** `/api/salon-dashboard/counter-close/pending-bills`
- List credit sales pending settlement
- Returns: `{ bills: [{bill_id, customer_name, amount, created_at}], count }`

**POST** `/api/salon-dashboard/counter-close/shift/:shiftId/close`
- Close shift with actual cash counted
- Body: `{ actualCash: number, notes?: string }`
- Returns: `{ success: true, message, shift_id }`

### Sales Analytics

**GET** `/api/salon-dashboard/sales?from=YYYY-MM-DD&to=YYYY-MM-DD`
- Daily sales summary
- Returns: `{ total_revenue, transaction_count, unique_customers }`

**GET** `/api/salon-dashboard/sales/products?from=YYYY-MM-DD&to=YYYY-MM-DD`
- Sales breakdown by product
- Returns: `{ products: [{product, revenue, count}] }`

**GET** `/api/salon-dashboard/sales/payment-methods?from=YYYY-MM-DD&to=YYYY-MM-DD`
- Sales breakdown by payment type
- Returns: `{ methods: [{method, amount}] }`

### Staff Performance

**GET** `/api/salon-dashboard/staff/performance?from=YYYY-MM-DD&to=YYYY-MM-DD`
- Per-staff sales metrics
- Returns: `{ staff: [{staff_id, name, total_revenue, transaction_count, total_tips, avg_transaction, performance_rating}] }`

### Inventory

**GET** `/api/salon-dashboard/inventory/stock`
- Stock levels with reorder/minimum levels
- Returns: `{ items: [{item_id, name, sku, current_stock, minimum_stock, reorder_level, unit, status}] }`
- Status: `ok`, `low`, `critical`

### Customers

**GET** `/api/salon-dashboard/customers/ledger`
- Customer credit balances and transaction history
- Returns: `{ entries: [{customer_id, name, total_debit, total_credit, balance, last_transaction}] }`

**GET** `/api/salon-dashboard/customers/unpaid-bills`
- Outstanding bills with overdue days
- Returns: `{ bills: [{bill_id, customer_name, amount, days_overdue, created_at}] }`

## Authentication

All endpoints require:
- Valid JWT token (from `/api/auth/login`)
- Authorization header: `Authorization: Bearer <token>`
- User must have `dashboard` feature enabled in entitlements

## Database Tables

Queries read from:
- `pos.shift_master` — Shifts, staff, revenue
- `pos.sales_master` — Transactions, amounts, billing status
- `pos.sales_line_item` — Products per sale
- `pos.payment_master` — Payment methods
- `core.product_master` — Product names, min/reorder levels
- `inventory.stock_master` — Current stock levels
- `core.customer_master` — Customer names, status
- `hr.staff_master` — Staff names, status

## Examples

### Get today's shift summary
```bash
curl -H "Authorization: Bearer TOKEN" \
  "http://localhost:5010/api/salon-dashboard/counter-close/summary?date=2024-08-06"
```

### Get sales by product (this month)
```bash
curl -H "Authorization: Bearer TOKEN" \
  "http://localhost:5010/api/salon-dashboard/sales/products?from=2024-08-01&to=2024-08-31"
```

### Get staff performance (this week)
```bash
curl -H "Authorization: Bearer TOKEN" \
  "http://localhost:5010/api/salon-dashboard/staff/performance?from=2024-08-01&to=2024-08-07"
```

### Close a shift
```bash
curl -X POST -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"actualCash": 35250, "notes": "Verified till receipt"}' \
  "http://localhost:5010/api/salon-dashboard/counter-close/shift/shift-001/close"
```

## Performance Notes

- All queries are **read-only** (SELECT only)
- No transactions needed
- Client connections pooled per request, released immediately
- Date filters use efficient indexing on `created_at` (assumed present)

## Design Notes

- **Read-only by design**: Dashboard is analytical, not transactional
- **Company/Branch scoped**: All queries filtered by auth staff's company_id + branch_id
- **No aggregation logic in DB**: Raw sums/counts only; frontend does calculations
- **Consistent naming**: camelCase in responses, snake_case in DB

## Future Enhancements

- Add caching layer (Redis) for expensive queries
- Add time-series aggregation (hourly, daily, weekly)
- Add CSV export endpoints
- Add filtered views (by staff, product category, payment method)
- Add real-time WebSocket updates for shift-in-progress metrics
