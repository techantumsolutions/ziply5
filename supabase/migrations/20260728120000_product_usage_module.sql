-- Migration: Product Usage Module Schema & Navigation Settings
CREATE TABLE IF NOT EXISTS "ProductUsage" (
    "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "title" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "short_description" TEXT,
    "description" TEXT,
    "usage_process" TEXT,
    "thumbnail" TEXT,
    "video_type" VARCHAR(32) NOT NULL DEFAULT 'none',
    "video_url" TEXT,
    "uploaded_video" TEXT,
    "related_product_id" TEXT REFERENCES "Product"("id") ON DELETE SET NULL,
    "seo_title" VARCHAR(255),
    "meta_description" TEXT,
    "meta_keywords" TEXT,
    "canonical_url" TEXT,
    "og_title" VARCHAR(255),
    "og_description" TEXT,
    "og_image" TEXT,
    "robots" VARCHAR(64) DEFAULT 'index,follow',
    "include_in_sitemap" BOOLEAN DEFAULT true,
    "publish_status" VARCHAR(32) NOT NULL DEFAULT 'draft',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INT NOT NULL DEFAULT 0,
    "created_by" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
    "updated_by" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at" TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductUsage_slug_unique_active" 
ON "ProductUsage"("slug") WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "ProductUsage_status_active_order_idx" 
ON "ProductUsage"("publish_status", "is_active", "display_order", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "ProductUsage_related_product_idx" 
ON "ProductUsage"("related_product_id");

-- Seed default navigation setting for Product Usage in Setting table
INSERT INTO "Setting" ("id", "group", "key", "valueJson", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'navigation',
  'product_usage',
  '{"title": "How to Use", "url": "/product-usage", "enabled": true, "displayOrder": 4}'::jsonb,
  now()
)
ON CONFLICT ("group", "key") DO NOTHING;
