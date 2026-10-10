import { cache } from "@/lib/cache/redis"

const MASTER_CACHE_TTL_MS = 60_000

const store = new Map<string, { at: number; payload: unknown }>()

export const getMasterCache = <T,>(key: string): T | null => {
  const row = store.get(key)
  if (!row) return null
  if (Date.now() - row.at > MASTER_CACHE_TTL_MS) {
    store.delete(key)
    return null
  }
  return row.payload as T
}

export const setMasterCache = (key: string, payload: unknown) => {
  store.set(key, { at: Date.now(), payload })
}

export const clearMasterCache = () => {
  store.clear()
  void cache.delByPrefix("cache:v1:master:")
}
