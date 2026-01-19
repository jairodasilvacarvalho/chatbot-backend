const express = require("express");

// services em /src
const { upsertCustomer } = require("../src/services/customerService");
const { saveMessage } = require("../src/services/messageService");

// core em /services
const { sendMessage } = require("../services/whatsapp");
const { buildReply } = require("../services/agent");

const router = express.Router();

/* ============================
   Helpers
============================ */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function humanDelayMs() {
  // 15–20 segundos
  return 15000 + Math.floor(Math.random() * 5000);
}

/* ============================
   GET - Verificação do webhook (Meta)
============================ */
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/* ============================
   POST - Receber mensagens
============================ */
router.post("/", async (req, res) => {
  try {
    /* ====== 1) MODO SIMULAÇÃO ====== */
    if (req.body?.phone && req.body?.message) {
      const phone = String(req.body.phone);
      const name = req.body.name || null;
      const text = String(req.body.message || "");

      // salva entrada
      await upsertCustomer({ phone, name });
      await saveMessage({ customer_phone: phone, direction: "in", text });

      // decisor central
      const result = await buildReply({
        text,
        profile: { phone, name },
      });

      // responde rápido
      res.status(200).json({
        ok: true,
        mode: "simulacao",
        phone,
        queued: true,
        channel: result.channel,
        stage: result.stage,
        reply_preview: result.replyText,
      });

      // envio assíncrono com delay humano
      (async () => {
        await sleep(humanDelayMs());

        if (result.channel === "audio") {
          console.log("🔊 [AUDIO PLACEHOLDER] (ElevenLabs entra aqui)");
        }

        await sendMessage({ to: phone, text: result.replyText });
        await saveMessage({
          customer_phone: phone,
          direction: "out",
          text: result.replyText,
        });
      })().catch((e) => console.error("Async send error:", e));

      return;
    }

    /* ====== 2) MODO META (Cloud API) ====== */
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];

    if (!msg) return res.sendStatus(200);

    const phone = String(msg.from);
    const text = msg.text?.body || "";

    await upsertCustomer({ phone, name: null });
    await saveMessage({ customer_phone: phone, direction: "in", text });

    const result = await buildReply({
      text,
      profile: { phone },
    });

    // responde rápido à Meta
    res.sendStatus(200);

    // envio com delay humano
    (async () => {
      await sleep(humanDelayMs());

      if (result.channel === "audio") {
        console.log("🔊 [AUDIO PLACEHOLDER] (ElevenLabs entra aqui)");
      }

      await sendMessage({ to: phone, text: result.replyText });
      await saveMessage({
        customer_phone: phone,
        direction: "out",
        text: result.replyText,
      });
    })().catch((e) => console.error("Async send error:", e));
  } catch (err) {
    console.error("WEBHOOK ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
