router.post(
  "/admin/customers/:phone/reset",
  adminAuth,
  tenantMiddleware,
  async (req, res) => {
    const { phone } = req.params;
    const { tenant_id } = req;

    try {
      await db.run(
        `
        UPDATE customers
        SET
          stage = 'abertura',
          text_streak = 0,
          facts_json = '{}',
          awaiting_payment = NULL,
          awaiting_channel = NULL,
          awaiting_affiliate_link = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE customer_phone = ?
          AND tenant_id = ?
        `,
        [phone, tenant_id]
      );

      return res.json({
        ok: true,
        message: "Funil do cliente resetado com sucesso",
        phone
      });
    } catch (err) {
      console.error("RESET FUNIL ERROR:", err);
      return res.status(500).json({
        ok: false,
        error: "Erro ao resetar funil do cliente"
      });
    }
  }
);
