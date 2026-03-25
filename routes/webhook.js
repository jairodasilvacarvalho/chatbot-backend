// routes/webhook.js

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

/* =========================================================
   NORMALIZAÇÃO DE TELEFONE
========================================================= */

function normalizePhone(phone) {
  let p = String(phone || "").replace(/\D/g, "");

  // remove 0 inicial apenas se existir
  if (p.startsWith("0")) {
    p = p.substring(1);
  }

  return p;
}

function normalizeText(text) {
  if (typeof text !== "string") return "";
  return text.trim();
}

/* =========================================================
   PARSE DE ENTRADA
========================================================= */

function parseIncoming(reqBody) {
  // simulador
  const simPhone = reqBody?.phone;
  const simText = reqBody?.text ?? reqBody?.message;

  if (simPhone && (typeof simText === "string" || typeof simText === "number")) {
    const phone = normalizePhone(simPhone);
    const text = normalizeText(String(simText));

    if (!phone || !text) {
      return { ok: false, source: "sim", error: "invalid_payload" };
    }

    return {
      ok: true,
      source: "sim",
      phone,
      text,
      name: reqBody?.name || null,
    };
  }

  // payload Meta
  const msg = reqBody?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (!msg) {
    return { ok: false, source: "meta", error: "no_message" };
  }

  console.log("📱 META FROM RAW:", msg.from);

  const phone = normalizePhone(msg.from);
  const type = msg.type;

  if (type !== "text") {
    return { ok: false, source: "meta", error: "unsupported_type", type };
  }

  const text = normalizeText(msg?.text?.body || "");

  if (!phone || !text) {
    return { ok: false, source: "meta", error: "invalid_message" };
  }

  return {
    ok: true,
    source: "meta",
    phone,
    text,
    name: null,
  };
}

/* =========================================================
   CUSTOMER
========================================================= */

async function ensureCustomer(phone, name) {
  if (typeof customerService.getOrCreateCustomer === "function") {
    return customerService.getOrCreateCustomer({
      phone,
      name: name || "Cliente WhatsApp",
    });
  }

  if (typeof customerService.upsertCustomer === "function") {
    await customerService.upsertCustomer({
      phone,
      name: name || "Cliente WhatsApp",
    });

    if (typeof customerService.getCustomerByPhone === "function") {
      return customerService.getCustomerByPhone(phone);
    }

    return { phone, name: name || "Cliente WhatsApp" };
  }

  throw new Error("customerService: método não encontrado");
}

/* =========================================================
   PERSISTÊNCIA
========================================================= */

async function persistIn(tenant_id, phone, text) {
  return messageService.saveMessage({
    tenant_id,
    customer_phone: phone,
    direction: "in",
    text,
  });
}

async function persistOut(tenant_id, phone, text, agentResult) {
  return messageService.saveMessage({
    tenant_id,
    customer_phone: phone,
    direction: "out",
    text,
    has_audio: agentResult?.has_audio ? 1 : 0,
    audio_url: agentResult?.audio_url || null,
    audio_duration_ms: agentResult?.audio_duration_ms ?? null,
    audio_voice_id: agentResult?.audio_voice_id ?? null,
  });
}

/* =========================================================
   GET /webhook (verificação Meta)
========================================================= */

router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    token &&
    token === String(process.env.WHATSAPP_VERIFY_TOKEN || "")
  ) {
    debug("✅ WEBHOOK VERIFY OK");
    return res.status(200).send(String(challenge || ""));
  }

  debug("❌ WEBHOOK VERIFY FAIL");
  return res.sendStatus(403);
});

/* =========================================================
   POST /webhook
========================================================= */

router.post("/", async (req, res) => {
  const startedAt = Date.now();

  debug("\n📩 WEBHOOK HIT");

  let body = req.body;

  try {
    if (Buffer.isBuffer(body)) {
      body = JSON.parse(body.toString("utf8"));
    }
  } catch (err) {
    console.error("❌ WEBHOOK ERROR: invalid raw JSON body");
    return res.status(400).json({
      ok: false,
      error: "invalid_json_body",
      message: err?.message,
    });
  }

  debug("BODY:", body);

  try {
    const parsed = parseIncoming(body);

    if (!parsed.ok) {
      debug("⚠️ ignored:", parsed);
      return res.status(200).json({ ok: true, ignored: parsed });
    }

    const { phone, text, name, source } = parsed;

    // tenant fixo por enquanto no fluxo real
    const tenant_id = 1;

    const customer = await ensureCustomer(phone, name);

    const inMsg = await persistIn(tenant_id, phone, text);

    const agentResult = await agent.run({
      tenant_id,
      customer,
      incomingText: text,
    });

    const delayMs = clampInt(agentResult?.delayMs, 0, 30000, 0);

    if (delayMs > 0) {
      await sleep(delayMs);
    }

    const outText = String(agentResult?.text || agentResult?.outText || "").trim();

    const outMsg = await persistOut(tenant_id, phone, outText, agentResult);

    try {
      if (agentResult?.has_audio && agentResult?.audio_url) {
        await whatsapp.sendAudio({
          to: phone,
          audioUrl: agentResult.audio_url,
        });
      } else if (outText) {
        await whatsapp.sendText({
          to: phone,
          text: outText,
        });
      }
    } catch (sendErr) {
      console.error("❌ WEBHOOK SEND erro:", sendErr?.message || sendErr);
    }

    return res.status(200).json({
      ok: true,
      source,
      phone,
      tenant_id,
      in: inMsg,
      out: outMsg,
      plan: agentResult?.plan,
      meta: { took_ms: Date.now() - startedAt },
    });
  } catch (err) {
    console.error("❌ WEBHOOK ERROR:", err?.message || err);

    const payload = {
      ok: false,
      error: "internal_error",
      message: err?.message,
    };

    if (!isProd) payload.stack = err?.stack;

    return res.status(500).json(payload);
  }
});

module.exports = router;