const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./database.sqlite');

db.all("SELECT * FROM admins", [], (err, rows) => {
  if (err) {
    console.error("Erro:", err.message);
    return;
  }

  console.log("ADMINS:");
  console.log(rows);
});

db.close();
