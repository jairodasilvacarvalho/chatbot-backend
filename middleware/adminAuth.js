// middlewares/adminAuth.js
const jwt = require("jsonwebtoken");

function adminAuth(req, res, next) {
  // ✅ Nunca bloquear preflight CORS
  if (req.method === "OPTIONS") return next();

  const tenantId = Number(req.headers["x-tenant-id"] || 1);

  /* ======================
     1) JWT (prioritário)
  ====================== */
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, process.env.ADMIN_JWT_SECRET);

      // garante tenant correto
      if (payload.tenant_id !== tenantId) {
        return res.status(401).json({ ok: false, error: "invalid_tenant" });
      }

      req.admin = payload;
      return next();
    } catch (err) {
      return res.status(401).json({ ok: false, error: "invalid_token" });
    }
  }

  /* ======================
     2) x-admin-key (fallback)
  ====================== */
  const key = req.headers["x-admin-key"];
  const expected = process.env.ADMIN_API_KEY;

  if (!key || !expected || key !== expected) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  return next();
}

module.exports = { adminAuth };
