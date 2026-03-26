// db/queries_admin.js
// Queries reutilizáveis do Dashboard (Admin)
// - SQLite (customers, messages)
// - Tudo retorna Promise para facilitar uso nas rotas
// - NÃO faz ALTER TABLE (migração estrutural fica no core do projeto)
// - Apenas CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS (seguro e idempotente)
// - Logs detalhados de erro (err.message + SQL + params)

const dbModule = require("../config/db");

// Compatibilidade: alguns projetos exportam "db", outros exportam direto a instância
const db = dbModule?.db ? dbModule.db : dbModule;

// ======================
// Helpers Promisificados (com LOG)
// ======================
function logSqlError(kind, err, sql, params) {
  console.error(`\n=== SQLITE ${kind} ERROR ===`);
  console.error("MESSAGE:", err.message);
  console.error("SQL:", sql);
  console.error("PARAMS:", params);
  console.error("=========================\n");
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        logSqlError("dbAll", err, sql, params);
        return reject(err);
      }
      resolve(rows);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        logSqlError("dbGet", err, sql, params);
        return reject(err);
      }
      resolve(row);
    });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        logSqlError("dbRun", err, sql, params);
        return reject(err);
      }
      resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

// ======================
// INIT (somente CREATE/INDEX)
// ======================
// Importante: NÃO fazemos ALTER TABLE aqui.
// Migração/ensureColumn é responsabilidade do core (config/db.js).
let _initialized = false;

