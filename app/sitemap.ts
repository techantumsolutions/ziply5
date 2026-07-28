import type { MetadataRoute } from "next"
import { getProductUsageSitemapUrls } from "@/src/server/modules/product-usage/product-usage.service"
import { pgQuery } from "@/src/server/db/pg"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ziply5.com"

  // Base static pages
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}`, lastModified: new Date(), changeFrequency: "daily", priority: 1.0 },
    { url: `${baseUrl}/products`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/product-usage`, lastModified: new Date(), changeFrequency: "daily", priority: 0.8 },
    { url: `${baseUrl}/about`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/contact`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/privacy-policy`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/terms`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/returns`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/shipping`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
  ]

  // Dynamic Product Usage entries
  let usageUrls: MetadataRoute.Sitemap = []
  try {
    const usages = await getProductUsageSitemapUrls()
    usageUrls = usages.map((item) => ({
      url: `${baseUrl}/product-usage/${item.slug}`,
      lastModified: item.updatedAt ? new Date(item.updatedAt) : new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
    }))
  } catch {
    /* fallback if DB not available during build */
  }

  // Dynamic Products
  let productUrls: MetadataRoute.Sitemap = []
  try {
    const products = await pgQuery<{ slug: string; updatedAt: Date }>(
      `SELECT slug, "updatedAt" FROM "Product" WHERE status = 'published' AND "deletedAt" IS NULL`,
    )
    productUrls = products.map((p) => ({
      url: `${baseUrl}/product/${p.slug}`,
      lastModified: p.updatedAt ? new Date(p.updatedAt) : new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    }))
  } catch {
    /* fallback */
  }

  return [...staticPages, ...usageUrls, ...productUrls]
}
