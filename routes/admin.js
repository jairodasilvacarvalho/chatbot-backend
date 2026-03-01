// routes/admin.js
const adminCustomersRoutes = require("./admin/customers");

const express = require("express");
const router = express.Router();

console.log("ADMIN ROUTES LOADED - v8 (tenant dynamic)");

// ✅ use UMA única instância de DB
const db = require("../config/db");
const { run } = db;

// ✅ IMPORT CORRETO (sua pasta é "middlewares", não "middleware")
const adminAuth = require("../middlewares/adminAuth");

// ✅ ✅ NOVO (PASSO B5): rota para setar product_key por cliente
// Crie o arquivo: routes/admin/customers.js

// ✅ models (IMPORT UMA VEZ SÓ)
const { createTenant, listTenants } = require("../models/tenants");
const { createNicheProfile, listNicheProfiles } = require("../models/nicheProfiles");
const { createProductProfile, listProductProfiles } = require("../models/productProfiles");

// queries antigas do seu dashboard/admin
const {
  getCustomers,
  getConversationByPhone,
  getAdminStats,
  updateCustomerStage,
} = require("../db/queries_admin");

// ===============================
// Helpers
// ===============================
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
// ✅ PASSO B5 (NOVO)
// Sub-rotas de customers (admin-only)
// Ex.: POST /admin/customers/:phone/product
// ===============================
router.use("/customers", adminAuth, adminCustomersRoutes);

// ===============================
// GET /admin/customers
// ===============================
router.get("/customers", adminAuth, async (req, res) => {
  try {
    const page = clamp(toInt(req.query.page, 1), 1, 1_000_000);
    const limit = clamp(toInt(req.query.limit, 20), 1, 100);
    const stage = (req.query.stage || "").trim() || null;
    const q = (req.query.q || "").trim() || null;

    const data = await getCustomers({
      tenant_id: req.tenant_id,
      page,
      limit,
      stage,
      q,
    });

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("[admin][customers][list]", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to list customers",
      message: err.message,
    });
  }
});

// ===============================
// GET /admin/conversations/:phone
// ===============================
router.get("/conversations/:phone", adminAuth, async (req, res) => {
  try {
    const phone = (req.params.phone || "").trim();
    const limit = clamp(toInt(req.query.limit, 500), 1, 2000);
    const offset = clamp(toInt(req.query.offset, 0), 0, 1_000_000);

    if (!phone) {
      return res.status(400).json({ ok: false, error: "phone is required" });
    }

    const data = await getConversationByPhone(phone, {
      tenant_id: req.tenant_id,
      limit,
      offset,
    });

    if (!data.customer) {
      return res.status(404).json({ ok: false, error: "Customer not found", phone });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("[admin][conversations][get]", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to fetch conversation",
      message: err.message,
    });
  }
});

// ===============================
// GET /admin/stats
// ===============================
router.get("/stats", adminAuth, async (req, res) => {
  try {
    const data = await getAdminStats({ tenant_id: req.tenant_id });
    return res.json({ ok: true, data });
  } catch (err) {
    console.error("[admin][stats][get]", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to fetch stats",
      message: err.message,
    });
  }
});

// ===============================
// GET /admin/kanban
// ===============================
router.get("/kanban", adminAuth, async (req, res) => {
  try {
    const rawStages = (req.query.stages || "").trim();
    const limit = clamp(toInt(req.query.limit, 200), 1, 1000);

    const stages = rawStages
      ? rawStages.split(",").map((s) => s.trim()).filter(Boolean)
      : ["abertura", "diagnostico", "oferta", "fechamento"];

    const pool = await getCustomers({
      tenant_id: req.tenant_id,
      page: 1,
      limit,
      stage: null,
      q: null,
    });

    const board = {};
    for (const s of stages) board[s] = [];
    board.sem_stage = [];

    for (const c of pool.items) {
      const st = (c.stage || "").trim();
      if (st && board[st]) board[st].push(c);
      else board.sem_stage.push(c);
    }

    function sortKanban(a, b) {
      const aNull = a.kanban_order == null ? 1 : 0;
      const bNull = b.kanban_order == null ? 1 : 0;
      if (aNull !== bNull) return aNull - bNull;

      const ao = a.kanban_order == null ? 0 : Number(a.kanban_order);
      const bo = b.kanban_order == null ? 0 : Number(b.kanban_order);
      if (ao !== bo) return ao - bo;

      const al = a.last_seen_at || a.created_at || "";
      const bl = b.last_seen_at || b.created_at || "";
      return String(bl).localeCompare(String(al));
    }

    for (const k of Object.keys(board)) board[k].sort(sortKanban);

    return res.json({
      ok: true,
      data: {
        stages,
        limit,
        counts: Object.fromEntries(Object.entries(board).map(([k, v]) => [k, v.length])),
        board,
      },
    });
  } catch (err) {
    console.error("[admin][kanban][get]", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to fetch kanban data",
      message: err.message,
    });
  }
});

