const { run, all } = require("../../config/db");

async function saveMessage({ customer_phone, direction, text }) {
  if (!customer_phone || !direction || !text) {
    throw new Error("customer_phone, direction e text são obrigatórios");
  }

  await run(
    `
    INSERT INTO messages (customer_phone, direction, text)
    VALUES (?, ?, ?)
    `,
    [customer_phone, direction, text]
  );

  return { ok: true };
}

// 🔎 Utilidades (para decisor, áudio e dashboard)
async function countOutgoingMessages(phone) {
  const rows = await all(
    `
    SELECT COUNT(*) as total
    FROM messages
    WHERE customer_phone = ? AND direction = 'out'
    `,
    [phone]
  );
  return rows[0]?.total || 0;
}

async function getConversation(phone, limit = 50) {
  return all(
    `
    SELECT direction, text, created_at
    FROM messages
    WHERE customer_phone = ?
    ORDER BY created_at DESC
    LIMIT ?
    `,
    [phone, limit]
  );
}

module.exports = {
  saveMessage,
  countOutgoingMessages,
  getConversation,
};
