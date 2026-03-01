// routes/adminLogin.js
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const loginRateLimit = require("../middlewares/loginRateLimit");

const router = express.Router();

/**
 * POST /admin/login
 * 🔐 NÃO usa JWT middleware
 * 🛡️ Rate limit: 5 tentativas -> bloqueia 10 min (por IP)
 */
router.post("/login", loginRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "missing_credentials" });
    }

    const emailOk = email === process.env.ADMIN_EMAIL;
    const hash = process.env.ADMIN_PASSWORD_HASH;

    if (!hash) {
      return res
        .status(500)
        .json({ ok: false, error: "admin_hash_not_configured" });
    }

    const passOk = await bcrypt.compare(password, hash);

    
    if (!emailOk || !passOk) {
      // ✅ conta tentativa apenas quando falha
      loginRateLimit.markFailed(req);
      return res.status(401).json({ ok: false, error: "invalid_credentials" });
    }

    const tenantId = Number(process.env.DEFAULT_TENANT_ID || 1);

    if (!process.env.JWT_SECRET) {
      return res
        .status(500)
        .json({ ok: false, error: "jwt_secret_not_configured" });
    }

    const token = jwt.sign(
      {
        sub: email,
        tenant_id: tenantId,
        role: "admin",
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "8h",
      }
    );

    return res.json({
      ok: true,
      data: {
        token,
        tenant_id: tenantId,
        role: "admin",
      },
    });
  } catch (err) {
    console.error("LOGIN_ERROR:", err);
    return res.status(500).json({ ok: false, error: "login_failed" });
  }
});

module.exports = router;