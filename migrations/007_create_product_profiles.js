// migrations/007_create_product_profiles.js
module.exports = {
  id: "007_create_product_profiles",
  up: async (db) => {
    await db.run(`
      CREATE TABLE IF NOT EXISTS product_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        promise TEXT NOT NULL,
        benefits TEXT NOT NULL,        -- JSON
        differentials TEXT NOT NULL,   -- JSON
        price TEXT NOT NULL,
        delivery TEXT NOT NULL,
        objections TEXT NOT NULL,      -- JSON
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      )
    `);

    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_product_profiles_tenant
      ON product_profiles(tenant_id)
    `);
  },

  down: async (db) => {
    await db.run(`DROP TABLE IF EXISTS product_profiles`);
  },
};
