import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../../config/db.js';
import * as staffRepo from '../repositories/staff.repository.js';
import { buildSessionPayload } from './session.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from './token.service.js';
import {
  validateRegisterBody,
  registerCompanyInTransaction,
  sendRegistrationVerificationEmail,
} from './registration.service.js';
import * as planService from './plan.service.js';
import { buildWelcomeForSession } from './welcome.service.js';
import * as onboardingRepo from '../repositories/onboarding.repository.js';
import { resolveEntitlementsForStaff } from './entitlement.service.js';
import { getEntitlementVersionForStaff } from './entitlement.service.js';
import { buildTokensForStaffRow } from './sessionTokens.js';

// Delegates to the shared builder so ERP + Counter-POS stay in sync.
const tokensForStaffRow = (staffRow) => buildTokensForStaffRow(staffRow);

async function tokensForStaffRowWithWelcome(pool, staffRow) {
  const base = await tokensForStaffRow(staffRow);
  const welcome = await buildWelcomeForSession(pool, staffRow.company_id);
  return {
    ...base,
    session: { ...base.session, welcome },
  };
}

export async function registerAccount(body) {
  const parsed = validateRegisterBody(body);
  if (!parsed.ok) {
    const err = new Error(parsed.errors.join('; '));
    err.status = 400;
    throw err;
  }

  const planRow = await planService.assertPlanAcceptsRegistration(
    pool,
    parsed.data.selectedPlan
  );

  const result = await withTransaction((client) =>
    registerCompanyInTransaction(client, {
      ...parsed.data,
      trialDays: planRow.trial_days,
    })
  );

  if (!result?.staffRow) {
    throw new Error('Registration incomplete');
  }

  // Send verification email outside the transaction (non-blocking on failure)
  try {
    await sendRegistrationVerificationEmail(
      parsed.data.email,
      result.firstName,
      result.verifyToken
    );
  } catch (emailErr) {
    console.error('[Registration] Failed to send verification email:', emailErr.message);
  }

  return {
    status: 201,
    ok: true,
    message: 'Account created. Check your email to verify your address before signing in.',
  };
}

export async function loginWithCredentials(username, password) {
  const u = String(username || '').trim();
  if (!u || !password) {
    const err = new Error('username and password are required');
    err.status = 400;
    throw err;
  }

  const { rows } = await staffRepo.findLoginCandidates(pool, u);
  const active = rows.filter((r) => r.record_status === 'ACTIVE');
  if (active.length !== 1) {
    const err = new Error('Invalid username or password');
    err.status = 401;
    throw err;
  }
  const row = active[0];
  const ok = await bcrypt.compare(String(password), row.password_hash);
  if (!ok) {
    const err = new Error('Invalid username or password');
    err.status = 401;
    throw err;
  }

  // Strict false check: undefined means pre-migration schema — let through
  if (row.email_verified === false) {
    const err = new Error('Please verify your email before signing in. Check your inbox for the verification link.');
    err.status = 403;
    err.code = 'EMAIL_NOT_VERIFIED';
    throw err;
  }

  return await tokensForStaffRowWithWelcome(pool, row);
}

const RESTAURANT_POS_ALLOWED_TYPES = new Set(['RESTAURANT-POS', 'ERP', '', null, undefined]);
const COUNTER_POS_ALLOWED_TYPES    = new Set(['COUNTER-POS',    'ERP', '', null, undefined]);
const VAN_ALLOWED_TYPES            = new Set(['VAN',            'ERP', '', null, undefined]);

function assertRoleAllowed(row, allowedSet, posName) {
  const roleType = String(row.role_software_type || '').toUpperCase().trim();
  if (roleType !== '' && !allowedSet.has(roleType)) {
    const err = new Error(`This staff is not authorised for ${posName}`);
    err.status = 403;
    throw err;
  }
}

