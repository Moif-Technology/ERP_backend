import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../config/db.js';
import * as staffRepo from '../repositories/staff.repository.js';
import * as passwordResetRepo from '../repositories/passwordReset.repository.js';

const OTP_TTL_MS = 15 * 60 * 1000;
const MIN_PASSWORD_LEN = 8;

function normalizeIdentifier(raw) {
  return String(raw || '').trim();
}

function generateSixDigitOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

/** Same resolution rules as login: exactly one ACTIVE staff row. */
async function resolveActiveStaff(usernameOrEmail) {
  const u = normalizeIdentifier(usernameOrEmail);
  if (!u) {
    const err = new Error('username or email is required');
    err.status = 400;
    throw err;
  }
  const { rows } = await staffRepo.findLoginCandidates(pool, u);
  const active = rows.filter((r) => r.record_status === 'ACTIVE');
  if (active.length !== 1) return null;
  return active[0];
}

/**
 * Creates a reset token and logs the plain OTP to the API console (for dev / no SMTP).
 * Response is always generic so callers cannot enumerate accounts.
 */
export async function requestForgotPasswordOtp(body) {
  const row = await resolveActiveStaff(body?.usernameOrEmail ?? body?.username);
  const generic = {
    ok: true,
    message:
      'If an account exists for that email or username, a reset code was issued. Check the API server console for the OTP in development.',
  };

  if (!row) {
    return generic;
  }

  const plainOtp = generateSixDigitOtp();
  const otpHash = await bcrypt.hash(plainOtp, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await withTransaction(async (client) => {
    await passwordResetRepo.deleteTokensForStaff(client, row.id);
    await passwordResetRepo.insertToken(client, row.id, otpHash, expiresAt);
  });

  const label = row.email?.trim() || row.login_name || `staff #${row.id}`;
  console.log('');
  console.log('---------------------------------------------------------');
  console.log(`  [Password reset] OTP for "${label}" (login: ${row.login_name})`);
  console.log(`  Code: ${plainOtp}  (expires in ${OTP_TTL_MS / 60000} minutes)`);
  console.log('---------------------------------------------------------');
  console.log('');

  return generic;
}

export async function resetPasswordWithOtp(body) {
  const usernameOrEmail = normalizeIdentifier(body?.usernameOrEmail ?? body?.username);
  const otpRaw = String(body?.otp ?? '').replace(/\D/g, '');
  const newPassword = body?.newPassword ?? body?.password;

  if (!usernameOrEmail) {
    const err = new Error('username or email is required');
    err.status = 400;
    throw err;
  }
  if (!otpRaw || otpRaw.length !== 6) {
    const err = new Error('OTP must be 6 digits');
    err.status = 400;
    throw err;
  }
  if (!newPassword || String(newPassword).length < MIN_PASSWORD_LEN) {
    const err = new Error(`password must be at least ${MIN_PASSWORD_LEN} characters`);
    err.status = 400;
    throw err;
  }

  const row = await resolveActiveStaff(usernameOrEmail);
  if (!row) {
    const err = new Error('Invalid or expired code');
    err.status = 400;
    throw err;
  }

  const tokenRow = await passwordResetRepo.findLatestTokenForStaff(pool, row.id);
  if (!tokenRow) {
    const err = new Error('Invalid or expired code');
    err.status = 400;
    throw err;
  }

  const expired = new Date(tokenRow.expires_at).getTime() <= Date.now();
  if (expired) {
    const err = new Error('Invalid or expired code');
    err.status = 400;
    throw err;
  }

  const match = await bcrypt.compare(otpRaw, tokenRow.otp_hash);
  if (!match) {
    const err = new Error('Invalid or expired code');
    err.status = 400;
    throw err;
  }

  const passwordHash = await bcrypt.hash(String(newPassword), 10);

  await withTransaction(async (client) => {
    const ok = await staffRepo.updatePasswordHashByStaffPk(client, row.id, passwordHash);
    if (!ok) {
      const err = new Error('Could not update password');
      err.status = 500;
      throw err;
    }
    await passwordResetRepo.deleteTokensForStaff(client, row.id);
  });

  return { ok: true, message: 'Password updated. You can sign in now.' };
}
