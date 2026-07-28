import { z } from "zod"
import sanitizeHtml from "sanitize-html"

export const sanitizeRichText = (html?: string | null): string => {
  if (!html) return ""
  return sanitizeHtml(html, {
    allowedTags: [
      "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "p", "a", "ul", "ol",
      "nl", "li", "b", "i", "strong", "em", "strike", "code", "hr", "br", "div",
      "table", "thead", "caption", "tbody", "tr", "th", "td", "pre", "img", "span", "iframe"
    ],
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      img: ["src", "srcset", "alt", "title", "width", "height", "loading"],
      iframe: ["src", "width", "height", "frameborder", "allow", "allowfullscreen"],
      "*": ["class", "style", "id"]
    },
    allowedIframeHostnames: ["www.youtube.com", "youtube.com", "player.vimeo.com"],
  })
}

export const createProductUsageSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters").max(255),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .max(255)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must contain only lowercase letters, numbers, and hyphens"),
  shortDescription: z.string().max(1000).optional().nullable(),
  description: z.string().optional().nullable(),
  usageProcess: z.string().optional().nullable(),
  thumbnail: z.string().optional().nullable(),
  videoType: z.enum(["none", "upload", "youtube", "vimeo", "cdn"]).default("none"),
  videoUrl: z.string().optional().nullable(),
  uploadedVideo: z.string().optional().nullable(),
  relatedProductId: z.string().min(1).optional().nullable(),
  seoTitle: z.string().max(255).optional().nullable(),
  metaDescription: z.string().max(500).optional().nullable(),
  metaKeywords: z.string().max(500).optional().nullable(),
  canonicalUrl: z.string().optional().nullable(),
  ogTitle: z.string().max(255).optional().nullable(),
  ogDescription: z.string().max(500).optional().nullable(),
  ogImage: z.string().optional().nullable(),
  robots: z.string().default("index,follow"),
  includeInSitemap: z.boolean().default(true),
  publishStatus: z.enum(["draft", "published", "archived"]).default("draft"),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().default(0),
})

export const updateProductUsageSchema = createProductUsageSchema.partial()

export const navigationConfigSchema = z.object({
  title: z.string().min(1, "Menu title is required").max(100),
  url: z.string().min(1, "Menu URL is required").max(255),
  enabled: z.boolean().default(true),
  displayOrder: z.number().int().default(4),
})
