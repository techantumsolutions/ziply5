import { pgTx, pgQuery } from "../src/server/db/pg"

async function migrateProductIds() {
  const products = await pgQuery<{ id: string; name: string; createdAt: Date }>(
    `SELECT id, name, "createdAt" FROM "Product" ORDER BY "createdAt" ASC`
  )

  console.log(`Migrating ${products.length} products to PRD-000001 format...`)

  const fkColumns = await pgQuery<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name != 'Product'
      AND (column_name ILIKE '%product_id%' OR column_name ILIKE '%productid%');
  `)

  console.log(`Found ${fkColumns.length} referencing columns in DB tables.`)

  await pgTx(async (client) => {
    await client.query(`SET session_replication_role = 'replica';`)

    for (let index = 0; index < products.length; index++) {
      const oldId = products[index].id
      const newId = `PRD-${String(index + 1).padStart(6, '0')}`

      if (oldId === newId) continue

      console.log(`Updating [${index + 1}/${products.length}]: ${oldId} -> ${newId} (${products[index].name})`)

      // Update Product table
      await client.query(`UPDATE "Product" SET id = $1 WHERE id = $2`, [newId, oldId])

      // Update child tables with SAVEPOINT to isolate any individual table issue
      for (const t of fkColumns) {
        const tableName = t.table_name === t.table_name.toLowerCase() ? t.table_name : `"${t.table_name}"`
        const colName = t.column_name.includes("_") ? t.column_name : `"${t.column_name}"`
        await client.query(`SAVEPOINT sp_child;`)
        try {
          await client.query(`UPDATE ${tableName} SET ${colName} = $1 WHERE ${colName} = $2`, [newId, oldId])
          await client.query(`RELEASE SAVEPOINT sp_child;`)
        } catch (err: any) {
          await client.query(`ROLLBACK TO SAVEPOINT sp_child;`)
          console.warn(`Could not update ${t.table_name}.${t.column_name}:`, err.message)
        }
      }

      // Update AbandonedCart itemsJson if table exists
      await client.query(`SAVEPOINT sp_cart;`)
      try {
        await client.query(
          `UPDATE "AbandonedCart" SET "itemsJson" = REPLACE("itemsJson", $1, $2) WHERE "itemsJson" LIKE '%' || $1 || '%'`,
          [oldId, newId]
        )
        await client.query(`RELEASE SAVEPOINT sp_cart;`)
      } catch {
        await client.query(`ROLLBACK TO SAVEPOINT sp_cart;`)
      }
    }

    await client.query(`SET session_replication_role = 'origin';`)
    console.log("Product ID sequence migration complete successfully!")
  })

  process.exit(0)
}

migrateProductIds().catch((err) => {
  console.error("Failed to migrate product IDs:", err)
  process.exit(1)
})