async function initAdminDb() {
  if (_initialized) return;
  _initialized = true;

  // Customers
  // Observação: definimos colunas completas para instalações novas.
  // Em DBs antigos, as colunas são garantidas pelo core via ensureColumn.
  await dbRun(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE,
      name TEXT,

      stage TEXT,
      kanban_order INTEGER,

      text_streak INTEGER DEFAULT 0,
      next_audio_at INTEGER DEFAULT 6,
      last_audio_at TEXT,

      created_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Messages
  await dbRun(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_phone TEXT,
      direction TEXT,
      text TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Índices úteis (não quebram se já existirem)
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_messages_customer_phone ON messages(customer_phone)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_customers_stage ON customers(stage)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_customers_last_seen ON customers(last_seen_at)`);

  // ✅ novo: kanban order
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_customers_stage_order ON customers(stage, kanban_order)`);
}

// ================================
// Helpers de filtro/ordenação
// ================================
function buildStageWhere(stage) {
  // stage pode ser:
  // - null => sem filtro
  // - "sem_stage" => stage IS NULL
  // - "abertura"|"diagnostico"|... => stage = ?
  if (!stage) return { sql: "", params: [] };

  const s = String(stage).trim();
  if (!s) return { sql: "", params: [] };

  if (s === "sem_stage") {
    return { sql: "c.stage IS NULL", params: [] };
  }

  return { sql: "c.stage = ?", params: [s] };
}

function buildSearchWhere(q) {
  if (!q) return { sql: "", params: [] };
  const term = String(q).trim();
  if (!term) return { sql: "", params: [] };

  const like = `%${term}%`;
  return {
    sql: "(c.phone LIKE ? OR c.name LIKE ?)",
    params: [like, like],
  };
}

function buildWhere(stage, q) {
  const parts = [];
  const params = [];

  const ws = buildStageWhere(stage);
  if (ws.sql) {
    parts.push(ws.sql);
    params.push(...ws.params);
  }

  const wq = buildSearchWhere(q);
  if (wq.sql) {
    parts.push(wq.sql);
    params.push(...wq.params);
  }

  return {
    whereSql: parts.length ? `WHERE ${parts.join(" AND ")}` : "",
    params,
  };
}

function buildOrderBy(order) {
  // order opcional (futuro):
  // - "recent" (default)
  // - "kanban" (útil quando stage é fornecido e você quer ordem do kanban)
  const o = (order || "recent").trim();

  if (o === "kanban") {
    return `
      ORDER BY
        CASE WHEN c.kanban_order IS NULL THEN 1 ELSE 0 END ASC,
        c.kanban_order ASC,
        datetime(COALESCE(c.last_seen_at, c.created_at)) DESC,
        c.id DESC
    `;
  }

  // default: mais recentes primeiro
  return `
    ORDER BY
      datetime(COALESCE(c.last_seen_at, c.created_at)) DESC,
      c.id DESC
  `;
}

// ================================
// 1) LISTAGEM DE CUSTOMERS (paginado)
// ================================
// Filtros opcionais:
// - stage: "abertura"|"diagnostico"|...|"sem_stage"|null
// - q: busca por phone ou name (LIKE)
// - order: "recent" (default) ou "kanban"
async function getCustomers({ page = 1, limit = 20, stage = null, q = null, order = "recent" } = {}) {
  await initAdminDb();

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const offset = (safePage - 1) * safeLimit;

  const { whereSql, params } = buildWhere(stage, q);
  const orderSql = buildOrderBy(order);

  const totalRow = await dbGet(
    `SELECT COUNT(*) AS total
     FROM customers c
     ${whereSql}`,
    params
  );

  const rows = await dbAll(
    `SELECT
        c.id,
        c.phone,
        c.name,
        c.stage,
        c.kanban_order,
        c.text_streak,
        c.next_audio_at,
        c.last_audio_at,
        c.created_at,
        c.last_seen_at
     FROM customers c
     ${whereSql}
     ${orderSql}
     LIMIT ?
     OFFSET ?`,
    [...params, safeLimit, offset]
  );

  const total = totalRow?.total || 0;

  return {
    page: safePage,
    limit: safeLimit,
    total,
    pages: Math.ceil(total / safeLimit),
    items: rows,
  };
}

// ===================================
// 2) CONVERSA COMPLETA POR TELEFONE
// ===================================
// Retorna customer + mensagens ordenadas por created_at ASC
async function getConversationByPhone(phone, { limit = 500, offset = 0 } = {}) {
  await initAdminDb();
  const p = (phone || "").trim();
  if (!p) throw new Error("phone é obrigatório");

  const safeLimit = Math.min(2000, Math.max(1, Number(limit) || 500));
  const safeOffset = Math.max(0, Number(offset) || 0);

  const customer = await dbGet(
    `SELECT
        id,
        phone,
        name,
        stage,
        kanban_order,
        text_streak,
        next_audio_at,
        last_audio_at,
        created_at,
        last_seen_at
     FROM customers
     WHERE phone = ?
     LIMIT 1`,
    [p]
  );

  const messages = await dbAll(
    `SELECT
        id,
        customer_phone,
        direction,
        text,
        created_at
     FROM messages
     WHERE customer_phone = ?
     ORDER BY datetime(created_at) ASC, id ASC
     LIMIT ?
     OFFSET ?`,
    [p, safeLimit, safeOffset]
  );

  return {
    customer: customer || null,
    messages,
  };
}

// ========================
// 3) STATS DO DASHBOARD
// ========================
// - total de customers
// - mensagens últimas 24h
// - mensagens últimos 7 dias
// - distribuição por stage
async function getAdminStats() {
  await initAdminDb();

  const totalCustomers = await dbGet(
    `SELECT COUNT(*) AS total FROM customers`,
    []
  );

  const messages24h = await dbGet(
    `SELECT COUNT(*) AS total
     FROM messages
     WHERE datetime(created_at) >= datetime('now', '-1 day')`,
    []
  );

  const messages7d = await dbGet(
    `SELECT COUNT(*) AS total
     FROM messages
     WHERE datetime(created_at) >= datetime('now', '-7 day')`,
    []
  );

  const stageDistribution = await dbAll(
    `SELECT
        COALESCE(stage, 'sem_stage') AS stage,
        COUNT(*) AS total
     FROM customers
     GROUP BY COALESCE(stage, 'sem_stage')
     ORDER BY total DESC`,
    []
  );

  return {
    total_customers: totalCustomers?.total || 0,
    messages_24h: messages24h?.total || 0,
    messages_7d: messages7d?.total || 0,
    stage_distribution: stageDistribution,
  };
}

// =========================
// 4) UPDATE MANUAL DE STAGE
// =========================
// newStage pode ser string (abertura/...) OU null (sem_stage)
async function updateCustomerStage(phone, newStage) {
  await initAdminDb();

  const p = (phone || "").trim();
  if (!p) throw new Error("phone é obrigatório");

  // ✅ aceita null (sem_stage)
  const stageToSave = newStage === undefined ? undefined : newStage;

  if (stageToSave === undefined) {
    throw new Error("newStage é obrigatório (pode ser null para sem_stage)");
  }

  const result = await dbRun(
    `UPDATE customers
     SET stage = ?, last_seen_at = COALESCE(last_seen_at, datetime('now'))
     WHERE phone = ?`,
    [stageToSave, p]
  );

  return {
    phone: p,
    stage: stageToSave,
    updated: result.changes || 0,
  };
}

module.exports = {
  getCustomers,
  getConversationByPhone,
  getAdminStats,
  updateCustomerStage,
  initAdminDb,
};
