-- Sécurité : rôle applicatif, row-level security par société, journal d'audit chaîné,
-- fonctions SECURITY DEFINER pour les seules lectures transverses autorisées.

-- 1. Rôle applicatif (sans BYPASSRLS). En production, le DBA crée cir_app LOGIN au préalable.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cir_app') THEN
    CREATE ROLE cir_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint

-- 2. Contexte de requête posé par l'API (SET LOCAL dans chaque transaction)
CREATE OR REPLACE FUNCTION app_company_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.company_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- 3. updated_at automatique
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'updated_at'
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t || '_touch', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- 4. Row-level security : toute table portant company_id est isolée par société
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'company_id'
             AND table_name NOT IN ('memberships', 'audit_log')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())',
      t);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON companies USING (id = app_company_id()) WITH CHECK (id = app_company_id());
--> statement-breakpoint
-- Un utilisateur voit ses propres adhésions (toutes sociétés) ; il n'écrit que dans la société active.
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON memberships
  USING (company_id = app_company_id() OR user_id = app_user_id())
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_read ON audit_log FOR SELECT USING (company_id = app_company_id());
--> statement-breakpoint

-- 5. Journal d'audit : insertion seule, chaînage SHA-256 par société
CREATE OR REPLACE FUNCTION audit_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_company uuid;
  v_entity_id text;
  v_prev text;
  v_hash text;
  v_ts timestamptz := clock_timestamp();
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_before := to_jsonb(OLD) - 'content' - 'content_text' - 'rows' - 'updated_at';
  END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN
    v_after := to_jsonb(NEW) - 'content' - 'content_text' - 'rows' - 'updated_at';
  END IF;
  IF TG_OP = 'UPDATE' AND v_before = v_after THEN
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'companies' THEN
    v_company := (coalesce(v_after, v_before) ->> 'id')::uuid;
  ELSE
    v_company := (coalesce(v_after, v_before) ->> 'company_id')::uuid;
  END IF;
  v_entity_id := coalesce(coalesce(v_after, v_before) ->> 'id', coalesce(v_after, v_before) ->> 'company_id');

  PERFORM pg_advisory_xact_lock(hashtext('audit:' || coalesce(v_company::text, 'global')));
  SELECT hash INTO v_prev FROM audit_log
   WHERE company_id IS NOT DISTINCT FROM v_company
   ORDER BY id DESC LIMIT 1;

  v_hash := encode(sha256(convert_to(
      coalesce(v_prev, '') || '|' || TG_TABLE_NAME || '|' || lower(TG_OP) || '|' || coalesce(v_entity_id, '') || '|' ||
      coalesce(v_before::text, '') || '|' || coalesce(v_after::text, '') || '|' || v_ts::text, 'UTF8')), 'hex');

  INSERT INTO audit_log (company_id, actor_user_id, action, entity, entity_id, before, after, ip, created_at, prev_hash, hash)
  VALUES (v_company, app_user_id(), lower(TG_OP), TG_TABLE_NAME, v_entity_id, v_before, v_after,
          nullif(current_setting('app.ip', true), ''), v_ts, v_prev, v_hash);
  RETURN NULL;
END $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['companies','memberships','invitations','rescrits','fiscal_years','people','files',
                           'projects','assignments','frascati_answers','operations','locks','topics','notes',
                           'note_links','time_entries','imports','sections','biblio_refs','comments','archives','subscriptions']
  LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_trigger()', t || '_audit', t);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log est en insertion seule (% refusé)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_immutable();
--> statement-breakpoint

-- 6. Lectures transverses contrôlées (SECURITY DEFINER)

-- Adhésions de l'utilisateur courant, avec le nom des sociétés (invisible autrement par RLS).
CREATE OR REPLACE FUNCTION app_my_memberships()
RETURNS TABLE (company_id uuid, company_name text, siren text, role text, access_expires_at date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.company_id, c.name, c.siren, m.role, m.access_expires_at
    FROM memberships m JOIN companies c ON c.id = m.company_id
   WHERE m.user_id = app_user_id()
   ORDER BY c.name
$$;
--> statement-breakpoint

-- Invitation par empreinte du jeton (avant que l'invité ne soit membre).
CREATE OR REPLACE FUNCTION app_find_invitation(p_token_hash text)
RETURNS TABLE (id uuid, company_id uuid, company_name text, email text, role text, expires_at timestamptz,
               access_expires_at date, accepted_at timestamptz, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.company_id, c.name, i.email, i.role, i.expires_at, i.access_expires_at, i.accepted_at, i.revoked_at
    FROM invitations i JOIN companies c ON c.id = i.company_id
   WHERE i.token_hash = p_token_hash
$$;
--> statement-breakpoint

-- Vue groupe : uniquement avancement et statut du dernier exercice de chaque société, jamais de données RH.
CREATE OR REPLACE FUNCTION app_group_overview(p_group_id uuid)
RETURNS TABLE (company_id uuid, company_name text, siren text, fiscal_year_label text, status text, progress int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = p_group_id AND gm.user_id = app_user_id()) THEN
    RAISE EXCEPTION 'accès refusé au groupe' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT c.id, c.name, c.siren, fy.label, fy.status, fy.progress
      FROM companies c
      LEFT JOIN LATERAL (
        SELECT f.label, f.status, f.progress FROM fiscal_years f
         WHERE f.company_id = c.id ORDER BY f.start_date DESC LIMIT 1
      ) fy ON true
     WHERE c.group_id = p_group_id
     ORDER BY c.name;
END $$;
--> statement-breakpoint

-- Abonnement retrouvé depuis un webhook Stripe (identifiant client), sans contexte société.
CREATE OR REPLACE FUNCTION app_company_by_stripe_customer(p_customer text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM subscriptions WHERE stripe_customer_id = p_customer LIMIT 1
$$;
--> statement-breakpoint

-- 7. Droits du rôle applicatif
GRANT USAGE ON SCHEMA public TO cir_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cir_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cir_app;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_log FROM cir_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON section_versions, lock_versions FROM cir_app;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO cir_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cir_app;
