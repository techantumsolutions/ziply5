import { z } from "zod"

const variantSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  weight: z.string().optional().nullable(),
  price: z.number().positive(),
  mrp: z.number().positive().optional().nullable(),
  discountPercent: z.number().min(0).max(100).optional().nullable(),
  stock: z.number().int().min(0).optional(),
  sku: z.string().min(1),
  isDefault: z.boolean().optional(),
})

const featureSchema = z.object({
  title: z.string().min(1),
  icon: z.string().optional().nullable(),
})

const labelSchema = z.object({
  label: z.string().min(1),
  color: z.string().optional().nullable(),
})

const detailsSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  sortOrder: z.number().int().min(0).optional(),
})

const sectionSchema = z.object({
  id: z.string().optional().nullable(),
  title: z.string().trim().min(1, "Section title is required"),
  description: z.string().trim().min(1, "Section description is required"),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
})

export const createProductSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2),
  sku: z.string().min(2),
  price: z.number().min(0),
  description: z.string().optional(),
  type: z.enum(["simple", "variant"]),
  basePrice: z.number().positive().optional().nullable(),
  salePrice: z.number().min(0).optional().nullable(),
  discountPercent: z.number().min(0).max(100).optional().nullable(),
  weight: z.string().optional().nullable(),
  taxIncluded: z.boolean().optional(),
  stockStatus: z.enum(["in_stock", "out_of_stock"]).optional(),
  totalStock: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  allowReturn: z.boolean().optional(),
  thumbnail: z.string().optional().nullable(),
  metaTitle: z.string().optional().nullable(),
  metaDescription: z.string().optional().nullable(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  categoryId: z.string().nullable().optional(),
  brandId: z.string().nullable().optional(),
  variants: z.array(variantSchema).optional(),
  images: z.array(z.string().min(1)).optional(),
  features: z.array(featureSchema).optional(),
  tagIds: z.array(z.string()).optional(),
  labels: z.array(labelSchema).optional(),
  details: z.array(detailsSchema).optional(),
  sections: z.array(sectionSchema).max(10).optional(),
  amazonLink: z.string().optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.type === "variant") {
    if (!data.variants?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["variants"],
        message: "At least one variant is required for variant products",
      })
      return
    }
    const defaultCount = data.variants.filter((v) => Boolean(v.isDefault)).length
    if (defaultCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["variants"],
        message: "Only one variant can be marked as default",
      })
    }
  }
})

export const updateProductSchema = z.object({
  name: z.string().min(2).optional(),
  slug: z.string().min(2).optional(),
  sku: z.string().min(2).optional(),
  price: z.number().min(0).optional(),
  description: z.string().nullable().optional(),
  type: z.enum(["simple", "variant"]).optional(),
  basePrice: z.number().positive().optional().nullable(),
  salePrice: z.number().min(0).optional().nullable(),
  discountPercent: z.number().min(0).max(100).optional().nullable(),
  weight: z.string().nullable().optional(),
  taxIncluded: z.boolean().optional(),
  stockStatus: z.enum(["in_stock", "out_of_stock"]).optional(),
  totalStock: z.number().int().min(0).optional(),
  shelfLife: z.string().nullable().optional(),
  preparationType: z.enum(["ready_to_eat", "ready_to_cook"]).optional().nullable(),
  spiceLevel: z.enum(["mild", "medium", "hot", "extra_hot"]).optional().nullable(),
  isActive: z.boolean().optional(),
  allowReturn: z.boolean().optional(),
  thumbnail: z.string().nullable().optional(),
  metaTitle: z.string().nullable().optional(),
  metaDescription: z.string().nullable().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  categoryId: z.string().nullable().optional(),
  tagIds: z.array(z.string()).optional(),
  brandId: z.string().nullable().optional(),
  variants: z.array(variantSchema).optional(),
  images: z.array(z.string().min(1)).optional(),
  features: z.array(featureSchema).optional(),
  labels: z.array(labelSchema).optional(),
  details: z.array(detailsSchema).optional(),
  sections: z.array(sectionSchema).max(10).optional(),
  amazonLink: z.string().nullable().optional(),
})
