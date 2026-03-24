const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./database.sqlite");
db.get(
  "SELECT id, phone, stage, facts_json FROM customers WHERE tenant_id = 1 AND phone = '5511997777777' ORDER BY id DESC LIMIT 1",
  (err, row) => {
    if (err) console.error(err);
    else console.log(JSON.stringify(row, null, 2));
    db.close();
  }
);
