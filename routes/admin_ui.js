// routes/admin_ui.js
const path = require("path");
const express = require("express");
const router = express.Router();

// Serve a UI estática do admin
router.get("/", (req, res) => {
  return res.sendFile(path.join(__dirname, "..", "public", "admin", "index.html"));
});

module.exports = router;
