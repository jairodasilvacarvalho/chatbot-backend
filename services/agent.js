// services/agent.js
const {
  getCustomerByPhone,
  updateCustomerState,
} = require("../src/services/customerService");

function normalize(text = "") {
  return String(text).toLowerCase().trim();
}

function pickNextAudioAt() {
  // alterna entre 5 ou 6 mensagens
  return Math.random() < 0.5 ? 5 : 6;
}

function nextStage(currentStage, text) {
  const t = normalize(text);

  if (!currentStage) return "abertura";

  if (currentStage === "abertura") return "diagnostico";

  if (currentStage === "diagnostico") {
    if (t.includes("preço") || t.includes("valor") || t.includes("comprar")) {
      return "fechamento";
    }
    return "oferta";
  }

  return currentStage;
}

function replyByStage(stage) {
  switch (stage) {
    case "abertura":
      return "Perfeito! Antes de eu te passar o melhor caminho: é pra você ou pra presente? 🙂";

    case "diagnostico":
      return "Boa! Me conta rapidinho: qual é o principal objetivo que você quer resolver agora?";

    case "oferta":
      return "Entendi. Tenho uma solução bem direta pra isso. Você prefere algo rápido ou mais completo?";

    case "fechamento":
      return "Perfeito. Posso te mandar o link, mas antes: você autoriza eu te enviar o link por aqui?";

    default:
      return "Entendi! Me conta rapidinho como posso te ajudar 🙂";
  }
}

async function decideChannel(phone) {
  const customer = await getCustomerByPhone(phone);

  const textStreak = customer?.text_streak ?? 0;
  const nextAudioAt = customer?.next_audio_at ?? 6;

  // Se atingiu o limite → áudio
  if (textStreak >= nextAudioAt) {
    await updateCustomerState(phone, {
      text_streak: 0,
      next_audio_at: pickNextAudioAt(),
      last_audio_at: new Date().toISOString(),
    });
    return "audio";
  }

  // Senão → texto
  await updateCustomerState(phone, {
    text_streak: textStreak + 1,
  });

  return "text";
}

async function buildReply({ text, profile }) {
  const phone = profile?.phone;
  const customer = phone ? await getCustomerByPhone(phone) : null;

  const currentStage = customer?.stage || "abertura";
  const newStage = nextStage(currentStage, text);

  if (phone && newStage !== currentStage) {
    await updateCustomerState(phone, { stage: newStage });
  }

  const channel = phone ? await decideChannel(phone) : "text";
  const replyText = replyByStage(newStage);

  return {
    replyText,
    channel, // "text" | "audio"
    stage: newStage,
  };
}

module.exports = { buildReply };
