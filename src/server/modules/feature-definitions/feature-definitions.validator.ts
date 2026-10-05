import { z } from "zod"

export const createFeatureDefinitionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  icon: z.string().trim().max(2000).optional().nullable().or(z.literal("")),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
})

export const updateFeatureDefinitionSchema = createFeatureDefinitionSchema.partial()
