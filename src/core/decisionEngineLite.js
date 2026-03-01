// src/core/decisionEngineLite.js
// PASSO 7 (lite): decide o próximo stage baseado em intent + texto

const STAGES = ["abertura", "diagnostico", "oferta", "fechamento"];

function normalize(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function pickValidStage(stage) {
  const s = normalize(stage);
  return STAGES.includes(s) ? s : "abertura";
}

function hasAny(text, arr) {
  const t = normalize(text);
  return arr.some((w) => t.includes(normalize(w)));
}

function decideNextStage({ currentStage, intent, incomingText }) {
  const stage = pickValidStage(currentStage);
  const text = incomingText || "";

  // gatilhos fortes de fechamento
  const closeSignals = ["quero comprar", "quero fechar", "como compro", "link", "checkout", "pix", "me manda o pix", "pode enviar", "vou querer", "onde pago"];
  if (hasAny(text, closeSignals)) {
    return { nextStage: "fechamento", reason: "close_signal" };
  }

  // intenção de oferta (preço/pagamento/entrega)
  if (["preco", "pagamento", "entrega"].includes(String(intent || ""))) {
    return { nextStage: "oferta", reason: `intent_${intent}` };
  }

  // se ainda está na abertura, empurra para diagnóstico após a primeira interação
  if (stage === "abertura") {
    return { nextStage: "diagnostico", reason: "move_to_diagnostico" };
  }

  // default: mantém
  return { nextStage: stage, reason: "keep" };
}

module.exports = { decideNextStage };
