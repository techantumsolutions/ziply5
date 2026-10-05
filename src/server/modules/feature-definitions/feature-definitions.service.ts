import { randomUUID } from "crypto"
import { pgQuery } from "@/src/server/db/pg"
import { logActivity } from "@/src/server/modules/activity/activity.service"

export type FeatureDefinitionRow = {
  id: string
  title: string
  icon: string | null
  isActive: boolean
  sortOrder: number
  createdAt: string | Date
  updatedAt: string | Date
}

const normalizeIcon = (icon?: string | null) => {
  const value = String(icon ?? "").trim()
  return value.length ? value : null
}

export const listFeatureDefinitions = async (opts?: { activeOnly?: boolean }) => {
  const activeOnly = opts?.activeOnly === true
  const rows = await pgQuery<FeatureDefinitionRow[]>(
    `
      SELECT id, title, icon, "isActive", "sortOrder", "createdAt", "updatedAt"
      FROM "FeatureDefinition"
      ${activeOnly ? `WHERE "isActive" = true` : ""}
      ORDER BY "sortOrder" ASC, title ASC
    `,
  )
  return rows
}

export const getFeatureDefinitionsByIds = async (ids: string[]) => {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  if (!unique.length) return [] as FeatureDefinitionRow[]
  const rows = await pgQuery<FeatureDefinitionRow[]>(
    `
      SELECT id, title, icon, "isActive", "sortOrder", "createdAt", "updatedAt"
      FROM "FeatureDefinition"
      WHERE id = ANY($1::text[])
    `,
    [unique],
  )
  return rows
}

export const createFeatureDefinition = async (
  input: { title: string; icon?: string | null; isActive?: boolean; sortOrder?: number },
  actorId?: string,
) => {
  const id = randomUUID()
  const title = input.title.trim()
  const icon = normalizeIcon(input.icon)
  const isActive = input.isActive !== false
  const sortOrder = Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 0

  const existing = await pgQuery<Array<{ id: string }>>(
    `SELECT id FROM "FeatureDefinition" WHERE lower(trim(title)) = lower(trim($1)) LIMIT 1`,
    [title],
  )
  if (existing[0]) throw new Error("A feature with this title already exists")

  const rows = await pgQuery<FeatureDefinitionRow[]>(
    `
      INSERT INTO "FeatureDefinition" (id, title, icon, "isActive", "sortOrder", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, now(), now())
      RETURNING id, title, icon, "isActive", "sortOrder", "createdAt", "updatedAt"
    `,
    [id, title, icon, isActive, sortOrder],
  )
  const created = rows[0]
  if (!created) throw new Error("Failed to create feature definition")

  await logActivity({
    actorId,
    action: "feature_definition.create",
    entityType: "FeatureDefinition",
    entityId: created.id,
    metadata: { title: created.title },
  }).catch(() => null)

  return created
}

export const updateFeatureDefinition = async (
  id: string,
  input: { title?: string; icon?: string | null; isActive?: boolean; sortOrder?: number },
  actorId?: string,
) => {
  const currentRows = await pgQuery<FeatureDefinitionRow[]>(
    `SELECT id, title, icon, "isActive", "sortOrder", "createdAt", "updatedAt" FROM "FeatureDefinition" WHERE id = $1 LIMIT 1`,
    [id],
  )
  const current = currentRows[0]
  if (!current) throw new Error("Feature definition not found")

  const title = input.title !== undefined ? input.title.trim() : current.title
  if (!title) throw new Error("Title is required")

  if (input.title !== undefined) {
    const dup = await pgQuery<Array<{ id: string }>>(
      `SELECT id FROM "FeatureDefinition" WHERE lower(trim(title)) = lower(trim($1)) AND id <> $2 LIMIT 1`,
      [title, id],
    )
    if (dup[0]) throw new Error("A feature with this title already exists")
  }

  const icon = input.icon !== undefined ? normalizeIcon(input.icon) : current.icon
  const isActive = input.isActive !== undefined ? Boolean(input.isActive) : current.isActive
  const sortOrder = input.sortOrder !== undefined ? Number(input.sortOrder) : current.sortOrder

  const rows = await pgQuery<FeatureDefinitionRow[]>(
    `
      UPDATE "FeatureDefinition"
      SET title = $2,
          icon = $3,
          "isActive" = $4,
          "sortOrder" = $5,
          "updatedAt" = now()
      WHERE id = $1
      RETURNING id, title, icon, "isActive", "sortOrder", "createdAt", "updatedAt"
    `,
    [id, title, icon, isActive, Number.isFinite(sortOrder) ? sortOrder : 0],
  )
  const updated = rows[0]
  if (!updated) throw new Error("Failed to update feature definition")

  await logActivity({
    actorId,
    action: "feature_definition.update",
    entityType: "FeatureDefinition",
    entityId: updated.id,
    metadata: { title: updated.title, isActive: updated.isActive },
  }).catch(() => null)

  return updated
}

export const deleteFeatureDefinition = async (id: string, actorId?: string) => {
  const rows = await pgQuery<Array<{ id: string }>>(
    `DELETE FROM "FeatureDefinition" WHERE id = $1 RETURNING id`,
    [id],
  )
  if (!rows[0]) throw new Error("Feature definition not found")

  await logActivity({
    actorId,
    action: "feature_definition.delete",
    entityType: "FeatureDefinition",
    entityId: id,
    metadata: {},
  }).catch(() => null)

  return { id }
}

export const resolveProductFeaturesFromDefinitions = async (
  featureDefinitionIds: string[],
): Promise<Array<{ featureDefinitionId: string; title: string; icon: string | null }>> => {
  const defs = await getFeatureDefinitionsByIds(featureDefinitionIds)
  const byId = new Map(defs.map((d) => [d.id, d]))
  const missing = featureDefinitionIds.filter((id) => !byId.has(id))
  if (missing.length) {
    throw new Error(`Unknown feature definition id(s): ${missing.join(", ")}`)
  }
  return featureDefinitionIds.map((id) => {
    const def = byId.get(id)!
    return {
      featureDefinitionId: def.id,
      title: def.title,
      icon: def.icon,
    }
  })
}
