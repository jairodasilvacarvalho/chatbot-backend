CREATE TABLE IF NOT EXISTS product_wizard_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  wizard_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  draft_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, wizard_id)
);

CREATE INDEX IF NOT EXISTS idx_product_wizard_drafts_tenant
ON product_wizard_drafts(tenant_id);

CREATE INDEX IF NOT EXISTS idx_product_wizard_drafts_status
ON product_wizard_drafts(status);
