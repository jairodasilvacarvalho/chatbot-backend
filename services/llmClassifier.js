// services/llmClassifier.js
const crypto = require("crypto");

function norm(s = "") {
  return String(s)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function makeKey({ text, stage, pendingField }) {
  const base = `${norm(text)}|${stage || ""}|${pendingField || ""}`;
  return crypto.createHash("sha1").update(base).digest("hex");
}

/**
 * Retorno padronizado:
 * { type: "objection"|"checkout_data"|"other",
 *   field: "cep"|"payment"|"channel"|"affiliate_link"|null,
 *   value: string|null,
 *   confidence: number }
 */
async function classifyInboundLLM({
  llmClient, // função async (messages)->string ou ->json; você injeta do seu agent
  text,
  stage,
  pendingField, // ex: "cep" | "payment" | "channel" | "affiliate_link" | null
  facts,
}) {
  const t = String(text || "");
  const n = norm(t);

  // Heurísticas rápidas (evitam gastar LLM)
  if (pendingField === "cep") {
    const m = n.match(/\b\d{5}-?\d{3}\b/);
    if (m) {
      const cep = m[0].replace("-", "");
      return { type: "checkout_data", field: "cep", value: `${cep.slice(0,5)}-${cep.slice(5)}`, confidence: 0.95 };
    }
  }

  if (pendingField === "payment") {
    if (/\bpix\b/.test(n)) return { type: "checkout_data", field: "payment", value: "pix", confidence: 0.95 };
    if (/\b(cartao|cr[eé]dito|debito)\b/.test(n)) return { type: "checkout_data", field: "payment", value: "card", confidence: 0.85 };
  }

  if (pendingField === "affiliate_link") {
    if (/^https?:\/\/\S+/i.test(t.trim())) {
      return { type: "checkout_data", field: "affiliate_link", value: t.trim(), confidence: 0.95 };
    }
  }

  if (pendingField === "channel") {
    if (/\b(amazon|shopee|mercado livre|ml|magalu|shein)\b/.test(n)) {
      return { type: "checkout_data", field: "channel", value: n, confidence: 0.75 };
    }
  }

  // Cai pro LLM classificar quando não deu pra ter certeza
  const schemaHint = `Responda APENAS JSON minificado.
Campos: type (objection|checkout_data|other), field (cep|payment|channel|affiliate_link|null), value (string|null), confidence (0..1).
Regras:
- Se for objeção (preço, dúvida, insegurança, comparação, desconfiança): type=objection.
- Se estiver respondendo o dado pedido (cep/pagamento/canal/link): type=checkout_data e field correspondente.
- Caso contrário: other.
Sem texto extra.`;

  const context = {
    stage,
    pendingField,
    checkout: facts?.checkout || facts?.facts?.checkout || null,
  };

  const messages = [
    { role: "system", content: schemaHint },
    { role: "user", content: `Contexto: ${JSON.stringify(context)}\nMensagem: ${t}` },
  ];

  const raw = await llmClient(messages);

  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    return { type: "other", field: null, value: null, confidence: 0.0 };
  }

  // Sanitização
  const type = ["objection", "checkout_data", "other"].includes(parsed.type) ? parsed.type : "other";
  const field = ["cep", "payment", "channel", "affiliate_link"].includes(parsed.field) ? parsed.field : null;
  const value = typeof parsed.value === "string" ? parsed.value : null;
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)));

  return { type, field, value, confidence };
}

module.exports = { classifyInboundLLM, makeKey };