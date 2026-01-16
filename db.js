const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./database.sqlite");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE,
      name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_phone TEXT,
      direction TEXT,
      text TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
});

function upsertCustomer({ phone, name }) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      INSERT INTO customers (phone, name)
      VALUES (?, ?)
      ON CONFLICT(phone) DO UPDATE SET
        name = COALESCE(excluded.name, customers.name),
        last_seen_at = datetime('now')
      `,
      [phone, name || null],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

function saveMessage({ customer_phone, direction, text }) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      INSERT INTO messages (customer_phone, direction, text)
      VALUES (?, ?, ?)
      `,
      [customer_phone, direction, text],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

module.exports = { upsertCustomer, saveMessage };
