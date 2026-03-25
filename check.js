const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./database.sqlite");

const sql = `
SELECT 
  json_extract(facts_json,'$.checkout.llm_class_last_key') AS lastKey,
  json_extract(facts_json,'$.checkout.awaiting_cep') AS awaitingCep,
  json_extract(facts_json,'$.checkout.awaiting_channel') AS awaitingChannel,
  json_extract(facts_json,'$.checkout.cep') AS cep,
  json_extract(facts_json,'$.checkout.channel') AS channel
FROM customers
WHERE tenant_id = 1
AND phone = '5511993333333'
`;

db.get(sql, (err, row) => {
  if (err) {
    console.error(err);
  } else {
    console.log(row);
  }
  db.close();
});