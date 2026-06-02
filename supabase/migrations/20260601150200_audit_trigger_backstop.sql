-- ============================================================================
-- Audit-log DB-trigger backstop
-- ----------------------------------------------------------------------------
-- The app-layer logAuditEvent() path is only as complete as developer
-- discipline. This migration adds database-level triggers on high-sensitivity
-- tables so that key mutations are recorded in public.audit_log REGARDLESS of
-- whether the writing code remembered to call logAuditEvent — including writes
-- made directly via SQL, edge functions, or service-role scripts.
--
-- Covered surfaces:
--   * products_cache.cost_price   — cost-price changes (margin-sensitive)
--   * user_roles                  — RBAC role grants / revocations
--   * api_keys                    — API key creation / (de)activation / deletion
--   * purchase_orders.status      — PO state transitions
--
-- All trigger functions are SECURITY DEFINER so they can write to the
-- append-only audit_log even when the acting role holds only INSERT on it.
-- They NEVER raise on audit-write failure (wrapped in EXCEPTION blocks) so a
-- logging problem can never block the underlying business write.
--
-- Depends on: 20260601150000_tasks_and_audit_log.sql (public.audit_log).
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS guards.
-- ============================================================================

-- ── Shared helper: resolve a human label for the current actor ──────────────
CREATE OR REPLACE FUNCTION public.audit_actor_display_name()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.email FROM public.profiles p WHERE p.id = auth.uid()),
    auth.uid()::text,
    'system'
  );
$$;

-- ============================================================================
-- products_cache.cost_price
-- ============================================================================
CREATE OR REPLACE FUNCTION public.audit_products_cache_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only record when cost_price actually changes.
  IF NEW.cost_price IS DISTINCT FROM OLD.cost_price THEN
    BEGIN
      INSERT INTO public.audit_log (
        actor_user_id, actor_display_name, action_type,
        entity_type, entity_id, entity_label, old_value, new_value
      ) VALUES (
        auth.uid(), public.audit_actor_display_name(), 'product.cost_price_changed',
        'products_cache', NEW.id::text, NEW.sku,
        jsonb_build_object('cost_price', OLD.cost_price),
        jsonb_build_object('cost_price', NEW.cost_price)
      );
    EXCEPTION WHEN OTHERS THEN
      -- Never let an audit-write failure block the business write.
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_products_cache_cost ON public.products_cache;
CREATE TRIGGER audit_products_cache_cost
  AFTER UPDATE OF cost_price ON public.products_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_products_cache_cost();

-- ============================================================================
-- user_roles  (role grants & revocations)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.audit_user_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text := public.audit_actor_display_name();
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO public.audit_log (
        actor_user_id, actor_display_name, action_type,
        entity_type, entity_id, entity_label, old_value, new_value
      ) VALUES (
        v_actor, v_actor_name, 'role.granted',
        'user_roles', NEW.user_id::text, NEW.role::text,
        NULL, jsonb_build_object('user_id', NEW.user_id, 'role', NEW.role)
      );
    ELSIF TG_OP = 'DELETE' THEN
      INSERT INTO public.audit_log (
        actor_user_id, actor_display_name, action_type,
        entity_type, entity_id, entity_label, old_value, new_value
      ) VALUES (
        v_actor, v_actor_name, 'role.revoked',
        'user_roles', OLD.user_id::text, OLD.role::text,
        jsonb_build_object('user_id', OLD.user_id, 'role', OLD.role), NULL
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS audit_user_roles ON public.user_roles;
CREATE TRIGGER audit_user_roles
  AFTER INSERT OR DELETE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_user_roles();

-- ============================================================================
-- api_keys  (creation / activation toggle / deletion)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.audit_api_keys()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text := public.audit_actor_display_name();
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO public.audit_log (
        actor_user_id, actor_display_name, action_type,
        entity_type, entity_id, entity_label, old_value, new_value
      ) VALUES (
        v_actor, v_actor_name, 'api_key.created',
        'api_keys', NEW.id::text, NEW.name,
        NULL, jsonb_build_object('name', NEW.name, 'active', NEW.active)
      );
    ELSIF TG_OP = 'UPDATE' THEN
      -- Only audit the security-relevant active toggle.
      IF NEW.active IS DISTINCT FROM OLD.active THEN
        INSERT INTO public.audit_log (
          actor_user_id, actor_display_name, action_type,
          entity_type, entity_id, entity_label, old_value, new_value
        ) VALUES (
          v_actor, v_actor_name,
          CASE WHEN NEW.active THEN 'api_key.activated' ELSE 'api_key.deactivated' END,
          'api_keys', NEW.id::text, NEW.name,
          jsonb_build_object('active', OLD.active),
          jsonb_build_object('active', NEW.active)
        );
      END IF;
    ELSIF TG_OP = 'DELETE' THEN
      INSERT INTO public.audit_log (
        actor_user_id, actor_display_name, action_type,
        entity_type, entity_id, entity_label, old_value, new_value
      ) VALUES (
        v_actor, v_actor_name, 'api_key.deleted',
        'api_keys', OLD.id::text, OLD.name,
        jsonb_build_object('name', OLD.name, 'active', OLD.active), NULL
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS audit_api_keys ON public.api_keys;
CREATE TRIGGER audit_api_keys
  AFTER INSERT OR UPDATE OR DELETE ON public.api_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_api_keys();

-- ============================================================================
-- purchase_orders.status  (PO state transitions)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.audit_purchase_orders_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    BEGIN
      INSERT INTO public.audit_log (
        actor_user_id, actor_display_name, action_type,
        entity_type, entity_id, entity_label, old_value, new_value
      ) VALUES (
        auth.uid(), public.audit_actor_display_name(), 'purchase_order.status_changed',
        'purchase_orders', NEW.id::text, NEW.status,
        jsonb_build_object('status', OLD.status),
        jsonb_build_object('status', NEW.status)
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_purchase_orders_status ON public.purchase_orders;
CREATE TRIGGER audit_purchase_orders_status
  AFTER UPDATE OF status ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_purchase_orders_status();
