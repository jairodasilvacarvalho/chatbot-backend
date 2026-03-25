const db = require("../config/db");

(async () => {
  const rows = await db.all(`
    SELECT id, name, slug, allow_tts
    FROM tenants
    ORDER BY id
  `);

  console.log(rows);
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
