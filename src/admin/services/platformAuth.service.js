import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import * as platformUserRepo from '../repositories/platformUser.repository.js';

function signPlatformAccessToken(payload) {
  return jwt.sign(payload, config.jwtPlatformAccessSecret, {
    expiresIn: config.jwtPlatformAccessExpires,
  });
}

function signPlatformRefreshToken(payload) {
  return jwt.sign(payload, config.jwtPlatformRefreshSecret, {
    expiresIn: config.jwtPlatformRefreshExpires,
  });
}

export function verifyPlatformAccessToken(token) {
  return jwt.verify(token, config.jwtPlatformAccessSecret);
}

export function verifyPlatformRefreshToken(token) {
  return jwt.verify(token, config.jwtPlatformRefreshSecret);
}

export async function login({ email, password }) {
  if (!email || !password) {
    const err = new Error('Email and password required');
    err.status = 400;
    throw err;
  }
  const user = await platformUserRepo.findByEmail(email);
  if (!user || !user.is_active) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }
  await platformUserRepo.touchLastLogin(user.platform_user_id);
  const [capabilities, roles] = await Promise.all([
    platformUserRepo.listCapabilities(user.platform_user_id),
    platformUserRepo.listRoles(user.platform_user_id),
  ]);
  const tokenPayload = {
    typ: 'platform-access',
    sub: String(user.platform_user_id),
    email: user.email,
  };
  return {
    accessToken: signPlatformAccessToken(tokenPayload),
    refreshToken: signPlatformRefreshToken({
      typ: 'platform-refresh',
      sub: String(user.platform_user_id),
    }),
    user: {
      platformUserId: user.platform_user_id,
      email: user.email,
      fullName: user.full_name,
    },
    roles,
    capabilities,
  };
}

export async function refresh({ refreshToken }) {
  if (!refreshToken) {
    const err = new Error('refreshToken required');
    err.status = 400;
    throw err;
  }
  let decoded;
  try {
    decoded = verifyPlatformRefreshToken(refreshToken);
  } catch {
    const err = new Error('Invalid refresh token');
    err.status = 401;
    throw err;
  }
  if (decoded.typ !== 'platform-refresh') {
    const err = new Error('Invalid refresh token');
    err.status = 401;
    throw err;
  }
  const user = await platformUserRepo.findById(Number(decoded.sub));
  if (!user || !user.is_active) {
    const err = new Error('User no longer active');
    err.status = 401;
    throw err;
  }
  return {
    accessToken: signPlatformAccessToken({
      typ: 'platform-access',
      sub: String(user.platform_user_id),
      email: user.email,
    }),
  };
}
