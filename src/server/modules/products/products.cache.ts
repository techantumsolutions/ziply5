import { env } from "@/src/server/core/config/env"
import { isRedisReady, redis, withRedisTimeout } from "@/src/server/db/redis"

const memoryStore = new Map<string, { at: number; value: string }>()
const PRODUCT_CACHE_PREFIX = "products:v1"

const ensureRedis = async () => Boolean(env.REDIS_URL) && isRedisReady()

const now = () => Date.now()

type CacheEnvelope<T> = {
  cachedAt: number
  payload: T
}

const parseEnvelope = <T>(raw: string): CacheEnvelope<T> | null => {
  try {
    const parsed = JSON.parse(raw) as CacheEnvelope<T> | T
    if (
      parsed &&
      typeof parsed === "object" &&
      "cachedAt" in parsed &&
      "payload" in parsed
    ) {
      return parsed as CacheEnvelope<T>
    }
    // Backward compatibility with old plain payload entries.
    return { cachedAt: Date.now(), payload: parsed as T }
  } catch {
    return null
  }
}

const readMemory = <T>(key: string, ttlMs: number): CacheEnvelope<T> | null => {
  const row = memoryStore.get(key)
  if (!row) return null
  if (now() - row.at > ttlMs) {
    memoryStore.delete(key)
    return null
  }
  const parsed = parseEnvelope<T>(row.value)
  if (!parsed) {
    memoryStore.delete(key)
    return null
  }
  return parsed
}

const writeMemory = (key: string, value: unknown) => {
  memoryStore.set(key, { at: now(), value: JSON.stringify(value) })
}

export const getProductCache = async <T>(
  key: string,
  ttlMs: number,
): Promise<{ value: T; ageMs: number } | null> => {
  if (await ensureRedis()) {
    try {
      const value = await withRedisTimeout(redis.get(key))
      if (!value) return null
      const parsed = parseEnvelope<T>(value)
      if (!parsed) return null
      if (now() - parsed.cachedAt > ttlMs) return null
      return { value: parsed.payload, ageMs: now() - parsed.cachedAt }
    } catch {
      const fallback = readMemory<T>(key, ttlMs)
      return fallback ? { value: fallback.payload, ageMs: now() - fallback.cachedAt } : null
    }
  }
  const fallback = readMemory<T>(key, ttlMs)
  return fallback ? { value: fallback.payload, ageMs: now() - fallback.cachedAt } : null
}

export const setProductCache = async (key: string, value: unknown, ttlMs: number) => {
  const envelope = {
    cachedAt: now(),
    payload: value,
  }
  if (await ensureRedis()) {
    try {
      await withRedisTimeout(redis.set(key, JSON.stringify(envelope), "PX", ttlMs))
      writeMemory(key, envelope)
      return
    } catch {
      writeMemory(key, envelope)
      return
    }
  }
  writeMemory(key, envelope)
}

export const buildProductListCacheKey = (parts: Record<string, unknown>) =>
  `${PRODUCT_CACHE_PREFIX}:list:${JSON.stringify(parts)}`

export const buildProductBySlugCacheKey = (slug: string, scope: string) =>
  `${PRODUCT_CACHE_PREFIX}:slug:${scope}:${slug}`

export const invalidateProductCache = async () => {
  memoryStore.clear()
  if (await ensureRedis()) {
    try {
      const keys = await withRedisTimeout(redis.keys(`${PRODUCT_CACHE_PREFIX}:*`))
      if (keys.length) {
        await withRedisTimeout(redis.del(...keys))
      }
    } catch {
      // no-op: cache invalidation should not break writes
    }
  }
}
