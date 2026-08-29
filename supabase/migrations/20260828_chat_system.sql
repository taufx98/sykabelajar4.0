-- CHAT SYSTEM — User-to-Admin messaging
-- Run in Supabase SQL Editor

-- Chat threads (one per user, tracks status)
CREATE TABLE IF NOT EXISTS chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  rating int CHECK (rating BETWEEN 1 AND 5),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

-- Chat messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS: Users can see their own thread
CREATE POLICY "User view own thread" ON chat_threads
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "User create own thread" ON chat_threads
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "User update own thread" ON chat_threads
  FOR UPDATE USING (auth.uid() = user_id);

-- RLS: Admin full access to threads
CREATE POLICY "Admin manage threads" ON chat_threads
  FOR ALL USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true));

-- RLS: Users see messages in their own thread
CREATE POLICY "User view own messages" ON chat_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM chat_threads WHERE id = thread_id AND user_id = auth.uid())
  );
CREATE POLICY "User send own messages" ON chat_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (SELECT 1 FROM chat_threads WHERE id = thread_id AND user_id = auth.uid())
  );

-- RLS: Admin full access to messages
CREATE POLICY "Admin manage messages" ON chat_messages
  FOR ALL USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true));

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_chat_threads_user_id ON chat_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_id ON chat_messages(thread_id);
