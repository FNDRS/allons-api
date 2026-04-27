-- Adds event filters support (types + flags)
-- Run in Supabase SQL editor.

alter table if exists public.interests
  add column if not exists slug text;

-- Backfill slug from name (best-effort) when missing.
update public.interests
set slug = lower(regexp_replace(coalesce(name, ''), '[^a-zA-Z0-9]+', '-', 'g'))
where (slug is null or slug = '')
  and name is not null;

-- Ensure slug is required/unique.
do $$ begin
  alter table public.interests alter column slug set not null;
exception when others then null; end $$;

do $$ begin
  create unique index interests_slug_key on public.interests (slug);
exception when duplicate_table then null; when duplicate_object then null; end $$;

alter table if exists public.events
  add column if not exists smoking_allowed boolean not null default false,
  add column if not exists pet_friendly boolean not null default false,
  add column if not exists parking_available boolean not null default false,
  add column if not exists min_age int;

create table if not exists public.event_interests (
  event_id uuid not null references public.events (id) on delete cascade,
  interest_id uuid not null references public.interests (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, interest_id)
);

create index if not exists event_interests_interest_id_idx on public.event_interests (interest_id);
