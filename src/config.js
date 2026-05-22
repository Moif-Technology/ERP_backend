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
  databaseUrl: process.env.DATABASE_URL || '',
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || '',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || '',
  jwtAccessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
  jwtRefreshExpires: process.env.JWT_REFRESH_EXPIRES || '7d',
  jwtPlatformAccessSecret:
    process.env.JWT_PLATFORM_ACCESS_SECRET || process.env.JWT_ACCESS_SECRET || '',
  jwtPlatformRefreshSecret:
    process.env.JWT_PLATFORM_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET || '',
  jwtPlatformAccessExpires: process.env.JWT_PLATFORM_ACCESS_EXPIRES || '30m',
  jwtPlatformRefreshExpires: process.env.JWT_PLATFORM_REFRESH_EXPIRES || '1d',
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS),
};

export function assertConfig() {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  if (config.jwtAccessSecret.length < 32 || config.jwtRefreshSecret.length < 32) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must each be at least 32 characters');
  }
}
