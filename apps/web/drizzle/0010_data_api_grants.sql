-- Hand-written (no schema change). Supabase grants its Data API roles everything in `public`, and service_role bypasses
-- RLS, so revoke from all three, now and for tables later migrations create. A no-op where the roles don't exist.
SET LOCAL lock_timeout = '3s';--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) = 3 THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated, service_role;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated, service_role;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
  END IF;
END
$$;
