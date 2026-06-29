import dotenv from 'dotenv';

dotenv.config();

const port = Number(process.env.PORT) || 5000;

function parseOrigins(raw) {
  if (!raw || !String(raw).trim()) {
    return ['http://localhost:3000', 'http://localhost:5173'];
  }
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  port,
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  databaseUrl: process.env.DATABASE_URL || '',
  // Optional read replica; falls back to primary when unset.
  replicaUrl: process.env.DATABASE_REPLICA_URL || '',
  // Connection pool sizing (per process). Tune with PgBouncer/RDS Proxy in prod.
  pgPoolMax: Number(process.env.PG_POOL_MAX) || 20,
  pgPoolMin: Number(process.env.PG_POOL_MIN) || 2,
  // Optional Redis (session cache + rate limit). App degrades gracefully when unset.
  redisUrl: process.env.REDIS_URL || '',
  // Trust N proxy hops (LB/Nginx) so client IP + rate limiting work. 0 = off.
  trustProxy: Number(process.env.TRUST_PROXY) || 0,
  // Rate limits (requests per minute per client). Generous so real offices
  // behind one NAT IP aren't blocked; tighten only if abuse appears.
  rateLimitApi: Number(process.env.RATE_LIMIT_API_PER_MIN) || 2000,
  rateLimitAuth: Number(process.env.RATE_LIMIT_AUTH_PER_MIN) || 30,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || '',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || '',
  jwtAccessExpires: process.env.JWT_ACCESS_EXPIRES || '2h',
  jwtRefreshExpires: process.env.JWT_REFRESH_EXPIRES || '7d',
  jwtPosAccessExpires: process.env.JWT_POS_ACCESS_EXPIRES || '8h',
  jwtPlatformAccessSecret:
    process.env.JWT_PLATFORM_ACCESS_SECRET || process.env.JWT_ACCESS_SECRET || '',
  jwtPlatformRefreshSecret:
    process.env.JWT_PLATFORM_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET || '',
  jwtPlatformAccessExpires: process.env.JWT_PLATFORM_ACCESS_EXPIRES || '30m',
  jwtPlatformRefreshExpires: process.env.JWT_PLATFORM_REFRESH_EXPIRES || '1d',
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS),
  resendApiKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || 'noreply@moifone.com',
  frontendUrl: (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, ''),
};

export function assertConfig() {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  if (config.jwtAccessSecret.length < 32 || config.jwtRefreshSecret.length < 32) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must each be at least 32 characters');
  }
}
