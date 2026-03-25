const { all } = require("./config/db");

(async () => {
  try {
    const rows = await all(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    console.log("TABELAS NO BANCO:");
    console.table(rows);
  } catch (err) {
    console.error("ERRO AO LISTAR TABELAS:", err);
  } finally {
    process.exit(0);
  }
})();
