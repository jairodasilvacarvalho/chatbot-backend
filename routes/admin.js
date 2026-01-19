// routes/admin.js
const express = require("express");
const router = express.Router();

console.log("ADMIN ROUTES LOADED - v6 (kanban order persistence)");

const { db, run } = require("../config/db");

const {
  getCustomers,
  getConversationByPhone,
  getAdminStats,
  updateCustomerStage,
} = require("../db/queries_admin");

// Helpers
function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// Stages permitidos (fonte única de verdade)
const ALLOWED_STAGES = ["abertura", "diagnostico", "oferta", "fechamento", "sem_stage"];
const ALLOWED_STAGE_SET = new Set(ALLOWED_STAGES);

function normalizeStage(stageRaw) {
  // "sem_stage" => NULL no banco
  return stageRaw === "sem_stage" ? null : stageRaw;
}

// ===============================
// GET /admin/customers
// Query params:
// - page (default 1)
// - limit (default 20, max 100)
// - stage (opcional)
// - q (opcional: busca por phone ou name)
// ===============================
router.get("/customers", async (req, res) => {
  try {
    const page = clamp(toInt(req.query.page, 1), 1, 1_000_000);
    const limit = clamp(toInt(req.query.limit, 20), 1, 100);
    const stage = (req.query.stage || "").trim() || null;
    const q = (req.query.q || "").trim() || null;

    const data = await getCustomers({ page, limit, stage, q });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Failed to list customers",
      message: err.message,
    });
  }
});

// =======================================
// GET /admin/conversations/:phone
// Query params (opcionais):
// - limit (default 500, max 2000)
// - offset (default 0)
// =======================================
router.get("/conversations/:phone", async (req, res) => {
  try {
    const phone = (req.params.phone || "").trim();
    const limit = clamp(toInt(req.query.limit, 500), 1, 2000);
    const offset = clamp(toInt(req.query.offset, 0), 0, 1_000_000);

    if (!phone) {
      return res.status(400).json({ ok: false, error: "phone is required" });
    }

    const data = await getConversationByPhone(phone, { limit, offset });

    if (!data.customer) {
      return res.status(404).json({
        ok: false,
        error: "Customer not found",
        phone,
      });
    }

    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Failed to fetch conversation",
      message: err.message,
    });
  }
});

// ===============================
// GET /admin/stats
// ===============================
router.get("/stats", async (req, res) => {
  try {
    const data = await getAdminStats();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Failed to fetch stats",
      message: err.message,
    });
  }
});

// ===============================
// GET /admin/kanban
// Query params (opcionais):
// - stages=abertura,diagnostico,oferta,fechamento  (lista de colunas)
// - limit (default 200, max 1000) (limite TOTAL retornado)
// ===============================
router.get("/kanban", async (req, res) => {
  try {
    const rawStages = (req.query.stages || "").trim();
    const limit = clamp(toInt(req.query.limit, 200), 1, 1000);

    const stages = rawStages
      ? rawStages.split(",").map((s) => s.trim()).filter(Boolean)
      : ["abertura", "diagnostico", "oferta", "fechamento"];

    // Pool para o MVP
    const pool = await getCustomers({ page: 1, limit, stage: null, q: null });

    const board = {};
    for (const s of stages) board[s] = [];
    board.sem_stage = [];

    for (const c of pool.items) {
      const st = (c.stage || "").trim();
      if (st && board[st]) board[st].push(c);
      else board.sem_stage.push(c);
    }

    // ✅ Ordena cada coluna por kanban_order (nulos por último) + fallback
    function sortKanban(a, b) {
      const aNull = a.kanban_order == null ? 1 : 0;
      const bNull = b.kanban_order == null ? 1 : 0;
      if (aNull !== bNull) return aNull - bNull;

      const ao = a.kanban_order == null ? 0 : Number(a.kanban_order);
      const bo = b.kanban_order == null ? 0 : Number(b.kanban_order);
      if (ao !== bo) return ao - bo;

      // fallback: mais recente primeiro
      const al = a.last_seen_at || a.created_at || "";
      const bl = b.last_seen_at || b.created_at || "";
      return String(bl).localeCompare(String(al));
    }

    for (const k of Object.keys(board)) {
      board[k].sort(sortKanban);
    }

    res.json({
      ok: true,
      data: {
        stages,
        limit,
        counts: Object.fromEntries(
          Object.entries(board).map(([k, v]) => [k, v.length])
        ),
        board,
      },
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Failed to fetch kanban data",
      message: err.message,
    });
  }
});

