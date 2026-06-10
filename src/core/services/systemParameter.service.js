import * as repo from '../repositories/systemParameter.repository.js';

/**
 * Merge definitions (with defaults) against stored company values.
 * Returns { MODULE: { key: resolvedValue, ... }, ... }
 */
function mergeAll(definitions, storedByModule) {
  const result = {};
  for (const def of definitions) {
    if (!result[def.module]) result[def.module] = {};
    const stored = storedByModule[def.module] ?? {};
    result[def.module][def.parameter_key] = Object.prototype.hasOwnProperty.call(stored, def.parameter_key)
      ? stored[def.parameter_key]
      : def.default_value;
  }
  return result;
}

/** GET /api/parameters — all modules: values merged with defaults + definition metadata. */
export async function getAllParameters(pool, companyId) {
  const [definitions, storedByModule] = await Promise.all([
    repo.getDefinitions(pool),
    repo.getCompanyValues(pool, companyId),
  ]);
  const values = mergeAll(definitions, storedByModule);

  // Build definitions map: { MODULE: [ { parameter_key, parameter_name, value_type, category, default_value } ] }
  const defs = {};
  for (const d of definitions) {
    if (!defs[d.module]) defs[d.module] = [];
    defs[d.module].push({
      parameter_key:  d.parameter_key,
      parameter_name: d.parameter_name,
      value_type:     d.value_type,
      category:       d.category,
      default_value:  d.default_value,
      sort_order:     d.sort_order,
    });
  }

  return { values, definitions: defs };
}

/** GET /api/parameters/:module — single module merged with defaults. */
export async function getModuleParameters(pool, companyId, module) {
  const MOD = module.toUpperCase();
  const [definitions, storedByModule] = await Promise.all([
    repo.getDefinitions(pool, MOD),
    repo.getCompanyValues(pool, companyId, MOD),
  ]);
  const merged = mergeAll(definitions, storedByModule);
  return merged[MOD] ?? {};
}

/**
 * PUT /api/parameters/:module — partial update.
 * Only keys that exist in parameter_definition for that module are accepted.
 */
export async function updateModuleParameters(pool, companyId, module, body, updatedBy) {
  const MOD = module.toUpperCase();
  const definitions = await repo.getDefinitions(pool, MOD);
  if (definitions.length === 0) {
    const err = new Error(`Unknown module: ${MOD}`);
    err.status = 400;
    throw err;
  }

  const knownKeys = new Set(definitions.map(d => d.parameter_key));
  const typeByKey = Object.fromEntries(definitions.map(d => [d.parameter_key, d.value_type]));

  const patch = {};
  const ignored = [];
  for (const [key, val] of Object.entries(body ?? {})) {
    if (!knownKeys.has(key)) { ignored.push(key); continue; }
    if (val == null) continue;
    const vt = typeByKey[key] ?? 'text';
    if (vt === 'number') {
      const n = Number(val);
      if (!Number.isFinite(n)) { ignored.push(key); continue; }
      patch[key] = String(n);
    } else {
      patch[key] = String(val);
    }
  }

  await repo.upsertModuleValues(pool, companyId, MOD, patch, updatedBy);

  // Return updated module values
  const updated = await getModuleParameters(pool, companyId, MOD);
  return { ok: true, module: MOD, parameters: updated, ignored };
}
