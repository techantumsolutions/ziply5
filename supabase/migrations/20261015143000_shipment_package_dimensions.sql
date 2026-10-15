ALTER TABLE "Shipment"
  ADD COLUMN IF NOT EXISTS "packageLengthCm" numeric,
  ADD COLUMN IF NOT EXISTS "packageBreadthCm" numeric,
  ADD COLUMN IF NOT EXISTS "packageHeightCm" numeric;
