// src/services/customerService.js
const db = require("../../config/db");

/**
 * Busca customer pelo phone
 */
async function getCustomerByPhone(phone) {
  if (!phone) return null;

  const rows = await db.all(
    `
      SELECT *
      FROM customers
      WHERE phone = ?
      LIMIT 1
    `,
    [phone]
  );

  return rows[0] || null;
}

/**
 * Cria customer se não existir
 * Sempre atualiza last_seen_at
 */
async function getOrCreateCustomer({ phone, name }) {
  if (!phone) throw new Error("getOrCreateCustomer: phone is required");

  let customer = await getCustomerByPhone(phone);

  if (!customer) {
    await db.run(
      `
        INSERT INTO customers (phone, name, created_at, last_seen_at)
        VALUES (?, ?, datetime('now'), datetime('now'))
      `,
      [phone, name || null]
    );

    customer = await getCustomerByPhone(phone);
    return customer;
  }

  // Atualiza last_seen_at sempre que há interação
  await db.run(
    `
      UPDATE customers
      SET last_seen_at = datetime('now')
      WHERE phone = ?
    `,
    [phone]
  );

  return customer;
}

/**
 * Atualiza estado do customer (parcial)
 */
async function updateCustomerState(phone, patch = {}) {
  if (!phone) throw new Error("updateCustomerState: phone is required");
  if (!patch || typeof patch !== "object") return;

  const fields = [];
  const values = [];

  for (const [key, value] of Object.entries(patch)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }

  if (!fields.length) return;

  values.push(phone);

  await db.run(
    `
      UPDATE customers
      SET ${fields.join(", ")}
      WHERE phone = ?
    `,
    values
  );
}

/**
 * Incremento simples (mantido por compatibilidade futura)
 * ⚠️ Hoje o agent controla o text_streak
 */
async function incrementTextStreak(phone) {
  if (!phone) return;

  await db.run(
    `
      UPDATE customers
      SET text_streak = COALESCE(text_streak, 0) + 1,
          last_seen_at = datetime('now')
      WHERE phone = ?
    `,
    [phone]
  );
}

module.exports = {
  getCustomerByPhone,
  getOrCreateCustomer,
  updateCustomerState,
  incrementTextStreak, // não usado agora, mas mantido
};
