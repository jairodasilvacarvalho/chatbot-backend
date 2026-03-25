// server.js — versão estável e limpa

require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");

console.log(">>> SERVER.JS INICIADO <<<");
console.log("PID:", process.pid);
console.log("NODE_ENV:", process.env.NODE_ENV || "development");
console.log("WHATSAPP_MODE:", process.env.WHATSAPP_MODE || "mock");

const app = express();
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "127.0.0.1";

app.set("trust proxy", 1);

// ============================
// 🔌 DB
// ============================
const { attachDbToApp } = require("./config/db");
attachDbToApp(app);

// ============================
// 🧱 CORS
// ============================
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error("CORS blocked"));
    },
    allowedHeaders: ["Content-Type", "Authorization", "x-tenant-id"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  })
);

app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ============================
// 🧾 LOGS
// ============================
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ============================
// 🔊 STATIC ÁUDIO
// ============================
const audioDir = process.env.TTS_AUDIO_DIR || "storage/audio";
app.use("/media/audio", express.static(path.resolve(audioDir)));

// ============================
// 🌐 WEBHOOK REAL (RAW BODY)
// ============================
const verifyMetaSignature = require("./middlewares/verifyMetaSignature");
const webhookHandler = require("./routes/webhook");

app.use(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    if (req.method === "POST") return verifyMetaSignature(req, res, next);
    next();
  },
  webhookHandler
);

// ============================
// 🧪 JSON
// ============================
app.use(express.json({ limit: "1mb" }));

// ============================
// 🧪 SIMULATOR (usa tenantMiddleware)
// ============================
const tenantMiddleware = require("./middlewares/tenant");
const simulatorRoutes = require("./routes/simulator");

app.use("/simulator", tenantMiddleware, simulatorRoutes);

// ============================
// 🏠 HEALTH
// ============================
app.get("/", (req, res) => {
  res.status(200).send("Servidor OK");
});

// ============================
// 🖥️ ADMIN UI (estático)
// ============================
app.use("/admin", express.static(path.join(__dirname, "public", "admin")));

// ============================
// 🔐 ADMIN LOGIN (SEM JWT)
// ============================
const adminLoginRoutes = require("./routes/adminLogin");
app.use("/admin", adminLoginRoutes);

// ============================
// 🔐 ADMIN JWT (PROTEGE TUDO ABAIXO)
// ============================
const adminJwt = require("./middlewares/adminJwt");

app.use("/admin", (req, res, next) => {
  if (req.path === "/login") return next();
  return adminJwt(req, res, next);
});

// ============================
// 📊 ADMIN METRICS (NOVO)
// ============================
const adminMetricsRoutes = require("./routes/adminMetrics");
app.use("/admin/metrics", adminMetricsRoutes);

// ============================
// 🔐 ROTAS ADMIN (JWT apenas)
// ============================
const adminRoutes = require("./routes/admin");
const adminTrainingRoutes = require("./routes/adminTraining");
const adminCustomerResetRoutes = require("./routes/adminCustomerReset");
const adminProductsTraining = require("./routes/adminProductsTraining");
const productWizardRoutes = require("./routes/admin/productWizard");
const adminLogoutRoutes = require("./routes/adminLogout");
const adminProductsPlaybookRoutes = require("./routes/adminProductsPlaybook");

// ⚠️ Playbook antes do adminRoutes
app.use("/admin", adminProductsPlaybookRoutes);

app.use("/admin", adminTrainingRoutes);
app.use("/admin", adminCustomerResetRoutes);
app.use("/admin", adminProductsTraining);
app.use("/admin/product-wizard", productWizardRoutes);

// adminRoutes por último
app.use("/admin", adminRoutes);

app.use("/admin", adminLogoutRoutes);

console.log("✅ adminProductsPlaybookRoutes mounted at /admin");

// ============================
// ❌ 404
// ============================
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Route not found",
    method: req.method,
    path: req.originalUrl,
  });
});

// ============================
// 💥 ERROR HANDLER
// ============================
app.use((err, req, res, next) => {
  console.error("UNHANDLED_ERROR:", err);
  const isCors = String(err.message || "").toLowerCase().includes("cors");
  res.status(isCors ? 403 : 500).json({
    ok: false,
    error: isCors ? "CORS blocked" : "Internal server error",
  });
});

// ============================
// 🚀 START
// ============================
const server = app.listen(PORT, HOST, () => {
  console.log(`Servidor rodando em http://${HOST}:${PORT}`);
});

// ============================
// 🛑 SHUTDOWN
// ============================
function shutdown(signal) {
  console.log(`Encerrando (${signal})...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT_EXCEPTION:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED_REJECTION:", reason);
  process.exit(1);
});