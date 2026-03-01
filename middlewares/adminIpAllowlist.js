// middlewares/adminIpAllowlist.js
const TRUST_PROXY = true; // se usar Nginx/Cloudflare, deixe true

const ALLOWLIST = (process.env.ADMIN_IP_ALLOWLIST || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

module.exports = function adminIpAllowlist(req, res, next) {
  if (!ALLOWLIST.length) return next(); // se vazio, não bloqueia (dev)

  // pega IP real atrás de proxy
  const ip = TRUST_PROXY ? (req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip) : req.ip;

  if (ALLOWLIST.includes(ip)) return next();
  return res.status(403).json({ ok: false, error: "admin_ip_not_allowed" });
};
