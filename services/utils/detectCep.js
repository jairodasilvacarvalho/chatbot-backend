// services/utils/detectCep.js
function detectCep(text) {
  if (!text) return null;
  const s = String(text);

  // captura 00000-000 ou 00000000
  const m = s.match(/\b(\d{5})-?(\d{3})\b/);
  if (!m) return null;

  return `${m[1]}-${m[2]}`; // padroniza com hífen
}

module.exports = { detectCep };
