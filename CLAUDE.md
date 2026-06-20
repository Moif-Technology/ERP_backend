## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)

---

## API Building Conventions

### Folder Structure

Every module follows this structure:

```
api/src/<module>/
  controllers/<name>.controller.js   ← req/res only, calls service
  services/<name>.service.js         ← all business logic
  repositories/<name>.repository.js  ← raw SQL only, no business logic
  routes/<module>.routes.js          ← Express router, auth middleware
```

Existing modules: `backoffice`, `accounts`, `garage`, `crm`, `hr`, `van`, `pos/restaurant-pos`, `pos/counter-pos`, `core`, `shared`

---

### Document Sequence — when exactly to call `nextDocNo`

**Decision rule — call `nextDocNo` only when ALL three are true:**
1. You are **inserting a new business record** (not updating, not deleting)
2. That record has a **code or number field** that humans use to reference it (printed on invoices, shown in reports, told to customers/suppliers)
3. That code must be **sequential and auto-generated** (not typed by the user, not a UUID)

**Examples — YES, use `nextDocNo`:**
- Creating a sales invoice → `invoice_no` (INV-0001)
- Creating a customer → `customer_code` when auto-generate is requested (CUS-00001)
- Creating a job card → `jc_no` (JC-00001)
- Creating an employee → `employee_code` when auto-generate is requested (EMP-00001)

**Examples — NO, do NOT use `nextDocNo`:**
- Any internal DB primary key (`sales_id`, `job_card_id`) — these are auto-increment integers, never sequential business codes
- `account_no` in chart of accounts — accountant sets this manually
- `project_no` — set manually by user
- `barcode` on a product — use a separate barcode generator if needed
- Any UPDATE or DELETE operation

**Never use `MAX(id)+1`, custom counter tables, or `regexp_replace` tricks for business codes.**
Those patterns already exist in legacy repos — do not copy them for new services.

```js
import { nextDocNo } from '../../shared/services/docSequence.service.js';

// Inside withTransaction:
const invoiceNo = await nextDocNo(client, {
  companyId,
  branchId,
  sequenceCode: 'SALES',          // see full list below
  fiscalYear: new Date().getFullYear(), // omit for NEVER-reset sequences
});
// → "INV-0001"
```

**Rules:**
- MUST be called inside a `withTransaction` block (uses atomic UPDATE…RETURNING)
- Auto-provisions the sequence row for new companies/branches/fiscal years — no manual seed needed
- `fiscalYear` required for YEARLY sequences, omit for NEVER sequences

**All valid sequence codes:**

| sequenceCode | Format | resetRule | Module |
|---|---|---|---|
| `GROUP` | GRP001 | NEVER | BACKOFFICE |
| `SUB_GROUP` | SGP001 | NEVER | BACKOFFICE |
| `SUB_SUB_GROUP` | SSG001 | NEVER | BACKOFFICE |
| `CUSTOMER` | CUS-00001 | NEVER | BACKOFFICE |
| `SUPPLIER` | SUP-00001 | NEVER | BACKOFFICE |
| `PRODUCT` | PRD-000001 | NEVER | BACKOFFICE |
| `SALES` | INV-0001 | YEARLY | BACKOFFICE |
| `SALES_RETURN` | RTN-0001 | YEARLY | BACKOFFICE |
| `PURCHASE` | PO-0001 | YEARLY | BACKOFFICE |
| `PURCHASE_RETURN` | PRN-0001 | YEARLY | BACKOFFICE |
| `GRN` | GRN-0001 | YEARLY | BACKOFFICE |
| `QUOTATION` | QT-0001 | YEARLY | BACKOFFICE |
| `LPO` | LPO-0001 | YEARLY | BACKOFFICE |
| `DELIVERY` | DO-0001 | YEARLY | BACKOFFICE |
| `TRANSFER` | TRF-0001 | YEARLY | BACKOFFICE |
| `STOCK_ADJ` | SA-0001 | YEARLY | BACKOFFICE |
| `STOCK_DMG` | DM-00001 | YEARLY | BACKOFFICE |
| `STOCK_ASE` | AS-00001 | YEARLY | BACKOFFICE |
| `OPENING_STOCK` | OS-0001 | YEARLY | BACKOFFICE |
| `MATERIAL_REQUEST` | MRQ-0001 | YEARLY | BACKOFFICE |
| `ORDER_FORM` | OF-0001 | YEARLY | BACKOFFICE |
| `VAN_SALES` | VS-0001 | YEARLY | BACKOFFICE |
| `VAN_SETTLEMENT` | VST-0001 | YEARLY | BACKOFFICE |
| `RECEIPT` | RCP-0001 | YEARLY | ACCOUNTS |
| `PAYMENT` | PV-0001 | YEARLY | ACCOUNTS |
| `JOURNAL` | JV-0001 | YEARLY | ACCOUNTS |
| `CONTRA` | CV-0001 | YEARLY | ACCOUNTS |
| `DEBIT_NOTE` | DN-0001 | YEARLY | ACCOUNTS |
| `CREDIT_NOTE` | CN-0001 | YEARLY | ACCOUNTS |
| `EXPENSE` | EXP-0001 | YEARLY | ACCOUNTS |
| `INCOME` | INC-0001 | YEARLY | ACCOUNTS |
| `VOUCHER` | VCH-0001 | YEARLY | ACCOUNTS |
| `STAFF` | STF-00001 | NEVER | HR |
| `EMPLOYEE` | EMP-00001 | NEVER | HR |
| `LEAD` | LD-00001 | NEVER | CRM |
| `OPPORTUNITY` | OPP-00001 | NEVER | CRM |
| `JOB_CARD` | JC-00001 | YEARLY | GARAGE |
| `PRE_JOB_CARD` | PJC-00001 | YEARLY | GARAGE |
| `ESTIMATION` | EST-00001 | YEARLY | GARAGE |
| `GATE_PASS` | GP-00001 | YEARLY | GARAGE |
| `GARAGE_INVOICE` | GI-00001 | YEARLY | GARAGE |
| `PART_REQUEST` | PR-00001 | YEARLY | GARAGE |
| `SUBLET_LPO` | SLO-00001 | YEARLY | GARAGE |
| `SUBLET_JOB` | SJ-00001 | YEARLY | GARAGE |
| `TECHNICIAN` | TCH-0001 | NEVER | GARAGE |
| `KOT` | KOT-0001 | NEVER | RESTAURANT |
| `ADVANCE_PAYMENT` | ADV-0001 | YEARLY | RESTAURANT |
| `PRODUCTION` | PRO-0001 | YEARLY | RESTAURANT |
| `PRO_REQUEST` | PRQ-0001 | YEARLY | RESTAURANT |
| `PRO_RECEIPT` | PRC-0001 | YEARLY | RESTAURANT |
| `PARTY_ORDER` | POR-0001 | YEARLY | RESTAURANT |
| `HOLD_BILL` | HLD-0001 | NEVER | COUNTER_POS |
| `COUNTER_CLOSE` | CCL-0001 | YEARLY | COUNTER_POS |

