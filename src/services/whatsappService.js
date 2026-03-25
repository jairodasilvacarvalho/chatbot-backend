// src/services/whatsappService.js

const MODE = (process.env.WHATSAPP_MODE || "mock").toLowerCase();
const TOKEN = process.env.WHATSAPP_TOKEN || "";
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const GRAPH_VERSION = process.env.GRAPH_API_VERSION || "v24.0";

function assertRealConfig() {
  if (!TOKEN) throw new Error("WHATSAPP_TOKEN missing (WHATSAPP_MODE=real)");
  if (!PHONE_ID) throw new Error("WHATSAPP_PHONE_NUMBER_ID missing (WHATSAPP_MODE=real)");
}

function isReal() {
  return MODE === "real" || MODE === "live";
}

function normalizeOutboundPhone(to) {
  let phone = String(to || "").replace(/\D/g, "");

  // remove 0 inicial
  if (phone.startsWith("0")) {
    phone = phone.substring(1);
  }

  // correção para números BR que chegam sem o 9
  // ex.: 55 + 54 + 96088146  -> 55 + 54 + 9 + 96088146
  if (phone.startsWith("55") && phone.length === 12) {
    const ddd = phone.slice(2, 4);
    const rest = phone.slice(4);

    if (rest.length === 8) {
      phone = "55" + ddd + "9" + rest;
    }
  }

  return phone;
}

// mock sender: só loga e retorna um payload padrão
async function mockSend(payload) {
  console.log("📲 [WHATSAPP MOCK SEND]", JSON.stringify(payload, null, 2));
  return {
    mock: true,
    ok: true,
    messages: [{ id: `mock_${Date.now()}` }],
  };
}

// real sender: chama a Graph API (só quando MODE=real)
async function realSend(payload) {
  assertRealConfig();

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_ID}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`Meta API error: ${res.status} ${JSON.stringify(data)}`);
  }

  return data;
}

async function sendText({ to, text }) {
  const phone = normalizeOutboundPhone(to);

  console.log("📤 ENVIANDO TEXTO PARA:", phone);

  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "text",
    text: { body: String(text || "") },
  };

  return isReal() ? realSend(payload) : mockSend(payload);
}

async function sendAudio({ to, audioUrl }) {
  const phone = normalizeOutboundPhone(to);

  console.log("📤 ENVIANDO ÁUDIO PARA:", phone);

  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "audio",
    audio: { link: String(audioUrl || "") },
  };

  return isReal() ? realSend(payload) : mockSend(payload);
}

module.exports = {
  sendText,
  sendAudio,
  isReal,
};