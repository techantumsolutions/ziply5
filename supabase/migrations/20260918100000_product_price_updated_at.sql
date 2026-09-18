ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "priceUpdatedAt" TIMESTAMP(3);

ALTER TABLE "ProductVariant"
  ADD COLUMN IF NOT EXISTS "priceUpdatedAt" TIMESTAMP(3);

UPDATE "Product"
SET "priceUpdatedAt" = COALESCE("priceUpdatedAt", "updatedAt", "createdAt")
WHERE "priceUpdatedAt" IS NULL;

UPDATE "ProductVariant"
SET "priceUpdatedAt" = COALESCE("priceUpdatedAt", "updatedAt", "createdAt")
WHERE "priceUpdatedAt" IS NULL;
