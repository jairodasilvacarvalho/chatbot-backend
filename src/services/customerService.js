const { run, all } = require("../../config/db");

async function upsertCustomer({ phone, name }) {
  if (!phone) throw new Error("phone é obrigatório");

  await run(
    `
    INSERT INTO customers (phone, name, last_seen_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(phone) DO UPDATE SET
      name = COALESCE(excluded.name, customers.name),
      last_seen_at = datetime('now')
    `,
    [phone, name || null]
  );

  return getCustomerByPhone(phone);
}

async function getCustomerByPhone(phone) {
  const rows = await all(
    `SELECT * FROM customers WHERE phone = ? LIMIT 1`,
    [phone]
  );
  return rows[0] || null;
}

async function updateCustomerState(phone, patch = {}) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;

  const setSql = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => patch[k]);

  await run(
    `UPDATE customers SET ${setSql} WHERE phone = ?`,
    [...values, phone]
  );
}

module.exports = {
  upsertCustomer,
  getCustomerByPhone,
  updateCustomerState,
};
