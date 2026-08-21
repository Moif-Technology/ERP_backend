import { pool } from '../../../config/db.js';
import * as repo from '../repositories/posParameter.repository.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RECEIPT_FLUTTER_KEYS = {
  heading1_counter: 'heading1Counter',
  heading2_counter: 'heading2Counter',
  heading3_counter: 'heading3Counter',
  heading4_counter: 'heading4Counter',
  heading5_counter: 'heading5Counter',
  heading6_counter: 'heading6Counter',
  heading7_counter: 'heading7Counter',
  tax_registration_no: 'taxRegistrationNo',
};

function coerceNum(raw) {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function coerceStr(raw) {
  if (raw == null) return '';
  const s = String(raw).trim();
  return s.toLowerCase() === 'null' ? '' : s;
}

// ---------------------------------------------------------------------------
// Merge definitions + company overrides → flat key→value map
// ---------------------------------------------------------------------------

function mergeSettings(definitions, storedJson) {
  const stored = storedJson && typeof storedJson === 'object' ? storedJson : {};
  const result = {};
  for (const def of definitions) {
    const key = def.parameter_key;
    result[key] = {
      value: Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : def.default_value,
      value_type: def.value_type,
    };
  }
  // Include saved company-detail keys even if definitions were not seeded yet.
  for (const key of repo.RECEIPT_SETTING_KEYS) {
    if (result[key]) continue;
    if (Object.prototype.hasOwnProperty.call(stored, key)) {
      result[key] = { value: stored[key], value_type: 'text' };
    }
  }
  return result;
}

function overlayReceiptSettings(payload, receiptPatch) {
  if (!receiptPatch || typeof receiptPatch !== 'object') return payload;
  for (const [storageKey, flutterKey] of Object.entries(RECEIPT_FLUTTER_KEYS)) {
    const val = receiptPatch[storageKey];
    if (val != null && String(val).trim() !== '') {
      payload[flutterKey] = String(val).trim();
    }
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Map merged settings → Flutter /parameters payload (exact field names)
// ---------------------------------------------------------------------------

function mapToFlutterPayload(merged) {
  const num = (key) => coerceNum(merged[key]?.value);
  const str = (key) => coerceStr(merged[key]?.value);

  const currencyPrec = num('currency_precision');

  return {
    Tax1: num('tax1'),
    currencyPrecession: currencyPrec == null ? null : String(currencyPrec),
    reportStartTime: str('report_start_time'),
    reportEndTime: str('report_end_time'),
    pendingKotCheck: num('pending_kot_check'),
    ISWaiterMandotory: num('is_waiter_mandatory'),
    ClearAfterKOTSave: num('clear_after_kot_save'),
    SaveKOTonSettlement: num('save_kot_on_settlement'),
    autoRoundOff: num('auto_round_off'),
    customerDisplayEnabled: num('customer_display_enabled'),
    heading1Counter: str('heading1_counter'),
    heading2Counter: str('heading2_counter'),
    heading3Counter: str('heading3_counter'),
    heading4Counter: str('heading4_counter'),
    heading5Counter: str('heading5_counter'),
    heading6Counter: str('heading6_counter'),
    heading7Counter: str('heading7_counter'),
    taxRegistrationNo: str('tax_registration_no'),
  };
}

// ---------------------------------------------------------------------------
// Exported service functions
// ---------------------------------------------------------------------------

function assertCompanyId(companyId) {
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid < 1) {
    const err = new Error('Invalid company');
    err.status = 400;
    throw err;
  }
  return cid;
}

/** GET /api/pos/parameters — Flutter-shaped payload. */
export async function loadParametersPayload(companyId, branchId = null, stationId = null) {
  const cid = assertCompanyId(companyId);
  const client = await pool.connect();
  try {
    const [definitions, storedJson] = await Promise.all([
      repo.getPosDefinitions(client),
      repo.getCompanyPosValues(client, cid),
    ]);
    const merged = mergeSettings(definitions, storedJson);
    const payload = mapToFlutterPayload(merged);

    const bid = Number(branchId);
    const sid = Number(stationId);
    const hasBranch = Number.isFinite(bid) && bid > 0;
    const hasStation = Number.isFinite(sid) && sid > 0;

    if (hasBranch || hasStation) {
      const counterSettings = await repo.getCounterReceiptSettings(
        client,
        cid,
        hasBranch ? bid : null,
        hasStation ? sid : null,
      );
      overlayReceiptSettings(payload, counterSettings);
    }

    return payload;
  } finally {
    client.release();
  }
}

/** GET /api/pos/parameter-definitions — field list for ERP settings UI. */
export async function getParameterDefinitions() {
  const client = await pool.connect();
  try {
    const rows = await repo.getPosDefinitions(client);
    return rows.map((d) => ({
      key: d.parameter_key,
      label: d.parameter_name,
      valueType: d.value_type,
      category: d.category,
      defaultValue: d.default_value,
    }));
  } finally {
    client.release();
  }
}

/**
 * PUT /api/pos/parameters — partial update using snake_case keys.
 * Only known definition keys are accepted.
 */
export async function updateParameters(companyId, body) {
  const cid = assertCompanyId(companyId);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: true, ignoredKeys: [] };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const definitions = await repo.getPosDefinitions(client);
    const knownKeys = new Set(definitions.map((d) => d.parameter_key));
    const typeByKey = Object.fromEntries(definitions.map((d) => [d.parameter_key, d.value_type]));

    const patch = {};
    const ignoredKeys = [];

    for (const [rawKey, rawVal] of Object.entries(body)) {
      if (!knownKeys.has(rawKey)) {
        ignoredKeys.push(rawKey);
        continue;
      }
      if (rawVal == null) continue;

      const vt = typeByKey[rawKey] ?? 'text';
      if (vt === 'number') {
        const n = Number(rawVal);
        if (!Number.isFinite(n)) {
          ignoredKeys.push(rawKey);
          continue;
        }
        patch[rawKey] = String(n);
      } else {
        patch[rawKey] = String(rawVal);
      }
    }

    if (Object.keys(patch).length > 0) {
      await repo.upsertCompanyPosValues(client, cid, patch);
    }

    await client.query('COMMIT');
    return { ok: true, ignoredKeys };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * PUT /api/pos/parameters/company-details — legacy Flutter body shape.
 * Maps heading1…5, footer1, footer2, taxRegNo → snake_case keys.
 * Also writes branch/station rows to core.counter_parameter when context is available.
 */
export async function updateCompanyDetails(companyId, body, branchId = null, stationId = null) {
  const cid = assertCompanyId(companyId);

  const patch = {
    heading1_counter: String(body?.heading1 ?? ''),
    heading2_counter: String(body?.heading2 ?? ''),
    heading3_counter: String(body?.heading3 ?? ''),
    heading4_counter: String(body?.heading4 ?? ''),
    heading5_counter: String(body?.heading5 ?? ''),
    heading6_counter: String(body?.footer1 ?? ''),
    heading7_counter: String(body?.footer2 ?? ''),
    tax_registration_no: String(body?.taxRegNo ?? ''),
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await repo.upsertCompanyPosValues(client, cid, patch);

    const bid = Number(branchId);
    const sid = Number(stationId);
    if (Number.isFinite(bid) && bid > 0 && Number.isFinite(sid) && sid > 0) {
      await repo.upsertCounterReceiptSettings(client, cid, bid, sid, patch);
    }

    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
