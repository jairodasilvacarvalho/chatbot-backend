const fs = require("fs");
const path = require("path");
const db = require("../config/db"); // ajuste se seu caminho for diferente

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Passe o caminho do .sql. Ex: node scripts/apply_sql.js sql/007_conversation_events.sql");

  const sqlPath = path.join(__dirname, "..", file);
  const sql = fs.readFileSync(sqlPath, "utf-8");

  await db.run(sql);
  console.log("OK: SQL aplicado ->", file);
  process.exit(0);
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
