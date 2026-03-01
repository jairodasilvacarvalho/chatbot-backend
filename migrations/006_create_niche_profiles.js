// migrations/006_create_niche_profiles.js
module.exports = {
  id: "006_create_niche_profiles",
  up: async (db) => {
    await db.run(`
      CREATE TABLE IF NOT EXISTS niche_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL,
        niche TEXT NOT NULL,
        language TEXT NOT NULL,
        pains TEXT NOT NULL,          -- JSON
        objections TEXT NOT NULL,     -- JSON
        triggers TEXT NOT NULL,       -- JSON
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      )
    `);

    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_niche_profiles_tenant
      ON niche_profiles(tenant_id)
    `);
  },

  down: async (db) => {
    await db.run(`DROP TABLE IF EXISTS niche_profiles`);
  },
};
