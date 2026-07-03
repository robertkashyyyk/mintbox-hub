-- War Room: dedicated RBAC area + role for the leadership targets board.
-- Applied live via MCP apply_migration 2026-07-02; kept here for version control.
--
-- System area (registration; nav is rendered manually + capability-gated, so is_menu_item=false).
INSERT INTO public.system_areas (key, label, parent_key, route_path, icon_name, sort_order, is_menu_item)
VALUES ('strategy.war_room', 'War Room', NULL, '/war-room', 'Target', 58, false)
ON CONFLICT (key) DO NOTHING;

-- Dedicated role held ONLY by the leadership accounts (assigned in the next migration,
-- because a newly-added enum value cannot be USED in the same transaction that adds it).
ALTER TYPE public.rbac_role ADD VALUE IF NOT EXISTS 'war_room';
