-- Add pack snapshot and savings fields to OrderItem table
ALTER TABLE "OrderItem"
  ADD COLUMN IF NOT EXISTS "packQuantity" INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "packName" TEXT,
  ADD COLUMN IF NOT EXISTS "comparePrice" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "savingAmount" DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "baseWeight" TEXT;
