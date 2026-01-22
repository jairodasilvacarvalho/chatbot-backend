// services/agent.js
// ✅ PASSO 3.4-ready: contexto + intenção + anti-repetição + persistência facts_json + canal texto/áudio real (ElevenLabs)
// Mantém contrato: run({ customer, incomingText }) -> { ok, delayMs, plan, outText, has_audio?, audio_url?, ... }

console.log("✅ [agent] carregado: PASSO 3.4 (TTS real + facts_json + contexto/intenção/anti-repetição)");

const customerService = require("../src/services/customerService");
const messageService = require("../src/services/messageService");
const tts = require("../src/services/tts"); // ✅ novo: src/services/tts.js (ElevenLabs)

function normalizeStage(stage) {
  const s = (stage || "").toLowerCase().trim();
  if (!s || s === "sem_stage") return "abertura";
  if (["abertura", "diagnostico", "oferta", "fechamento"].includes(s)) return s;
  return "abertura";
}

function pickHumanDelayMs() {
  // mantém teu comportamento humano
  const min = 15000;
  const max = 20000;
  return Math.floor(min + Math.random() * (max - min + 1));
}

function randChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function clampInt(n, min, max, fallback = min) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(Math.trunc(x), max));
}

function normalize(s) {
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function containsAny(text, words) {
  const t = normalize(text);
  return words.some((w) => t.includes(normalize(w)));
}

/** ===========================
 *  INTENÇÃO (rules-based)
 *  =========================== */
const INTENTS = {
  PRECO: "preco",
  PRAZO: "prazo",
  GARANTIA: "garantia",
  ENTREGA: "entrega",
  HUMANO: "humano",
  GERAL: "geral",
};

const INTENT_RULES = [
  { intent: INTENTS.PRECO, keywords: ["preço", "preco", "valor", "quanto", "custa", "orçamento", "orcamento"] },
  { intent: INTENTS.PRAZO, keywords: ["prazo", "quando", "demora", "urgente", "para hoje", "pra hoje", "essa semana"] },
  { intent: INTENTS.GARANTIA, keywords: ["garantia", "troca", "reembolso", "devolução", "devolucao"] },
  { intent: INTENTS.ENTREGA, keywords: ["entrega", "frete", "envio", "chega", "correios", "transportadora", "cep"] },
  { intent: INTENTS.HUMANO, keywords: ["humano", "atendente", "pessoa", "suporte", "vendedor"] },
];

function detectIntent(incomingText) {
  const t = normalize(incomingText);
  for (const rule of INTENT_RULES) {
    if (rule.keywords.some((k) => t.includes(normalize(k)))) return rule.intent;
  }
  return INTENTS.GERAL;
}

/** ===========================
 *  FATOS + QUESTIONS
 *  =========================== */
const FACT_KEYS = {
  AUDIENCIA: "audiencia", // pessoa | empresa
  OBJETIVO: "objetivo",
  URGENCIA: "urgencia",
  ORCAMENTO: "orcamento",
  LOCAL: "local",
  PRODUTO: "produto",
};

const QUESTIONS = {
  [FACT_KEYS.AUDIENCIA]: "Rapidinho: isso é pra você ou pra alguma empresa?",
  [FACT_KEYS.OBJETIVO]: "Boa — qual é o principal objetivo? (ex.: vender mais, automatizar atendimento, suporte)",
  [FACT_KEYS.PRODUTO]: "Show. O que exatamente você quer vender/atender pelo WhatsApp?",
  [FACT_KEYS.LOCAL]: "Você atende em qual cidade/estado? (pra eu ajustar entrega/prazos)",
  [FACT_KEYS.ORCAMENTO]: "Você tem uma faixa de orçamento em mente?",
  [FACT_KEYS.URGENCIA]: "Você precisa disso pra quando: hoje, essa semana, ou pode ser com calma?",
};

function safeJsonParse(str, fallback = {}) {
  if (!str || typeof str !== "string") return fallback;
  try {
    const v = JSON.parse(str);
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}

function mergeFacts(persistedFacts, extractedFacts) {
  // regra simples: extracted pode preencher vazios, mas não sobrescreve valores já persistidos (conservador)
  const out = { ...(persistedFacts || {}) };
  for (const [k, v] of Object.entries(extractedFacts || {})) {
    if (out[k] == null || out[k] === "") out[k] = v;
  }
  return out;
}

/**
 * heurística simples de extração
 * (você pode ir refinando depois, mas isso mantém teu 3.3)
 */
function extractFactsFromHistory(history) {
  const facts = {};

  for (const m of history) {
    if (m.direction !== "in") continue;
    const raw = m.text || "";
    const t = normalize(raw);

    // audiência
    if (containsAny(t, ["empresa", "negocio", "negócio", "minha loja", "meu comercio", "meu comércio"])) {
      facts[FACT_KEYS.AUDIENCIA] = "empresa";
    }
    if (containsAny(t, ["pra mim", "para mim", "pessoal"])) {
      facts[FACT_KEYS.AUDIENCIA] = "pessoa";
    }

    // urgência
    if (containsAny(t, ["hoje", "agora", "urgente"])) facts[FACT_KEYS.URGENCIA] = "urgente";
    else if (containsAny(t, ["essa semana"])) facts[FACT_KEYS.URGENCIA] = "essa_semana";
    else if (containsAny(t, ["sem pressa", "com calma"])) facts[FACT_KEYS.URGENCIA] = "calma";

    // orçamento (simples)
    const moneyMatch = raw.match(/(r\$|rs)\s?(\d{1,3}(\.\d{3})*|\d+)(,\d{2})?/i);
    if (moneyMatch) facts[FACT_KEYS.ORCAMENTO] = moneyMatch[0];

    // local
    if (containsAny(t, ["sou de", "moro em", "cidade", "estado"])) {
      facts[FACT_KEYS.LOCAL] = raw;
    }

    // produto
    if (containsAny(t, ["vendo", "trabalho com", "é um", "é uma", "meu produto", "meu serviço"])) {
      if (!facts[FACT_KEYS.PRODUTO]) facts[FACT_KEYS.PRODUTO] = raw;
    }

    // objetivo
    if (containsAny(t, ["quero", "preciso", "objetivo", "meta"])) {
      facts[FACT_KEYS.OBJETIVO] = raw;
    }
  }

  return facts;
}

/** ===========================
 *  ANTI-REPETIÇÃO (melhorado)
 *  =========================== */
function fingerprint(text) {
  // reduz o texto a um “shape” pra comparar perguntas parecidas
  const t = normalize(text)
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // corta para evitar comparação longa
  return t.slice(0, 40);
}

function wasQuestionAsked(history, questionText) {
  const qfp = fingerprint(questionText);
  return history.some((m) => m.direction === "out" && fingerprint(m.text || "").includes(qfp.slice(0, 24)));
}

function nextMissingQuestion(stage, history, facts) {
  const orderByStage = {
    abertura: [FACT_KEYS.AUDIENCIA, FACT_KEYS.OBJETIVO],
    diagnostico: [FACT_KEYS.PRODUTO, FACT_KEYS.URGENCIA, FACT_KEYS.ORCAMENTO, FACT_KEYS.LOCAL],
    oferta: [],
    fechamento: [],
  };

  const order = orderByStage[stage] || [];
  for (const key of order) {
    if (!facts[key]) {
      const q = QUESTIONS[key];
      if (q && !wasQuestionAsked(history, q)) return q;
    }
  }
  return null;
}

/** ===========================
 *  PROGRESSÃO (igual, mas limpa)
 *  =========================== */
function decideStageProgression(stage, intent, facts) {
  let s = normalizeStage(stage);

  if (s === "abertura") {
    if (facts[FACT_KEYS.AUDIENCIA] && facts[FACT_KEYS.OBJETIVO]) s = "diagnostico";
    if (intent === INTENTS.PRECO || intent === INTENTS.PRAZO) s = "diagnostico";
  }

  if (s === "diagnostico") {
    if (facts[FACT_KEYS.PRODUTO] && (facts[FACT_KEYS.ORCAMENTO] || facts[FACT_KEYS.URGENCIA])) s = "oferta";
  }

  return s;
}

/** ===========================
 *  RESPOSTAS
 *  =========================== */
function replyForIntent(intent, stage, facts) {
  if (intent === INTENTS.PRECO) {
    if (!facts[FACT_KEYS.PRODUTO]) return "Consigo te passar valores sim 🙂 Antes: o que exatamente você vende/atende pelo WhatsApp?";
    if (!facts[FACT_KEYS.ORCAMENTO]) return "Pra eu te falar de valor com precisão: você tem uma faixa de orçamento em mente?";
    return "Boa. Com essa faixa, dá pra montar uma solução bem redonda. Você quer algo mais simples pra começar rápido ou já algo completo?";
  }

  if (intent === INTENTS.PRAZO) {
    if (!facts[FACT_KEYS.URGENCIA]) return "Consigo sim. Você precisa disso pra quando: hoje, essa semana, ou pode ser com calma?";
    return "Perfeito. Com esse prazo, eu te indico o caminho mais rápido. Me confirma: é pra você ou pra uma empresa?";
  }

  if (intent === INTENTS.GARANTIA) {
    return "Sobre garantia/troca: depende do que você vende. Me diz qual é o produto/serviço e qual regra você quer aplicar (troca/reembolso)?";
  }

  if (intent === INTENTS.ENTREGA) {
    if (!facts[FACT_KEYS.LOCAL]) return "Sobre entrega: você atende em qual cidade/estado? E entrega pra todo Brasil ou só região?";
    return "Show. Com isso eu consigo te orientar certinho sobre prazos e envio. Você costuma enviar por Correios, transportadora ou retirada?";
  }

  if (intent === INTENTS.HUMANO) {
    return "Claro 🙂 Posso te direcionar pra um humano sim. Antes, me diz em 1 frase o que você precisa pra eu encaminhar certo.";
  }

  return null;
}

function defaultReplyByStage(stage, nextQ) {
  if (stage === "abertura") {
    return nextQ || "Oi! 😊 Me diz rapidinho: você tá buscando isso pra você ou pra alguma empresa? E qual o principal objetivo?";
  }

  if (stage === "diagnostico") {
    return nextQ || "Entendi 🙂 Só me dá mais um detalhe pra eu te orientar certinho:";
  }

  if (stage === "oferta") {
    return "Perfeito. Com base no que você me passou, eu te indico o melhor caminho. Você prefere algo simples pra começar rápido ou já uma solução mais completa?";
  }

  return "Fechado! ✅ Me diz o melhor próximo passo pra você: quer link/contato/agendamento?";
}

/** ===========================
 *  CANAL (texto/áudio) — melhorado
 *  =========================== */
function computeChannel(customer) {
  const streak = clampInt(customer?.text_streak, 0, 100000, 0);

  let nextAudioAt = clampInt(customer?.next_audio_at, 0, 100000, 0);
  if (!nextAudioAt || nextAudioAt < 1) {
    // se não existir, cria uma janela 5–6 a partir de agora
    nextAudioAt = streak + randChoice([5, 6]);
  }

  const shouldAudio = streak >= nextAudioAt;

  return {
    channel: shouldAudio ? "audio" : "text",
    nextAudioAt,
    shouldResetStreak: shouldAudio,
  };
}

/** ===========================
 *  Persistência de estado (inclui facts_json)
 *  =========================== */
async function persistState(phone, patch) {
  await customerService.updateCustomerState(phone, patch);
}

/** ===========================
 *  FUNÇÃO PRINCIPAL
 *  =========================== */
async function run({ customer, incomingText }) {
  const delayMs = pickHumanDelayMs();

  const phone = customer?.phone;
  const stageBefore = normalizeStage(customer?.stage);

  // 1) contexto
  const history = phone ? await messageService.getLastMessages(phone, 10) : [];

  // 2) intenção atual
  const intent = detectIntent(incomingText);

  // 3) facts: persistidos + extraídos do histórico
  const persistedFacts = safeJsonParse(customer?.facts_json, {});
  const extractedFacts = extractFactsFromHistory(history);
  const facts = mergeFacts(persistedFacts, extractedFacts);

  // 4) decide stage
  const stageAfter = decideStageProgression(stageBefore, intent, facts);

  // 5) escolhe pergunta faltante (anti-repetição) e resposta
  const nextQ = nextMissingQuestion(stageAfter, history, facts);
  const intentReply = replyForIntent(intent, stageAfter, facts);
  const outText = intentReply || defaultReplyByStage(stageAfter, nextQ);

  // 6) canal (texto/áudio)
  const { channel, nextAudioAt, shouldResetStreak } = computeChannel(customer);

  // 7) TTS real se canal=audio
  let has_audio = 0;
  let audio_url = null;
  let audio_duration_ms = null;
  let audio_voice_id = null;

  if (channel === "audio") {
    const audio = await tts.synthesizeToFile(outText); // precisa existir em src/services/tts.js
    has_audio = 1;
    audio_url = audio.audio_url;
    audio_duration_ms = audio.audio_duration_ms ?? null;
    audio_voice_id = audio.audio_voice_id ?? null;
  }

  // 8) atualizar streak e next_audio_at
  const newTextStreak = shouldResetStreak ? 0 : clampInt(customer?.text_streak, 0, 100000, 0) + 1;
  const nextWindow = randChoice([5, 6]);

  // 9) persistência (stage + streak + facts_json + controle áudio)
  if (phone) {
    await persistState(phone, {
      stage: stageAfter,
      text_streak: newTextStreak,
      next_audio_at: shouldResetStreak ? nextWindow : nextAudioAt,
      last_audio_at: shouldResetStreak ? nowIso() : (customer?.last_audio_at || null),

      // ✅ facts_json persistido (merge)
      facts_json: JSON.stringify(facts),
    });
  }

  return {
    ok: true,
    delayMs,
    plan: {
      channel,
      stageBefore,
      stageAfter,
      intent,
    },
    outText,

    // ✅ novo (para o handler persistir + frontend tocar)
    has_audio,
    audio_url,
    audio_duration_ms,
    audio_voice_id,
  };
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = { run };
