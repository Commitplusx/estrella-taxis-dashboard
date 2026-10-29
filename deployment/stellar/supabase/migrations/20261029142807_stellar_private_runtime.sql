BEGIN;
-- This fresh database has no public legacy trips. Only verified server APIs use ownership lookup.
REVOKE EXECUTE ON FUNCTION public.taxi_bot_owns_tenant(uuid) FROM PUBLIC,anon,authenticated;
COMMIT;
