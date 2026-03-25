const { get } = require("./config/db");

(async () => {
  try {
    const row = await get(
      "SELECT phone, stage, facts_json, last_seen_at FROM customers WHERE phone='5511999999999'"
    );

    console.log("=== CUSTOMER ===");
    console.log(row);
  } catch (err) {
    console.error("ERROR:", err);
  } finally {
    process.exit(0);
  }
})();