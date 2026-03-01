ALTER TABLE product_playbooks ADD COLUMN created_at TEXT;
ALTER TABLE product_playbooks ADD COLUMN updated_at TEXT;

UPDATE product_playbooks
SET created_at = COALESCE(created_at, datetime('now')),
    updated_at = COALESCE(updated_at, datetime('now'));
