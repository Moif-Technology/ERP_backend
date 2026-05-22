# Moifone ERP API — structure and next steps

## Layering (3 + 1)

Every feature should follow this flow:

| Layer | Responsibility |
|--------|----------------|
| **Route** (`src/routes/*.routes.js`) | HTTP path + verb only; attach middleware. |
| **Controller** (`src/controllers/*.controller.js`) | Read `req`, call services, set `res` status/body; map errors to HTTP. |
| **Service** (`src/services/*.service.js`) | Business rules, orchestration, hashing, token issuance — no raw SQL. |
| **Repository** (`src/repositories/*.repository.js`) | SQL and parameter binding — no Express types. |
| **Middleware** (`src/middleware/*.js`) | Cross-cutting (e.g. JWT → `req.authStaff`). |

Supporting modules:

- `src/config.js` — env and app config.
- `src/config/db.js` — `pg` pool and `withTransaction`.
- `src/services/session.js` — maps DB rows to the ERP frontend session DTO.

## Current layout

```text
api/
  src/
    index.js
    config.js
    config/db.js
    routes/auth.routes.js
    controllers/auth.controller.js
    services/auth.service.js
    services/registration.service.js
    services/token.service.js
    services/session.js
    repositories/staff.repository.js
    repositories/company.repository.js
    repositories/branch.repository.js
    repositories/onboarding.repository.js
    repositories/plan.repository.js
    services/plan.service.js
    routes/plan.routes.js
    routes/staff.routes.js
    pos/                    ← Flutter POS / AdminMainDesktop (`/api/pos/*`)
      pos.routes.js         ← mounts `/login` (public), then JWT + `/kot`, `/parameters`, …
      controllers/          ← POS HTTP handlers (login response shape, parameters, …)
      services/             ← POS-only business (e.g. parameter → Flutter DTO); may call `src/services/*` for shared auth
      repositories/         ← POS-specific SQL (e.g. parameter values)
      routes/               ← sub-routers (e.g. `kot.routes.js`)
    controllers/plan.controller.js
    middleware/authMiddleware.js
```

## Endpoints

- **Public (no auth):** `GET /api/plans` — active pricing rows from `core.plan_master` (for Moifone / marketing UIs).
- `POST /api/auth/register` — Moifone signup (plan must exist and be active in `plan_master`).
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/welcome/complete`, `POST /api/auth/refresh` — ERP session.
- `GET /api/staff/branches`, `POST /api/staff` — create staff user for signed-in company (auth required).
- **`/api/pos/*`** — AdminMainDesktop (Flutter): **`POST /api/pos/login`** (public; legacy session shape + JWT via shared `auth.service`), then JWT-protected **`/parameters`**, **`/kot/*`**, **`/sales/settle`**, etc. See `src/pos/`. **Do not duplicate** credential verification in `pos/` — reuse `services/auth.service.js`.

## Frontend (ERP) next steps

The previous monolithic `API_INTEGRATION_PLAN` was removed. For the React app, evolve toward:

- Env-driven `VITE_API_BASE_URL` (already used).
- Optional: TanStack Query, service + adapter split per module, no Axios in pages — add incrementally when you build dashboard and domain modules.

## Running

Copy `.env.example` to `.env`, run `npm start` from `api/` for a single run, or **`npm run dev`** for **nodemon** (restarts on `src/**` changes). Apply SQL under `database/migrations/` before first registration.

**Full-stack wiring (Moifone + ERP + DB tables/columns):** see [`docs/MOIFONE_ERP_INTEGRATION.md`](../docs/MOIFONE_ERP_INTEGRATION.md) at repo root.
