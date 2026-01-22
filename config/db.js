// config/db.js
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

/* ======================
   Conexão SQLite
====================== */
const dbPath = path.join(__dirname, "..", "database.sqlite");
const db = new sqlite3.Database(dbPath);

/* ======================
   Helpers async (Promise-based)
====================== */
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
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
   - NÃO duplica
   - NÃO quebra banco antigo
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
   Inicialização + Migrações
====================== */
async function initDb() {
  /* ============
     PRAGMAs
     ============
     - WAL: melhor concorrência (dashboard + mock)
     - synchronous NORMAL: bom equilíbrio performance/segurança
  */
  await run("PRAGMA foreign_keys = ON");
  await run("PRAGMA journal_mode = WAL");
  await run("PRAGMA synchronous = NORMAL");

  /* ============
     Tabela customers
     ============
     Base do SaaS (1 linha = 1 cliente WhatsApp)
  */
  await run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE,
      name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now'))
    )
  `);

  /* ============
     Tabela messages
     ============
     Histórico IN/OUT
  */
  await run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_phone TEXT,
      direction TEXT,
      text TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  /* =================================================
     Colunas do "vendedor humano" (Agent / Bot)
     ================================================= */

  // stage:
  // - aceita NULL
  // - NÃO colocamos DEFAULT 'abertura'
  //   (mantém compatibilidade com clientes antigos / sem_stage)
  await ensureColumn("customers", "stage", "TEXT");

  // Controle de alternância texto/áudio
  await ensureColumn("customers", "text_streak", "INTEGER DEFAULT 0");
  await ensureColumn("customers", "next_audio_at", "INTEGER DEFAULT 6");
  await ensureColumn("customers", "last_audio_at", "TEXT");

  // depois de garantir tabela messages existir...
  await ensureColumn("messages", "has_audio", "INTEGER DEFAULT 0");
  await ensureColumn("messages", "audio_url", "TEXT");
  await ensureColumn("messages", "audio_duration_ms", "INTEGER");
  await ensureColumn("messages", "audio_voice_id", "TEXT");


  // 🔥 PASSO 3.3.3 — Memória do agente
  // Guarda fatos já coletados (JSON string):
  // ex.: audiencia, objetivo, produto, urgencia, orcamento, local
  await ensureColumn("customers", "facts_json", "TEXT");

  /* ============
     Kanban
     ============
     Ordem visual no dashboard
  */
  await ensureColumn("customers", "kanban_order", "INTEGER");

  /* ============
     Índices
     ============
     Performance e escalabilidade
  */

  // Kanban (stage + ordem)
  await ensureIndex(
    "CREATE INDEX IF NOT EXISTS idx_customers_stage_order ON customers(stage, kanban_order)"
  );

  // Conversas (cliente + tempo)
  await ensureIndex(
    "CREATE INDEX IF NOT EXISTS idx_messages_customer_created ON messages(customer_phone, created_at)"
  );
}

/* ======================
   Inicialização automática
====================== */
initDb().catch((err) => {
  console.error("❌ DB init/migration error:", err);
});

/* ======================
   Exports
====================== */
module.exports = {
  db,
  run,
  get,
  all,
};
