const db = require('./config/db');
db.run("UPDATE customers SET facts_json = '{}', stage = 'abertura' WHERE phone = '5511997000100'", () => {
  console.log('RESET OK');
});
