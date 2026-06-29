import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import * as companyRepo from '../repositories/company.repository.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as staffRepo from '../repositories/staff.repository.js';
import * as onboardingRepo from '../repositories/onboarding.repository.js';
import * as roleRepo from '../repositories/role.repository.js';
import { seedDefaultTenantAccounts } from '../../accounts/repositories/accountsSeed.repository.js';
import { sendVerificationEmail } from './email.service.js';
import { config } from '../../config.js';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

// Maps registration softwareTypeCode → software_type_master.software_type_id
// Unknown/missing codes → null (legacy: no software-type feature scoping)
const SOFTWARE_TYPE_ID_MAP = {
  RESTAURANT: 1,
  POS: 2,
  GARAGE: 3,
  HR: 4,
  CRM: 5,
  ERP: 6,
};

function resolveSoftwareTypeId(code) {
  if (!code) return null;
  return SOFTWARE_TYPE_ID_MAP[String(code).toUpperCase().trim()] ?? null;
}

function sanitizeCompanyCode(name, companyId) {
  const base = String(name || '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .slice(0, 24)
    .toUpperCase();
  const prefix = base || 'CO';
  let code = `${prefix}${companyId}`;
  if (code.length > 50) code = code.slice(0, 50);
  return code;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function validateRegisterBody(body) {
  const errors = [];
  const companyName = String(body.companyName || '').trim();
  const businessType = String(body.businessType || '').trim();
  const firstName = String(body.firstName || '').trim();
  const lastName = String(body.lastName || '').trim();
  const email = normalizeEmail(body.email);
  const password = body.password;
  const selectedPlan = String(body.selectedPlan || body.plan || '')
    .trim()
    .toLowerCase();
  const softwareTypeCode = String(body.softwareTypeCode || body.softwareType || '').trim().toUpperCase() || 'ERP';

  if (!companyName) errors.push('companyName is required');
  if (!businessType) errors.push('businessType is required');
  if (!firstName) errors.push('firstName is required');
  if (!lastName) errors.push('lastName is required');
  if (!email) errors.push('email is required');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('email is invalid');
  if (!password || String(password).length < 8) errors.push('password must be at least 8 characters');
  if (!selectedPlan) errors.push('selectedPlan is required');

  return {
    ok: errors.length === 0,
    errors,
    data: {
      companyName,
      businessType,
      firstName,
      lastName,
      email,
      password: String(password),
      phone: body.phone ? String(body.phone).trim() : null,
      country: body.country ? String(body.country).trim() : null,
      branches: body.branches != null && body.branches !== '' ? String(body.branches).trim() : null,
      selectedPlan,
      softwareTypeCode,
      setupBlueprint: body.setupBlueprint ?? null,
    },
  };
}

/**
 * Runs inside an open transaction (client). Inserts company, branch, staff, onboarding.
 */
export async function registerCompanyInTransaction(client, input) {
  const {
    companyName,
    businessType,
    firstName,
    lastName,
    email,
    password,
    phone,
    country,
    branches,
    selectedPlan,
    softwareTypeCode,
    setupBlueprint,
    trialDays,
  } = input;

  const softwareTypeId = resolveSoftwareTypeId(softwareTypeCode);

  await companyRepo.lockCompanyMasterForInsert(client);

  if (await staffRepo.existsStaffWithEmail(client, email)) {
    const err = new Error('An account with this email already exists');
    err.code = 'EMAIL_IN_USE';
    throw err;
  }

  const companyId = await companyRepo.nextCompanyId(client);
  if (!Number.isFinite(companyId) || companyId < 1) {
    throw new Error('Could not allocate company_id');
  }

  let companyCode = sanitizeCompanyCode(companyName, companyId);
  if (await companyRepo.isCompanyCodeTaken(client, companyCode)) {
    companyCode = `C${companyId}`;
  }

  const contactPerson = `${firstName} ${lastName}`.trim();
  const now = new Date().toISOString();

  await companyRepo.insertCompany(client, {
    companyId,
    companyCode,
    companyName,
    contactPerson,
    phone,
    now,
    softwareTypeId,
  });

  const branchId = 1;
  await branchRepo.insertHeadOfficeBranch(client, { companyId, branchId, now });
  await roleRepo.seedDefaultTenantRoles(client, companyId, 'registration');
  // Chart of accounts + voucher types + branch ledger defaults. Without this a
  // new company's backoffice Accounts module + cash/card ledger posting are dead.
  await seedDefaultTenantAccounts(client, { companyId, branchId, actor: 'registration' });

  const staffId = await staffRepo.nextStaffId(client, companyId);
  const passwordHash = await bcrypt.hash(password, 12);
  const staffName = contactPerson;
  const staffCode = `U${staffId}`;

  await staffRepo.insertStaff(client, {
    companyId,
    staffId,
    branchId,
    staffCode,
    staffName,
    designation: null,
    email,
    passwordHash,
    roleId: roleRepo.DEFAULT_ROLE_IDS.admin,
    phone,
    now,
  });

  const onboardingJson = {
    business_type: businessType,
    country,
    branches,
    setup_blueprint: setupBlueprint,
  };

  const days = Number.isFinite(Number(trialDays)) && Number(trialDays) > 0 ? Number(trialDays) : 14;
  const trialEnds = new Date();
  trialEnds.setDate(trialEnds.getDate() + days);

  await onboardingRepo.insertTrialOnboarding(client, {
    companyId,
    planCode: selectedPlan,
    now,
    trialEndsAt: trialEnds.toISOString(),
    onboardingJson,
  });

  await onboardingRepo.insertTrialSubscription(client, {
    companyId,
    planCode: selectedPlan,
    now,
    trialEndsAt: trialEnds.toISOString(),
  });

  const staffRow = await staffRepo.selectStaffSessionRow(client, companyId, staffId);

  // Generate verification token and store it within the same transaction
  const verifyToken = crypto.randomBytes(32).toString('hex');
  const verifyExpiresAt = new Date(Date.now() + VERIFY_TTL_MS);
  const staffPk = staffRow?.id;
  if (staffPk) {
    await staffRepo.storeVerifyToken(client, staffPk, verifyToken, verifyExpiresAt);
  }

  return { staffRow, verifyToken, firstName };
}

export async function sendRegistrationVerificationEmail(email, firstName, verifyToken) {
  const verifyUrl = `${config.frontendUrl}/verify-email?token=${verifyToken}`;
  await sendVerificationEmail(email, firstName, verifyUrl);
}
