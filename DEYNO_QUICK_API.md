# Deyno Quick — backend API reference

Deyno Quick (`Deyno_Quick/`, React 19 + Vite + TS) is a device-enrolled
quick-service restaurant till. It talks to the existing ERP API at
**`/api/pos`** — the `RESTAURANT-POS` namespace it shares with the Flutter
RestaurantPOS client.

No new software type, no new station type, no migration. Deyno Quick is a
restaurant POS: `station_type = 'RESTAURANT_POS'`, role
`software_type = 'RESTAURANT-POS'` (or `ERP`).

## Tenant prerequisites

Enrollment fails without these. All are existing Backoffice screens.

1. A station of type **`RESTAURANT_POS`** for the company
   (Backoffice → Stations, or `POST /api/stations`). Without one,
   `/device/stations` returns `NO_RESTAURANT_STATION`.
2. The company's plan must grant the **`pos`** feature pack. Every protected
   route sits behind `requireFeature('pos')`.
3. Staff who will sign in need a **PIN** set (`core.staff_master.staff_pin`)
   and a role whose `software_type` is `RESTAURANT-POS` or `ERP`.
4. The enrolling admin needs `role_id = 1`, or a role name containing
   `admin`/`owner`.
5. Per-feature gates for the optional surfaces:
   `pos.billing`, `pos.settlement`, `pos.counter_open_close`,
   `pos.cash_in_out`, `pos.counter_reports`, `pos.kot`.

## Auth

Two paths with **different token scopes**. Do not mix them — crossing the two
is what produces "Session expired" on the request right after a successful
login.

| Path | Endpoints | Token | Session type |
|---|---|---|---|
| Device + PIN (**Deyno Quick uses this**) | `/device/*` | POS-scoped (`scope:'pos'`, station in `sid`) | `pos` |
| Username + password (Flutter, legacy) | `/login`, `/pin-login`, `/staff-list` | ERP-scoped | `erp` |

A POS-scoped token is walled to `/api/pos/*`, `/api/counter-pos/*`,
`/api/salon-pos/*` plus the catalogue whitelist
(`/api/groups`, `/api/sub-groups`, `/api/areas`, `/api/tables`,
`/api/products`, `/api/customers`). Anything else returns 403.

### Enrollment flow

```
1. POST /api/pos/device/stations    { adminUsername, adminPassword }
                                    -> { companyId, companyName, stations[] }
2. POST /api/pos/device/enroll      { adminUsername, adminPassword,
                                      deviceToken, stationId, label? }
                                    -> { companyId, branchId, stationId,
                                         stationName, counterNo }
3. POST /api/pos/device/staff-list  { deviceToken }
                                    -> { companyId, stationId, counterNo, staff[] }
4. POST /api/pos/device/pin-login   { deviceToken, companyId, staffId, pin }
                                    -> { accessToken, refreshToken, stationId,
                                         staffID, staffName, roleId, roleName,
                                         companyId, counterNo, features,
                                         limits, permissions, subscription }
```

`deviceToken` is generated and persisted client-side
(`src/utils/deviceEnrollment.ts`). `staffId` in step 4 is the `staffPk` from the
step-3 picker (`core.staff_master.id`), so exactly one bcrypt compare runs.

All four `/device/*` endpoints are rate-limited by `authLimiter`
(30 req/min per source IP) in `api/src/index.js`.

**Known gap, deliberately left alone:** the three legacy endpoints
(`/api/pos/login`, `/pin-login`, `/staff-list`) are still unlimited. They carry
the same brute-force exposure and counter-pos/salon-pos limit their equivalents,
but the Flutter RestaurantPOS in production PIN-logs per order and the limit is
keyed per source IP — several tills behind one NAT would start getting 429s
mid-service. Closing this needs a per-device rate key or a higher ceiling first,
and is out of scope for the Deyno Quick build.

## Endpoint map — apiService method → route

| `apiService.ts` method | Route |
|---|---|
| `enrollListStations` | `POST /api/pos/device/stations` |
| `enrollDevice` | `POST /api/pos/device/enroll` |
| `fetchPosStaffList`, `fetchStaff` | `POST /api/pos/device/staff-list` |
| `pinLogin` | `POST /api/pos/device/pin-login` |
| `login` | `POST /api/pos/login` |
| `fetchParameters` | `GET /api/pos/parameters` |
| `saveCompanyDetails` | `PUT /api/pos/parameters/company-details` |
| `fetchPrivileges` | `GET /api/pos/privileges` |
| `verifySupervisor` | `POST /api/pos/supervisor/verify` |
| `saveKot` | `POST /api/pos/kot/save` |
| `fetchOrderList` | `GET /api/pos/kot/list` |
| `fetchKotDetails` | `GET /api/pos/kot/:kotMasterId` |
| `saveSettlement` | `POST /api/pos/sales/settle` |
| — (bill no preview) | `GET /api/pos/sales/next-bill-no` |
| `fetchSalesViewer` | `GET /api/pos/sales/viewer` |
| `fetchSalesViewerBill` | `GET /api/pos/sales/viewer/:salesId` |
| `fetchSalesReport('salesman-wise')` | `GET /api/pos/sales/reports/salesman-wise` |
| `fetchSalesReport('item-wise')` | `GET /api/pos/sales/reports/item-wise` |
| `fetchSalesReport('group-wise')` | `GET /api/pos/sales/reports/group-wise` |
| (staff-wise counter report) | `GET /api/pos/sales/staff-wise` |
| `fetchCounterSummary` | `GET /api/pos/counter/summary?counterNo=` |
| `closeCounter` | `POST /api/pos/counter/close` |
| (close history) | `GET /api/pos/counter/history`, `/history/:closeId` |
| (cash in/out) | `GET|POST /api/pos/counter/cash-in-out`, `GET /cash-in-out/report` |
| `fetchCreditSettlementCustomers` | `GET /api/pos/settlement/credit-customers` |
| `fetchCustomerOutstandingBills` | `GET /api/pos/settlement/customers/:customerId/bills` |
| `saveCreditSettlement` | `POST /api/pos/settlement/save` |
| `fetchCreditSettlementHistory` | `GET /api/pos/settlement/history` |
| `fetchCreditSettlementReceipt` | `GET /api/pos/settlement/receipts/:transactionId` |
| `fetchGroups`, `createGroup`, `updateGroup`, `deleteGroup` | `/api/groups` |
| `fetchProducts`, `createProduct`, `updateProduct` | `/api/products` |
| `fetchCustomers`, `createCustomer`, `updateCustomer` | `/api/customers` |
| `fetchTables` | `/api/tables` |

