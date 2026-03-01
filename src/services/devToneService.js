// src/services/devToneService.js
const db = require("../../config/db"); // ajuste o caminho se seu db estiver em outro local

async function getLatest(tenantId) {
  return db.get(
    `SELECT * FROM dev_tone
     WHERE tenant_id = ?
     ORDER BY version DESC
     LIMIT 1`,
    [tenantId]
  );
}

async function upsert(tenantId, version, rulesJson, examplesJson) {
  const rules = typeof rulesJson === "string" ? rulesJson : JSON.stringify(rulesJson ?? {});
  const examples = typeof examplesJson === "string" ? examplesJson : JSON.stringify(examplesJson ?? {});

  // UPSERT pelo índice único (tenant_id, version)
  await db.run(
    `INSERT INTO dev_tone (tenant_id, version, rules_json, examples_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(tenant_id, version)
     DO UPDATE SET
       rules_json = excluded.rules_json,
       examples_json = excluded.examples_json,
       updated_at = datetime('now')`,
    [tenantId, version, rules, examples]
  );

  return db.get(
    `SELECT * FROM dev_tone WHERE tenant_id = ? AND version = ?`,
    [tenantId, version]
  );
}

module.exports = {
  getLatest,
  upsert,
};
