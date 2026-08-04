CREATE TABLE IF NOT EXISTS class_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  discipline text,
  instructor_name text,
  duration_minutes integer NOT NULL,
  capacity_per_session integer NOT NULL,
  location_name text,
  address text,
  city text,
  latitude double precision,
  longitude double precision,
  cover_image_url text,
  theme_color text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT class_programs_status_chk CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT class_programs_duration_chk CHECK (duration_minutes > 0),
  CONSTRAINT class_programs_capacity_chk CHECK (capacity_per_session > 0)
);

CREATE INDEX IF NOT EXISTS class_programs_provider_status_idx
  ON class_programs(provider_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS class_session_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES class_programs(id) ON DELETE CASCADE,
  weekday integer NOT NULL,
  start_time time NOT NULL,
  duration_minutes integer,
  capacity integer,
  instructor_name text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT class_session_templates_weekday_chk CHECK (weekday BETWEEN 0 AND 6),
  CONSTRAINT class_session_templates_duration_chk CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  CONSTRAINT class_session_templates_capacity_chk CHECK (capacity IS NULL OR capacity > 0)
);

CREATE INDEX IF NOT EXISTS class_session_templates_program_active_idx
  ON class_session_templates(program_id, active, weekday, start_time);

CREATE TABLE IF NOT EXISTS class_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES class_programs(id) ON DELETE CASCADE,
  name text NOT NULL,
  price numeric(12,2) NOT NULL DEFAULT 0,
  credits integer,
  validity_days integer,
  kind text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT class_packages_kind_chk CHECK (kind IN ('drop_in', 'pack', 'unlimited')),
  CONSTRAINT class_packages_price_chk CHECK (price >= 0),
  CONSTRAINT class_packages_credits_chk CHECK (credits IS NULL OR credits > 0),
  CONSTRAINT class_packages_validity_chk CHECK (validity_days IS NULL OR validity_days > 0),
  CONSTRAINT class_packages_shape_chk CHECK (
    (kind = 'drop_in' AND credits = 1)
    OR (kind = 'pack' AND credits > 1)
    OR (kind = 'unlimited' AND credits IS NULL AND validity_days IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS class_packages_program_active_sort_idx
  ON class_packages(program_id, active, sort_order, created_at);

CREATE TABLE IF NOT EXISTS user_class_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES class_programs(id) ON DELETE CASCADE,
  package_id uuid REFERENCES class_packages(id) ON DELETE SET NULL,
  payment_order_id uuid REFERENCES payment_orders(id) ON DELETE SET NULL,
  credits_total integer,
  credits_remaining integer,
  valid_from timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_class_passes_status_chk CHECK (status IN ('active', 'expired', 'cancelled')),
  CONSTRAINT user_class_passes_credits_chk CHECK (
    (credits_total IS NULL AND credits_remaining IS NULL)
    OR (credits_total > 0 AND credits_remaining BETWEEN 0 AND credits_total)
  )
);

CREATE INDEX IF NOT EXISTS user_class_passes_user_program_idx
  ON user_class_passes(user_id, program_id, status, expires_at);

CREATE TABLE IF NOT EXISTS class_session_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES class_programs(id) ON DELETE CASCADE,
  template_id uuid REFERENCES class_session_templates(id) ON DELETE SET NULL,
  pass_id uuid REFERENCES user_class_passes(id) ON DELETE SET NULL,
  session_date date NOT NULL,
  start_time time NOT NULL,
  duration_minutes integer NOT NULL,
  instructor_name text,
  status text NOT NULL DEFAULT 'reserved',
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT class_session_reservations_status_chk CHECK (status IN ('reserved', 'cancelled', 'attended', 'no_show')),
  CONSTRAINT class_session_reservations_duration_chk CHECK (duration_minutes > 0)
);

CREATE INDEX IF NOT EXISTS class_session_reservations_occurrence_idx
  ON class_session_reservations(program_id, session_date, start_time, status);

CREATE UNIQUE INDEX IF NOT EXISTS class_session_reservations_user_occurrence_uidx
  ON class_session_reservations(user_id, program_id, session_date, start_time)
  WHERE status = 'reserved';

ALTER TABLE class_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_session_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_class_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_session_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_direct_access ON class_programs FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_direct_access ON class_session_templates FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_direct_access ON class_packages FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_direct_access ON user_class_passes FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_direct_access ON class_session_reservations FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
