// routes/webhook.js
// ✅ Reescrito para o teu estado atual (PASSO 3.4 concluído + PASSO 4.2 fake):
// - Mantém GET /webhook (verificação Meta)
// - POST /webhook aceita:
//    (A) payload simples de simulação: { phone, text }  (mantém compatível com seu mock antigo)
//    (B) payload Meta Cloud API: entry[0].changes[0].value.messages[0]
// - Pipeline única (fonte da verdade):
//    garante customer -> salva IN -> agent.run (pode gerar TTS real) -> delay humano -> salva OUT (com metadata áudio)
//    -> whatsappService.sendText/sendAudio (mock/real via WHATSAPP_MODE)
// - NÃO usa "envio assíncrono" (evita concorrência/debug difícil). Tudo acontece na request com delay controlado.
//   (Em produção você pode voltar a async com fila; por enquanto isso é perfeito para testes.)

const express = require("express");
const router = express.Router();

const customerService = require("../src/services/customerService");
const messageService = require("../services/messageService");
const agent = require("../services/agent");
const whatsapp = require("../src/services/whatsappService");

const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
const forceDebug = String(process.env.WEBHOOK_DEBUG || "") === "1";

function debug(...args) {
  if (!isProd || forceDebug) console.log(...args);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampInt(n, min, max, fallback = min) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(Math.trunc(x), max));
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function normalizeText(text) {
  if (typeof text !== "string") return "";
  return text.trim();
}

/**
 * Aceita dois formatos:
 * 1) Simples (dev): { phone, text }  (ou { phone, message } por compat)
 * 2) Meta: entry[0].changes[0].value.messages[0] com type=text
 */
function parseIncoming(reqBody) {
  // (A) Simulação simples
  const simPhone = reqBody?.phone;
  const simText = reqBody?.text ?? reqBody?.message; // compat legado
  if (simPhone && (typeof simText === "string" || typeof simText === "number")) {
    const phone = normalizePhone(simPhone);
    const text = normalizeText(String(simText));
    if (!phone || !text) return { ok: false, source: "sim", error: "invalid_payload" };
    return { ok: true, source: "sim", phone, text, name: reqBody?.name || null };
  }

  // (B) Meta Cloud API
  const msg = reqBody?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return { ok: false, source: "meta", error: "no_message" };

  const phone = normalizePhone(msg.from);
  const type = msg.type;

  if (type !== "text") {
    return { ok: false, source: "meta", error: "unsupported_type", type };
  }

  const text = normalizeText(String(msg?.text?.body || ""));
  if (!phone || !text) return { ok: false, source: "meta", error: "invalid_message" };

  return { ok: true, source: "meta", phone, text, name: null };
}

async function ensureCustomer(phone, name) {
  // mantém compat com teu customerService atual
  // se seu método se chama getOrCreateCustomer, use esse.
  if (typeof customerService.getOrCreateCustomer === "function") {
    return customerService.getOrCreateCustomer({
      phone,
      name: name || "Cliente WhatsApp",
    });
  }

  // fallback caso exista upsertCustomer/ upsertCustomerState etc
  if (typeof customerService.upsertCustomer === "function") {
    await customerService.upsertCustomer({ phone, name });
    // se não tiver retorno, tenta buscar:
    if (typeof customerService.getCustomerByPhone === "function") {
      return customerService.getCustomerByPhone(phone);
    }
    return { phone, name };
  }

  throw new Error("customerService: método de criar/buscar customer não encontrado");
}

async function persistIn(phone, text) {
  // seu saveMessage atual aceita { phone, direction, text }
  return messageService.saveMessage({
    phone,
    direction: "in",
    text,
  });
}

async function persistOut(phone, outText, agentResult) {
  return messageService.saveMessage({
    phone,
    direction: "out",
    text: outText,
    has_audio: agentResult?.has_audio ? 1 : 0,
    audio_url: agentResult?.audio_url || null,
    audio_duration_ms: agentResult?.audio_duration_ms ?? null,
    audio_voice_id: agentResult?.audio_voice_id ?? null,
  });
}

/* ============================
   GET /webhook - Verificação Meta
============================ */
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === String(process.env.WHATSAPP_VERIFY_TOKEN || "")) {
    debug("✅ [WEBHOOK] verify OK");
    return res.status(200).send(String(challenge || ""));
  }

  debug("❌ [WEBHOOK] verify FAIL", { mode });
  return res.sendStatus(403);
});

/* ============================
   POST /webhook - Receber mensagens (sim + meta)
============================ */
router.post("/", async (req, res) => {
  const startedAt = Date.now();
  debug("\n📩 [WEBHOOK] HIT");
  debug("BODY:", req.body);

  try {
    const parsed = parseIncoming(req.body);

    // A Meta espera 200 mesmo quando você ignora eventos
    if (!parsed.ok) {
      debug("⚠️ [WEBHOOK] ignored:", parsed);
      return res.status(200).json({ ok: true, ignored: parsed });
    }

    const { phone, text, name, source } = parsed;

    // 1) customer
    const customer = await ensureCustomer(phone, name);

    // 2) salva IN
    const inMsg = await persistIn(phone, text);

    // 3) agent (gera texto e possivelmente áudio real)
    const agentResult = await agent.run({
      customer,
      incomingText: text,
    });

    // 4) delay humano (clamp 0–30s)
    const delayMs = clampInt(agentResult?.delayMs, 0, 30000, 0);
    if (delayMs > 0) await sleep(delayMs);

    // 5) salva OUT
    const outText = String(agentResult?.text || agentResult?.outText || "").trim()
    const outMsg = await persistOut(phone, outText, agentResult);

    // 6) "envio" WhatsApp (mock/real)
    // (em mock só loga; em real chama a Meta — mas só se WHATSAPP_MODE=real)
    try {
      if (agentResult?.has_audio && agentResult?.audio_url) {
        await whatsapp.sendAudio({ to: phone, audioUrl: agentResult.audio_url });
      } else {
        await whatsapp.sendText({ to: phone, text: outText });
      }
    } catch (sendErr) {
      console.error("❌ [WEBHOOK SEND] erro:", sendErr?.message || sendErr);
    }

    return res.status(200).json({
      ok: true,
      source,
      phone,
      in: inMsg,
      out: outMsg,
      plan: agentResult?.plan,
      meta: { took_ms: Date.now() - startedAt },
    });
  } catch (err) {
    console.error("❌ WEBHOOK ERROR:", err?.message || err);

    // Em produção, a Meta prefere 200; mas em dev 500 ajuda.
    const payload = { ok: false, error: "internal_error", message: err?.message };
    if (!isProd) payload.stack = err?.stack;
    return res.status(500).json(payload);
  }
});

module.exports = router;
