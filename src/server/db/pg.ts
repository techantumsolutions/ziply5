import { Pool, type PoolConfig } from "pg"

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing")
}

function isIpHost(host: string): boolean {
  const value = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host
  if (value.includes(":")) return true
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)
}

function pgSslConfig(connectionString: string): PoolConfig["ssl"] {
  try {
    const normalized = connectionString.replace(/^postgresql:/i, "http:").replace(/^postgres:/i, "http:")
    const u = new URL(normalized)
    const host = u.hostname.toLowerCase()
    const sslmode = u.searchParams.get("sslmode")?.toLowerCase()
    if (sslmode === "disable") return false
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false
    // Self-hosted Postgres on a raw IP usually has no SSL. Keep SSL for hosted names (e.g. supabase.co).
    if (isIpHost(host) && sslmode !== "require" && sslmode !== "verify-ca" && sslmode !== "verify-full") {
      return false
    }
  } catch {
    /* use SSL for unparseable remote URLs */
  }
  return { rejectUnauthorized: false }
}

export const pg = new Pool({
  connectionString: databaseUrl,
  ssl: pgSslConfig(databaseUrl),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
})

type PgQueryRows<T> = T extends any[] ? T : T[]

export async function pgQuery<T = any>(text: string, values: any[] = []): Promise<PgQueryRows<T>> {
  const res = await pg.query(text, values)
  return res.rows as PgQueryRows<T>
}

export async function pgTx<T>(fn: (client: import("pg").PoolClient) => Promise<T>) {
  const client = await pg.connect()
  try {
    await client.query("BEGIN")
    const out = await fn(client)
    await client.query("COMMIT")
    return out
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null)
    throw e
  } finally {
    client.release()
  }
}
