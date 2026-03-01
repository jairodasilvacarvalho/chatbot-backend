// services/utils/detectPaymentMethod.js

function detectPaymentMethod(text) {
  if (!text) return null;
  const s = String(text).toLowerCase();

  // pix
  if (/\bpix\b/.test(s)) return "pix";

  // cartão
  if (/(cart[aã]o|credito|cr[eé]dito|debito|d[eé]bito|visa|master|amex)/.test(s)) {
    return "card";
  }

  // boleto
  if (/\bboleto\b/.test(s)) return "boleto";

  return null;
}

module.exports = { detectPaymentMethod };
