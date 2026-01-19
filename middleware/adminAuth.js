function adminAuth(req, res, next) {
  // ✅ Nunca bloquear preflight CORS
  if (req.method === "OPTIONS") return next();

  const key = req.headers["x-admin-key"];
  const expected = process.env.ADMIN_API_KEY;

  if (!key || key !== expected) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  next();
}

module.exports = { adminAuth };
