const db = require("../config/db");

(async () => {
  const before = await db.all("SELECT id, name, allow_tts FROM tenants ORDER BY id");
  console.log("BEFORE:", before);

  const r = await db.run("UPDATE tenants SET allow_tts = 1 WHERE id = 1");
  console.log("UPDATE result:", r); // tem que aparecer changes: 1

  const after = await db.all("SELECT id, name, allow_tts FROM tenants ORDER BY id");
  console.log("AFTER:", after);

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