**Intentional exceptions — do NOT migrate these to nextDocNo:**
- `restaurant-pos/services/sales.service.js` → `billNo` uses `salesRepo.nextBillNo` (MAX+1). Flutter app depends on plain integer format — changing would break printing and KOT linking.
- `counter-pos/services/sales.service.js` → `billNo = salesId` by design (Tally-style, bill number = DB primary key).
- `accounts/voucher.service.js` → voucher numbers managed via `voucher_type_master` table with per-type prefix config. Separate system, do not replace.

To preview next number without incrementing (for UI display only):
```js
import { peekNextDocNo } from '../../shared/services/docSequence.service.js';
const preview = await peekNextDocNo(pool, { companyId, branchId, sequenceCode: 'SALES', fiscalYear: 2026 });
```

---

### Standard Service Pattern

```js
import { withTransaction } from '../../config/db.js';
import { nextDocNo } from '../../shared/services/docSequence.service.js';
import * as repo from '../repositories/myDoc.repository.js';

export async function createMyDoc(pool, body, authStaff) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);

  return withTransaction(async (client) => {
    // advisory lock prevents duplicate codes under concurrent requests
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `schema.my_doc:${companyId}:${branchId}`,
    ]);

    const docNo = await nextDocNo(client, {
      companyId,
      branchId,
      sequenceCode: 'MY_SEQ',
      fiscalYear: new Date().getFullYear(), // omit if NEVER
    });

    return repo.insertMyDoc(client, { companyId, branchId, docNo, ...payload });
  });
}
```

---

### Standard Error Pattern

```js
const err = new Error('Field X is required');
err.status = 400;
throw err;
```

Status codes: `400` bad input, `401` not authenticated, `403` forbidden, `404` not found, `409` conflict (duplicate/already posted).

---

### Auth Context Helpers

```js
// Backoffice / general modules
const companyId = Number(authStaff.company_id);
const branchId  = authStaff.branch_id != null ? Number(authStaff.branch_id) : null;

// Garage / CRM modules (throws if missing)
import { requireCompanyId, requireBranchId } from '../../utils/crmHelpers.js';
const companyId = requireCompanyId(authStaff);
const branchId  = requireBranchId(authStaff, body); // also checks body.branchId
```

---

### Two Databases

- **Local dev**: `postgresql://postgres:admin@localhost:5432/moifone_uae`
- **Server (production)**: `postgresql://moif:404cd0a6...@localhost:5433/moifone_uae`

Run migrations and seeds on **both** databases.

Migration files: `api/database/migrations/NNN_description.sql`
Seed scripts: `api/scripts/`
