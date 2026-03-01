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

// 🔸 mock sender: só loga e retorna um payload padrão
async function mockSend(payload) {
  console.log("📲 [WHATSAPP MOCK SEND]", JSON.stringify(payload, null, 2));
  return {
    mock: true,
    ok: true,
    messages: [{ id: `mock_${Date.now()}` }],
  };
}

// 🔹 real sender: chama a Graph API (só quando MODE=real)
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
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: String(text || "") },
  };
  return isReal() ? realSend(payload) : mockSend(payload);
}

async function sendAudio({ to, audioUrl }) {
  const payload = {
    messaging_product: "whatsapp",
    to,
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
