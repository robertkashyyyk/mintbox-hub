-- Unify LSA threshold: copy ingest_min_threshold value into min_threshold (if higher), then drop legacy key
DO $$
DECLARE
  v_ingest int;
  v_min int;
BEGIN
  SELECT (value)::int INTO v_ingest FROM app_settings WHERE key = 'lsa.ingest_min_threshold';
  SELECT (value)::int INTO v_min    FROM app_settings WHERE key = 'lsa.min_threshold';
  IF v_ingest IS NOT NULL THEN
    UPDATE app_settings
       SET value = to_jsonb(GREATEST(COALESCE(v_min, 1), v_ingest)),
           updated_at = now()
     WHERE key = 'lsa.min_threshold';
    DELETE FROM app_settings WHERE key = 'lsa.ingest_min_threshold';
  END IF;
END $$;

-- Ensure PO suppression hours setting exists with description for clarity
INSERT INTO app_settings (key, value, description)
VALUES (
  'buying.po_suppression_hours',
  '22'::jsonb,
  'After a Draft PO is sent to Mintsoft, hide the supplier from Buy Recommendations for this many hours to avoid double-ordering while waiting for ASN conversion.'
)
ON CONFLICT (key) DO UPDATE
  SET description = EXCLUDED.description;