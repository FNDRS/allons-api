-- Adds event details support (gallery + provider reviews)
-- Run in Supabase SQL editor.

create table if not exists public.event_media (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  url text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists event_media_event_id_sort_idx
  on public.event_media (event_id, sort_order, created_at);

create table if not exists public.provider_reviews (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  author_name text not null,
  body text not null,
  rating int,
  created_at timestamptz not null default now()
);

create index if not exists provider_reviews_provider_id_created_at_idx
  on public.provider_reviews (provider_id, created_at desc);
