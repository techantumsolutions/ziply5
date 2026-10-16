ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "codPaymentLinkId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "codPaymentLinkUrl" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Order_codPaymentLinkId_unique"
  ON "Order" ("codPaymentLinkId")
  WHERE "codPaymentLinkId" IS NOT NULL;
