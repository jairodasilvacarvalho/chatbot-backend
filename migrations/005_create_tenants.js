// migrations/005_create_tenants.js
module.exports = {
  id: "005_create_tenants",
  up: async (db) => {
    await db.run(`
      CREATE TABLE IF NOT EXISTS tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // índice extra (o UNIQUE já cria um índice, mas deixo explícito se você preferir)
    // await db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug)`);

    // cria um tenant default (id=1) se não existir nenhum
    const row = await db.get(`SELECT COUNT(*) AS c FROM tenants`);
    if ((row?.c || 0) === 0) {
      await db.run(
        `INSERT INTO tenants (name, slug, status) VALUES (?, ?, ?)`,
        ["Default Tenant", "default", "active"]
      );
    }
  },

  down: async (db) => {
    await db.run(`DROP TABLE IF EXISTS tenants`);
  },
};
