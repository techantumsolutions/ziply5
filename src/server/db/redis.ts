import { Redis } from "ioredis"
import { env } from "@/src/server/core/config/env"

const globalForRedis = globalThis as unknown as {
  redis?: Redis
}

export const redis =
  globalForRedis.redis ??
  new Redis(
    (() => {
      const raw = env.REDIS_URL?.trim()
      if (!raw || raw === "/") return "redis://127.0.0.1:6379"
      try {
        const parsed = new URL(raw)
        if (parsed.protocol === "redis:" || parsed.protocol === "rediss:") return raw
      } catch {
        // fall back to local redis URL
      }
      return "redis://127.0.0.1:6379"
    })(),
    {
    lazyConnect: true,
    password: env.REDIS_PASSWORD,

    //  REQUIRED for BullMQ workers
    maxRetriesPerRequest: null,

    enableReadyCheck: false,
  })

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis
}

const REDIS_RETRY_MIN_MS = 30_000
const REDIS_RETRY_MAX_MS = 10 * 60_000
const REDIS_COMMAND_TIMEOUT_MS = 500

let lastConnectAttemptAt = 0
let retryDelayMs = REDIS_RETRY_MIN_MS
let errorHandlerAttached = false

/**
 * Never blocks a request on Redis. Returns true only when the connection is already ready;
 * otherwise kicks off a background connect (with exponential backoff) and returns false.
 */
export const isRedisReady = () => {
  if (!errorHandlerAttached) {
    redis.on("error", () => {})
    redis.on("ready", () => {
      retryDelayMs = REDIS_RETRY_MIN_MS
    })
    errorHandlerAttached = true
  }
  if (redis.status === "ready") return true
  const idle = redis.status === "wait" || redis.status === "end" || redis.status === "close"
  if (idle && Date.now() - lastConnectAttemptAt >= retryDelayMs) {
    lastConnectAttemptAt = Date.now()
    redis.connect().catch(() => {
      retryDelayMs = Math.min(retryDelayMs * 2, REDIS_RETRY_MAX_MS)
      redis.disconnect()
    })
  }
  return false
}

/** Runs a Redis command but gives up after a short timeout so a stalled connection can't hang the request. */
export const withRedisTimeout = <T>(promise: Promise<T>, ms = REDIS_COMMAND_TIMEOUT_MS): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Redis command timed out")), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })