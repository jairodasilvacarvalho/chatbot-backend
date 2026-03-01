// services/conversationDecision.service.js
const events = require("./conversationEvents.service");

/**
 * Regras v1 (determinísticas) para decidir:
 * - se pode enviar áudio
 * - se deve responder curto
 * - intensidade (suave/normal)
 *
 * Nada de ML. Apenas comportamento.
 */
async function decide({ tenantId, customerId }) {
  const last = await events.getLastEvents(tenantId, customerId, 30);

  // helpers
  const count = (type, withinN = last) => withinN.filter((e) => e.event_type === type).length;

  const lastIncoming = last.find((e) => e.event_type === "incoming_text");
  const lastIncomingAt = lastIncoming ? new Date(lastIncoming.created_at.replace(" ", "T") + "Z").getTime() : null;

  // --- Métricas simples (v1)
  const incomingCount = count("incoming_text");
  const audioSentCount = count("audio_sent");
  const textSentCount = count("text_sent");

  // “momento de aquecimento”: só liberar áudio depois de algumas interações
  const warmedUp = incomingCount >= 3;

  // evitar áudio em excesso (ex: 1 áudio a cada 5-6 mensagens)
  const allowAudioByRatio = (textSentCount + audioSentCount) === 0
    ? false
    : ((textSentCount + audioSentCount) - (audioSentCount * 6)) >= 0; 
  // (simples: se já mandou áudio recente demais, bloqueia)

  // se a última msg foi muito recente, responder curto (pra parecer humano e não “robô ansioso”)
  const now = Date.now();
  const secondsSinceIncoming = lastIncomingAt ? Math.max(0, Math.floor((now - lastIncomingAt) / 1000)) : 9999;
  const shouldBeShort = secondsSinceIncoming < 8; // ajustável

  // intensidade: se o lead só manda “oi/ok/?” repetindo, reduzir intensidade
  const lastIncomingText = String(lastIncoming?.event_value || "").toLowerCase().trim();
  const lowSignal = ["oi", "ola", "ok", "blz", "?", "aham", "hm"].includes(lastIncomingText);

  const tone = lowSignal ? "suave" : "normal";

  // decisão final de áudio (v1)
  const shouldSendAudio = warmedUp && allowAudioByRatio;

  return {
    tone,                 // "suave" | "normal"
    shouldBeShort,        // true/false
    shouldSendAudio,      // true/false
    stats: {
      incomingCount,
      textSentCount,
      audioSentCount,
      secondsSinceIncoming,
      warmedUp,
      allowAudioByRatio,
    },
  };
}

module.exports = { decide };
