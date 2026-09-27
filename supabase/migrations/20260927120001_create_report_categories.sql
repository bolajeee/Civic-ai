-- PostGIS powers the geographic clustering and dashboard mapping in later
-- phases. Enabled here, while the geographic tables are still empty, rather
-- than as a disruptive change once there is data to migrate.
CREATE EXTENSION IF NOT EXISTS postgis;

-- Categories are a table rather than an enum so the government dashboard can
-- attach labels, icons and ordering without a schema migration. Seeded with the
-- six categories in the reference design.
CREATE TABLE report_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(50) UNIQUE NOT NULL,
  label VARCHAR(100) NOT NULL,
  display_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO report_categories (slug, label, display_order) VALUES
  ('POTHOLE',     'Pothole',     1),
  ('FLOODING',    'Flooding',    2),
  ('STREETLIGHT', 'Streetlight', 3),
  ('WASTE',       'Waste',       4),
  ('WATER_LEAK',  'Water Leak',  5),
  ('OTHER',       'Other',       6);
