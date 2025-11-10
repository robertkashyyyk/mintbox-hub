-- Create enum for prefix styles
CREATE TYPE prefix_style AS ENUM ('hyphen', 'slash');

-- Drop the old brand_prefixes table since we'll consolidate
DROP TABLE IF EXISTS brand_prefixes;

-- Update brands table to include prefix and prefix_style
ALTER TABLE brands 
ADD COLUMN prefix TEXT,
ADD COLUMN prefix_style prefix_style DEFAULT 'hyphen';

-- Add unique constraint on prefix
ALTER TABLE brands 
ADD CONSTRAINT brands_prefix_key UNIQUE (prefix);

-- Create index for faster lookups
CREATE INDEX idx_brands_prefix ON brands(prefix);

-- Example brands (you can add yours after)
INSERT INTO brands (name, prefix, prefix_style) VALUES
  ('NGK', 'NGK', 'hyphen'),
  ('Sealey', 'SEA', 'hyphen')
ON CONFLICT (name) DO UPDATE 
  SET prefix = EXCLUDED.prefix, 
      prefix_style = EXCLUDED.prefix_style;