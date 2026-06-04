-- Add SHA-256 content hash to carrier_documents for rename-proof duplicate detection
ALTER TABLE carrier_documents ADD COLUMN IF NOT EXISTS file_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS carrier_documents_file_hash_unique 
  ON carrier_documents(file_hash) WHERE file_hash IS NOT NULL;
