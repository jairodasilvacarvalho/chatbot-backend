// middlewares/adminJwt.js

const jwt = require("jsonwebtoken");
const { jwtSecret } = require("../config/jwt");

function adminJwt(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const [type, token] = authHeader.split(" ");

    if (type !== "Bearer" || !token) {
      return res.status(401).json({
        ok: false,
        error: "missing_bearer_token",
      });
    }

    const payload = jwt.verify(token, jwtSecret);

    // 🔐 Injeta admin autenticado
    req.admin = {
      sub: payload.sub,
      tenant_id: payload.tenant_id,
      role: payload.role,
    };

    return next();
  } catch (err) {
    return res.status(401).json({
      ok: false,
      error: "invalid_or_expired_token",
    });
  }
}

module.exports = adminJwt;
