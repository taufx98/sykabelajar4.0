-- AD BANNER SYSTEM — Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS ad_banner_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slide_duration_seconds int NOT NULL DEFAULT 45,
  min_duration_seconds int NOT NULL DEFAULT 30,
  max_duration_seconds int NOT NULL DEFAULT 60,
  price_per_lot_daily numeric(12,2) NOT NULL DEFAULT 50000,
  bundle_discount_3lots numeric(5,2) NOT NULL DEFAULT 15.00,
  bundle_discount_5lots numeric(5,2) NOT NULL DEFAULT 25.00,
  single_image_2slots_price numeric(12,2) NOT NULL DEFAULT 80000,
  single_image_3slots_price numeric(12,2) NOT NULL DEFAULT 100000,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ad_banner_settings (slide_duration_seconds, price_per_lot_daily)
VALUES (45, 50000) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS ad_banner_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  link_url text NOT NULL DEFAULT '/home',
  slots_requested int NOT NULL DEFAULT 1 CHECK (slots_requested BETWEEN 1 AND 3),
  single_image boolean NOT NULL DEFAULT false,
  duration_days int NOT NULL DEFAULT 7,
  total_price numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED')),
  admin_note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ad_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES ad_banner_requests(id) ON DELETE CASCADE,
  organizer_id uuid NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slot_number int NOT NULL,
  image_url text NOT NULL,
  link_url text NOT NULL DEFAULT '/home',
  single_image boolean NOT NULL DEFAULT false,
  image_width_slots int NOT NULL DEFAULT 1,
  slide_duration_seconds int NOT NULL DEFAULT 45,
  expires_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_number)
);

ALTER TABLE ad_banner_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_banners ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_banner_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public view active banners" ON ad_banners FOR SELECT USING (is_active = true AND expires_at > now());
CREATE POLICY "Public view settings" ON ad_banner_settings FOR SELECT USING (true);
CREATE POLICY "Organizers view own requests" ON ad_banner_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Organizers create requests" ON ad_banner_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admin full access banners" ON ad_banners FOR ALL USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true));
CREATE POLICY "Admin full access requests" ON ad_banner_requests FOR ALL USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true));
CREATE POLICY "Admin full access settings" ON ad_banner_settings FOR ALL USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true));
