-- Gallery rows for event detail (GET /events/:id → gallery[]).
CREATE TABLE IF NOT EXISTS public.event_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  url text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_media_event_id_sort_idx
  ON public.event_media (event_id, sort_order, created_at);
