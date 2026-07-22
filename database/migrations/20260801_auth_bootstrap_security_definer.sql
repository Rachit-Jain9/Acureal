-- database/migrations/20260801_auth_bootstrap_security_definer.sql
-- M1 Phase 2 — SECURITY DEFINER helpers for the pre-identity auth bootstrap.
-- RED-TEAM HARDENED vs the draft:
--   • Narrow column lists — user-lookup helpers NEVER return mfa_secret /
--     mfa_recovery_codes (red-team #4). Robust to future sensitive columns.
--   • auth_provision_signup re-validates the invitation TOKEN and the verified
--     domain INSIDE the function (red-team #3) — callers cannot pass a resolved
--     org id / role, so a SQLi sink or JS validation bug cannot mint membership
--     in an arbitrary tenant. Invitation row locked FOR UPDATE (double-consume race).
--   • Idempotent + paste-safe; drops any superseded draft signatures first.
-- Behavior-neutral under today's BYPASSRLS role: nothing calls these until the
-- code's probe finds them, and they return byte-identical results to the direct
-- queries. Apply as postgres (Supabase SQL editor) so owner = BYPASSRLS.
--
-- CALLER CONTRACT (single-candidate domains): joinByVerifiedDomain picks ONE
-- domain (normalizeEmailDomain(hostedDomain) || normalizeEmailDomain(email))
-- and does NOT fall back to the email domain when the hosted domain has no
-- verified claim. For byte-parity the JS definer branch passes at most ONE
-- candidate in p_domain_candidates; the array form exists only so the SQL stays
-- general if that UX decision ever changes deliberately.
BEGIN;

-- Drop superseded draft signatures (no-ops on a clean prod).
DROP FUNCTION IF EXISTS public.auth_find_user_for_login(text);
DROP FUNCTION IF EXISTS public.auth_find_user_by_oauth(text, text);
DROP FUNCTION IF EXISTS public.auth_find_mfa_challenge(text);
DROP FUNCTION IF EXISTS public.auth_lookup_verified_domain(text);
DROP FUNCTION IF EXISTS public.auth_find_invitation(text);
DROP FUNCTION IF EXISTS public.auth_provision_signup(text,text,text,text,text,text,text,boolean,boolean,text,text,text,uuid,uuid,text,uuid,text,boolean,boolean,text,text,bigint[],inet,text);
DROP FUNCTION IF EXISTS public.auth_provision_signup(text,text,text,text,text,text,text,boolean,boolean,text,text,text,text,text[],text,text,bigint[],inet,text);

-- 1) User lookup by email. Column list = union of login (auth.service.js:246),
--    findUserByEmail (:470) and the register dup-check (:153). NO MFA columns.
CREATE FUNCTION public.auth_find_user_for_login(p_email text)
  RETURNS TABLE (
    id uuid, email text, password_hash text, name text, phone text,
    is_active boolean, last_login_at timestamptz, default_organization_id uuid,
    account_closed_at timestamptz, erased_at timestamptz,
    oauth_provider text, oauth_subject text, email_verified_at timestamptz,
    password_set boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT u.id, u.email::text, u.password_hash::text, u.name::text, u.phone::text,
           u.is_active, u.last_login_at, u.default_organization_id,
           u.account_closed_at, u.erased_at,
           u.oauth_provider::text, u.oauth_subject::text, u.email_verified_at,
           u.password_set
      FROM public.users u
     WHERE u.email = p_email
     LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.auth_find_user_for_login(text) FROM PUBLIC;

-- 2) Returning-Google-user lookup (Path A). Exact findUserByOAuthIdentity
--    column list (auth.service.js:457-458).
CREATE FUNCTION public.auth_find_user_by_oauth(p_provider text, p_subject text)
  RETURNS TABLE (
    id uuid, email text, name text, phone text, is_active boolean,
    default_organization_id uuid, oauth_provider text, oauth_subject text,
    email_verified_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT u.id, u.email::text, u.name::text, u.phone::text, u.is_active,
           u.default_organization_id, u.oauth_provider::text, u.oauth_subject::text,
           u.email_verified_at
      FROM public.users u
     WHERE u.oauth_provider = p_provider AND u.oauth_subject = p_subject
     LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.auth_find_user_by_oauth(text, text) FROM PUBLIC;

-- 3) MFA challenge + the user's TOTP secret (the JOIN to users is what RLS
--    blocks). Shape identical to mfa.service.js:165-175.
CREATE FUNCTION public.auth_find_mfa_challenge(p_challenge text)
  RETURNS TABLE (id uuid, user_id uuid, expires_at timestamptz,
                 consumed_at timestamptz, mfa_secret text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT mc.id, mc.user_id, mc.expires_at, mc.consumed_at, u.mfa_secret::text
      FROM public.mfa_challenges mc
      JOIN public.users u ON u.id = mc.user_id
     WHERE mc.challenge = p_challenge;
$$;
REVOKE ALL ON FUNCTION public.auth_find_mfa_challenge(text) FROM PUBLIC;

-- 4) Cross-org verified-domain lookup (read-only; UX decision stays in JS).
--    Takes ORDERED candidates (Google hosted-domain first, then email domain)
--    to mirror joinByVerifiedDomain's fallback (organization.service.js:604-612).
CREATE FUNCTION public.auth_lookup_verified_domain(p_domains text[])
  RETURNS TABLE (organization_id uuid, default_role public.organization_role,
                 require_admin_approval boolean, matched_domain text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT d.organization_id, d.default_role, d.require_admin_approval, c.domain::text
      FROM unnest(p_domains) WITH ORDINALITY AS c(domain, ord)
      JOIN public.organization_domains d
        ON lower(d.domain) = lower(c.domain) AND d.verified = TRUE
     ORDER BY c.ord
     LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.auth_lookup_verified_domain(text[]) FROM PUBLIC;

-- 5) Invitation lookup by token — exact consumeInvitation column list
--    (organization.service.js:189-197). JS uses this for friendly 404/409/410
--    errors BEFORE provisioning; the provision function re-validates anyway.
CREATE FUNCTION public.auth_find_invitation(p_token text)
  RETURNS TABLE (id uuid, organization_id uuid, email text,
                 role public.organization_role, expires_at timestamptz,
                 accepted_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT oi.id, oi.organization_id, oi.email::text, oi.role, oi.expires_at, oi.accepted_at
      FROM public.organization_invitations oi
     WHERE oi.token = p_token
     LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.auth_find_invitation(text) FROM PUBLIC;

-- 6) The whole register / google-cold-signup INSERT chain as owner.
--    HARDENED: takes the invitation TOKEN and domain CANDIDATES — never a
--    caller-resolved org id or role — and re-derives membership internally.
--    Byte-parity with consumeInvitation (org.service:219-240),
--    joinByVerifiedDomain (:461-498 — incl. pending joins ALSO getting a
--    personal workspace), createWorkspaceForUser (:160-185) and
--    recordAcceptance (legal.service:92-115).
CREATE FUNCTION public.auth_provision_signup(
    p_email text, p_password_hash text, p_name text, p_role text,
    p_phone text, p_oauth_provider text, p_oauth_subject text,
    p_email_verified boolean, p_password_set boolean,
    p_company text, p_job_title text, p_city text,
    p_invitation_token text,
    p_domain_candidates text[],
    p_workspace_name text, p_workspace_slug_base text,
    p_legal_document_ids bigint[], p_ip inet, p_user_agent text)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_uid uuid;
  v_org uuid;
  v_slug text;
  v_inv record;
  v_dom record;
  v_role public.organization_role;
  v_active boolean;
  v_joined_active boolean := false;
