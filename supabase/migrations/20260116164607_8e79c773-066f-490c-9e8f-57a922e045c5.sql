-- Add source column to upload_history to distinguish PUSH vs PULL
ALTER TABLE upload_history 
ADD COLUMN source text NOT NULL DEFAULT 'push';

-- Add constraint to limit values
ALTER TABLE upload_history 
ADD CONSTRAINT upload_history_source_check 
CHECK (source IN ('push', 'pull'));

-- Add prefix column for PULL operations
ALTER TABLE upload_history 
ADD COLUMN prefix text;