-- Add dosage guidance fields to chemical products
ALTER TABLE chemical_products ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE chemical_products ADD COLUMN IF NOT EXISTS suggested_dose text;
ALTER TABLE chemical_products ADD COLUMN IF NOT EXISTS notes text;
