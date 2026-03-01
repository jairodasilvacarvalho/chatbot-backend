const db = require("../config/db");

async function logEvent(tenantId, customerId, eventType, eventValue = null) {
  const sql = `
    INSERT INTO conversation_events (tenant_id, customer_id, event_type, event_value)
    VALUES (?, ?, ?, ?)
  `;
  return db.run(sql, [tenantId, customerId, eventType, eventValue]);
}

async function getLastEvents(tenantId, customerId, limit = 20) {
  const sql = `
    SELECT *
    FROM conversation_events
    WHERE tenant_id = ? AND customer_id = ?
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `;
  return db.all(sql, [tenantId, customerId, limit]);
}

async function countEvents(tenantId, customerId, eventType, minutesWindow = 60) {
  const sql = `
    SELECT COUNT(*) as total
    FROM conversation_events
    WHERE tenant_id = ?
      AND customer_id = ?
      AND event_type = ?
      AND datetime(created_at) >= datetime('now', ?)
  `;
  // ex: '-60 minutes'
  return db.get(sql, [tenantId, customerId, eventType, `-${minutesWindow} minutes`]);
}

module.exports = {
  logEvent,
  getLastEvents,
  countEvents,
};
