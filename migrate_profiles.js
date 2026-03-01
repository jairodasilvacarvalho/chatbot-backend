const { run } = require("./config/db");

(async () => {
  try {
    // niche_profiles
    await run(`
      CREATE TABLE IF NOT EXISTS niche_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL,
        niche_key TEXT NOT NULL,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(tenant_id, niche_key),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      )
    `);

    // product_profiles
    await run(`
      CREATE TABLE IF NOT EXISTS product_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL,
        product_key TEXT NOT NULL,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(tenant_id, product_key),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      )
    `);

    console.log("✅ MIGRATION OK: niche_profiles + product_profiles criadas.");
  } catch (err) {
    console.error("❌ MIGRATION ERROR:", err);
  } finally {
    process.exit(0);
  }
})();
