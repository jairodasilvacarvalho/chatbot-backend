require("dotenv").config();
const express = require("express");
const cors = require("cors");

console.log(">>> SERVER.JS CARREGADO (ADMIN AUTH ENABLED) <<<");
console.log("PID:", process.pid);

// ============================
// 🔌 Inicializa DB (migrações rodam ao importar)
// ============================
require("./config/db");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";

/* ============================
   🧱 Middlewares (sempre primeiro)
============================ */

// ✅ CORS (precisa vir antes das rotas)
app.use(
  cors({
    origin: [
      "http://localhost:3001",
      "http://127.0.0.1:3001",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ],
    allowedHeaders: ["Content-Type", "x-admin-key"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  })
);

app.use(express.json());

/* ============================
   🔓 Preflight OPTIONS (ANTES de qualquer /admin)
   - Isso resolve o CORS no navegador
============================ */
app.use("/admin", (req, res, next) => {
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

/* ============================
   🌐 Rotas públicas
============================ */

// Health check (público)
app.get("/", (req, res) => {
  res.status(200).send("Servidor OK + Banco OK");
});

// Webhook (público)
const webhookRoutes = require("./routes/webhook");
app.use("/webhook", webhookRoutes);

/* ============================
   🔐 Admin protegido
============================ */
const { adminAuth } = require("./middleware/adminAuth");
const adminRoutes = require("./routes/admin");

// Log simples para provar que requests /admin passam aqui
// (depois do OPTIONS, para não atrapalhar o preflight)
app.use("/admin", (req, res, next) => {
  console.log(">>> /admin REQUEST <<<", req.method, req.originalUrl);
  next();
});

// Protege e monta rotas admin
app.use("/admin", adminAuth, adminRoutes);

/* ============================
   ❌ 404 Handler (sempre no final)
============================ */
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Route not found",
    method: req.method,
    path: req.originalUrl,
  });
});

/* ============================
   💥 Error Handler global
============================ */
app.use((err, req, res, next) => {
  console.error("UNHANDLED_ERROR:", err);
  res.status(500).json({
    ok: false,
    error: "Internal server error",
    message: err?.message || "Unknown error",
  });
});

/* ============================
   🚀 Start
============================ */
app.listen(PORT, HOST, () => {
  const base = `http://${HOST}:${PORT}`;

  console.log(`Servidor rodando em ${base}`);
  console.log("Admin endpoints (🔒 protegidos):");
  console.log(`- GET    ${base}/admin/customers`);
  console.log(`- GET    ${base}/admin/conversations/:phone`);
  console.log(`- GET    ${base}/admin/stats`);
  console.log(`- GET    ${base}/admin/kanban`);
  console.log(`- PATCH  ${base}/admin/customers/:phone/stage`);
  console.log(`- PATCH  ${base}/admin/kanban/order`);
});
