-- Add notification settings storage for user profiles.
-- JSONB keeps this flexible while the product evolves.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_settings JSONB;
