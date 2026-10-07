import { isRedisReady, redis, withRedisTimeout } from "@/src/server/db/redis"
import { logger } from "@/lib/logger"

const memoryStore = new Map<string, { value: string; expiresAt: number }>()
const metrics = {
  hits: 0,
  misses: 0,
  sets: 0,
  errors: 0,
}

const isRedisEnabled = () => process.env.REDIS_ENABLED === "true" && Boolean(process.env.REDIS_URL)
const canUseRedis = () => isRedisEnabled() && isRedisReady()

const now = () => Date.now()

const readMemory = <T>(key: string): T | null => {
  const row = memoryStore.get(key)
  if (!row) return null
  if (row.expiresAt < now()) {
    memoryStore.delete(key)
    return null
  }
  try {
    return JSON.parse(row.value) as T
  } catch {
    memoryStore.delete(key)
    return null
  }
}

const writeMemory = (key: string, value: unknown, ttlMs: number) => {
  memoryStore.set(key, {
    value: JSON.stringify(value),
    expiresAt: now() + ttlMs,
  })
}

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    if (canUseRedis()) {
      try {
        const raw = await withRedisTimeout(redis.get(key))
        if (!raw) {
          metrics.misses += 1
          return null
        }
        metrics.hits += 1
        return JSON.parse(raw) as T
      } catch (error) {
        metrics.errors += 1
        logger.warn("cache.redis.get_failed", { key, error: error instanceof Error ? error.message : "unknown" })
      }
    }
    const fallback = readMemory<T>(key)
    if (fallback) metrics.hits += 1
    else metrics.misses += 1
    return fallback
  },
  async set(key: string, value: unknown, ttlMs: number) {
    metrics.sets += 1
    if (canUseRedis()) {
      try {
        await withRedisTimeout(redis.set(key, JSON.stringify(value), "PX", ttlMs))
        return
      } catch (error) {
        metrics.errors += 1
        logger.warn("cache.redis.set_failed", { key, error: error instanceof Error ? error.message : "unknown" })
      }
    }
    writeMemory(key, value, ttlMs)
  },
  async del(key: string) {
    if (canUseRedis()) {
      try {
        await withRedisTimeout(redis.del(key))
      } catch {
        // no-op
      }
    }
    memoryStore.delete(key)
  },
  async delMany(keys: string[]) {
    if (!keys.length) return
    if (canUseRedis()) {
      try {
        await withRedisTimeout(redis.del(...keys))
      } catch {
        // no-op
      }
    }
    for (const key of keys) memoryStore.delete(key)
  },
  metrics() {
    const totalReads = metrics.hits + metrics.misses
    return {
      ...metrics,
      hitRate: totalReads > 0 ? metrics.hits / totalReads : 0,
      backend: isRedisEnabled() ? "redis" : "memory",
      redisStatus: redis.status,
    }
  },
}

export const withCache = async <T>(key: string, ttlMs: number, builder: () => Promise<T>): Promise<T> => {
  const cached = await cache.get<T>(key)
  if (cached != null) return cached
  const fresh = await builder()
  await cache.set(key, fresh, ttlMs)
  return fresh
}
