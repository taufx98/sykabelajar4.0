-- PLATFORM SETTINGS — Bank accounts, WhatsApp, Chat config
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS platform_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed default values
INSERT INTO platform_settings (key, value) VALUES
  ('admin_banks', '[{"bank":"BCA","name":"PT Syka Belajar","number":"1234567890"},{"bank":"BRI","name":"PT Syka Belajar","number":"0987654321"}]'::jsonb),
  ('whatsapp_number', '"6281234567890"'::jsonb),
  ('chat_enabled', 'true'::jsonb),
  ('chat_type', '"whatsapp"'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public view platform_settings" ON platform_settings FOR SELECT USING (true);
CREATE POLICY "Admin full access platform_settings" ON platform_settings FOR ALL
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true));
