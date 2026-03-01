// routes/adminCustomerReset.js
// ✅ POST /admin/customers/:phone/reset
// ✅ Reseta APENAS colunas que existem no schema atual (evita SQLITE_ERROR)
// ✅ Descobre automaticamente qual é a coluna do telefone (phone vs customer_phone etc.)
// ✅ Mantém histórico (messages/orders), só zera estado do funil
// ✅ Usa tenant_id do middleware (fallback 1)

const express = require("express");
const router = express.Router();

const db = require("../config/db"); // wrapper do seu projeto (db.run/db.all retornam Promise)

function normalizePhone(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function pickPhoneColumn(cols) {
  // Ordem de preferência (ajuste se você souber o nome exato)
  const candidates = [
    "customer_phone",
    "phone",
    "customerPhone",
    "customer_number",
    "customerNumber",
    "whatsapp_phone",
    "whatsappPhone",
  ];
  return candidates.find((c) => cols.has(c)) || null;
}

router.post("/customers/:phone/reset", async (req, res) => {
  const phone = normalizePhone(req.params.phone);
  const tenant_id = Number(req.tenant_id || 1);

  if (!phone) {
    return res.status(400).json({ ok: false, error: "Phone inválido" });
  }

  try {
    // 1) Lê schema real
    const columnsInfo = await db.all(`PRAGMA table_info(customers)`);
    const cols = new Set((columnsInfo || []).map((c) => c.name));

    // 2) Descobre coluna do telefone
    const phoneCol = pickPhoneColumn(cols);
    if (!phoneCol) {
      return res.status(500).json({
        ok: false,
        error:
          "Não encontrei coluna de telefone em customers (ex: customer_phone/phone). Rode PRAGMA table_info(customers).",
      });
    }

    // 3) Monta SET apenas com colunas existentes
    const sets = [];
    const params = [];

    if (cols.has("stage")) {
      sets.push(`stage = ?`);
      params.push("abertura");
    }

    if (cols.has("text_streak")) {
      sets.push(`text_streak = ?`);
      params.push(0);
    }

    if (cols.has("facts_json")) {
      sets.push(`facts_json = ?`);
      params.push("{}");
    }

    // flags/pendências opcionais (se existirem, limpa)
    const nullableFlags = [
      "awaiting_payment",
      "awaiting_channel",
      "awaiting_affiliate_link",
      "awaiting_cep",
      "awaiting_address",
      "awaiting_confirm",
    ];
    for (const col of nullableFlags) {
      if (cols.has(col)) sets.push(`${col} = NULL`);
    }

    if (cols.has("updated_at")) {
      sets.push(`updated_at = CURRENT_TIMESTAMP`);
    }

    if (sets.length === 0) {
      return res.status(500).json({
        ok: false,
        error:
          "Nenhuma coluna resetável encontrada na tabela customers (stage/text_streak/facts_json/...).",
      });
    }

    // 4) WHERE (tenant + phone)
    params.push(phone, tenant_id);

    const sql = `
      UPDATE customers
      SET ${sets.join(", ")}
      WHERE ${phoneCol} = ?
        AND tenant_id = ?
    `;

    const result = await db.run(sql, params);
    const changed = Number(result?.changes || 0);

    if (changed === 0) {
      return res.status(404).json({
        ok: false,
        error: "Cliente não encontrado para este tenant (nenhuma linha alterada)",
        phone,
        tenant_id,
        phoneCol,
      });
    }

    return res.json({
      ok: true,
      reset: true,
      phone,
      tenant_id,
      phoneCol,
      changed,
    });
  } catch (err) {
    console.error("RESET_FUNIL_ERROR:", err);
    return res.status(500).json({ ok: false, error: "Erro ao resetar funil" });
  }
});

module.exports = router;
