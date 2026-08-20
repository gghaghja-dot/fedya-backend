-- ============================================================
-- FedyaLM: вставь ЭТОТ SQL в Supabase → SQL Editor → Run
-- Безопасно для уже существующих таблиц (IF NOT EXISTS / OR IGNORE)
-- ============================================================

-- 1) Недостающие значки (если ещё нет)
INSERT INTO badges (name, description, icon_url, color, is_auto)
SELECT 'Популярный', '100 друзей / диалогов', NULL, '#F59E0B', true
WHERE NOT EXISTS (SELECT 1 FROM badges WHERE name = 'Популярный');

INSERT INTO badges (name, description, icon_url, color, is_auto)
SELECT 'Мастер групп', 'Создал 5 групп', NULL, '#10B981', true
WHERE NOT EXISTS (SELECT 1 FROM badges WHERE name = 'Мастер групп');

INSERT INTO badges (name, description, icon_url, color, is_auto)
SELECT 'Специальный', 'За заслуги (вручную)', NULL, '#EC4899', false
WHERE NOT EXISTS (SELECT 1 FROM badges WHERE name = 'Специальный');

-- 2) Индексы для скорости сообщений
CREATE INDEX IF NOT EXISTS idx_messages_from_user ON messages(from_user);
CREATE INDEX IF NOT EXISTS idx_messages_to_user ON messages(to_user);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);

-- 3) Админ-аккаунт (после первой регистрации под ADMIN_EMAIL
--    можно вручную выдать админку так:)
-- UPDATE users SET is_admin = true WHERE email = 'gghaghja@example.com';

-- 4) (ОПЦИОНАЛЬНО) расширенные колонки — только если захочешь апгрейд.
--    Бэкенд сейчас работает БЕЗ них. Раскомментируй при необходимости:
/*
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_text TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fcm_token TEXT;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS content_type TEXT DEFAULT 'text';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN DEFAULT TRUE;
*/
