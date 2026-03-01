// routes/simulator.js
// ✅ Simulator robusto (payload simples + WhatsApp Cloud)
// ✅ FIX: chama services/agent.run com assinatura correta { tenant_id, customer, incomingText, decision }
// ✅ FIX CRÍTICO: garante customer existente (UPSERT) antes do agent (senão facts/stage não persistem)
// ✅ Salva inbound/outbound no DB
// ✅ Retorna reply_text sempre da última mensagem "out" no DB (source of truth)
// ✅ Persist facts_json + stage retornados pelo agent no customers (sem assumir updated_at)

const express = require("express");
const router = express.Router();

/**
 * ===========================
 * 1) DB loader
 * ===========================
 */
function loadDbModule() {
  const tries = ["../config/db", "../config-db"];
  const errors = [];

  for (const p of tries) {
    try {
      const mod = require(p); // esperado: { run, get, all }
      if (mod && typeof mod.get === "function" && typeof mod.run === "function" && typeof mod.all === "function") {
        return { mod, path: p };
      }
      errors.push(`Found ${p}, but missing { get/run/all }`);
    } catch (e) {
      errors.push(`Failed ${p}: ${e.message}`);
    }
  }

  const err = new Error(
    "DB module not found / invalid.\nTentei:\n- " +
      errors.join("\n- ") +
      "\n\n✅ Garanta que exista UM destes arquivos:\n- config/db.js (exportando get/run/all)\n- config-db.js (exportando get/run/all)"
  );
  err.code = "DB_MODULE_NOT_FOUND";
  throw err;
}

const { mod: db } = loadDbModule();

/**
 * ===========================
 * 2) Agent handler (FIXO)
 * ===========================
 */
let agentRun = null;
try {
  const agent = require("../services/agent");
  agentRun = typeof agent?.run === "function" ? agent.run : null;
} catch {
  agentRun = null;
}

/* ======================
   Helpers
====================== */
function safeString(x) {
  if (x === null || x === undefined) return "";
  return String(x);
}

function safeInt(x, fallback = 1) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function extractInbound(reqBody) {
  const b = reqBody || {};

  // Payload simples #1: { phone, message|text, id, tenant_id }
  if (b.phone && (b.message || b.text)) {
    return {
      source_shape: "simple_phone_message",
      phone: safeString(b.phone),
      text: safeString(b.message || b.text),
      id: safeString(b.id || `sim_${Date.now()}`),
      tenant_id: safeInt(b.tenant_id, 1),
    };
  }

  // Payload simples #2: { from, text:{body}, id, tenant_id }
  if (b.from && b.text && typeof b.text === "object" && b.text.body) {
    return {
      source_shape: "simple_whatsapp_like",
      phone: safeString(b.from),
      text: safeString(b.text.body),
      id: safeString(b.id || `sim_${Date.now()}`),
      tenant_id: safeInt(b.tenant_id, 1),
    };
  }

  // WhatsApp Cloud: entry[0].changes[0].value.messages[0]
  const msg = b?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (msg?.from && (msg?.text?.body || msg?.button?.text || msg?.interactive)) {
    const text =
      msg?.text?.body ||
      msg?.button?.text ||
      msg?.interactive?.button_reply?.title ||
      msg?.interactive?.list_reply?.title ||
      "";

    return {
      source_shape: "whatsapp_cloud",
      phone: safeString(msg.from),
      text: safeString(text),
      id: safeString(msg.id || `wa_${Date.now()}`),
      tenant_id: safeInt(reqBody?.tenant_id, 1),
    };
  }

  return null;
}

async function getLastOutMessage(customerPhone, tenantId) {
  return await db.get(
    `
    SELECT id, text, created_at
    FROM messages
    WHERE customer_phone = ?
      AND tenant_id = ?
      AND direction = 'out'
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 1
  `,
    [customerPhone, tenantId]
  );
}

/**
 * ✅ FIX CRÍTICO: garante que o customer exista (UPSERT)
 * - Se não existir, cria.
 * - Sempre retorna row com id (para consistência).
 * - Atualiza last_seen_at.
 */
async function getOrCreateCustomer({ phone, tenant_id }) {
  const p = safeString(phone).trim();
  const tid = safeInt(tenant_id, 1);
  if (!p) return null;

  let row = await db.get(
    `SELECT id, phone, tenant_id, stage, facts_json, product_key, last_seen_at
     FROM customers
     WHERE phone = ? AND tenant_id = ?
     LIMIT 1`,
    [p, tid]
  );

  if (!row) {
    // cria mínimo compatível com seu schema (sem colunas extras)
    await db.run(
      `INSERT INTO customers (phone, tenant_id, stage, facts_json, created_at, last_seen_at)
       VALUES (?, ?, 'abertura', '{}', datetime('now'), datetime('now'))`,
      [p, tid]
    );

    row = await db.get(
      `SELECT id, phone, tenant_id, stage, facts_json, product_key, last_seen_at
       FROM customers
       WHERE phone = ? AND tenant_id = ?
       LIMIT 1`,
      [p, tid]
    );
  } else {
    // atualiza last_seen_at (não quebra se não existir a coluna? existe no seu schema)
    try {
      await db.run(
        `UPDATE customers SET last_seen_at = datetime('now') WHERE tenant_id = ? AND phone = ?`,
        [tid, p]
      );
    } catch {
      // silêncio: não é crítico
    }
  }

  // fallback defensivo
  if (!row) {
    return {
      id: null,
      phone: p,
      tenant_id: tid,
      stage: "abertura",
      facts_json: "{}",
      product_key: null,
    };
  }

  // garante shape esperado pelo agent
  return {
    id: row.id ?? null,
    phone: row.phone ?? p,
    tenant_id: row.tenant_id ?? tid,
    stage: row.stage ?? "abertura",
    facts_json: row.facts_json ?? "{}",
    product_key: row.product_key ?? null,
  };
}

