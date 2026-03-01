// middlewares/loginRateLimit.js
// Rate limit simples (memória) por IP: 5 tentativas em 10 min
// Em produção, troque por Redis/DB.

const WINDOW_MS = 10 * 60 * 1000; // 10 min
const MAX_ATTEMPTS = 5;

const store = new Map(); // key: ip -> { count, firstAt, blockedUntil }

function getIp(req) {
  // trust proxy já está setado no server.js
  return (
    req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
    req.ip ||
    req.connection?.remoteAddress ||
    "unknown"
  );
}

module.exports = function loginRateLimit(req, res, next) {
  const ip = getIp(req);
  const now = Date.now();

  const entry = store.get(ip) || { count: 0, firstAt: now, blockedUntil: 0 };

  // ainda bloqueado?
  if (entry.blockedUntil && now < entry.blockedUntil) {
    const retryAfterSec = Math.ceil((entry.blockedUntil - now) / 1000);
    res.setHeader("Retry-After", String(retryAfterSec));
    return res.status(429).json({
      ok: false,
      error: "too_many_attempts",
      retry_after_sec: retryAfterSec,
    });
  }

  // janela expirou? zera
  if (now - entry.firstAt > WINDOW_MS) {
    entry.count = 0;
    entry.firstAt = now;
    entry.blockedUntil = 0;
  }

  // deixa passar e só conta se falhar
  req._rl = { ip, entry }; // anexa para o handler usar
  store.set(ip, entry);

  return next();
};

// helper opcional pra marcar falha no login
module.exports.markFailed = function markFailed(req) {
  const rl = req._rl;
  if (!rl) return;

  const now = Date.now();
  const entry = rl.entry;

  entry.count += 1;

  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = now + WINDOW_MS; // bloqueia 10 min
  }
};