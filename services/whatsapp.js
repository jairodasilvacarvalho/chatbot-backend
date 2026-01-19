/**
 * services/whatsapp.js (CommonJS)
 * - Usa fetch nativo do Node (Node 18+ / 24 ok)
 * - Mantém modo MOCK via env e fallback automático
 * - Exporta via module.exports para compatibilidade com require()
 */

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function normalizeMode(v) {
  return String(v || "").trim().toLowerCase();
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function sendMessage({ to, text }) {
  const forcedMode = normalizeMode(process.env.WHATSAPP_MODE);

  // validação mínima
  if (!isNonEmptyString(to)) {
    return { ok: false, mode: forcedMode || "unknown", error: "Parâmetro 'to' inválido" };
  }
  if (!isNonEmptyString(text)) {
    return { ok: false, mode: forcedMode || "unknown", error: "Parâmetro 'text' inválido" };
  }

  // 🔒 FORÇA MODO MOCK VIA ENV
  if (forcedMode === "mock") {
    console.log("🧪 [WHATSAPP MOCK - FORCED]", { to, text });
    return { ok: true, mode: "mock", to, text };
  }

  // ⚠️ MODO REAL (somente se tiver credenciais)
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.GRAPH_API_VERSION || "v24.0";

  const useRealApi =
    isNonEmptyString(token) &&
    isNonEmptyString(phoneNumberId) &&
    String(token).startsWith("EAA");

  // 🧪 MOCK AUTOMÁTICO (proteção extra)
  if (!useRealApi) {
    console.log("🧪 [WHATSAPP MOCK - AUTO]", {
      to,
      text,
      reason: "Credenciais ausentes/invalidas",
    });
    return { ok: true, mode: "mock", to, text };
  }

  // 🚀 MODO REAL (WhatsApp Cloud API)
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    text: { body: text },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await safeJson(response);

    if (!response.ok) {
      console.error("❌ WhatsApp API error:", {
        status: response.status,
        statusText: response.statusText,
        data,
      });

      return {
        ok: false,
        mode: "real",
        status: response.status,
        error: data || response.statusText || "WhatsApp API error",
      };
    }

    console.log("✅ [WHATSAPP REAL] Mensagem enviada", {
      to,
      messageId: data?.messages?.[0]?.id,
    });

    return { ok: true, mode: "real", data };
  } catch (err) {
    console.error("🔥 Erro ao enviar mensagem:", err);
    return {
      ok: false,
      mode: "real",
      error: err?.message || "Erro desconhecido",
    };
  }
}

module.exports = { sendMessage };
