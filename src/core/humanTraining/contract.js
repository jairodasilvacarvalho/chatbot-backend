// src/core/humanTraining/contract.js
// CommonJS para compatibilidade com services/agent.js e core/agentLLM.js

const TRAINING_KEYS = [
  "tone_style",
  "language_level",
  "emoji_usage",
  "energy",
  "sales_posture",
  "pressure_level",
  "rapport_script",
  "objections_script",
  "closing_style",
  "never_do",
];

const DEFAULT_TRAINING = {
  tone_style: "humano, próximo, confiante",
  language_level: "simples",
  emoji_usage: "moderado",
  energy: "calmo",
  sales_posture: "consultor",
  pressure_level: "baixo",

  // scripts curtos e práticos (o motor usa em objeções/fechamento)
  rapport_script: "valide e pergunte",
  objections_script: "acolha, explique e ofereça opção",
  closing_style: "escolha guiada",

  never_do: "não pressionar, não soar robótico, não inventar prazos",
};

/**
 * Mantém apenas as chaves conhecidas (evita "lixo" no JSON do playbook quebrar o motor)
 */
function pickTrainingKeys(input) {
  const obj = input && typeof input === "object" ? input : {};
  const out = {};
  for (const k of TRAINING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  }
  return out;
}

/**
 * Merge seguro: DEFAULT <- base <- override (apenas chaves válidas)
 * Bom pra futuro: default do tenant + override do produto
 */
function mergeTrainingSafe(base, override) {
  const a = pickTrainingKeys(base);
  const b = pickTrainingKeys(override);
  return normalizeTraining({ ...a, ...b });
}

/**
 * Sanitiza e garante shape estável.
 * - Preenche faltantes com DEFAULT
 * - Trim em strings
 * - Converte tipos estranhos para string (sem quebrar)
 */
function normalizeTraining(input) {
  const raw = pickTrainingKeys(input);
  const t = { ...DEFAULT_TRAINING, ...raw };

  for (const k of TRAINING_KEYS) {
    let v = t[k];

    if (v === null || v === undefined || v === "") {
      v = DEFAULT_TRAINING[k];
    }

    if (typeof v === "string") {
      v = v.trim();
    } else {
      // garante consistência: sempre string
      v = String(v);
    }

    // nunca fica vazio
    if (v === "") v = DEFAULT_TRAINING[k];

    t[k] = v;
  }

  return t;
}

module.exports = {
  TRAINING_KEYS,
  DEFAULT_TRAINING,
  pickTrainingKeys,
  mergeTrainingSafe,
  normalizeTraining,
};