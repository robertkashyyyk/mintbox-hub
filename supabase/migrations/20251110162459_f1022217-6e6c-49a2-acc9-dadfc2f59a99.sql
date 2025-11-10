-- Add family column to brands table
ALTER TABLE brands 
ADD COLUMN family TEXT;

-- Create index for faster family lookups
CREATE INDEX idx_brands_family ON brands(family) WHERE family IS NOT NULL;

-- Example: Update existing brands with families
UPDATE brands 
SET family = 'NGK' 
WHERE name = 'NGK';

UPDATE brands 
SET family = 'Sealey' 
WHERE name = 'Sealey';