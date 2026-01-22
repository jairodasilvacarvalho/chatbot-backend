import path from "path";
import express from "express";

const audioDir = process.env.TTS_AUDIO_DIR || "storage/audio";
app.use("/media/audio", express.static(path.resolve(audioDir)));


require("dotenv").config();

const express = require("express");
const cors = require("cors");

// ============================
// ✅ Boot logs
// ============================
console.log(">>> SERVER.JS CARREGADO <<<");
console.log("PID:", process.pid);

// ============================
// 🔌 Inicializa DB (migrações rodam ao importar)
// ============================
require("./config/db");

// ============================
// ⚙️ App / Env
// ============================
const app = express();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";

// ============================
// 🧱 Middlewares (sempre primeiro)
// ============================

/**
 * ✅ CORS
 * - Permite dashboard (3001) e o próprio backend (3000)
 * - Responde preflight automaticamente via app.options
 */
const allowedOrigins = new Set([
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

app.use(
  cors({
    origin(origin, cb) {
      // Permite chamadas sem Origin (ex: curl, Postman)
      if (!origin) return cb(null, true);
      if (allowedOrigins.has(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: false,
    allowedHeaders: ["Content-Type", "x-admin-key"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  })
);

// ✅ Preflight global (resolve CORS sem “gambi” por rota)
app.options(/.*/, cors());

// ✅ Body parser
app.use(express.json({ limit: "1mb" }));

// ✅ Log simples (útil pra debug; pode desligar depois)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ============================
// 🌐 Rotas públicas
// ============================

// Health check
app.get("/", (req, res) => {
  res.status(200).send("Servidor OK + Banco OK");
});

// Webhook (público)
const webhookRoutes = require("./routes/webhook");
app.use("/webhook", webhookRoutes);

// Mock incoming (público) — PASSO 3.1
// (crie routes/mock.js e descomente quando existir)
const mockRoutes = require("./routes/mock");
app.use("/mock", mockRoutes);

// ============================
// 🔐 Admin protegido
// ============================
const { adminAuth } = require("./middleware/adminAuth");
const adminRoutes = require("./routes/admin");

// Log específico do admin (após preflight global)
app.use("/admin", (req, res, next) => {
  console.log(">>> /admin REQUEST <<<", req.method, req.originalUrl);
  next();
});

app.use("/admin", adminAuth, adminRoutes);

// ============================
// ❌ 404 Handler (sempre no final)
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
// 💥 Error Handler global
// ============================
app.use((err, req, res, next) => {
  console.error("UNHANDLED_ERROR:", err);

  // Se for erro de CORS, retorna 403
  const isCorsError = String(err?.message || "").toLowerCase().includes("cors");
  const status = isCorsError ? 403 : 500;

  res.status(status).json({
    ok: false,
    error: isCorsError ? "CORS blocked" : "Internal server error",
    message: err?.message || "Unknown error",
  });
});

// ============================
// 🚀 Start + graceful shutdown
// ============================
  const server = app.listen(PORT, HOST, () => {
  const base = `http://${HOST}:${PORT}`;

  console.log(`Servidor rodando em ${base}`);
  console.log("Rotas públicas:");
  console.log(`- GET   ${base}/`);
  console.log(`- POST  ${base}/webhook`);
  console.log(`- GET   ${base}/webhook`);
  console.log(`- POST  ${base}/mock/incoming`);

  console.log("Admin endpoints (🔒 protegidos):");
  console.log(`- GET    ${base}/admin/customers`);
  console.log(`- GET    ${base}/admin/conversations/:phone`);
  console.log(`- GET    ${base}/admin/stats`);
  console.log(`- GET    ${base}/admin/kanban`);
  console.log(`- PATCH  ${base}/admin/customers/:phone/stage`);
  console.log(`- PATCH  ${base}/admin/kanban/order`);
});

function shutdown(signal) {
  console.log(`\nRecebido ${signal}. Encerrando servidor...`);
  server.close(() => {
    console.log("Servidor encerrado com sucesso.");
    process.exit(0);
  });

  // Se travar por algum motivo, força saída
  setTimeout(() => {
    console.log("Forçando encerramento (timeout).");
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