BEGIN
  INSERT INTO public.users
    (email, password_hash, name, role, phone, oauth_provider, oauth_subject,
     email_verified_at, password_set, company, job_title, city)
  VALUES
    (p_email, p_password_hash, p_name, p_role::public.user_role, p_phone,
     p_oauth_provider, p_oauth_subject,
     CASE WHEN p_email_verified THEN NOW() ELSE NULL END,
     COALESCE(p_password_set, TRUE), p_company, p_job_title, p_city)
  RETURNING users.id INTO v_uid;

  IF p_invitation_token IS NOT NULL THEN
    -- Internal re-validation (red-team #3): the privileged write must not
    -- trust caller-resolved args. FOR UPDATE closes the double-consume race.
    SELECT oi.id, oi.organization_id, oi.email, oi.role, oi.expires_at, oi.accepted_at
      INTO v_inv
      FROM public.organization_invitations oi
     WHERE oi.token = p_invitation_token
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AUTH_PROVISION_INVITATION_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
    IF v_inv.accepted_at IS NOT NULL THEN
      RAISE EXCEPTION 'AUTH_PROVISION_INVITATION_ALREADY_ACCEPTED' USING ERRCODE = 'P0001';
    END IF;
    IF v_inv.expires_at < NOW() THEN
      RAISE EXCEPTION 'AUTH_PROVISION_INVITATION_EXPIRED' USING ERRCODE = 'P0001';
    END IF;
    IF lower(v_inv.email) <> lower(p_email) THEN
      RAISE EXCEPTION 'AUTH_PROVISION_INVITATION_EMAIL_MISMATCH' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.organization_members (organization_id, user_id, role, invited_by, is_active)
    VALUES (v_inv.organization_id, v_uid,
            COALESCE(v_inv.role, 'viewer'::public.organization_role), NULL, TRUE)
    ON CONFLICT (organization_id, user_id) DO UPDATE
      SET role = EXCLUDED.role, is_active = TRUE, updated_at = NOW();

    UPDATE public.organization_invitations
       SET accepted_at = NOW(), accepted_by = v_uid
     WHERE id = v_inv.id;

    UPDATE public.users
       SET default_organization_id = v_inv.organization_id, updated_at = NOW()
     WHERE id = v_uid;

    v_joined_active := true;

  ELSIF p_domain_candidates IS NOT NULL AND array_length(p_domain_candidates, 1) > 0 THEN
    -- Internal verified-domain re-lookup. JS filters public email domains and
    -- orders candidates (hosted-domain first); a forged candidate that is not
    -- a verified org domain simply matches nothing.
    SELECT d.organization_id, d.default_role, d.require_admin_approval
      INTO v_dom
      FROM unnest(p_domain_candidates) WITH ORDINALITY AS c(domain, ord)
      JOIN public.organization_domains d
        ON lower(d.domain) = lower(c.domain) AND d.verified = TRUE
     ORDER BY c.ord
     LIMIT 1;
    IF FOUND THEN
      v_role   := COALESCE(v_dom.default_role, 'editor'::public.organization_role);
      v_active := (v_dom.require_admin_approval IS DISTINCT FROM TRUE);

      INSERT INTO public.organization_members (organization_id, user_id, role, invited_by, is_active)
      VALUES (v_dom.organization_id, v_uid, v_role, NULL, v_active)
      ON CONFLICT (organization_id, user_id) DO UPDATE
        SET role = EXCLUDED.role,
            is_active = public.organization_members.is_active OR EXCLUDED.is_active,
            updated_at = NOW();

      INSERT INTO public.organization_audit_log
        (organization_id, actor_id, target_user_id, event_type, before_json, after_json, metadata)
      VALUES (v_dom.organization_id, v_uid, v_uid, 'member_domain_joined', '{}'::jsonb,
              jsonb_build_object('role', v_role, 'is_active', v_active, 'via', 'domain'),
              '{}'::jsonb);

      IF v_active THEN
        UPDATE public.users
           SET default_organization_id = v_dom.organization_id, updated_at = NOW()
         WHERE id = v_uid;
        v_joined_active := true;
      END IF;
    END IF;
  END IF;

  -- Fresh personal workspace when nothing granted an ACTIVE membership.
  -- Parity note: PENDING domain joins also fall through here, exactly like
  -- register() L211 (joinByVerifiedDomain returns null when not active).
  IF NOT v_joined_active THEN
    v_slug := COALESCE(NULLIF(p_workspace_slug_base, ''), 'workspace-' || left(v_uid::text, 8))
              || '-' || left(v_uid::text, 8);
    INSERT INTO public.organizations (name, slug, created_by)
    VALUES (COALESCE(NULLIF(p_workspace_name, ''), 'Workspace'), v_slug, v_uid)
    RETURNING organizations.id INTO v_org;
    INSERT INTO public.organization_members (organization_id, user_id, role, invited_by, is_active)
    VALUES (v_org, v_uid, 'owner'::public.organization_role, v_uid, TRUE);
    UPDATE public.users
       SET default_organization_id = v_org, updated_at = NOW()
     WHERE id = v_uid;
  END IF;

  -- Legal acceptance — parity with legal.service recordAcceptance L92-115.
  INSERT INTO public.user_legal_acceptances (user_id, document_id, ip_address, user_agent)
  SELECT v_uid, d.doc_id, p_ip, p_user_agent
    FROM unnest(COALESCE(p_legal_document_ids, ARRAY[]::bigint[])) AS d(doc_id)
  ON CONFLICT (user_id, document_id) DO NOTHING;

  UPDATE public.users u SET
    terms_accepted_at = GREATEST(
      COALESCE(u.terms_accepted_at, 'epoch'::timestamptz),
      COALESCE((SELECT MAX(la.accepted_at)
                  FROM public.user_legal_acceptances la
                  JOIN public.legal_documents d ON d.id = la.document_id
                 WHERE la.user_id = u.id AND d.kind = 'terms_of_service'),
               u.terms_accepted_at)),
    privacy_accepted_at = GREATEST(
      COALESCE(u.privacy_accepted_at, 'epoch'::timestamptz),
      COALESCE((SELECT MAX(la.accepted_at)
                  FROM public.user_legal_acceptances la
                  JOIN public.legal_documents d ON d.id = la.document_id
                 WHERE la.user_id = u.id AND d.kind = 'privacy_policy'),
               u.privacy_accepted_at)),
    updated_at = NOW()
  WHERE u.id = v_uid;

  RETURN v_uid;
END;
$$;
REVOKE ALL ON FUNCTION public.auth_provision_signup(text,text,text,text,text,text,text,boolean,boolean,text,text,text,text,text[],text,text,bigint[],inet,text) FROM PUBLIC;

-- GRANT EXECUTE to redip_app only if the role exists (created in Phase 3; the
-- Phase-3 blanket GRANT EXECUTE ON ALL FUNCTIONS is the backstop for a
-- Phase-2-before-Phase-3 apply order). REVOKE FROM PUBLIC above is unconditional.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'redip_app') THEN
    GRANT EXECUTE ON FUNCTION public.auth_find_user_for_login(text) TO redip_app;
    GRANT EXECUTE ON FUNCTION public.auth_find_user_by_oauth(text, text) TO redip_app;
    GRANT EXECUTE ON FUNCTION public.auth_find_mfa_challenge(text) TO redip_app;
    GRANT EXECUTE ON FUNCTION public.auth_lookup_verified_domain(text[]) TO redip_app;
    GRANT EXECUTE ON FUNCTION public.auth_find_invitation(text) TO redip_app;
    GRANT EXECUTE ON FUNCTION public.auth_provision_signup(text,text,text,text,text,text,text,boolean,boolean,text,text,text,text,text[],text,text,bigint[],inet,text) TO redip_app;
  END IF;
END $$;

COMMIT;

-- Rollback: DROP FUNCTION IF EXISTS for each of the six signatures above.
-- Presence check (also the code's probe target — the LAST/most-complex function,
-- so a partial deployment fails the probe closed):
--   SELECT to_regprocedure('public.auth_provision_signup(text,text,text,text,text,text,text,boolean,boolean,text,text,text,text,text[],text,text,bigint[],inet,text)') IS NOT NULL;