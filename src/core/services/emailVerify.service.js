import crypto from 'crypto';
import { pool, withTransaction } from '../../config/db.js';
import * as staffRepo from '../repositories/staff.repository.js';
import { sendVerificationEmail } from './email.service.js';
import { config } from '../../config.js';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function generateVerifyToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function verifyTokenExpiresAt() {
  return new Date(Date.now() + VERIFY_TTL_MS);
}

function buildVerifyUrl(token) {
  return `${config.frontendUrl}/verify-email?token=${token}`;
}

export async function sendVerificationForStaff(staffPk, email, firstName) {
  const token = generateVerifyToken();
  const expiresAt = verifyTokenExpiresAt();

  await withTransaction(async (client) => {
    await staffRepo.storeVerifyToken(client, staffPk, token, expiresAt);
  });

  const verifyUrl = buildVerifyUrl(token);
  await sendVerificationEmail(email, firstName, verifyUrl);
  return token;
}

export async function verifyEmailToken(token) {
  if (!token || typeof token !== 'string' || token.length !== 64) {
    const err = new Error('Invalid or expired verification link');
    err.status = 400;
    throw err;
  }

  const row = await staffRepo.findByVerifyToken(pool, token);
  if (!row) {
    const err = new Error('Invalid or expired verification link');
    err.status = 400;
    throw err;
  }

  if (new Date(row.email_verify_expires).getTime() <= Date.now()) {
    const err = new Error('Verification link has expired. Request a new one.');
    err.status = 400;
    err.code = 'VERIFY_TOKEN_EXPIRED';
    throw err;
  }

  await withTransaction(async (client) => {
    await staffRepo.markEmailVerified(client, row.id);
  });

  return { ok: true, message: 'Email verified. You can now sign in.' };
}

export async function resendVerification(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    const err = new Error('email is required');
    err.status = 400;
    throw err;
  }

  const row = await staffRepo.findUnverifiedByEmail(pool, normalizedEmail);

  // Always return generic response to prevent email enumeration
  const generic = {
    ok: true,
    message: 'If an unverified account exists for that email, a new verification link was sent.',
  };

  if (!row) return generic;
  if (row.email_verified) return generic;

  const token = generateVerifyToken();
  const expiresAt = verifyTokenExpiresAt();

  await withTransaction(async (client) => {
    await staffRepo.storeVerifyToken(client, row.id, token, expiresAt);
  });

  const firstName = (row.staff_name || '').split(' ')[0] || 'there';
  const verifyUrl = buildVerifyUrl(token);
  await sendVerificationEmail(normalizedEmail, firstName, verifyUrl);

  return generic;
}
