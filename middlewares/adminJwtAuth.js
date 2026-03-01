const jwt = require("jsonwebtoken");

module.exports = function adminJwtAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok:false, error:"missing_token" });

  try {
    const payload = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
    req.admin = payload;
    return next();
  } catch {
    return res.status(401).json({ ok:false, error:"invalid_token" });
  }
};
