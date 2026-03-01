// services/utils/estimateShipping.js

function estimateShippingDays(cep) {
  // Mock simples (depois a gente troca por API real)
  // Dá uma sensação “calculado” sem mentir demais.
  const digits = (cep || "").replace(/\D/g, "");
  if (digits.length !== 8) return { min: 4, max: 9 };

  const last = parseInt(digits[7], 10);
  if (Number.isNaN(last)) return { min: 4, max: 9 };

  // 3 faixas só pra variar:
  if (last <= 3) return { min: 3, max: 6 };
  if (last <= 6) return { min: 4, max: 8 };
  return { min: 5, max: 10 };
}

module.exports = { estimateShippingDays };
