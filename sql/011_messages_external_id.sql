ALTER TABLE messages
ADD COLUMN external_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_external_id
ON messages (external_message_id);