// ===============================
// PATCH /admin/customers/:phone/stage
// ===============================
router.patch("/customers/:phone/stage", adminAuth, async (req, res) => {
  try {
    const phone = (req.params.phone || "").trim();
    const stageRaw = typeof req.body?.stage === "string" ? req.body.stage.trim() : "";

    if (!phone) return res.status(400).json({ ok: false, error: "phone is required" });
    if (!stageRaw) return res.status(400).json({ ok: false, error: "stage is required" });

    if (!ALLOWED_STAGE_SET.has(stageRaw)) {
      return res.status(400).json({
        ok: false,
        error: "invalid stage",
        allowed: ALLOWED_STAGES,
        received: stageRaw,
      });
    }

    const stageToSave = normalizeStage(stageRaw);

    const result = await updateCustomerStage({
      tenant_id: req.tenant_id,
      phone,
      stage: stageToSave,
    });

    if (!result.updated) {
      return res.status(404).json({ ok: false, error: "Customer not found", phone });
    }

    return res.json({
      ok: true,
      data: { phone, stage: stageToSave ?? "sem_stage", updated: result.updated },
    });
  } catch (err) {
    console.error("[admin][customers][stage]", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to update stage",
      message: err.message,
    });
  }
});

// ===============================
// PATCH /admin/kanban/order
// ===============================
router.patch("/kanban/order", adminAuth, async (req, res) => {
  try {
    const stageRaw = typeof req.body?.stage === "string" ? req.body.stage.trim() : "";
    const phones = req.body?.phones;

    if (!stageRaw) return res.status(400).json({ ok: false, error: "stage is required" });
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
    const cleaned = phones.map((p) => (typeof p === "string" ? p.trim() : "")).filter(Boolean);
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
        WHERE tenant_id = ? AND phone = ?
        `,
        [stageToSave, i, req.tenant_id, phone]
      );

      if (!r.changes) throw new Error(`Customer not found: ${phone}`);
    }

    await run("COMMIT");

    return res.json({
      ok: true,
      data: { stage: stageToSave ?? "sem_stage", count: cleaned.length },
    });
  } catch (err) {
    try {
      await run("ROLLBACK");
    } catch (_) {}

    console.error("[admin][kanban][order]", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to persist kanban order",
      message: err.message,
    });
  }
});

// ===============================
// Tenants (admin-only)
// ===============================
router.get("/tenants", adminAuth, async (_req, res) => {
  try {
    const tenants = await listTenants(db);
    return res.json({ ok: true, tenants });
  } catch (err) {
    console.error("[admin][tenants][list]", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.post("/tenants", adminAuth, async (req, res) => {
  try {
    const tenant = await createTenant(db, req.body);
    return res.status(201).json({ ok: true, tenant });
  } catch (err) {
    const status = err.status || 500;
    const error = err.message || "internal_error";
    if (status >= 500) console.error("[admin][tenants][create]", err);
    return res.status(status).json({ ok: false, error });
  }
});

// ===============================
// Niche Profiles (por-tenant)
// ===============================
router.get("/niche-profiles", adminAuth, async (req, res) => {
  try {
    const data = await listNicheProfiles(db, req.tenant_id);
    return res.json({ ok: true, data });
  } catch (err) {
    console.error("[admin][niche][list]", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.post("/niche-profiles", adminAuth, async (req, res) => {
  try {
    const profile = await createNicheProfile(db, { ...req.body, tenant_id: req.tenant_id });
    return res.status(201).json({ ok: true, profile });
  } catch (err) {
    const status = err.status || 500;
    const error = err.message || "internal_error";
    if (status >= 500) console.error("[admin][niche][create]", err);
    return res.status(status).json({ ok: false, error });
  }
});

// ===============================
// Product Profiles (por-tenant)
// ===============================
router.get("/product-profiles", adminAuth, async (req, res) => {
  try {
    const data = await listProductProfiles(db, req.tenant_id);
    return res.json({ ok: true, data });
  } catch (err) {
    console.error("[admin][product][list]", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.post("/product-profiles", adminAuth, async (req, res) => {
  try {
    const profile = await createProductProfile(db, { ...req.body, tenant_id: req.tenant_id });
    return res.status(201).json({ ok: true, profile });
  } catch (err) {
    const status = err.status || 500;
    const error = err.message || "internal_error";
    if (status >= 500) console.error("[admin][product][create]", err);
    return res.status(status).json({ ok: false, error });
  }
});

module.exports = router;
