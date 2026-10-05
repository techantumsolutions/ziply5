#!/usr/bin/env node
/**
 * Apply all SQL migrations in supabase/migrations/ to the database behind DIRECT_URL.
 *
 * Usage:
 *   pnpm db:migrate
 *   node --env-file=.env scripts/apply-supabase-migrations.mjs
 *
 * Set DIRECT_URL to a session/direct Postgres URL (port 5432). For Supabase Cloud,
 * use the "Session pooler" or direct connection string — not the transaction pooler (6543).
 */
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error("Set DIRECT_URL (preferred) or DATABASE_URL in the environment.")
  process.exit(1)
}

const isLocal = /localhost|127\.0\.0\.1|::1/i.test(connectionString)
const sslMode = String(process.env.DB_SSL || "").toLowerCase()
const useSsl =
  sslMode === "true" || sslMode === "1"
    ? { rejectUnauthorized: false }
    : sslMode === "false" || sslMode === "0" || isLocal
      ? false
      : { rejectUnauthorized: false }

const client = new pg.Client({
  connectionString,
  ssl: useSsl,
})

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations")

const migrationVersion = (file) => file.replace(/_.*$/, "").replace(/\.sql$/, "")
const migrationName = (file) => file.replace(/^\d+_/, "").replace(/\.sql$/, "")

const isBaselineMigration = (file) => file.includes("baseline")

const isAlreadyAppliedError = (message) => {
  const m = message.toLowerCase()
  return (
    m.includes("already exists") ||
    m.includes("duplicate key") ||
    m.includes("duplicate object") ||
    m.includes("multiple primary keys")
  )
}

const recordMigration = async (version, name) => {
  await client.query(
    `INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
     VALUES ($1, $2, ARRAY[]::text[])
     ON CONFLICT (version) DO NOTHING`,
    [version, name],
  )
}

const hasExistingSchema = async () => {
  const { rows } = await client.query(`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Order'
    LIMIT 1
  `)
  return rows.length > 0
}

const main = async () => {
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort()

  await client.connect()
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version text PRIMARY KEY,
      name text,
      statements text[]
    );
  `)

  const applied = await client.query(`SELECT version FROM supabase_migrations.schema_migrations`)
  const done = new Set(applied.rows.map((r) => r.version))
  const existingSchema = await hasExistingSchema()

  if (existingSchema && done.size < files.length) {
    console.log("Detected existing database; skipping baseline and treating duplicate-object errors as already applied.")
  }

  for (const file of files) {
    const version = migrationVersion(file)
    const name = migrationName(file)
    if (done.has(version)) {
      console.log(`skip ${file}`)
      continue
    }

    if (existingSchema && isBaselineMigration(file)) {
      console.log(`skip ${file} (baseline already present in existing database)`)
      await recordMigration(version, name)
      done.add(version)
      continue
    }

    const sql = await readFile(path.join(migrationsDir, file), "utf8")
    console.log(`apply ${file}`)
    await client.query("BEGIN")
    try {
      await client.query(sql)
      await recordMigration(version, name)
      await client.query("COMMIT")
      done.add(version)
    } catch (error) {
      await client.query("ROLLBACK")
      const message = error instanceof Error ? error.message : String(error)
      if (existingSchema && isAlreadyAppliedError(message)) {
        console.warn(`warn ${file}: ${message} — marking as applied`)
        await recordMigration(version, name)
        done.add(version)
        continue
      }
      throw error
    }
  }

  console.log("All migrations applied.")
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
  .finally(() => client.end().catch(() => null))
