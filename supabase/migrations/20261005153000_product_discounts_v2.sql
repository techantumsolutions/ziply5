CREATE TABLE IF NOT EXISTS product_discounts_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id TEXT NOT NULL REFERENCES "Product"(id) ON DELETE CASCADE,
  discount_type VARCHAR(16) NOT NULL CHECK (discount_type IN ('percentage', 'flat')),
  discount_value NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  is_stackable BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The "Enable Discount" toggle stores a 0-value row as its on/off flag.
ALTER TABLE product_discounts_v2 DROP CONSTRAINT IF EXISTS product_discounts_v2_discount_value_check;
ALTER TABLE product_discounts_v2 ADD CONSTRAINT product_discounts_v2_discount_value_check CHECK (discount_value >= 0);

CREATE INDEX IF NOT EXISTS idx_product_discounts_v2_product_id ON product_discounts_v2(product_id);
CREATE INDEX IF NOT EXISTS idx_product_discounts_v2_dates ON product_discounts_v2(start_date, end_date);
