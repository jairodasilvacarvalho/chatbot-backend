// routes/adminProductsPlaybook.js
const express = require("express");
const router = express.Router();

/**
 * Helpers
 */
function normalizeProductKey(pk) {
  return String(pk || "DEFAULT").trim().toUpperCase();
}

function safeJsonParse(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value; // já é objeto
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function safeJsonStringify(obj) {
  // garante string JSON sempre
  return JSON.stringify(obj ?? null);
}

/**
 * GET /admin/products/:product_key/playbook
 * Retorna o playbook do produto (por tenant)
 */
router.get("/products/:product_key/playbook", async (req, res) => {
  try {
    const tenant_id = Number(req.headers["x-tenant-id"] || 0);
    if (!tenant_id) return res.status(400).json({ ok: false, error: "Missing x-tenant-id" });

    const product_key = normalizeProductKey(req.params.product_key);

    const db = req.app.locals.db;
    const row = await db.get(
      `SELECT tenant_id, product_key, pitch_by_stage, rules_json, objections_json, policies_json
         FROM product_playbooks
        WHERE tenant_id = ?
          AND product_key = ?
        LIMIT 1`,
      [tenant_id, product_key]
    );

    if (!row) {
      // retorna shape padrão pra UI já abrir preenchível
      return res.json({
        ok: true,
        data: {
          tenant_id,
          product_key,
          pitch_by_stage: { abertura: "", diagnostico: "", oferta: "", fechamento: "" },
          rules_json: {},
          objections_json: {},
          policies_json: {},
          exists: false,
        },
      });
    }

    return res.json({
      ok: true,
      data: {
        tenant_id: row.tenant_id,
        product_key: row.product_key,
        pitch_by_stage: safeJsonParse(row.pitch_by_stage, { abertura: "", diagnostico: "", oferta: "", fechamento: "" }),
        rules_json: safeJsonParse(row.rules_json, {}),
        objections_json: safeJsonParse(row.objections_json, {}),
        policies_json: safeJsonParse(row.policies_json, {}),
        exists: true,
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * PUT /admin/products/:product_key/playbook
 * Salva (UPSERT) o playbook do produto (por tenant) - MERGE SAFE
 */
router.put("/products/:product_key/playbook", async (req, res) => {
  try {
    const tenant_id = Number(req.headers["x-tenant-id"] || 0);
    if (!tenant_id) {
      return res.status(400).json({ ok: false, error: "Missing x-tenant-id" });
    }

    const product_key = normalizeProductKey(req.params.product_key);
    const body = req.body || {};
    const db = req.app.locals.db;

    // Lê registro atual (para não apagar campos)
    const current = await db.get(
      `SELECT pitch_by_stage, rules_json, objections_json, policies_json
         FROM product_playbooks
        WHERE tenant_id = ?
          AND product_key = ?
        LIMIT 1`,
      [tenant_id, product_key]
    );

    const currentPitch = safeJsonParse(current?.pitch_by_stage, {});
    const currentRules = safeJsonParse(current?.rules_json, {});
    const currentObj   = safeJsonParse(current?.objections_json, {});
    const currentPol   = safeJsonParse(current?.policies_json, {});

    // Merge inteligente
    const nextPitch = body.pitch_by_stage ?? currentPitch;
    const nextRules = body.rules_json ?? currentRules;
    const nextObj   = body.objections_json ?? currentObj;
    const nextPol   = body.policies_json ?? currentPol;

    await db.run(
      `INSERT INTO product_playbooks (
         tenant_id, product_key, pitch_by_stage, rules_json, objections_json, policies_json
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, product_key) DO UPDATE SET
         pitch_by_stage = excluded.pitch_by_stage,
         rules_json = excluded.rules_json,
         objections_json = excluded.objections_json,
         policies_json = excluded.policies_json`,
      [
        tenant_id,
        product_key,
        safeJsonStringify(nextPitch),
        safeJsonStringify(nextRules),
        safeJsonStringify(nextObj),
        safeJsonStringify(nextPol),
      ]
    );

    return res.json({ ok: true, saved: true, tenant_id, product_key });

  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

module.exports = router;