// ===============================
// PATCH /admin/customers/:phone/stage
// Body JSON: { "stage": "diagnostico" }
// Regras:
// - stage deve estar em ALLOWED_STAGES
// - "sem_stage" vira NULL no banco
// ===============================
router.patch("/customers/:phone/stage", async (req, res) => {
  try {
    const phone = (req.params.phone || "").trim();
    const stageRaw =
      typeof req.body?.stage === "string" ? req.body.stage.trim() : "";

    if (!phone) {
      return res.status(400).json({ ok: false, error: "phone is required" });
    }

    if (!stageRaw) {
      return res.status(400).json({ ok: false, error: "stage is required" });
    }

    if (!ALLOWED_STAGE_SET.has(stageRaw)) {
      return res.status(400).json({
        ok: false,
        error: "invalid stage",
        allowed: ALLOWED_STAGES,
        received: stageRaw,
      });
    }

    const stageToSave = normalizeStage(stageRaw);

    const result = await updateCustomerStage(phone, stageToSave);

    if (!result.updated) {
      return res.status(404).json({ ok: false, error: "Customer not found", phone });
    }

    res.json({
      ok: true,
      data: {
        phone,
        stage: stageToSave ?? "sem_stage",
        updated: result.updated,
      },
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Failed to update stage",
      message: err.message,
    });
  }
});

// ===============================
// PATCH /admin/kanban/order
// Body JSON:
// {
//   "stage": "diagnostico" | "sem_stage" | ...,
//   "phones": ["5511...", "5511..."]
// }
//
// Regras:
// - stage deve estar em ALLOWED_STAGES
// - "sem_stage" vira NULL no banco
// - salva kanban_order sequencial (0..n-1)
// - transação (rollback se algum phone não existir)
// ===============================
router.patch("/kanban/order", async (req, res) => {
  try {
    const stageRaw = typeof req.body?.stage === "string" ? req.body.stage.trim() : "";
    const phones = req.body?.phones;

    if (!stageRaw) {
      return res.status(400).json({ ok: false, error: "stage is required" });
    }
    if (!ALLOWED_STAGE_SET.has(stageRaw)) {
      return res.status(400).json({
        ok: false,
        error: "invalid stage",
        allowed: ALLOWED_STAGES,
        received: stageRaw,
      });
    }
    if (!Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({ ok: false, error: "phones must be a non-empty array" });
    }

    const stageToSave = normalizeStage(stageRaw);

    // Sanitiza phones (trim + remove vazios)
    const cleaned = phones
      .map((p) => (typeof p === "string" ? p.trim() : ""))
      .filter(Boolean);

    if (cleaned.length === 0) {
      return res.status(400).json({ ok: false, error: "phones must contain valid phone strings" });
    }

    await run("BEGIN TRANSACTION");

    for (let i = 0; i < cleaned.length; i++) {
      const phone = cleaned[i];

      const r = await run(
        `
        UPDATE customers
        SET stage = ?, kanban_order = ?
        WHERE phone = ?
        `,
        [stageToSave, i, phone]
      );

      if (!r.changes) {
        throw new Error(`Customer not found: ${phone}`);
      }
    }

    await run("COMMIT");

    res.json({
      ok: true,
      data: {
        stage: stageToSave ?? "sem_stage",
        count: cleaned.length,
      },
    });
  } catch (err) {
    try {
      await run("ROLLBACK");
    } catch (_) {}

    res.status(500).json({
      ok: false,
      error: "Failed to persist kanban order",
      message: err.message,
    });
  }
});

module.exports = router;
