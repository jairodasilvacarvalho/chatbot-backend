// services/intentEngine.js

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function includesAny(text, terms = []) {
  return terms.some((term) => text.includes(term));
}

function analyzeIntent({ text = "", stage = "", facts = {}, recentMessages = [] } = {}) {
  const normalized = normalizeText(text);

  const signal_reasons = [];

  let sentiment = "neutral";
  let purchase_intent = "low";
  let drop_risk = "low";
  let objection_type = "unknown";
  let engagement_level = "medium";
  let buying_temperature = "cold";
  let next_best_action = "inform";
  let confidence = 0.5;

  const positiveTerms = [
    "quero", "tenho interesse", "gostei", "curti", "amei",
    "como compra", "como comprar", "link", "manda o link",
    "vou levar", "quero esse", "quero comprar", "fechar", "pode enviar"
  ];

  const priceTerms = [
    "preco", "valor", "quanto custa", "quanto fica", "desconto",
    "mais barato", "tem desconto", "parcela", "parcelado", "frete"
  ];

  const trustTerms = [
    "confiavel", "e confiavel", "seguro", "site seguro",
    "golpe", "funciona mesmo", "de verdade", "original"
  ];

  const hesitationTerms = [
    "vou pensar", "depois vejo", "talvez", "nao sei",
    "agora nao", "quem sabe", "vou analisar"
  ];

  const closingTerms = [
    "como compra", "como comprar", "manda o link", "link",
    "quero comprar", "vou levar", "pode fechar", "onde paga"
  ];

  const shippingTerms = [
    "frete", "entrega", "prazo", "chega quando", "quando chega"
  ];

  const lowEngagementTerms = [
    "hm", "ata", "sei", "blz", "ok", "ta", "tendi"
  ];

  if (!normalized) {
    return {
      sentiment,
      purchase_intent,
      drop_risk,
      objection_type,
      engagement_level: "low",
      buying_temperature,
      next_best_action: "ask_question",
      confidence: 0.2,
      signal_reasons: ["empty_message"]
    };
  }

  if (includesAny(normalized, positiveTerms)) {
    purchase_intent = "high";
    sentiment = "positive";
    engagement_level = "high";
    buying_temperature = "hot";
    next_best_action = "close";
    confidence = 0.85;
    signal_reasons.push("positive_purchase_signal");
  }

  if (includesAny(normalized, closingTerms)) {
    purchase_intent = "high";
    buying_temperature = "hot";
    next_best_action = "close";
    confidence = Math.max(confidence, 0.9);
    signal_reasons.push("closing_signal");
  }

  if (includesAny(normalized, priceTerms)) {
    objection_type = "price";
    purchase_intent = purchase_intent === "high" ? "high" : "medium";
    drop_risk = "medium";
    buying_temperature = buying_temperature === "hot" ? "hot" : "warm";
    next_best_action = "handle_objection";
    confidence = Math.max(confidence, 0.8);
    signal_reasons.push("price_objection_signal");
  }

  if (includesAny(normalized, trustTerms)) {
    objection_type = "trust";
    purchase_intent = purchase_intent === "high" ? "high" : "medium";
    drop_risk = "medium";
    next_best_action = "reassure";
    confidence = Math.max(confidence, 0.8);
    signal_reasons.push("trust_objection_signal");
  }

  if (includesAny(normalized, shippingTerms)) {
    objection_type = "shipping";
    purchase_intent = purchase_intent === "low" ? "medium" : purchase_intent;
    buying_temperature = buying_temperature === "cold" ? "warm" : buying_temperature;
    next_best_action = "inform";
    confidence = Math.max(confidence, 0.75);
    signal_reasons.push("shipping_question_signal");
  }

  if (includesAny(normalized, hesitationTerms)) {
    sentiment = "neutral";
    purchase_intent = purchase_intent === "high" ? "medium" : purchase_intent;
    drop_risk = "high";
    objection_type = objection_type === "unknown" ? "timing" : objection_type;
    buying_temperature = "warm";
    next_best_action = "handle_objection";
    confidence = Math.max(confidence, 0.85);
    signal_reasons.push("hesitation_signal");
  }

  if (includesAny(normalized, lowEngagementTerms) && normalized.length <= 10) {
    engagement_level = "low";
    drop_risk = drop_risk === "high" ? "high" : "medium";
    next_best_action = "ask_question";
    confidence = Math.max(confidence, 0.7);
    signal_reasons.push("low_engagement_signal");
  }

  if (
    !includesAny(normalized, positiveTerms) &&
    !includesAny(normalized, priceTerms) &&
    !includesAny(normalized, trustTerms) &&
    !includesAny(normalized, hesitationTerms) &&
    !includesAny(normalized, shippingTerms)
  ) {
    signal_reasons.push("generic_message");
  }

  return {
    sentiment,
    purchase_intent,
    drop_risk,
    objection_type,
    engagement_level,
    buying_temperature,
    next_best_action,
    confidence,
    signal_reasons
  };
}

module.exports = {
  analyzeIntent
};