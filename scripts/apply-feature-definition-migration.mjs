import { readFile } from "node:fs/promises"
import pg from "pg"

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error("Missing DIRECT_URL / DATABASE_URL")
  process.exit(1)
}

const client = new pg.Client({
  connectionString,
  ssl: false,
})

const main = async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20261001150000_product_hsn_ean_feature_definitions.sql", import.meta.url),
    "utf8",
  )
  await client.connect()
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version text PRIMARY KEY,
      name text,
      statements text[]
    );
  `)
  await client.query(sql)
  await client.query(
    `INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
     VALUES ($1, $2, ARRAY[]::text[])
     ON CONFLICT (version) DO NOTHING`,
    ["20261001150000", "product_hsn_ean_feature_definitions"],
  )
  const check = await client.query(`SELECT COUNT(*)::int AS n FROM "FeatureDefinition"`)
  console.log("FeatureDefinition ready, rows=", check.rows[0].n)
  await client.end()
}

main().catch(async (error) => {
  console.error(error)
  try {
    await client.end()
  } catch {}
  process.exit(1)
})
