const db = require("../config/db");

(async () => {
  const rows = await db.all(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name='conversation_events'"
  );

  if (!rows || rows.length === 0) {
    console.log("NÃO encontrou a tabela conversation_events.");
    process.exit(1);
  }

  console.log("OK: tabela encontrada!");
  console.log(rows[0].sql);
  process.exit(0);
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
