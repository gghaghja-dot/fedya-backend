-- FedyaLM full PostgreSQL schema (Supabase)
-- Run via: npm run migrate (requires DATABASE_URL) or paste into Supabase SQL Editor

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('user', 'moderator', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE conversation_type AS ENUM ('dm', 'group', 'channel');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE content_type AS ENUM ('text', 'image', 'video', 'document', 'voice', 'sticker');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE badge_category AS ENUM ('achievement', 'premium', 'event', 'special');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM ('active', 'expired', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE promo_type AS ENUM ('premium_days', 'discount_percent');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE report_status AS ENUM ('open', 'reviewing', 'resolved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  status_text TEXT DEFAULT '',
  role user_role NOT NULL DEFAULT 'user',
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  ban_reason TEXT,
  ban_until TIMESTAMPTZ,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_code TEXT,
  reset_token TEXT,
  reset_expires TIMESTAMPTZ,
  premium_until TIMESTAMPTZ,
  is_lifetime_premium BOOLEAN NOT NULL DEFAULT FALSE,
  privacy_photo TEXT NOT NULL DEFAULT 'everyone',
  privacy_online TEXT NOT NULL DEFAULT 'everyone',
  fcm_token TEXT,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type conversation_type NOT NULL DEFAULT 'dm',
  title TEXT,
  avatar_url TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  muted BOOLEAN NOT NULL DEFAULT FALSE,
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES users(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  content_type content_type NOT NULL DEFAULT 'text',
  media_url TEXT,
  reply_to UUID REFERENCES messages(id) ON DELETE SET NULL,
  forwarded_from UUID REFERENCES messages(id) ON DELETE SET NULL,
  is_encrypted BOOLEAN NOT NULL DEFAULT TRUE,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  deleted_by_sender BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_by_recipient BOOLEAN NOT NULL DEFAULT FALSE,
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);

CREATE TABLE IF NOT EXISTS badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  icon_url TEXT,
  color TEXT DEFAULT '#3B82F6',
  category badge_category NOT NULL DEFAULT 'achievement',
  is_automatic BOOLEAN NOT NULL DEFAULT FALSE,
  auto_condition JSONB,
  is_developer_only BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  awarded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS premium_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  duration_days INTEGER,
  price_usd NUMERIC(10, 2) NOT NULL DEFAULT 0,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  type promo_type NOT NULL,
  value INTEGER NOT NULL,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES premium_plans(id) ON DELETE SET NULL,
  status subscription_status NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  promo_code_id UUID REFERENCES promo_codes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
  promo_id UUID NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (promo_id, user_id)
);

CREATE TABLE IF NOT EXISTS login_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ip TEXT,
  user_agent TEXT,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_login_logs_created ON login_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status report_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_keys (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  identity_key TEXT NOT NULL,
  signed_prekey TEXT NOT NULL,
  signed_prekey_id INTEGER NOT NULL DEFAULT 1,
  signature TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS one_time_prekeys (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_id INTEGER NOT NULL,
  public_key TEXT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, key_id)
);

CREATE INDEX IF NOT EXISTS idx_otpk_unused ON one_time_prekeys(user_id, used) WHERE used = FALSE;

-- Auto-admin on insert when email matches setting (fallback via app also)
CREATE OR REPLACE FUNCTION set_admin_on_insert()
RETURNS TRIGGER AS $$
DECLARE
  admin_email TEXT;
BEGIN
  SELECT value->>'email' INTO admin_email
  FROM system_settings
  WHERE key = 'admin_email';

  IF admin_email IS NOT NULL AND lower(NEW.email) = lower(admin_email) THEN
    NEW.is_admin := TRUE;
    NEW.role := 'admin';
    NEW.email_verified := TRUE;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_admin ON users;
CREATE TRIGGER trg_users_admin
  BEFORE INSERT ON users
  FOR EACH ROW EXECUTE PROCEDURE set_admin_on_insert();

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();

-- Seeds
INSERT INTO system_settings (key, value) VALUES
  ('admin_email', '{"email":"gghaghja@example.com"}'::jsonb),
  ('app', '{"name":"FedyaLM","logo_url":"","contact_email":"gghaghja@example.com"}'::jsonb),
  ('limits', '{"max_file_mb":50,"premium_max_file_mb":1024,"max_group_members":256,"message_retention_days":365}'::jsonb),
  ('registration', '{"enabled":true,"invite_only":false}'::jsonb),
  ('smtp', '{"host":"smtp.gmail.com","port":587}'::jsonb),
  ('fcm', '{"enabled":false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO badges (name, description, icon_url, color, category, is_automatic, auto_condition, is_developer_only) VALUES
  ('developer', 'Значок разработчика FedyaLM', NULL, '#8B5CF6', 'special', FALSE, NULL, TRUE),
  ('first_message', 'Первое сообщение', NULL, '#22C55E', 'achievement', TRUE, '{"type":"messages_sent","count":1}'::jsonb, FALSE),
  ('chatterbox', 'Болтун — 1000 сообщений', NULL, '#F59E0B', 'achievement', TRUE, '{"type":"messages_sent","count":1000}'::jsonb, FALSE),
  ('veteran', 'Старожил — аккаунт старше 1 года', NULL, '#6366F1', 'achievement', TRUE, '{"type":"account_age_days","count":365}'::jsonb, FALSE),
  ('popular', 'Популярный — 100 друзей', NULL, '#EC4899', 'achievement', TRUE, '{"type":"friends","count":100}'::jsonb, FALSE),
  ('group_master', 'Мастер групп — создал 5 групп', NULL, '#14B8A6', 'achievement', TRUE, '{"type":"groups_created","count":5}'::jsonb, FALSE),
  ('premium', 'Премиум подписчик', NULL, '#EAB308', 'premium', TRUE, '{"type":"premium"}'::jsonb, FALSE)
ON CONFLICT (name) DO NOTHING;

INSERT INTO premium_plans (code, name, duration_days, price_usd, features, active) VALUES
  ('month', 'Премиум Месяц', 30, 4.99, '["1GB files","themes","animated stickers","channels"]'::jsonb, TRUE),
  ('year', 'Премиум Год', 365, 39.99, '["1GB files","themes","animated stickers","channels","priority support","20% savings"]'::jsonb, TRUE),
  ('lifetime', 'Лайфтайм', NULL, 99.99, '["all features forever"]'::jsonb, TRUE)
ON CONFLICT (code) DO NOTHING;
