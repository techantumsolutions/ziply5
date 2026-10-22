-- Add packageImages array column to Shipment and Order for manual shipment verification
ALTER TABLE "Shipment"
  ADD COLUMN IF NOT EXISTS "packageImages" text[];

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "packageImages" text[];
