-- Allow authenticated users to insert their own profile row.
-- The handle_new_user() trigger covers normal sign-ups, but accounts created
-- before the trigger was deployed (e.g. dev/test accounts) have no profile,
-- which causes the portfolios_created_by_fkey FK violation. This policy lets
-- the app defensively upsert the profile before creating a portfolio.
CREATE POLICY "own profile insert"
  ON "public"."profiles"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ("id" = "auth"."uid"());
