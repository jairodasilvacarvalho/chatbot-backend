const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "..", "database.sqlite");
const db = new sqlite3.Database(dbPath);

/* ======================
   Helpers async
====================== */
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

/* ======================
   Migração segura de colunas
   (evita duplicar e não quebra DB antigo)
====================== */
async function ensureColumn(table, column, definition) {
  const cols = await all(`PRAGMA table_info(${table})`);
  const exists = cols.some((c) => c.name === column);
  if (!exists) {
    await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/* ======================
   Migração segura de índices
====================== */
async function ensureIndex(indexSql) {
  // SQLite já suporta IF NOT EXISTS
  await run(indexSql);
}

/* ======================
   Inicialização do banco + Migrações
====================== */
async function initDb() {
  // Tabelas base (mantém compatibilidade)
  await run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE,
      name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_phone TEXT,
      direction TEXT,
      text TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ============================
  // Colunas do "vendedor humano"
  // ============================

  // IMPORTANTE:
  // - stage deve aceitar NULL (pra sem_stage virar NULL)
  // - NÃO colocamos DEFAULT 'abertura' para não "forçar" stage em clientes antigos/sem_stage
  await ensureColumn("customers", "stage", "TEXT");

  await ensureColumn("customers", "text_streak", "INTEGER DEFAULT 0");
  await ensureColumn("customers", "next_audio_at", "INTEGER DEFAULT 6");
  await ensureColumn("customers", "last_audio_at", "TEXT");

  // ============================
  // Próximo passo: Kanban order
  // ============================
  await ensureColumn("customers", "kanban_order", "INTEGER");

  // Índice (recomendado para /admin/kanban)
  await ensureIndex(
    "CREATE INDEX IF NOT EXISTS idx_customers_stage_order ON customers(stage, kanban_order)"
  );
}

// Inicializa automaticamente ao carregar o módulo
initDb().catch((err) => {
  console.error("DB init/migration error:", err);
});

module.exports = {
  db,
  run,
  all,
};
