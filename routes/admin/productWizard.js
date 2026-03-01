// routes/admin/productWizard.js
const express = require("express");
const router = express.Router();

/*
  ATENÇÃO AOS PATHS:
  routes/admin/productWizard.js
  ├─ middlewares/ (na raiz)  -> ../../middlewares/...
  └─ src/services/          -> ../../src/services/...
*/

const adminAuth = require("../../middlewares/adminAuth");
const resolveTenant = require("../../middlewares/tenant");

const wizardService = require("../../src/services/productWizardService");
const productPlaybookService = require("../../src/services/productPlaybookService");

/* ======================
   Middlewares
====================== */
router.use(adminAuth);
router.use(resolveTenant);

/* ======================
   Helpers
====================== */
function safeMsg(e) {
  return String((e && e.message) || e || "error");
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/* ======================
   POST /admin/product-wizard/start
   Body: { wizard_id?: string }
====================== */
router.post("/start", async (req, res) => {
  try {
    const tenant_id = req.tenant_id;
    const { wizard_id } = req.body || {};

    // wizard_id pode ser opcional dependendo do service
    // mas se vier, garantimos que é string
    if (wizard_id != null && !isNonEmptyString(wizard_id)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_wizard_id",
        message: "wizard_id must be a non-empty string when provided",
      });
    }

    const data = await wizardService.createDraft({
      tenant_id,
      wizard_id: wizard_id ? wizard_id.trim() : undefined,
    });

    return res.json({ ok: true, data });
  } catch (e) {
    const msg = safeMsg(e);
    return res.status(500).json({
      ok: false,
      error: "internal_error",
      message: msg,
    });
  }
});

/* ======================
   POST /admin/product-wizard/answer
   Body: { wizard_id: string, answer: any }
====================== */
router.post("/answer", async (req, res) => {
  try {
    const tenant_id = req.tenant_id;
    const { wizard_id, answer } = req.body || {};

    if (!isNonEmptyString(wizard_id)) {
      return res.status(400).json({
        ok: false,
        error: "missing_wizard_id",
        message: "wizard_id is required",
      });
    }

    // answer pode ser string/obj/etc (depende do seu wizardService),
    // então NÃO travamos tipo aqui, só passamos como veio.
    const data = await wizardService.answerStep({
      tenant_id,
      wizard_id: wizard_id.trim(),
      answerRaw: answer,
    });

    return res.json({ ok: true, data });
  } catch (e) {
    const msg = safeMsg(e);

    // mantém seu comportamento: certos erros viram 400
    const known400 = new Set([
      "wizard_not_found",
      "wizard_not_draft",
      "invalid_stage",
    ]);

    const status = known400.has(msg) ? 400 : 500;

    return res.status(status).json({
      ok: false,
      error: msg,
      message: msg,
    });
  }
});

/* ======================
   POST /admin/product-wizard/confirm
   Body: { wizard_id: string }
====================== */
router.post("/confirm", async (req, res) => {
  try {
    const tenant_id = req.tenant_id;
    const { wizard_id } = req.body || {};

    if (!isNonEmptyString(wizard_id)) {
      return res.status(400).json({
        ok: false,
        error: "missing_wizard_id",
        message: "wizard_id is required",
      });
    }

    const data = await wizardService.confirmAndPersist({
      tenant_id,
      wizard_id: wizard_id.trim(),
      productPlaybookService,
    });

    return res.json({ ok: true, data });
  } catch (e) {
    const msg = safeMsg(e);

    const known400 = new Set([
      "wizard_not_found",
      "wizard_not_draft",
      "missing_product_key",
    ]);

    const status = known400.has(msg) ? 400 : 500;

    return res.status(status).json({
      ok: false,
      error: msg,
      message: msg,
    });
  }
});

module.exports = router;