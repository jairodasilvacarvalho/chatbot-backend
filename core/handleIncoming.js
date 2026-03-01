// core/handleIncoming.js
// ✅ Schema real:
// - messages usa customer_phone (não customer_id)
// - conversation_events usa customer_id (ok)
//
// ✅ Fixes:
// 1) normaliza phone (só dígitos)
// 2) idempotência antes de tudo
// 3) recarrega customer antes do agent.run (evita stale)
// 4) ✅ persiste facts_json quando agent retornar result.facts
// 5) delay humano mantido
// 6) logs/eventos seguros

const db = require("../config/db");
const messageService = require("../services/messageService");
const conversationEvents = require("../services/conversationEvents.service");
const conversationDecision = require("../services/conversationDecision.service");
const agent = require("../services/agent");

/* ======================
   Utils
====================== */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function safeJsonStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    // fallback extremo
    return "{}";
  }
}

/**
 * Loga evento sem quebrar o fluxo.
 * OBS: conversation_events usa customer_id.
 */
async function safeLogEvent(tenant_id, customer_id, event_type, payload) {
  try {
    if (!tenant_id || !customer_id) return;
    await conversationEvents.logEvent(tenant_id, customer_id, event_type, payload);
  } catch (_) {}
}

/**
 * ✅ Garante customer no DB
 * customers: (tenant_id, phone, stage, text_streak, next_audio_at, created_at, facts_json?)
 */
async function ensureCustomer({ tenant_id, phone }) {
  const existing = await db.get(
    `SELECT * FROM customers WHERE tenant_id = ? AND phone = ? LIMIT 1`,
    [tenant_id, phone]
  );
  if (existing) return existing;

  const stage = "abertura";
  const text_streak = 0;
  const next_audio_at = 5;

  const ins = await db.run(
    `INSERT INTO customers (tenant_id, phone, stage, text_streak, next_audio_at, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [tenant_id, phone, stage, text_streak, next_audio_at]
  );

  return await db.get(`SELECT * FROM customers WHERE id = ? LIMIT 1`, [ins.lastID]);
}

/**
 * Persiste facts_json se a coluna existir (seguro)
 */
async function persistFactsIfAny({ tenant_id, phone, facts }) {
  if (!facts || typeof facts !== "object") return { ok: false, reason: "no_facts" };

  // Confere se a coluna facts_json existe (compatível com seu schema)
  // Faz só uma vez por chamada, barato.
  const cols = await db.all(`PRAGMA table_info(customers)`);
  const hasFacts = Array.isArray(cols) && cols.some((c) => c?.name === "facts_json");
  if (!hasFacts) return { ok: false, reason: "customers.no_facts_json_column" };

  await db.run(
    `UPDATE customers
     SET facts_json = ?
     WHERE tenant_id = ? AND phone = ?`,
    [safeJsonStringify(facts), tenant_id, phone]
  );

  return { ok: true };
}

/**
 * Core único do fluxo
 * handleIncoming({ tenant_id, phone, text, external_message_id, source })
 */
async function handleIncoming({
  tenant_id = 1,
  phone,
  text = "",
  external_message_id = null, // wamid (idempotência)
  source = "unknown",
}) {
  if (!phone) return { ok: false, error: "missing_phone" };

  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone) return { ok: false, error: "invalid_phone" };

  const incomingText = (text ?? "").toString();

  // 🔒 Idempotência: checa duplicata ANTES de tudo (pelo external_message_id do IN)
  if (external_message_id) {
    const exists = await messageService.getByExternalMessageId({
      tenant_id,
      external_message_id,
    });
    if (exists) {
      return {
        ok: true,
        status: "duplicate_ignored",
        source: "idempotency",
        tenant_id,
        phone: cleanPhone,
        external_message_id,
      };
    }
  }

  // 1) garante customer
  let customer = await ensureCustomer({ tenant_id, phone: cleanPhone });

  // 2) salva message IN (messages vincula por customer_phone)
  await messageService.saveMessage({
    tenant_id,
    customer_phone: cleanPhone,
    direction: "in",
    text: incomingText,
    external_message_id: external_message_id || null,
  });

  await safeLogEvent(tenant_id, customer.id, "incoming_text", {
    source,
    text: incomingText,
    external_message_id: external_message_id || null,
  });

  // 3) decision
  const decision = await conversationDecision.decide({
    tenantId: tenant_id,
    customerId: customer.id,
  });

  await safeLogEvent(tenant_id, customer.id, "decision", { decision });

  // ✅ Recarrega customer antes do agent.run (pega facts_json mais recente)
  customer = await db.get(
    `SELECT * FROM customers WHERE tenant_id = ? AND phone = ? LIMIT 1`,
    [tenant_id, cleanPhone]
  );

  // 4) agent
  const result = await agent.run({
    tenant_id,
    customer,
    incomingText,
    decision,
  });

  // ✅ NOVO: persistir facts_json (se o agent devolveu)
  let persistFactsResult = null;
  if (result?.facts && typeof result.facts === "object") {
    persistFactsResult = await persistFactsIfAny({
      tenant_id,
      phone: cleanPhone,
      facts: result.facts,
    });

    // (opcional) log do persist
    await safeLogEvent(tenant_id, customer.id, "facts_persisted", {
      ok: persistFactsResult?.ok === true,
      reason: persistFactsResult?.reason || null,
    });
  }

  // 5) delay humano
  const minDelay = Number(process.env.HUMAN_DELAY_MIN_MS || 15000);
  const maxDelay = Number(process.env.HUMAN_DELAY_MAX_MS || 20000);
  const delayMs = randomBetween(
    Number.isFinite(minDelay) ? minDelay : 15000,
    Number.isFinite(maxDelay) ? maxDelay : 20000
  );
  await sleep(delayMs);

  // 6) salva OUT + evento
  if (result?.type === "audio") {
    await messageService.saveMessage({
      tenant_id,
      customer_phone: cleanPhone,
      direction: "out",
      text: result.text || null,
      has_audio: 1,
      audio_url: result.audio_url || null,
      external_message_id: null,
    });

    await safeLogEvent(tenant_id, customer.id, "audio_sent", {
      delayMs,
      audio_url: result.audio_url || null,
    });
  } else {
    const outText = (result?.text ?? "").toString();

    await messageService.saveMessage({
      tenant_id,
      customer_phone: cleanPhone,
      direction: "out",
      text: outText,
      has_audio: 0,
      audio_url: null,
      external_message_id: null,
    });

    await safeLogEvent(tenant_id, customer.id, "text_sent", {
      delayMs,
      text: outText,
    });
  }

  return {
    ok: true,
    status: "processed",
    source,
    tenant_id,
    customer_id: customer.id,
    phone: cleanPhone,
    external_message_id: external_message_id || null,
    decision,
    channel: result?.type || "text",
    facts_saved: persistFactsResult?.ok === true,
    facts_save_reason: persistFactsResult?.ok ? null : persistFactsResult?.reason || null,
  };
}

module.exports = { handleIncoming };
