const db = require("./config/db");

(async () => {
  try {
    await db.run(
      "UPDATE customers SET facts_json=?, stage=? WHERE tenant_id=? AND phone=?",
      ["{}", "abertura", 1, "5511999999999"]
    );
    console.log("✅ Cliente resetado com sucesso");
  } catch (err) {
    console.error("❌ Erro:", err.message);
  } finally {
    process.exit(0);
  }
})();