// src/core/objectionDetector.js

const OBJECTION_PATTERNS = {
  caro: ["caro", "muito caro", "preco alto", "valor alto", "salgado"],
  pensar: ["vou pensar", "pensar melhor", "depois vejo", "mais tarde", "avaliar"],
  confianca: [
    "nao confio",
    "confio",          // pega "n�o confio" depois da normalização
    "golpe",
    "e seguro",
    "seguro",
    "confiavel",
    "confianca"
  ],
  garantia: ["garantia", "troca", "devolucao", "reembolso"],
  frete: ["frete", "entrega", "prazo", "chega quando", "cep"],
  pagamento: ["pagamento", "pix", "cartao", "boleto", "pagar"],
  parcelamento: ["parcelar", "parcelamento", "em quantas vezes", "vezes"],
};

function normalizeText(s = "") {
  return String(s || "")
    .trim()
    .toLowerCase()
    // tenta corrigir casos comuns de "não" quebrado -> "n�o"
    .replace(/n�o/g, "nao")
    // remove o caractere quebrado "�"
    .replace(/�/g, "")
    // remove acentos
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // deixa só letras/números/espaço
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectObjection(text = "") {
  const t = normalizeText(text);
  if (!t) return null;

  for (const key of Object.keys(OBJECTION_PATTERNS)) {
    if (OBJECTION_PATTERNS[key].some((p) => t.includes(normalizeText(p)))) {
      return { key, confidence: 0.7 };
    }
  }
  return null;
}

module.exports = { detectObjection };
