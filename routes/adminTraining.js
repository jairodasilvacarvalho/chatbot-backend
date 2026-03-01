// routes/adminTraining.js
const express = require("express");

// ✅ Como este arquivo está em /routes, sobe 1 nível -> /src
const devToneService = require("../src/services/devToneService");
const productPlaybookService = require("../src/services/productPlaybookService");

const router = express.Router();

/* ======================
   Helpers
====================== */
function getTenantId(req) {
  const raw = req.tenant_id ?? req.tenantId ?? req.headers["x-tenant-id"] ?? 1;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function badRequest(res, error, message) {
  return res.status(400).json({ ok: false, error, message: message || error });
}

/* ======================
   DEV TONE
   GET  /admin/dev/tone
   POST /admin/dev/tone
====================== */
router.get("/dev/tone", async (req, res) => {
  try {
    const tenant_id = getTenantId(req);
    const row = await devToneService.getLatest(tenant_id);
    return res.json({ ok: true, data: row || null });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "internal_error",
      where: "adminTraining:GET /dev/tone",
      message: String(err?.message || err),
    });
  }
});

router.post("/dev/tone", async (req, res) => {
  try {
    const tenant_id = getTenantId(req);
    const version = Number(req.body?.version || 1);
    if (!Number.isFinite(version) || version <= 0) {
      return badRequest(res, "invalid_version", "version deve ser um número > 0");
    }

    const rules_json = req.body?.rules_json ?? {};
    const examples_json = req.body?.examples_json ?? {};

    const saved = await devToneService.upsert(tenant_id, version, rules_json, examples_json);
    return res.json({ ok: true, data: saved });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "internal_error",
      where: "adminTraining:POST /dev/tone",
      message: String(err?.message || err),
    });
  }
});

/* ======================
   PRODUCT PLAYBOOK
   GET  /admin/product-playbooks/:product_key
   POST /admin/product-playbooks/:product_key
   GET  /admin/product-playbooks        (lista)
====================== */

// listar todos do tenant
router.get("/product-playbooks", async (req, res) => {
  try {
    const tenant_id = getTenantId(req);
    const items = await productPlaybookService.listByTenant({ tenant_id });
    return res.json({ ok: true, data: items || [] });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "internal_error",
      where: "adminTraining:GET /product-playbooks",
      message: String(err?.message || err),
    });
  }
});

// buscar 1 playbook por product_key
router.get("/product-playbooks/:product_key", async (req, res) => {
  try {
    const tenant_id = getTenantId(req);
    const product_key = String(req.params.product_key || "").trim();
    if (!product_key) return badRequest(res, "missing_product_key");

    const row = await productPlaybookService.getByProductKey({ tenant_id, product_key });
    return res.json({ ok: true, data: row || null });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "internal_error",
      where: "adminTraining:GET /product-playbooks/:product_key",
      message: String(err?.message || err),
    });
  }
});

// upsert playbook por product_key
router.post("/product-playbooks/:product_key", async (req, res) => {
  try {
    const tenant_id = getTenantId(req);
    const product_key = String(req.params.product_key || "").trim();
    if (!product_key) return badRequest(res, "missing_product_key");

    const payload = req.body || {};
    const saved = await productPlaybookService.upsertByProductKey({
      tenant_id,
      product_key,
      payload,
    });

    return res.json({ ok: true, data: saved });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "internal_error",
      where: "adminTraining:POST /product-playbooks/:product_key",
      message: String(err?.message || err),
    });
  }
});

module.exports = router;
