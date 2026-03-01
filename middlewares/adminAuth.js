// middlewares/adminAuth.js
// ✅ JWT-only (x-admin-key REMOVIDO)
// Motivo: fase JWT concluída + rate limit + bcrypt já ativos.
// Mantém compatibilidade com rotas que ainda fazem `require("./adminAuth")`.

const jwt = require("jsonwebtoken");

function adminAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) {
      return res.status(401).json({ ok: false, error: "missing_token" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res
        .status(500)
        .json({ ok: false, error: "jwt_secret_not_configured" });
    }

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch (e) {
      return res.status(401).json({ ok: false, error: "invalid_or_expired_token" });
    }

    // valida payload mínimo
    if (!payload || !payload.tenant_id || !payload.role) {
      return res.status(401).json({ ok: false, error: "invalid_token_payload" });
    }

    // anexa infos do admin
    req.admin = {
      sub: payload.sub,
      tenant_id: Number(payload.tenant_id),
      role: payload.role,
    };

    return next();
  } catch (err) {
    console.error("ADMIN_AUTH_ERROR:", err);
    return res.status(500).json({ ok: false, error: "internal_admin_auth_error" });
  }
}

module.exports = adminAuth;