`occupyTable` / `freeTable` have no backend route. The Select Table flow was
removed from the client (commit `88f77c5`) — delete those two methods rather
than building endpoints for them.

## What was added vs. reused

**New** (`api/src/pos/restaurant-pos/`):

- `services/deviceAuth.service.js` — RESTAURANT_POS enroll / staff picker /
  PIN login. Modelled on the salon implementation; reuses counter-pos's
  `device.repository.js` and `staff.repository.js` (generic SQL over
  `core.pos_device_enrollment` and `core.staff_master`).
- `controllers/deviceAuth.controller.js` — HTTP layer, POS session registration
  and the plan's concurrent-session cap.
- `controllers/sales.controller.js` gained `nextBillNo`.

**Reused, not forked** — counter reading, credit settlement and the sales
viewer are all driven purely by `req.authStaff` and read/write the same
`ops.sales_master` / `ops.sales_child` / `ops.sales_payment_split` rows this
product already writes. Salon-POS reuses them for the same reason. Restaurant
settle writes every column those reports read (`staff_id`, `cash_amount`,
`credit_card_amount`, `credit_amount`, `subtotal_amount`, `taxable_amount`,
tax amounts, `round_off_adjustment`, `amount`, `station_id`, `counter_no`).

**One deliberate non-reuse:** `/sales/next-bill-no` uses restaurant's own
handler. Counter-pos numbers bills company-wide (`MAX(bill_no)` per
`company_id`); restaurant settle numbers **per station**
(`company_id + station_id`). Mounting the counter-pos handler would preview a
bill number settle never assigns on a multi-till site.

## Frontend wiring (done)

- `../Deyno_Quick/src/lib/api.ts` — HTTP client. Bearer token from
  `SessionManager`, `ApiError` carrying `status` + server `code`, and a
  `setUnauthorizedHandler` hook for 401s.
- `vite.config.ts` — `/api` proxied to `VITE_API_PROXY_TARGET`
  (default `https://api.moifone.com`), so dev has no CORS to configure.
- `src/api/apiService.ts` — every method now calls the API. Signatures and
  return shapes are unchanged, so no component needed editing.
- `src/components/auth/EnrollScreen.tsx` + `PinLoginScreen.tsx` — **new**. The
  mock build auto-provisioned a session from seed data, so neither screen
  existed; with a real API there is no other way to get a token.
- `src/components/SessionGate.tsx` — routes enroll → PIN → POS, and returns to
  PIN on any protected 401.
- `src/data/mock{Catalogue,Customers,Staff,Stations,Tables}.ts` — deleted.
  `mockReservations.ts` stays: there is no reservations endpoint.

`CORS_ORIGINS` in `api/.env` already includes `http://localhost:5174`
(Deyno Quick's dev port). Production needs the deployed origin added to
`api/.env.production`.

### No token refresh — deliberate

The client does not retry a 401 with `refreshToken`, because
`POST /api/auth/refresh` cannot serve a POS session:

1. It gates on `hasActiveSession(pool, staffPk, 'erp')`
   ([auth.service.js:248](src/core/services/auth.service.js#L248)), and a
   device PIN login registers a `'pos'` session — so it returns
   "Session expired" every time.
2. It re-signs with `signAccessToken`, not `signPosAccessToken`, so the new
   token would carry no `scope` and no `sid`. The till would silently lose its
   station binding and start writing KOTs against the staff row's default
   station.

The POS access token lives 8 hours (`JWT_POS_ACCESS_EXPIRES`), matching the
session registration — one shift. A 401 therefore means the shift is over: the
client clears the staff session and shows the PIN screen again. Enrollment
survives, so it is four digits, not a re-setup.

Fixing this properly means teaching `refreshAccessToken` to detect a POS
session and re-sign with `signPosAccessToken` + the enrolled station. Worth
doing before any deployment that shortens `JWT_POS_ACCESS_EXPIRES`.

### Known gaps

- **Reservations** — no endpoint. `src/data/mockReservations.ts` is still seed
  data and resets on reload.
- **KOT list columns** — `GET /pos/kot/list` returns `KotNumber`, `KotPrefix`,
  `KotTime`, `Amount`, `AreaName`, `TableName`, but no customer or waiter name.
  `JobListDialog` falls back to "Walk-in" and blank for those two columns.
- **Table occupancy** — `GET /api/tables` has no per-table status, so
  `fetchTables` reports every table available. The Select Table flow was
  removed from this client (commit `88f77c5`), so nothing reads it today.

## Tests

`api/test/quickPos.routes.test.mjs` (in `npm test`) pins the route surface:
every endpoint above is mounted, the four public device endpoints sit ahead of
`authMiddleware`, the `/sales` sub-router precedes the `/sales/*` viewer routes,
and `next-bill-no` is the restaurant handler rather than the counter-pos one.
No DB required — `pg.Pool` connects lazily.
