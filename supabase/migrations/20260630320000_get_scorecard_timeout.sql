-- get_scorecard runs ~3.1s (it grew when profit_8020_weekly back-weeks W8–W26 were
-- captured for the ASC-FGM cost fix), which exceeds the anon role's ~3s statement
-- timeout — so Orin's read-only ANON client (and the Scorecard page) 500'd on it.
-- Give the function its own headroom. Read-only aggregation, safe.
-- Proper follow-up: scope the 80/20 percent_rank scan to the lookback window so it's
-- fast again rather than scanning all of profit_8020_weekly.
ALTER FUNCTION public.get_scorecard(integer) SET statement_timeout = '15s';
