CREATE TABLE IF NOT EXISTS conversation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,

  event_type TEXT NOT NULL,
  event_value TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_ce_tenant_customer_time
  ON conversation_events (tenant_id, customer_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ce_type
  ON conversation_events (event_type);