export async function loginWithCredentialsForPOS(username, password, posType) {
  const u = String(username || '').trim();
  if (!u || !password) {
    const err = new Error('username and password are required');
    err.status = 400;
    throw err;
  }

  const { rows } = await staffRepo.findLoginCandidates(pool, u);
  const active = rows.filter((r) => r.record_status === 'ACTIVE');
  if (active.length !== 1) {
    const err = new Error('Invalid username or password');
    err.status = 401;
    throw err;
  }
  const row = active[0];
  const ok = await bcrypt.compare(String(password), row.password_hash);
  if (!ok) {
    const err = new Error('Invalid username or password');
    err.status = 401;
    throw err;
  }

  const allowedSet =
    posType === 'RESTAURANT-POS' ? RESTAURANT_POS_ALLOWED_TYPES :
    posType === 'VAN'            ? VAN_ALLOWED_TYPES :
                                   COUNTER_POS_ALLOWED_TYPES;
  assertRoleAllowed(row, allowedSet, posType);

  return await tokensForStaffRowWithWelcome(pool, row);
}

export async function loginWithPinForRestaurant({ pin, companyId, staffId }) {
  const pinStr = String(pin || '').trim();
  const cid    = Number(companyId);

  if (!pinStr) {
    const err = new Error('PIN is required'); err.status = 400; throw err;
  }
  if (!Number.isFinite(cid) || cid < 1) {
    const err = new Error('companyId is required'); err.status = 400; throw err;
  }
  if (!/^\d{4,6}$/.test(pinStr)) {
    const err = new Error('Invalid PIN'); err.status = 401; throw err;
  }

  const staffList = await staffRepo.findAllActiveStaffWithPinForCompany(pool, cid);
  if (!staffList.length) {
    const err = new Error('No staff found'); err.status = 401; throw err;
  }

  // If staffId provided, check only that staff member first (faster + better UX)
  const sid = staffId != null ? Number(staffId) : null;
  const ordered = (sid != null && Number.isFinite(sid))
    ? [...staffList.filter(r => Number(r.id) === sid), ...staffList.filter(r => Number(r.id) !== sid)]
    : staffList;

  for (const row of ordered) {
    const ok = await bcrypt.compare(pinStr, row.staff_pin);
    if (!ok) continue;
    assertRoleAllowed(row, RESTAURANT_POS_ALLOWED_TYPES, 'Restaurant POS');
    return tokensForStaffRow(row);
  }

  const err = new Error('Invalid PIN'); err.status = 401; throw err;
}

export async function completeWelcomeForCompany(pool, companyId) {
  const id = Number(companyId);
  if (!Number.isFinite(id) || id < 1) {
    const err = new Error('Invalid company');
    err.status = 400;
    throw err;
  }
  await onboardingRepo.markWelcomeCompleted(pool, id);
  return { ok: true };
}

export async function refreshAccessToken(refreshToken) {
  if (!refreshToken) {
    const err = new Error('refreshToken is required');
    err.status = 400;
    throw err;
  }
  try {
    const payload = verifyRefreshToken(refreshToken);
    if (payload.typ !== 'refresh' || payload.sub == null) {
      const err = new Error('Invalid refresh token');
      err.status = 401;
      throw err;
    }
    const staffPk = Number(payload.sub);
    const { rows } = await staffRepo.findStaffSessionByPk(pool, staffPk);
    if (!rows.length) {
      const err = new Error('Staff not found or inactive');
      err.status = 401;
      throw err;
    }
    const row = rows[0];
    const tokenPayload = {
      typ: 'access',
      sub: String(payload.sub),
      cid: row.company_id,
    };
    return { accessToken: signAccessToken(tokenPayload) };
  } catch (e) {
    if (e.status) throw e;
    const err = new Error('Invalid refresh token');
    err.status = 401;
    throw err;
  }
}

export function logout() {
  return { ok: true };
}

export function currentUserFromStaffRow(staffRow) {
  return buildSessionPayload(staffRow).user;
}

export async function currentSessionFromStaffRow(staffRow) {
  const [access, accessVersion] = await Promise.all([
    resolveEntitlementsForStaff(staffRow),
    getEntitlementVersionForStaff(staffRow),
  ]);
  return {
    ...buildSessionPayload(staffRow, access),
    accessVersion,
  };
}

export async function currentAccessVersionFromStaffRow(staffRow) {
  return getEntitlementVersionForStaff(staffRow);
}

export async function currentAccessOnlyFromStaffRow(staffRow) {
  const access = await resolveEntitlementsForStaff(staffRow);
  return {
    subscription: access.subscription,
    features: access.features,
    limits: access.limits,
    permissions: access.permissions,
  };
}
