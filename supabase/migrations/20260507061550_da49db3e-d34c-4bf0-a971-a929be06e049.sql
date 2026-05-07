INSERT INTO public.app_settings (key, value, description)
VALUES (
  'buying.po_suppression_hours',
  '22'::jsonb,
  'Hours to suppress a supplier from Buy Recommendations after a PO is sent to Mintsoft, while waiting for ASN conversion.'
)
ON CONFLICT (key) DO NOTHING;