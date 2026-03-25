const { all } = require("./config/db");

(async () => {
  try {
    const cols = await all("PRAGMA table_info(tenants)");
    console.log("COLUNAS tenants:");
    console.table(cols);

    const sample = await all("SELECT * FROM tenants LIMIT 5");
    console.log("AMOSTRA tenants:");
    console.table(sample);
  } catch (err) {
    console.error("ERRO:", err);
  } finally {
    process.exit(0);
  }
})();
