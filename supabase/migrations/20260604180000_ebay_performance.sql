-- eBay Performance: ODR tracking + response times
-- Replaces the manual "Customer Response Times & ODR Data" spreadsheet

-- ── eBay accounts ────────────────────────────────────────────────
CREATE TABLE ebay_accounts (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text    NOT NULL UNIQUE,  -- ASC, CPI, 123, TSS, UNI
  name        text    NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ebay_accounts (code, name, sort_order) VALUES
  ('ASC', 'ASC',  1),
  ('CPI', 'CPI',  2),
  ('123', '123',  3),
  ('TSS', 'TSS',  4),
  ('UNI', 'UNI',  5);

-- ── Weekly ODR snapshots ─────────────────────────────────────────
-- Percentages stored as the actual % value (e.g. 0.65 means 0.65%)
-- TDR is generated automatically = cos_pct + ccwsr_pct
CREATE TABLE ebay_odr_snapshots (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid    NOT NULL REFERENCES ebay_accounts(id) ON DELETE CASCADE,
  year         integer NOT NULL,
  week_number  integer NOT NULL,  -- ISO week
  week_start   date,
  -- Cancellations - Out Of Stock
  cos_count    integer,
  cos_pct      numeric(7,4),
  -- Cases Closed Without Seller Resolution
  ccwsr_count  integer,
  ccwsr_pct    numeric(7,4),
  -- Late Despatch
  ldr_count    integer,
  ldr_pct      numeric(7,4),
  notes        text,
  created_by   uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, year, week_number)
);

-- TDR view (avoids generated column complexity)
CREATE OR REPLACE VIEW ebay_odr_with_tdr AS
SELECT *,
  ROUND(COALESCE(cos_pct, 0) + COALESCE(ccwsr_pct, 0), 4) AS tdr_pct
FROM ebay_odr_snapshots;

-- ── Daily response time snapshots ────────────────────────────────
CREATE TABLE ebay_response_times (
  id        uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  date      date    NOT NULL UNIQUE,
  open_7d   integer,
  open_14d  integer,
  open_30d  integer,
  notes     text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── RLS ─────────────────────────────────────────────────────────
ALTER TABLE ebay_accounts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebay_odr_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebay_response_times ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read"   ON ebay_accounts       FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_read"   ON ebay_odr_snapshots  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_write"  ON ebay_odr_snapshots  FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "auth_read"   ON ebay_response_times FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_write"  ON ebay_response_times FOR ALL    USING (auth.role() = 'authenticated');
