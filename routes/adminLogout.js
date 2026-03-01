// routes/adminLogout.js
const express = require("express");
const router = express.Router();

// POST /admin/logout
router.post("/logout", (req, res) => {
  // Stateless: o servidor não “mata” token JWT sem blacklist.
  // Logout real é no cliente: limpar token e sair.
  return res.json({ ok: true, data: { logged_out: true } });
});

module.exports = router;