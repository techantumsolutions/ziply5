-- Product variant HSN / EAN codes + shared feature catalog for product selection

ALTER TABLE "ProductVariant"
  ADD COLUMN IF NOT EXISTS "hsnCode" TEXT,
  ADD COLUMN IF NOT EXISTS "eanCode" TEXT;

CREATE TABLE IF NOT EXISTS "FeatureDefinition" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "icon" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeatureDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FeatureDefinition_title_key"
  ON "FeatureDefinition" (lower(trim("title")));

CREATE INDEX IF NOT EXISTS "FeatureDefinition_isActive_sortOrder_idx"
  ON "FeatureDefinition" ("isActive", "sortOrder");

ALTER TABLE "ProductFeature"
  ADD COLUMN IF NOT EXISTS "featureDefinitionId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ProductFeature_featureDefinitionId_fkey'
  ) THEN
    ALTER TABLE "ProductFeature"
      ADD CONSTRAINT "ProductFeature_featureDefinitionId_fkey"
      FOREIGN KEY ("featureDefinitionId")
      REFERENCES "FeatureDefinition"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ProductFeature_featureDefinitionId_idx"
  ON "ProductFeature" ("featureDefinitionId");
