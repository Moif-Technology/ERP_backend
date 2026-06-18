import { withTransaction } from '../../config/db.js';
import * as repo from '../repositories/crmNote.repository.js';
import {
  requiredStr, trimOrNull, toIntOrNull,
  requireCompanyId, requireBranchId, actorStaffId,
} from '../../utils/crmHelpers.js';

function toDateOrNull(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function buildPayload(body) {
  return {
    customerId: toIntOrNull(body.customerId ?? body.customer_id),
    leadId: toIntOrNull(body.leadId ?? body.lead_id),
    opportunityId: toIntOrNull(body.opportunityId ?? body.opportunity_id),
    noteDate: toDateOrNull(body.noteDate ?? body.note_date),
    noteTitle: trimOrNull(body.noteTitle ?? body.note_title, 200),
    noteText: requiredStr(body.noteText ?? body.note_text, 'noteText', 4000),
    isImportant: Boolean(body.isImportant ?? body.is_important ?? false),
  };
}

function validateLinkTarget(payload) {
  if (payload.customerId == null && payload.leadId == null && payload.opportunityId == null) {
    const e = new Error('customerId, leadId, or opportunityId is required');
    e.status = 400;
    throw e;
  }
}

export async function list(pool, query, authStaff) {
  const companyId = requireCompanyId(authStaff);
  return repo.listByCompany(pool, companyId, {
    search: trimOrNull(query.search, 100),
    customerId: toIntOrNull(query.customerId),
    leadId: toIntOrNull(query.leadId),
    opportunityId: toIntOrNull(query.opportunityId),
  });
}

export async function getById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const row = await repo.findById(pool, companyId, Number(id));
  if (!row) {
    const e = new Error('Note not found');
    e.status = 404;
    throw e;
  }
  return row;
}

export async function create(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const branchId = requireBranchId(authStaff, body);
  const payload = buildPayload(body);
  validateLinkTarget(payload);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [`biz.customer_note:${companyId}`]);
    const noteId = await repo.nextNoteId(client, companyId);
    return repo.insert(client, {
      ...payload,
      companyId,
      branchId,
      noteId,
      actorStaffId: actorStaffId(authStaff),
    });
  });
}

export async function update(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const payload = buildPayload(body);
  validateLinkTarget(payload);
  const row = await repo.update(pool, companyId, Number(id), {
    ...payload,
    actorStaffId: actorStaffId(authStaff),
  });
  if (!row) {
    const e = new Error('Note not found');
    e.status = 404;
    throw e;
  }
  return row;
}

export async function remove(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const ok = await repo.softDelete(pool, companyId, Number(id), actorStaffId(authStaff));
  if (!ok) {
    const e = new Error('Note not found');
    e.status = 404;
    throw e;
  }
  return { ok: true };
}
