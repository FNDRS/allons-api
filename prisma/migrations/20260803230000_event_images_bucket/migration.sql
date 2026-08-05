-- Creates the `event-images` storage bucket the mobile app uploads to, plus the
-- row-level policies that let a signed-in user write to it.
--
-- Context:
--   * allons-mobile `lib/upload.ts` uploads event gallery pictures to a bucket
--     named `event-images` and then stores the public URL on the event. The
--     bucket had never been created, so every upload failed and providers could
--     not publish an event with pictures.
--   * RLS is enabled on `storage.objects` and the project had **no** policies at
--     all, so only the service role could write. Public buckets still serve
--     reads without an RLS check, which is why the `avatars` bucket appeared to
--     work: its objects were uploaded with the service key by a script.
--   * Writes are limited to the `authenticated` role, and overwrite/delete are
--     further limited to the uploader (`storage.objects.owner`).
--
-- Idempotent: safe to re-run.

-- =====================================================================
-- 1. Bucket
-- =====================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event-images',
  'event-images',
  true,
  10485760, -- 10 MiB
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- =====================================================================
-- 2. Policies on storage.objects, scoped to this bucket
-- =====================================================================

-- Named roles rather than `TO public`: every role inherits from `public`, so
-- that form grants the policy more broadly than anything here needs. Matches
-- how the other public SELECT policies are written (see the
-- supabase_lint_security_fixes migration).
DROP POLICY IF EXISTS event_images_public_read ON storage.objects;
CREATE POLICY event_images_public_read
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'event-images');

-- Uploading requires being an owner/admin of some comercio, mirroring the
-- membership `createProviderEvent` / `updateProviderEvent` demand. Checking
-- only the bucket would let any signed-in customer account write public
-- objects here and use the bucket as arbitrary image hosting; the object path
-- carries no identity, so the policy cannot key on it.
DROP POLICY IF EXISTS event_images_authenticated_insert ON storage.objects;
DROP POLICY IF EXISTS event_images_provider_insert ON storage.objects;
CREATE POLICY event_images_provider_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'event-images'
    AND EXISTS (
      SELECT 1
      FROM public.provider_members pm
      WHERE pm.user_id = (SELECT auth.uid())
        AND pm.active = true
        AND pm.role IN ('owner', 'admin')
    )
  );

-- `auth.uid()` is wrapped in `(SELECT ...)` so the planner caches the call
-- once per query instead of evaluating it per row, as the provider_realtime_rls
-- migration does and documents.
DROP POLICY IF EXISTS event_images_owner_update ON storage.objects;
CREATE POLICY event_images_owner_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'event-images' AND owner = (SELECT auth.uid()))
  WITH CHECK (bucket_id = 'event-images' AND owner = (SELECT auth.uid()));

DROP POLICY IF EXISTS event_images_owner_delete ON storage.objects;
CREATE POLICY event_images_owner_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'event-images' AND owner = (SELECT auth.uid()));
