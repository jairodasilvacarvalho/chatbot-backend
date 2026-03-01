const crypto = require("crypto");

module.exports = function verifyMetaSignature(req, res, next) {
  const sig = req.headers["x-hub-signature-256"];
  if (!sig) return res.status(401).json({ ok:false, error:"missing_signature" });

  const secret = process.env.META_APP_SECRET;
  if (!secret) return res.status(500).json({ ok:false, error:"missing_meta_app_secret" });

  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(req.body) // Buffer raw
    .digest("hex");

  if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return next();
  return res.status(401).json({ ok:false, error:"invalid_signature" });
};
