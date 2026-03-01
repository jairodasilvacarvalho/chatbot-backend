// src/services/customerService.js
// ✅ Customer Service — persistência pura (SEM merge / SEM recursão)

const { run, get, all } = require("../../config/db");

/* ======================
   Helpers
====================== */
function normalizeTenantId(tenantId) {
  const t = Number(tenantId);
  return Number.isFinite(t) && t > 0 ? t : 1;
}

function normalizePhone(phone) {
  return phone ? String(phone).replace(/\D/g, "") : "";
}

function nowIso() {
  return new Date().toISOString();
}

/* ======================
   Queries
====================== */

/**
 * Busca customer por tenant + phone
 */
async function getCustomerByPhone({ tenantId = 1, phone }) {
  const tId = normalizeTenantId(tenantId);
  const p = normalizePhone(phone);
  if (!p) return null;

  return get(
    `
      SELECT *
      FROM customers
      WHERE tenant_id = ? AND phone = ?
      LIMIT 1
    `,
    [tId, p]
  );
}

/**
 * Cria customer se não existir
 * Sempre atualiza last_seen_at
 */
async function getOrCreateCustomer({ tenantId = 1, phone, name = null }) {
  const tId = normalizeTenantId(tenantId);
  const p = normalizePhone(phone);

  if (!p) throw new Error("getOrCreateCustomer: phone is required");

  let customer = await getCustomerByPhone({ tenantId: tId, phone: p });

  if (!customer) {
    await run(
      `
        INSERT INTO customers (tenant_id, phone, name, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      [tId, p, name, nowIso(), nowIso()]
    );

    return await getCustomerByPhone({ tenantId: tId, phone: p });
  }

  await run(
    `
      UPDATE customers
      SET last_seen_at = ?
      WHERE tenant_id = ? AND phone = ?
    `,
    [nowIso(), tId, p]
  );

  return await getCustomerByPhone({ tenantId: tId, phone: p });
}

/**
 * Atualiza estado do customer
 * ⚠️ REGRA DEFINITIVA:
 * - NÃO faz merge
 * - NÃO interpreta facts_json
 * - Apenas grava o que o AGENT decidiu
 */
async function updateCustomerState({ tenantId = 1, phone, patch = {} }) {
  const tId = normalizeTenantId(tenantId);
  const p = normalizePhone(phone);

  if (!p) throw new Error("updateCustomerState: phone is required");
  if (!patch || typeof patch !== "object") return;

  const fields = [];
  const values = [];

  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case "name":
      case "stage":
      case "kanban_order":
      case "text_streak":
      case "next_audio_at":
      case "last_audio_at":
      case "facts_json":
      case "product_key":
      case "last_seen_at":
        fields.push(`${key} = ?`);
        values.push(value);
        break;
      default:
        // ignora campos não permitidos
        break;
    }
  }

  if (!fields.length) return;

  values.push(tId, p);

  await run(
    `
      UPDATE customers
      SET ${fields.join(", ")}
      WHERE tenant_id = ? AND phone = ?
    `,
    values
  );
}

/**
 * Incremento simples (compatibilidade futura)
 */
async function incrementTextStreak({ tenantId = 1, phone }) {
  const tId = normalizeTenantId(tenantId);
  const p = normalizePhone(phone);
  if (!p) return;

  await run(
    `
      UPDATE customers
      SET text_streak = COALESCE(text_streak, 0) + 1,
          last_seen_at = ?
      WHERE tenant_id = ? AND phone = ?
    `,
    [nowIso(), tId, p]
  );
}

/**
 * Setar product_key (admin / wizard)
 */
async function setCustomerProductKey({ tenantId = 1, phone, productKey }) {
  const tId = normalizeTenantId(tenantId);
  const p = normalizePhone(phone);
  if (!p) throw new Error("setCustomerProductKey: phone is required");

  const key = productKey && String(productKey).trim() ? String(productKey).trim() : null;

  await run(
    `
      UPDATE customers
      SET product_key = ?
      WHERE tenant_id = ? AND phone = ?
    `,
    [key, tId, p]
  );

  return await getCustomerByPhone({ tenantId: tId, phone: p });
}

module.exports = {
  getCustomerByPhone,
  getOrCreateCustomer,
  updateCustomerState,
  incrementTextStreak,
  setCustomerProductKey,
};