/**
 * ✅ Grava mensagens (in/out) no DB
 * - Tenta primeiro com message_id (se existir na tabela)
 * - Se falhar, tenta versão mínima
 */
async function saveMessage({ tenant_id, customer_phone, direction, text, message_id = null }) {
  const now = new Date().toISOString();

  // tentativa 1: com message_id
  try {
    await db.run(
      `INSERT INTO messages (tenant_id, customer_phone, direction, text, created_at, message_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tenant_id, customer_phone, direction, text, now, message_id]
    );
    return { ok: true, mode: "with_message_id" };
  } catch (e1) {
    // tentativa 2: sem message_id
    try {
      await db.run(
        `INSERT INTO messages (tenant_id, customer_phone, direction, text, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [tenant_id, customer_phone, direction, text, now]
      );
      return { ok: true, mode: "no_message_id" };
    } catch (e2) {
      return {
        ok: false,
        reason: "insert_failed",
        error1: e1?.message || String(e1),
        error2: e2?.message || String(e2),
      };
    }
  }
}

/**
 * ✅ Persistir facts_json e stage retornados pelo agent
 * - Compatível com seu schema real (sem updated_at)
 * - Se customer existir (garantido pelo getOrCreateCustomer), UPDATE sempre vai funcionar.
 */
async function persistCustomerState({ tenant_id, phone, newFacts }) {
  if (!newFacts || typeof newFacts !== "object") return { ok: false, reason: "invalid_facts" };

  const factsJson = JSON.stringify(newFacts);
  const stage = newFacts.stage || "abertura";

  try {
    const res = await db.run(
      `UPDATE customers
         SET facts_json = ?, stage = ?
       WHERE tenant_id = ? AND phone = ?`,
      [factsJson, stage, tenant_id, phone]
    );

    const changed = Number(res?.changes || 0);
    return { ok: changed > 0, mode: "update", stage, changes: changed };
  } catch (e) {
    return { ok: false, reason: "update_failed", err: e?.message || String(e) };
  }
}

/* ======================
   Routes
====================== */

// Health do simulator (pra confirmar mount)
router.get("/", (req, res) => {
  res.json({ ok: true, route: "/simulator", handler: agentRun ? "agent.run" : null });
});

router.post("/", async (req, res) => {
  const inbound = extractInbound(req.body);

  if (!inbound) {
    return res.status(400).json({
      ok: false,
      error: "invalid_payload_shape",
      hint:
        "Envie { phone, message, id, tenant_id } ou { from, text:{body}, id, tenant_id } ou payload WhatsApp Cloud (entry/changes/value/messages[0]).",
      examples: [
        { phone: "5511999999999", message: "quero comprar", id: "t1", tenant_id: 1 },
        { from: "5511999999999", text: { body: "quero comprar" }, id: "t1", tenant_id: 1 },
      ],
      got: { source_shape: "unknown", top_level_keys: Object.keys(req.body || {}) },
    });
  }

  if (!agentRun) {
    return res.status(500).json({
      ok: false,
      error: "SIMULATOR_HANDLER_MISSING",
      message: "services/agent não exportou run() como esperado.",
      details: { expected: "module.exports = { run }" },
    });
  }

  const { phone, text, id, source_shape, tenant_id } = inbound;

  try {
    // 0) ✅ FIX CRÍTICO: garante customer existente (com id)
    const customer = await getOrCreateCustomer({ phone, tenant_id });

    // 1) grava inbound no DB (histórico)
    const savedIn = await saveMessage({
      tenant_id,
      customer_phone: phone,
      direction: "in",
      text,
      message_id: id,
    });

    // 2) chama o agent com assinatura correta
    const coreResult = await agentRun({
      tenant_id,
      customer,
      incomingText: text,
      decision: {
        inbound_message_id: id,
        source: "simulator",
        channel: "text",
      },
    });

    // 3) persiste facts/stage retornados (agora UPDATE deve dar changes>0)
    const persisted = await persistCustomerState({
      tenant_id,
      phone,
      newFacts: coreResult?.facts || null,
    });

    // 4) grava outbound se vier texto
    let savedOut = { ok: false, reason: "no_out" };
    if (coreResult?.type === "text" && coreResult?.text) {
      savedOut = await saveMessage({
        tenant_id,
        customer_phone: phone,
        direction: "out",
        text: safeString(coreResult.text),
        message_id: null,
      });
    }

    // 5) last out do DB (source of truth)
    let lastOut = null;
    try {
      lastOut = await getLastOutMessage(phone, tenant_id);
    } catch {
      lastOut = null;
    }

    const replyText = lastOut?.text || (coreResult?.type === "text" ? coreResult?.text : null);

    return res.json({
      ok: true,
      status: "processed",
      source_shape,
      inbound: { phone, text, id, tenant_id },
      agent_handler: "services/agent.run",
      reply_text: replyText,
      reply_message_id: lastOut?.id || null,
      reply_created_at: lastOut?.created_at || null,
      debug: {
        core: coreResult || null,
        customer_loaded: customer || null,
        persisted_customer_state: persisted,
        saved_in: savedIn,
        saved_out: savedOut,
      },
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.code || "simulator_failed",
      message: err?.message || String(err),
    });
  }
});

module.exports = router;