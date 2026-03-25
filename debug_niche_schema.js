const { all } = require("./config/db");

(async () => {
  try {
    const tables = await all(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    console.log("TABELAS:");
    console.table(tables);

    const cols = await all("PRAGMA table_info(niche_profiles)");
    console.log("COLUNAS niche_profiles:");
    console.table(cols);

    const sample = await all("SELECT * FROM niche_profiles LIMIT 5");
    console.log("AMOSTRA niche_profiles:");
    console.table(sample);
  } catch (err) {
    console.error("ERRO DEBUG:", err);
  } finally {
    process.exit(0);
  }
})();
