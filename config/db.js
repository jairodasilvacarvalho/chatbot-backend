// config/db.js
// ✅ SQLite (WAL) + Promise helpers
// ✅ Migrações seguras: colunas + índices
// ✅ Multi-tenant base: tenants + tenant_id + backfill + índices
// ✅ Robustez: foreign_keys ON, busy_timeout, temp_store
// ✅ FIX: initDb realmente "awaitável" (sem async perdido dentro do serialize)
// ✅ NOVO: dbAsync (get/run/all promise-based) + compat callback (para testes rápidos)

const sqlite3 = require("sqlite3").verbose();
const path = require("path");

/* ======================
   Conexão SQLite
====================== */
const dbPath = path.join(__dirname, "..", "database.sqlite");

const raw = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error("❌ [DB] Erro ao abrir SQLite:", err);
  else console.log("[DB] SQLite path em uso:", dbPath);
});

/* ======================
   Helpers async (Promise-based) + callback compat
   - se passar callback como último arg, usa callback-style
   - se não passar callback, retorna Promise
====================== */
function run(sql, params = [], cb) {
  const hasCb = typeof cb === "function";
  if (typeof params === "function") {
    cb = params;
    params = [];
  }

  const p = new Promise((resolve, reject) => {
    raw.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });

  if (hasCb) {
    p.then((res) => cb(null, res)).catch((err) => cb(err));
    return; // callback-mode
  }
  return p;
}

function get(sql, params = [], cb) {
  const hasCb = typeof cb === "function";
  if (typeof params === "function") {
    cb = params;
    params = [];
  }

  const p = new Promise((resolve, reject) => {
    raw.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

  if (hasCb) {
    p.then((row) => cb(null, row)).catch((err) => cb(err));
    return; // callback-mode
  }
  return p;
}

function all(sql, params = [], cb) {
  const hasCb = typeof cb === "function";
  if (typeof params === "function") {
    cb = params;
    params = [];
  }

  const p = new Promise((resolve, reject) => {
    raw.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

  if (hasCb) {
    p.then((rows) => cb(null, rows)).catch((err) => cb(err));
    return; // callback-mode
  }
  return p;
}

/* ======================
   Wrapper "dbAsync" (o que as rotas esperam)
====================== */
const dbAsync = {
  get,
  run,
  all,
  raw, // sqlite3 puro, se precisar
};

/* ======================
   Migração segura de colunas
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
  await run(indexSql); // CREATE INDEX IF NOT EXISTS...
}

/* ======================
   Init / Migrações (SERIALIZADO e AWAITÁVEL)
====================== */
function initDb() {
  return new Promise((resolve, reject) => {
    raw.serialize(() => {
      (async () => {
        try {
          /* ============ PRAGMAs ============ */
          await run("PRAGMA foreign_keys = ON");
          await run("PRAGMA journal_mode = WAL");
          await run("PRAGMA synchronous = NORMAL");
          await run("PRAGMA busy_timeout = 5000");
          await run("PRAGMA temp_store = MEMORY");

          /* ============================
             Multi-tenant base
          ============================ */
          await run(`
            CREATE TABLE IF NOT EXISTS tenants (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              slug TEXT NOT NULL UNIQUE,
              created_at TEXT DEFAULT (datetime('now'))
            );
          `);

          await run(`
            INSERT OR IGNORE INTO tenants (id, name, slug)
            VALUES (1, 'Default', 'default');
          `);

          /* ============================
             customers
             - Nota: mantemos phone UNIQUE para compat com DB existente.
               (Se quiser multi-tenant real por tenant+phone, fazemos migração guiada depois.)
          ============================ */
          await run(`
            CREATE TABLE IF NOT EXISTS customers (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              phone TEXT UNIQUE,
              name TEXT,
              created_at TEXT DEFAULT (datetime('now')),
              last_seen_at TEXT DEFAULT (datetime('now'))
            );
          `);

          /* ============================
             messages
          ============================ */
          await run(`
            CREATE TABLE IF NOT EXISTS messages (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              customer_phone TEXT,
              direction TEXT,
              text TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
          `);

          /* ============================
             tenant_id nas tabelas (backfill)
          ============================ */
          await ensureColumn("customers", "tenant_id", "INTEGER DEFAULT 1");
          await ensureColumn("messages", "tenant_id", "INTEGER DEFAULT 1");

          await run(`UPDATE customers SET tenant_id = 1 WHERE tenant_id IS NULL;`);
          await run(`UPDATE messages  SET tenant_id = 1 WHERE tenant_id IS NULL;`);

          /* ============================
             Colunas do Agent / Bot
          ============================ */
          await ensureColumn("customers", "stage", "TEXT");

          await ensureColumn("customers", "text_streak", "INTEGER DEFAULT 0");
          await ensureColumn("customers", "next_audio_at", "INTEGER DEFAULT 6");
          await ensureColumn("customers", "last_audio_at", "TEXT");

          await ensureColumn("customers", "facts_json", "TEXT");

          await ensureColumn("customers", "kanban_order", "INTEGER");

          await ensureColumn("messages", "has_audio", "INTEGER DEFAULT 0");
          await ensureColumn("messages", "audio_url", "TEXT");
          await ensureColumn("messages", "audio_duration_ms", "INTEGER");
          await ensureColumn("messages", "audio_voice_id", "TEXT");

          /* ============================
             Índices
          ============================ */
          await ensureIndex(
            "CREATE INDEX IF NOT EXISTS idx_customers_stage_order ON customers(stage, kanban_order)"
          );

          await ensureIndex(
            "CREATE INDEX IF NOT EXISTS idx_messages_customer_created ON messages(customer_phone, created_at)"
          );

          await ensureIndex("CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id)");
          await ensureIndex("CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id)");
          await ensureIndex(
            "CREATE INDEX IF NOT EXISTS idx_messages_tenant_customer_created ON messages(tenant_id, customer_phone, created_at)"
          );

          await ensureIndex("CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug)");

          console.log("✅ [DB] init/migrations OK");
          resolve(true);
        } catch (err) {
          console.error("❌ [DB] init/migration error:", err);
          reject(err);
        }
      })();
    });
  });
}

/* ======================
   Inicialização automática
====================== */
initDb().catch((err) => {
  console.error("❌ [DB] init/migration fatal:", err);
});

/* ======================
   Helper opcional: anexar no app (Express)
====================== */
function attachDbToApp(app) {
  if (!app) return;
  app.locals.db = dbAsync;
  console.log("✅ [DB] attached to app.locals.db");
}

/* ======================
   Exports
   ✅ Exporta o "db" direto para facilitar:
      const db = require("./config/db");
      await db.all(...)

   Mantém também:
      db.dbAsync / db.raw / db.initDb / db.attachDbToApp
====================== */
const db = dbAsync;

// anexar extras no export principal
db.dbAsync = dbAsync;
db.raw = raw;
db.initDb = initDb;
db.attachDbToApp = attachDbToApp;
db.run = run;
db.get = get;
db.all = all;

module.exports = db;