const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./database.sqlite");
db.get(
  "SELECT phone, stage, json_extract(facts_json, '$.checkout.awaiting_channel') AS awaiting_channel, json_extract(facts_json, '$.checkout.channel') AS channel, json_extract(facts_json, '$.checkout.awaiting_affiliate_link') AS awaiting_affiliate_link, json_extract(facts_json, '$.checkout.affiliate_url') AS affiliate_url, json_extract(facts_json, '$.checkout.sent') AS sent FROM customers WHERE phone='5511999999999' AND tenant_id=1 ORDER BY id DESC LIMIT 1",
  (e, row) => {
    if (e) {
      console.error(e);
      process.exit(1);
    }
    console.log(JSON.stringify(row, null, 2));
    db.close();
  }
);
