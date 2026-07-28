import fs from "node:fs"
import pg from "pg"

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error("DATABASE_URL is required")
  process.exit(1)
}

const pool = new pg.Pool({ connectionString })

async function runImport() {
  console.log("Reading live-public-data.sql...")
  const rawSql = fs.readFileSync("tmp/live-public-data.sql", "utf8")
  
  // Strip non-SQL pg_dump warning lines from the top
  const cleanSql = rawSql.replace(/^pg_dump:.*$/gm, "-- pg_dump warning")
  
  // Split into individual SQL statements by semicolon
  // Handles multiline string literals in INSERT INTO
  const lines = cleanSql.split("\n")
  const statements = []
  let current = []

  for (const line of lines) {
    current.push(line)
    if (line.trim().endsWith(";")) {
      statements.push(current.join("\n"))
      current = []
    }
  }
  if (current.length > 0 && current.join("").trim()) {
    statements.push(current.join("\n"))
  }

  console.log(`Found ${statements.length} SQL statements to execute. Starting import...`)
  const client = await pool.connect()

  let successCount = 0
  let skippedCount = 0
  let errorCount = 0

  try {
    // Disable triggers temporarily for foreign key ordering in data-only dump
    await client.query("SET session_replication_role = 'replica';")

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i].trim()
      if (!stmt || stmt.startsWith("--")) continue

      try {
        await client.query(stmt)
        successCount++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes("duplicate key") || msg.includes("already exists")) {
          // If statement is an INSERT, retry with ON CONFLICT DO NOTHING
          if (/^INSERT INTO/i.test(stmt)) {
            try {
              const onConflictStmt = stmt.replace(/;\s*$/, " ON CONFLICT DO NOTHING;")
              await client.query(onConflictStmt)
              skippedCount++
              continue
            } catch {
              /* ignore fallback */
            }
          }
          skippedCount++
        } else {
          errorCount++
          if (errorCount <= 10) {
            console.warn(`Statement ${i} error:`, msg)
          }
        }
      }

      if ((i + 1) % 500 === 0) {
        console.log(`Processed ${i + 1}/${statements.length} statements...`)
      }
    }

    // Re-enable triggers
    await client.query("SET session_replication_role = 'origin';")
    // Ensure privileges are granted on all tables
    await client.query(`
      GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres, service_role, anon, authenticated;
      GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role, anon, authenticated;
      GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO postgres, service_role, anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, service_role, anon, authenticated;
    `)

    console.log(`\nImport Summary:`)
    console.log(`- Executed: ${successCount}`)
    console.log(`- Skipped/Duplicates: ${skippedCount}`)
    console.log(`- Errors: ${errorCount}`)
  } finally {
    client.release()
    await pool.end()
  }
}

runImport().catch((err) => {
  console.error("Fatal import error:", err)
  process.exit(1)
})
