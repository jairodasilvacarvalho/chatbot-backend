console.log("✅ MOCK ROUTE LOADED FROM:", __filename);

const express = require("express");
const router = express.Router();

const whatsapp = require("../src/services/whatsappService");
const customerService = require("../src/services/customerService");
const messageService = require("../services/messageService");

const conversationEvents = require("../services/conversationEvents.service");
const decision = require("../services/conversationDecision.service");
const agent = require("../services/agent");

const DEFAULT_TENANT_ID = 1;
const MOCK_ALLOW_TTS = String(process.env.MOCK_ALLOW_TTS || "") === "1";

// ============================
// 🔧 Utils
// ============================
function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function normalizeText(text) {
  return typeof text === "string" ? text.trim() : "";
}

function clampInt(n, min, max, fallback = min) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(Math.trunc(x), max));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeOutText(t) {
  const s = String(t || "").trim();
  return s || "Perfeito, já te respondo 😉";
}

function shortenText(text) {
  const t = String(text || "").trim();
  if (!t) return "Perfeito, já te respondo 😉";
  const i = t.indexOf(".");
  if (i > 10) return t.slice(0, i + 1).trim();
  return t.length > 120 ? t.slice(0, 120).trim() + "…" : t;
}

// ============================
// 🧠 CORE reutilizável
// ============================
async function handleIncoming({ tenant_id, phone, text, forceTextOnly = false }) {
  const startedAt = Date.now();

  const disableTts = String(process.env.DISABLE_TTS || "") === "1";

  const customer = await customerService.getOrCreateCustomer({
    tenant_id,
    phone,
    name: "Cliente WhatsApp",
  });

  const inMsg = await messageService.saveMessage({
    tenant_id,
    phone,
    direction: "in",
    text,
  });

  await conversationEvents.logEvent(tenant_id, customer.id, "incoming_text", text);

  const d = await decision.decide({
    tenantId: tenant_id,
    customerId: customer.id,
  });

  await conversationEvents.logEvent(
    tenant_id,
    customer.id,
    "decision",
    JSON.stringify({
      tone: d?.tone,
      short: !!d?.shouldBeShort,
      audio: !!d?.shouldSendAudio,
      disableTts,
      mockAllowTts: MOCK_ALLOW_TTS,
    })
  );

  const audioAllowed =
    !!d?.shouldSendAudio &&
    !!process.env.ELEVENLABS_API_KEY &&
    !disableTts &&
    MOCK_ALLOW_TTS &&
    !forceTextOnly;

  const agentResult = await agent.run({
    customer,
    incomingText: text,
    force_text_only: !audioAllowed,
  });

  if (d?.shouldBeShort) {
    agentResult.outText = shortenText(agentResult.outText);
  }

  const delayMs = clampInt(agentResult?.delayMs, 0, 30000, 0);
  if (delayMs > 0) await sleep(delayMs);

  const outText = safeOutText(agentResult?.outText);

  const outMsg = await messageService.saveMessage({
    tenant_id,
    phone,
    direction: "out",
    text: outText,
    has_audio: audioAllowed && agentResult?.audio_url ? 1 : 0,
    audio_url: audioAllowed ? agentResult?.audio_url || null : null,
  });

  if (audioAllowed && agentResult?.audio_url) {
    await conversationEvents.logEvent(
      tenant_id,
      customer.id,
      "audio_sent",
      agentResult.audio_url
    );
    await whatsapp.sendAudio({ to: phone, audioUrl: agentResult.audio_url });
  } else {
    await conversationEvents.logEvent(tenant_id, customer.id, "text_sent", outText);
    await whatsapp.sendText({ to: phone, text: outText });
  }

  return {
    ok: true,
    took_ms: Date.now() - startedAt,
    channel: audioAllowed ? "audio" : "text",
    in: inMsg,
    out: outMsg,
    decision: d,
  };
}

// ============================
// 🧪 MOCK endpoint
// ============================
router.post("/incoming", async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const text = normalizeText(req.body?.text);

    if (!phone || !text) {
      return res.status(400).json({ ok: false, error: "invalid_payload" });
    }

    const result = await handleIncoming({
      tenant_id: DEFAULT_TENANT_ID,
      phone,
      text,
      forceTextOnly: true, // mock nunca envia áudio por padrão
    });

    res.json(result);
  } catch (err) {
    console.error("❌ MOCK ERROR:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

module.exports = {
  router,
  handleIncoming, // 👈 exportado para o simulator
};
