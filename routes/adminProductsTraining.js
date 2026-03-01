// routes/adminProductsTraining.js

const express = require("express");
const router = express.Router();
const db = require("../config/db");

// ============================
// Helpers
// ============================
function safeParse(v) {
  try {
    return v ? JSON.parse(v) : {};
  } catch {
    return {};
  }
}

function requireAdmin(req, res) {
  if (!req.admin || !req.admin.tenant_id) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

// ============================
// GET TRAINING
// ============================
router.get("/products/:product_key/training", async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const tenant_id = req.admin.tenant_id;
    const { product_key } = req.params;

    const row = await db.get(
      "SELECT data_json FROM products WHERE tenant_id = ? AND product_key = ?",
      [tenant_id, product_key]
    );

    if (!row) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const data = safeParse(row.data_json);
    const training = data.human_training || null;

    // ✅ formato recomendado + compatibilidade
    return res.json({
      ok: true,
      data: { training },
      training,
    });
  } catch (err) {
    console.error("TRAINING_GET_ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: "internal_server_error",
    });
  }
});

// ============================
// SAVE TRAINING
// Aceita:
// 1) { training: {...} }
// 2) { persona, tone, objective, objections_strategy, cta_style, ... }
// ============================
router.post("/products/:product_key/training", async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const tenant_id = req.admin.tenant_id;
    const { product_key } = req.params;

    // ✅ compat: se vier {training:{...}} usa; senão usa body inteiro como training
    const incoming = req.body || {};
    const training = isPlainObject(incoming.training) ? incoming.training : incoming;
    
    /// ✅ opcional: product_intelligence (mas não é parte do training, é só info extra)
    const product_intelligence =
  incoming &&
  incoming.product_intelligence &&
  typeof incoming.product_intelligence === "object" &&
  !Array.isArray(incoming.product_intelligence)
    ? incoming.product_intelligence
    : null;

    if (!isPlainObject(training)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_training",
      });
    }

    const row = await db.get(
      "SELECT data_json FROM products WHERE tenant_id = ? AND product_key = ?",
      [tenant_id, product_key]
    );

    if (!row) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const data = safeParse(row.data_json);
    data.human_training = training;
if (product_intelligence) data.product_intelligence = product_intelligence;

    await db.run(
      "UPDATE products SET data_json = ? WHERE tenant_id = ? AND product_key = ?",
      [JSON.stringify(data), tenant_id, product_key]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("TRAINING_SAVE_ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: "internal_server_error",
    });
  }
});

// ============================
// RESET TRAINING
// ============================
router.post("/products/:product_key/training/reset", async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const tenant_id = req.admin.tenant_id;
    const { product_key } = req.params;

    const row = await db.get(
      "SELECT data_json FROM products WHERE tenant_id = ? AND product_key = ?",
      [tenant_id, product_key]
    );

    if (!row) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const data = safeParse(row.data_json);
    delete data.human_training;

    await db.run(
      "UPDATE products SET data_json = ? WHERE tenant_id = ? AND product_key = ?",
      [JSON.stringify(data), tenant_id, product_key]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("TRAINING_RESET_ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: "internal_server_error",
    });
  }
});

module.exports = router;
