import { randomUUID } from "crypto"
import { logger } from "@/lib/logger"
import { createCategorySupabase, listCategoriesSupabase, updateCategorySupabase } from "@/src/lib/db/categories"
import { pgQuery } from "@/src/server/db/pg"

const listCategoriesFromPg = async () =>
  pgQuery(`
    SELECT
      c.id,
      c.name,
      c.slug,
      c."parentId" as "parentId",
      c."isActive" as "isActive",
      CASE
        WHEN p.id IS NULL THEN NULL
        ELSE json_build_object('id', p.id, 'name', p.name, 'slug', p.slug)
      END as parent
    FROM "Category" c
    LEFT JOIN "Category" p ON p.id = c."parentId"
    ORDER BY c.name ASC
  `)

export const listCategories = async () => {
  try {
    return await listCategoriesSupabase()
  } catch (error) {
    logger.warn("categories.list.supabase_pg_fallback", {
      error: error instanceof Error ? error.message : "unknown",
    })
    return listCategoriesFromPg()
  }
}

export const createCategory = async (input: { name: string; slug: string; parentId?: string | null }) => {
  try {
    return await createCategorySupabase(input)
  } catch (error) {
    logger.warn("categories.create.supabase_pg_fallback", {
      error: error instanceof Error ? error.message : "unknown",
    })
    const rows = await pgQuery(
      `INSERT INTO "Category" (id, name, slug, "parentId", "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, true, now(), now())
       RETURNING id, name, slug, "parentId", "isActive"`,
      [randomUUID(), input.name, input.slug, input.parentId ?? null],
    )
    return rows[0]
  }
}

export const updateCategory = async (
  id: string,
  input: { name?: string; slug?: string; isActive?: boolean },
) => {
  try {
    return await updateCategorySupabase(id, input)
  } catch (error) {
    logger.warn("categories.update.supabase_pg_fallback", {
      error: error instanceof Error ? error.message : "unknown",
    })
    const sets: string[] = []
    const values: unknown[] = []
    if (input.name !== undefined) {
      values.push(input.name)
      sets.push(`name = $${values.length}`)
    }
    if (input.slug !== undefined) {
      values.push(input.slug)
      sets.push(`slug = $${values.length}`)
    }
    if (input.isActive !== undefined) {
      values.push(input.isActive)
      sets.push(`"isActive" = $${values.length}`)
    }
    sets.push(`"updatedAt" = now()`)
    values.push(id)
    const rows = await pgQuery(
      `UPDATE "Category" SET ${sets.join(", ")} WHERE id = $${values.length}
       RETURNING id, name, slug, "parentId", "isActive"`,
      values,
    )
    return rows[0]
  }
}
