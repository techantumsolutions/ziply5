import { isRedisReady, redis, withRedisTimeout } from "@/src/server/db/redis"

const memoryStore = new Map<string, { count: number; resetAt: number }>()

const now = () => Date.now()

const parseIp = (raw: string) =>
  raw
    .split(",")[0]
    ?.trim()
    .replace(/^::ffff:/, "") || "unknown"

export const resolveClientIp = (headers: Headers) => {
  const forwarded = headers.get("x-forwarded-for")
  if (forwarded) return parseIp(forwarded)
  const realIp = headers.get("x-real-ip")
  if (realIp) return parseIp(realIp)
  return "unknown"
}

export const rateLimit = async (input: {
  key: string
  limit: number
  windowSec: number
}): Promise<{ ok: boolean; remaining: number; resetSec: number }> => {
  const ttlMs = input.windowSec * 1000
  const resetSec = Math.max(1, input.windowSec)
  if (process.env.REDIS_ENABLED === "true" && process.env.REDIS_URL && isRedisReady()) {
    try {
      const count = await withRedisTimeout(redis.incr(input.key))
      if (count === 1) await withRedisTimeout(redis.expire(input.key, input.windowSec))
      const ttl = await withRedisTimeout(redis.ttl(input.key))
      return {
        ok: count <= input.limit,
        remaining: Math.max(0, input.limit - count),
        resetSec: ttl > 0 ? ttl : resetSec,
      }
    } catch {
      // fall through to memory limiter
    }
  }

  const entry = memoryStore.get(input.key)
  const currentTime = now()
  if (!entry || entry.resetAt <= currentTime) {
    memoryStore.set(input.key, { count: 1, resetAt: currentTime + ttlMs })
    return { ok: true, remaining: Math.max(0, input.limit - 1), resetSec }
  }
  entry.count += 1
  memoryStore.set(input.key, entry)
  return {
    ok: entry.count <= input.limit,
    remaining: Math.max(0, input.limit - entry.count),
    resetSec: Math.max(1, Math.ceil((entry.resetAt - currentTime) / 1000)),
  }
}
