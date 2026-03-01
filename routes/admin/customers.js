console.log("✅ admin customers routes loaded");

const express = require("express");
const router = express.Router();

const customerService = require("../../src/services/customerService");

// POST /admin/customers/:phone/product
router.post("/:phone/product", async (req, res) => {
  try {
    const tenantId = Number(req.headers["x-tenant-id"]) || 1;
    const phone = String(req.params.phone || "").replace(/\D/g, "");
    const { product_key } = req.body || {};

    if (!phone) {
      return res.status(400).json({ ok: false, error: "phone_required" });
    }

    const customer = await customerService.setCustomerProductKey({
      tenantId,
      phone,
      productKey: product_key,
    });

    return res.json({
      ok: true,
      data: {
        phone: customer.phone,
        product_key: customer.product_key,
      },
    });
  } catch (err) {
    console.error("❌ set customer product:", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

module.exports = router;
