import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedisClient } from '../config/redis.js';
import { config } from '../config.js';

/**
 * Rate limiters. When Redis is available the counter is shared across all
 * instances/workers; otherwise each process keeps its own in-memory counter
 * (still useful, just not cluster-wide). Call buildLimiters() AFTER initRedis().
 */

function makeStore() {
  const client = getRedisClient();
  if (!client) return undefined; // express-rate-limit defaults to MemoryStore
  return new RedisStore({ sendCommand: (...args) => client.sendCommand(args) });
}

export function buildLimiters() {
  const store = makeStore();
  const common = {
    store,
    standardHeaders: true,
    legacyHeaders: false,
  };

  // General API ceiling per client IP. Default high (2000/min) so a busy
  // office sharing one NAT IP isn't blocked. Tune via RATE_LIMIT_API_PER_MIN.
  const apiLimiter = rateLimit({
    ...common,
    windowMs: 60_000,
    limit: config.rateLimitApi,
    message: { message: 'Too many requests, slow down.' },
  });

  // Tighter limiter for credential endpoints (brute-force protection).
  const authLimiter = rateLimit({
    ...common,
    windowMs: 60_000,
    limit: config.rateLimitAuth,
    message: { message: 'Too many attempts, try again later.' },
  });

  return { apiLimiter, authLimiter };
}
