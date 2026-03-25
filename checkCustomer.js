const db = require("./config/db");

(async () => {
  try {
    const rows = await db.all(
      "SELECT id, tenant_id, phone, stage FROM customers WHERE tenant_id = ? AND phone = ? LIMIT 5",
      [1, "5511997776666"]
    );
    console.log(rows);
  } catch (e) {
    console.error("ERRO:", e);
  } finally {
    process.exit(0);
  }
})();