CREATE TABLE IF NOT EXISTS product_playbooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  product_key TEXT NOT NULL,
  pitch_json TEXT NOT NULL DEFAULT '{}',
  objections_json TEXT NOT NULL DEFAULT '{}',
  policies_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_playbooks_unique
ON product_playbooks (tenant_id, product_key);
