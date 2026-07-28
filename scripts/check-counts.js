import { pgQuery } from "../src/server/db/pg.ts"

async function check() {
  try {
    const prodSample = await pgQuery('SELECT * FROM "Product" LIMIT 1')
    console.log("Product Table Columns:", Object.keys(prodSample[0] || {}))

    const puRows = await pgQuery(
      `
      SELECT pu.*, 
             p.name as related_product_name,
             p.slug as related_product_slug,
             p.thumbnail as related_product_image
      FROM "ProductUsage" pu
      LEFT JOIN "Product" p ON pu.related_product_id = p.id
      LIMIT 1
      `
    )
    console.log("ProductUsage Query result:", puRows)
  } catch (err) {
    console.error("EXACT SQL ERROR:", err)
  }
}

check()
