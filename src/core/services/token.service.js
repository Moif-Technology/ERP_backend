import jwt from 'jsonwebtoken';
import { config } from '../../config.js';

export function signAccessToken(payload) {
  return jwt.sign(payload, config.jwtAccessSecret, {
    expiresIn: config.jwtAccessExpires,
  });
}

/** POS-scoped token: longer lifetime (8h) + `scope: 'pos'` claim so authMiddleware can block POS tokens on ERP routes. */
export function signPosAccessToken(payload) {
  return jwt.sign({ ...payload, scope: 'pos' }, config.jwtAccessSecret, {
    expiresIn: config.jwtPosAccessExpires,
  });
}

export function signRefreshToken(payload) {
  return jwt.sign(payload, config.jwtRefreshSecret, {
    expiresIn: config.jwtRefreshExpires,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtAccessSecret);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, config.jwtRefreshSecret);
}
