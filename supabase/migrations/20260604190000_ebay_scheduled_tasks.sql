-- Scheduled task creation for eBay performance data entry
-- steven@partsdoc.co.uk: 1cdd089a-87ef-4d79-8617-f7e58c210c92

-- Function to create a task for eBay response time entry (weekdays 3pm BST → 14:00 UTC)
CREATE OR REPLACE FUNCTION create_ebay_response_time_task()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO tasks (
    title, description, assigned_to, status, priority,
    due_at, area, source, is_system_generated
  ) VALUES (
    'Log eBay response times',
    'Enter today''s 7/14/30-day open message counts from 3D Sellers into PartsDoc Hub → Operations → eBay Performance → Response Times tab.',
    '1cdd089a-87ef-4d79-8617-f7e58c210c92',
    'todo',
    2,
    (now() AT TIME ZONE 'Europe/London')::date + time '15:00' AT TIME ZONE 'Europe/London',
    'operations',
    'scheduled',
    true
  )
  ON CONFLICT DO NOTHING;
END;
$$;

-- Function to create a task for eBay ODR entry (Fridays 10am BST → 09:00 UTC)
CREATE OR REPLACE FUNCTION create_ebay_odr_task()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO tasks (
    title, description, assigned_to, status, priority,
    due_at, area, source, is_system_generated
  ) VALUES (
    'Enter weekly eBay ODR data',
    'Copy this week''s ODR metrics from eBay Seller Hub (C O/S, CCWSR, LDR for all 5 accounts) into PartsDoc Hub → Operations → eBay Performance → ODR tab.',
    '1cdd089a-87ef-4d79-8617-f7e58c210c92',
    'todo',
    2,
    (now() AT TIME ZONE 'Europe/London')::date + time '10:00' AT TIME ZONE 'Europe/London',
    'operations',
    'scheduled',
    true
  )
  ON CONFLICT DO NOTHING;
END;
$$;

-- Schedule via pg_cron (guards against extension not being available)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Weekdays at 14:00 UTC (3pm BST summer / 2pm GMT winter — adjusts automatically via Europe/London in function)
    PERFORM cron.schedule(
      'ebay-response-time-task',
      '0 14 * * 1-5',
      'SELECT create_ebay_response_time_task()'
    );
    -- Fridays at 09:00 UTC (10am BST summer)
    PERFORM cron.schedule(
      'ebay-odr-task',
      '0 9 * * 5',
      'SELECT create_ebay_odr_task()'
    );
  END IF;
END;
$$;
