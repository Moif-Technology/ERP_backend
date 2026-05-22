# Moifone ERP Backend

Node.js and Express API for the Moifone ERP platform. This service powers the ERP web app, POS workflows, Counter POS, CRM, garage/workshop modules, accounts, inventory, HR, admin tenancy, plans, and entitlement checks.

## Tech Stack

- Node.js with ES modules
- Express 4
- PostgreSQL via `pg`
- JWT authentication
- bcrypt password hashing
- Node test runner
- Nodemon for local development

## Project Structure

```text
api/
  scripts/                 Migration, seed, and verification scripts
  src/
    admin/                 Platform admin, catalog, tenant management
    config/                Database config and shared app config
    controllers/           HTTP request/response handlers
    counter-pos/           Counter POS module
    middleware/            Auth, platform auth, entitlement guards
    pos/                   POS module, KOT, parameters, sales settlement
    repositories/          SQL and database access
    routes/                Express routers
    services/              Business logic and orchestration
    utils/                 Shared helpers
    index.js               App bootstrap and route mounting
  test/                    Node test runner tests
```

The codebase follows a simple flow:

```text
Route -> Controller -> Service -> Repository -> PostgreSQL
```

Routes should stay thin, controllers should handle HTTP mapping, services should hold business rules, and repositories should contain SQL.

## Main Modules

- Authentication and session management
- Platform plans and tenant onboarding
- Role, staff, branch, and company setup
- Products, groups, sub-groups, customers, suppliers, and stock entries
- Sales, purchases, quotations, LPO, GRN, delivery orders, and vouchers
- Accounts parameters, account heads, ledger, and trial balance support
- Deals and offers
- POS KOT, POS parameters, and POS sales settlement
- Counter POS counters, products, customers, and sales
- CRM leads, opportunities, followups, interactions, notes, and dashboard
- Garage/workshop masters, job cards, estimations, invoices, and monitoring
- Entitlements and platform admin APIs

## Requirements

- Node.js 18 or newer
- npm
- PostgreSQL database

## Environment Setup

Copy the example environment file:

```bash
cp .env.example .env
```

Then update `.env` with local values:

```env
PORT=5010
DATABASE_URL=postgresql://user:password@localhost:5432/moifone_erp
JWT_ACCESS_SECRET=change-me-access-secret-min-32-chars
JWT_REFRESH_SECRET=change-me-refresh-secret-min-32-chars
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

Keep `.env` private. Commit only `.env.example`.

## Install

```bash
npm install
```

## Run Locally

Development mode with automatic restart:

```bash
npm run dev
```

Production-style start:

```bash
npm start
```

By default the API runs on:

```text
http://localhost:5010
```

Health check:

```text
GET /health
```

## NPM Scripts

```bash
npm start                    # Start the API
npm run dev                  # Start with nodemon
npm test                     # Run unit tests
npm run test:accounts-schema # Verify accounts schema assumptions
npm run test:entitlements    # Verify entitlement setup
npm run migrate:entitlements # Run entitlement migration
npm run migrate:platform     # Run platform migration
npm run seed:platform-admin  # Seed platform admin user/data
npm run seed:test-tenants    # Seed test tenants
```

## Important API Prefixes

```text
/api/auth
/api/admin
/api/plans
/api/roles
/api/staff
/api/customers
/api/products
/api/sales
/api/purchases
/api/suppliers
/api/lpos
/api/grns
/api/vouchers
/api/account-heads
/api/account-parameters
/api/stock-entries
/api/deals-offers
/api/pos
/api/counter-pos
/api/crm/*
/api/garage/*
```

See `src/index.js` for the full route mount list.

## Database Notes

This API expects the PostgreSQL database schema used by the Moifone ERP platform. Migration and verification helpers live in `scripts/`.

Useful commands:

```bash
npm run migrate:platform
npm run migrate:entitlements
npm run test:accounts-schema
npm run test:entitlements
```

Run migrations before first login/registration in a new environment.

## Testing

Run:

```bash
npm test
```

Current tests cover entitlement service behavior and platform auth middleware behavior.

## Git and Ignored Files

The repository intentionally ignores:

- `node_modules/`
- `.env` and local env files
- generated `graphify-out/` output
- zip and log artifacts

Do not commit secrets, local database credentials, or generated dependency folders.

## Development Guidelines

- Reuse existing services before creating new flows.
- Keep SQL inside repositories.
- Keep Express `req` and `res` out of services and repositories.
- Add new routes in `src/routes/` or the relevant module folder.
- Add tests for shared logic, auth behavior, entitlement checks, and high-risk business rules.
- Keep API responses consistent with existing controllers.

