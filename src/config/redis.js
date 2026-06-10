import { createClient } from 'redis';
import { config } from '../config.js';

/**
 * Optional Redis layer. Used for session caching (authMiddleware) and rate
 * limiting. The whole app must keep working when Redis is absent or down:
 * every helper here degrades to a no-op / cache-miss instead of throwing.
 */

let client = null;
let ready = false;

export function isRedisReady() {
  return ready && client != null;
}

/** Raw client for libraries that need it (e.g. rate-limit-redis). May be null. */
export function getRedisClient() {
  return isRedisReady() ? client : null;
}

/** Connect once at boot. Never rejects — logs and continues without Redis. */
export async function initRedis() {
  if (!config.redisUrl) {
    console.warn('[redis] REDIS_URL not set — session cache + shared rate limit disabled');
    return;
  }
  try {
    client = createClient({
      url: config.redisUrl,
      socket: { reconnectStrategy: (retries) => Math.min(retries * 100, 3_000) },
    });
    client.on('error', (e) => {
      ready = false;
      console.error('[redis] error:', e.message);
    });
    client.on('ready', () => {
      ready = true;
    });
    await client.connect();
    ready = true;
    console.log('[redis] connected');
  } catch (e) {
    ready = false;
    client = null;
    console.error('[redis] connect failed — running without cache:', e.message);
  }
}

export async function closeRedis() {
  if (client) {
    await client.quit().catch(() => {});
    client = null;
    ready = false;
  }
}

/** Cache get. Returns null on miss or when Redis unavailable. */
export async function cacheGet(key) {
  if (!isRedisReady()) return null;
  try {
    return await client.get(key);
  } catch {
    return null;
  }
}

/** Cache set with TTL (seconds). No-op when Redis unavailable. */
export async function cacheSet(key, value, ttlSeconds) {
  if (!isRedisReady()) return;
  try {
    await client.set(key, value, { EX: ttlSeconds });
  } catch {
    /* ignore cache write failures */
  }
}

/** Cache delete. No-op when Redis unavailable. */
export async function cacheDel(key) {
  if (!isRedisReady()) return;
  try {
    await client.del(key);
  } catch {
    /* ignore */
  }
}
