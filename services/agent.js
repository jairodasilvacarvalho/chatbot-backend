// services/agent.js
// Ô£à Retorna { type, text, facts } para o core persistir facts_json
// Ô£à Normaliza fatos antigos (closing/payment/shipping) para n├úo competir com checkout
// Ô£à Fix do loop: no m├íximo 1 awaiting_* ativo + reset ao "quero comprar" e ao concluir checkout
// Ô£à Finaliza├º├úo: salva last_order e limpa pend├¬ncias corretamente
// Ô£à Aplica Treino Humano nas mensagens do funil sem quebrar l├│gica
// Ô£à Usa loader oficial getEffectiveTraining() (fallback + contrato ├║nico)
// Ô£à Integra LLM real (src/core/agentLLM.js) fora do checkout, com stageContext + facts + training
// Ô£à FIX: LLM n├úo fica bloqueado ap├│s co.sent=true
// Ô£à Logs: LLM CHECK + ENTER LLM + ENTER CHECKOUT + LLM DECISION
// Ô£à Normaliza├º├úo robusta p/ gatilhos (remove acentos + lida com "´┐¢" / mojibake)
// Ô£à Fallback espec├¡fico para 429/quota
// Ô£à LLM h├¡brido dentro do checkout: responde obje├º├úo e volta pra pergunta pendente (sem quebrar estado)
// Ô£à Anti-loop: evita usar LLM 2x para o mesmo inbound durante checkout
// Ô£à Stage Sync: mant├®m customers.stage consistente com facts.stage
// Ô£à Classificador LLM em JSON no checkout (objection|checkout_data|other) + anti-loop pr├│prio
// Ô£à HARD RULE no classificador (pending manda; heur├¡stica forte bypass; field != pending ignora)
// Ô£à (PASSO 5.5) BYPASS product_intelligence fora do checkout, antes do LLM
// Ô£à (FIX) Playbook Pitch ABERTURA + DIAGNOSTICO (antes do LLM) com anti-spam (facts_json)
// Ô£à (FIX CR├ìTICO) Normaliza├º├úo de product_key: sempre usa DEFAULT (caps) como padr├úo e normaliza case
// Ô£à (FIX CR├ìTICO) Debug PLAYBOOK INFO para enxergar product_key real + pitch_by_stage carregado
// Ô£à (FIX CR├ìTICO) Preserva facts.pitches_sent e demais campos ao aplicar defaults (n├úo ÔÇ£zeraÔÇØ)
// Ô£à (FIX CR├ìTICO) Fallback "oi" n├úo repete exatamente a ABERTURA quando pitches_sent.abertura=true
// Ô£à (FIX CR├ìTICO) Persist├¬ncia: respond() pode persistir facts_json em modo AUTO (evita perder anti-spam)
// Ô£à (FIX CR├ìTICO) ATALHO POS-CHECKOUT agora DENTRO do run() (resolve "await is only valid in async functions")
// Ô£à (FIX AGORA) Router "pre├ºo/valor/quanto custa" => OFERTA antes do nudge/abertura
// Ô£à (FIX AGORA) Anti-loop do nudge gen├®rico ganha do fluxo (nudge detectado + alternativa + flag persistida)
// Ô£à (FIX) Corre├º├úo de shape: campos checkout string/nullable n├úo for├ºam typeof "string" quando null
// Ô£à (FIX) buildClassifierKey n├úo usa customer_phone (evita inconsist├¬ncia)
// Ô£à (FIX AGORA) llm_class_last_key centralizado: ├║nica escrita via helper setCheckoutClassKeySafe()

console.log("### LOADED services/agent.js ###", __filename);

console.log("### LOADED services/agent.js ###");

const db = require("../config/db");
const { getEffectiveTraining } = require("./humanTrainingService");
const { generateLLMResponse } = require("../src/core/agentLLM");

/* ======================
   Utils
====================== */
function safeJsonParse(input, fallback = {}) {
  try {
    if (input == null) return fallback;
    if (typeof input === "object") return input;
    const s = String(input).trim();
    if (!s) return fallback;
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function normalizeText(t) {
  return String(t ?? "").trim();
}

/**
 * Normaliza para match/heur├¡sticas:
 * - lower
 * - remove acentos
 * - remove mojibake "´┐¢" (U+FFFD) para n├úo travar gatilhos
 * - compacta espa├ºos
 */
function normalizeForMatch(input) {
  let s = normalizeText(input);

  // Ô£à FIX: remove caractere de substitui├º├úo "´┐¢" (mojibake)
  // Ex: "t´┐¢ caro" -> "t caro"
  s = s.replace(/\uFFFD/g, " ");
  s = s.replace(/´┐¢/g, " ");

  // lower + remove acentos
  s = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // compacta espa├ºos
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

function normalizeProductKey(pk) {
  const s = normalizeText(pk);
  if (!s) return "DEFAULT";
  return s.toUpperCase().replace(/\s+/g, "_");
}

async function getCustomerProductKey(_tenant_id, customer) {
  const raw = customer?.product_key || customer?.current_product_key || "DEFAULT";
  return normalizeProductKey(raw);
}

function looksLikeUrl(text) {
  const t = normalizeText(text).toLowerCase();
  return t.startsWith("http://") || t.startsWith("https://");
}

function normalizeCep(text) {
  const digits = normalizeText(text).replace(/\D/g, "");
  if (digits.length !== 8) return null;
  return digits.slice(0, 5) + "-" + digits.slice(5);
}

function normalizeChannel(text) {
  const t = normalizeForMatch(text);
  
  if (t.includes("amazon")) return "amazon";
  if (t.includes("mercado") || t.includes("ml")) return "mercado_livre";
  if (t.includes("oficial") || t.includes("loja")) return "loja_oficial";
  return null;
}

function normalizePayment(text) {
  const t = normalizeForMatch(text);
  
  if (t.includes("pix")) return "pix";
  if (t.includes("cart") || t.includes("credito") || t.includes("debito")) return "cartao";
  if (t.includes("boleto")) return "boleto";
  return null;
}

function isBuyIntent(text) {
  const t = normalizeForMatch(text);
  
  return (
    t === "quero comprar" ||
    t.includes("quero comprar") ||
    t.includes("comprar agora") ||
    t.includes("finalizar") ||
    t.includes("fechar pedido")
  );
}

function isPriceIntent(text) {
  const t = normalizeForMatch(text);
  
  if (!t) return false;

  const patterns = [
    "quanto custa",
    "quanto e",
    "quanto ├®",
    "qual o preco",
    "qual preco",
    "qual o valor",
    "qual valor",
    "preco",
    "valor",
    "pre├ºo",
    "custa",
    "t├í quanto",
    "ta quanto",
  ];

  // patterns j├í est├úo "limpos" via normalizeForMatch na compara├º├úo
  if (patterns.some((p) => t.includes(normalizeForMatch(p)))) return true;
  if (t.startsWith("quanto") && (t.includes("custa") || t.includes("e") || t.includes("├®"))) return true;
  return false;
}

function isPingLike(text) {
  const inboundNorm = normalizeText(text);
  const inboundNormMatch = normalizeForMatch(inboundNorm);
  return (
    !inboundNorm ||
    inboundNorm.length <= 3 ||
    ["oi", "ola", "ol├í", "ok", "blz", "bom dia", "boa tarde", "boa noite"].includes(inboundNormMatch)
  );
}
/* ======================
   Facts defaults / shape (FIX CR├ìTICO)
====================== */
function ensureFactsShape(facts) {
  const f = facts && typeof facts === "object" ? facts : {};

  if (!f.pitches_sent || typeof f.pitches_sent !== "object") f.pitches_sent = {};

  if (!f.checkout || typeof f.checkout !== "object") f.checkout = {};
  const co = f.checkout;

  if (typeof co.awaiting_cep !== "boolean") co.awaiting_cep = false;
  if (typeof co.awaiting_payment !== "boolean") co.awaiting_payment = false;
  if (typeof co.awaiting_channel !== "boolean") co.awaiting_channel = false;
  if (typeof co.awaiting_affiliate_link !== "boolean") co.awaiting_affiliate_link = false;

  if (typeof co.sent !== "boolean") co.sent = false;
  if (typeof co.missing !== "boolean") co.missing = false;


  // Hybrid cooldown
  co.last_hybrid_at = Number(co.last_hybrid_at || 0);
  co.last_hybrid_inbound_key = String(co.last_hybrid_inbound_key || "");
  // Ô£à nullable strings (null ├® permitido)
  if (co.cep == null) co.cep = null;
  if (co.payment == null) co.payment = null;
  if (co.channel == null) co.channel = null;

  if (co.affiliate_url == null) co.affiliate_url = null;
  if (co.checkout_url == null) co.checkout_url = null;
  if (co.sent_at == null) co.sent_at = null;

  // anti-loop (n├úo apagar)
  if (co.llm_last_inbound_key == null) co.llm_last_inbound_key = null;
  if (co.llm_class_last_key == null) co.llm_class_last_key = null;
  if (co.pending_question_last_inbound_key == null) co.pending_question_last_inbound_key = null;

  if (!f.llm || typeof f.llm !== "object") f.llm = {};
  if (f.llm.last_used_at == null) f.llm.last_used_at = null;
  if (f.llm.last_reason == null) f.llm.last_reason = null;

  if (typeof f.stage !== "string") f.stage = f.stage ?? "";
  if (typeof f._dirty !== "boolean") f._dirty = false;

  return f;
}

/**
 * Ô£à Aplica defaults SEM apagar campos existentes (principalmente pitches_sent).
 */
function ensureFactsDefaults(facts, customer) {
  const f = ensureFactsShape(facts);

  f.stage = f.stage || customer?.stage || "abertura";

  f.checkout = {
    awaiting_cep: false,
    awaiting_payment: false,
    awaiting_channel: false,
    awaiting_affiliate_link: false,

    cep: null,
    payment: null,
    channel: null,
    affiliate_url: null,
    checkout_url: null,

    sent: false,
    sent_at: null,
    missing: false,

    llm_last_inbound_key: null,
    llm_class_last_key: null,
    pending_question_last_inbound_key: null,

    ...(f.checkout || {}),
  };

  f.pitches_sent = { ...(f.pitches_sent || {}) };

  f.llm = {
    last_used_at: null,
    last_reason: null,
    ...(f.llm || {}),
  };

  return f;
}

/* ======================
   Checkout state helpers
====================== */
function enforceSingleAwaiting(checkout) {
  if (!checkout || typeof checkout !== "object") return checkout;

  const awaitingKeys = Object.keys(checkout).filter((k) => k.startsWith("awaiting_") && checkout[k] === true);
  if (awaitingKeys.length <= 1) return checkout;

  const keep = awaitingKeys[0];
  for (const k of awaitingKeys) {
    if (k !== keep) checkout[k] = false;
  }
  return checkout;
}

function resetCheckoutState(facts) {
  facts = ensureFactsShape(facts);

  if (facts.closing) delete facts.closing;
  if (facts.shipping) delete facts.shipping;
  if (facts.payment) delete facts.payment;
  if (facts.last_order) delete facts.last_order;

  facts.checkout = facts.checkout && typeof facts.checkout === "object" ? facts.checkout : {};

  facts.checkout.awaiting_cep = false;
  facts.checkout.awaiting_payment = false;
  facts.checkout.awaiting_channel = false;
  facts.checkout.awaiting_affiliate_link = false;

  facts.checkout.cep = null;
  facts.checkout.payment = null;
  facts.checkout.channel = null;
  facts.checkout.affiliate_url = null;
  facts.checkout.checkout_url = null;

  facts.checkout.sent = false;
  facts.checkout.sent_at = null;
  facts.checkout.missing = false;

  facts.checkout.llm_last_inbound_key = null;
  facts.checkout.llm_class_last_key = null;
  facts.checkout.pending_question_last_inbound_key = null;

  facts.stage = "checkout_start";
  facts.last_reset_at = new Date().toISOString();

  facts._dirty = true;
  return facts;
}

function normalizeFactsForCheckout(facts) {
  facts = ensureFactsShape(facts);

  if (facts.checkout && Object.keys(facts.checkout).length > 0 && facts.closing) delete facts.closing;

  if (!facts.checkout.cep && typeof facts.shipping?.cep === "string") {
    const cep = normalizeCep(facts.shipping.cep);
    if (cep) facts.checkout.cep = cep;
  }

  if (!facts.checkout.payment && typeof facts.payment?.method === "string") {
    facts.checkout.payment = facts.payment.method;
  }

  if (!("llm_last_inbound_key" in facts.checkout)) facts.checkout.llm_last_inbound_key = null;
  if (!("llm_class_last_key" in facts.checkout)) facts.checkout.llm_class_last_key = null;
  if (!("pending_question_last_inbound_key" in facts.checkout)) facts.checkout.pending_question_last_inbound_key = null;

  enforceSingleAwaiting(facts.checkout);
  return facts;
}

/* ======================
   Pitch anti-spam (facts_json)
====================== */
function wasPitchSentFacts(facts, key) {
  const f = ensureFactsShape(facts);
  if (!key) return false;
  return !!(f.pitches_sent && typeof f.pitches_sent === "object" && f.pitches_sent[key] === true);
}

function markPitchSentFacts(facts, key) {
  const f = ensureFactsShape(facts);

  f.pitches_sent = f.pitches_sent && typeof f.pitches_sent === "object" ? f.pitches_sent : {};
  if (key) f.pitches_sent[key] = true;

  f._dirty = true;
  return f;
}

/* ======================
   Playbook helpers
====================== */
function normalizePitchByStage({ pitch_by_stage_raw, data_json }) {
  const pitch_by_stage = { ...(pitch_by_stage_raw || {}) };

  if (!pitch_by_stage.abertura && data_json?.pitch_abertura) pitch_by_stage.abertura = String(data_json.pitch_abertura).trim();
  if (!pitch_by_stage.diagnostico && data_json?.pitch_diagnostico)
    pitch_by_stage.diagnostico = String(data_json.pitch_diagnostico).trim();
  if (!pitch_by_stage.oferta && data_json?.pitch_oferta) pitch_by_stage.oferta = String(data_json.pitch_oferta).trim();
  if (!pitch_by_stage.fechamento && data_json?.pitch_fechamento)
    pitch_by_stage.fechamento = String(data_json.pitch_fechamento).trim();

  return pitch_by_stage;
}

async function getPlaybookRow({ tenant_id, product_key }) {
  if (!tenant_id || !product_key) return null;

  const pk = normalizeProductKey(product_key);

  const row = await db.get(
    `SELECT
      product_key,
      name,
      description,
      data_json,
      pitch_by_stage,
      objections_json,
      rules_json,
      policies_json
     FROM product_playbooks
     WHERE tenant_id = ? AND product_key = ?
     ORDER BY id DESC
     LIMIT 1`,
    [tenant_id, pk]
  );

  if (!row) return null;

  const data_json = safeJsonParse(row.data_json, {}) || {};
  const pitch_by_stage_raw = safeJsonParse(row.pitch_by_stage, {}) || {};
  const pitch_by_stage = normalizePitchByStage({ pitch_by_stage_raw, data_json });

  const objections_json = safeJsonParse(row.objections_json, null);
  const rules_json = safeJsonParse(row.rules_json, null);
  const policies_json = safeJsonParse(row.policies_json, null);

  return {
    tenant_id,
    product_key: row.product_key,
    name: row.name || null,
    description: row.description || null,
    data_json,
    pitch_by_stage,
    objections_json: objections_json ?? null,
    rules_json: rules_json ?? null,
    policies_json: policies_json ?? null,
  };
}

async function getPlaybookRowWithFallback({ tenant_id, product_key }) {
  const requested = normalizeProductKey(product_key);

  if (!tenant_id) {
    return {
      pb: null,
      used_product_key: requested,
      fallback_used: false,
      _meta: {
        requested_product_key: requested,
        used_product_key: requested,
        fallback_used: false,
        reason: "missing_tenant_id",
      },
    };
  }

  const pbProduct = await getPlaybookRow({ tenant_id, product_key: requested });
  if (pbProduct) {
    return {
      pb: pbProduct,
      used_product_key: requested,
      fallback_used: false,
      _meta: {
        requested_product_key: requested,
        used_product_key: requested,
        fallback_used: false,
        reason: "product_found",
      },
    };
  }

  if (!requested || requested === "DEFAULT") {
    return {
      pb: null,
      used_product_key: "DEFAULT",
      fallback_used: false,
      _meta: {
        requested_product_key: requested || "DEFAULT",
        used_product_key: "DEFAULT",
        fallback_used: false,
        reason: "default_missing",
      },
    };
  }

  const pbDefault = await getPlaybookRow({ tenant_id, product_key: "DEFAULT" });
  if (pbDefault) {
    return {
      pb: pbDefault,
      used_product_key: "DEFAULT",
      fallback_used: true,
      _meta: {
        requested_product_key: requested,
        used_product_key: "DEFAULT",
        fallback_used: true,
        reason: "fallback_to_default",
      },
    };
  }

  return {
    pb: null,
    used_product_key: requested,
    fallback_used: false,
    _meta: {
      requested_product_key: requested,
      used_product_key: requested,
      fallback_used: false,
      reason: "no_playbook_found",
    },
  };
}

/* ======================
   Policies / Rules / Objections
====================== */
function pickFirst(arr) {
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

function detectObjection({ objections_json, inboundText, stage }) {
  const t = normalizeForMatch(inboundText);
  if (!objections_json || typeof objections_json !== "object") return null;

  const scoped = objections_json?.[stage] && typeof objections_json[stage] === "object" ? objections_json[stage] : objections_json;

  for (const key of Object.keys(scoped)) {
    const k = normalizeForMatch(key);
    if (!k) continue;
    if (t.includes(k)) {
      const answers = scoped[key];
      // compat: pode ser array/string/obj
      const answer = Array.isArray(answers) ? pickFirst(answers) : answers;
      return { key, answers, answer };
    }
  }
  return null;
}

function applyPolicies({ policies_json, textOut, facts }) {
  if (!policies_json || typeof policies_json !== "object") return { textOut, facts };

  let out = String(textOut || "");
  const forbidden = Array.isArray(policies_json.forbidden_phrases) ? policies_json.forbidden_phrases : [];
  for (const phrase of forbidden) {
    const p = normalizeForMatch(phrase);
    if (p && normalizeForMatch(out).includes(p)) {
      out = "Entendi. Vou te ajudar por aqui com as informa├º├Áes certas. ­ƒÖé";
      break;
    }
  }
  return { textOut: out, facts };
}

function applyRules({ rules_json, facts }) {
  if (!rules_json || typeof rules_json !== "object") return { facts };
  const stage = facts?.stage;
  const byStage = rules_json?.by_stage?.[stage];
  if (byStage && typeof byStage === "object") {
    if (byStage.allow_discount === false) facts.allow_discount = false;
    if (byStage.force_cta) facts.force_cta = String(byStage.force_cta);
  }
  return { facts };
}

function shouldUsePitchForStage({ pitch_by_stage, stage }) {
  if (!pitch_by_stage || typeof pitch_by_stage !== "object") return null;
  const s = pitch_by_stage?.[stage];
  return s && String(s).trim() ? String(s).trim() : null;
}

async function applyPlaybook({ playbook, inboundText, facts, applyTrainingToOutgoing, humanTraining }) {
  if (!playbook) return { handled: false, text: null, facts };

  const stage = facts?.stage || "abertura";

  ({ facts } = applyRules({ rules_json: playbook.rules_json, facts }));

  const obj = detectObjection({ objections_json: playbook.objections_json, inboundText, stage });
  if (obj) {
    // resolve "chosen" compat
    let chosen = "";
    if (Array.isArray(obj?.answers) && obj.answers.length) chosen = String(pickFirst(obj.answers) || "").trim();
    else if (typeof obj?.answers === "string" && obj.answers.trim()) chosen = obj.answers.trim();
    else if (typeof obj?.answer === "string" && obj.answer.trim()) chosen = obj.answer.trim();
    else if (obj?.answer && typeof obj.answer === "object") {
      const maybe =
        (typeof obj.answer.text === "string" && obj.answer.text.trim()) ||
        (typeof obj.answer.value === "string" && obj.answer.value.trim()) ||
        "";
      chosen = String(maybe || "").trim();
    }

    if (chosen) {
      let textOut = chosen;
      if (typeof applyTrainingToOutgoing === "function") {
        textOut = applyTrainingToOutgoing(textOut, humanTraining, `playbook_objection_${obj.key}`);
      }
      ({ textOut, facts } = applyPolicies({ policies_json: playbook.policies_json, textOut, facts }));
      facts._dirty = true;
      return { handled: true, text: textOut, facts, meta: { kind: "objection", key: obj.key } };
    }
  }

  const pitch = shouldUsePitchForStage({ pitch_by_stage: playbook.pitch_by_stage, stage });
  if (pitch) {
    let textOut = pitch;
    if (typeof applyTrainingToOutgoing === "function") {
      textOut = applyTrainingToOutgoing(textOut, humanTraining, `playbook_pitch_${stage}`);
    }
    ({ textOut, facts } = applyPolicies({ policies_json: playbook.policies_json, textOut, facts }));
    facts._dirty = true;
    return { handled: true, text: textOut, facts, meta: { kind: "pitch", stage } };
  }

  return { handled: false, text: null, facts };
}

async function getCheckoutUrl({ tenant_id, product_key, channel }) {
  if (!tenant_id || !product_key || !channel) return null;

  const wrap = await getPlaybookRowWithFallback({ tenant_id, product_key });
  const pb = wrap?.pb;
  if (!pb) return null;

  const data = pb?.data_json || {};
  const urls = data?.checkout_urls || data?.checkoutUrls || {};
  return urls?.[channel] || null;
}

/* ======================
   Training formatting
====================== */
function textHasEmoji(t) {
  return /[­ƒÿè­ƒÖéÔ£à­ƒöÑ­ƒæëÔ×í´©Å]/.test(t);
}
function removeKnownEmojis(t) {
  return String(t ?? "")
    .replace(/[­ƒÿè­ƒÖéÔ£à­ƒöÑ­ƒæëÔ×í´©Å]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
function isNoEmojiPolicy(emojiUsage) {
  const s = normalizeForMatch(emojiUsage);
  return s.includes("nenhum") || s.includes("sem") || s.includes("zero");
}
function isHighEmojiPolicy(emojiUsage) {
  const s = normalizeForMatch(emojiUsage);
  return s.includes("alto") || s.includes("muito") || s.includes("bastante");
}
function isInformalLanguage(languageLevel, toneStyle) {
  const a = normalizeForMatch(languageLevel);
  const b = normalizeForMatch(toneStyle);
  return a.includes("informal") || a.includes("giria") || b.includes("informal") || b.includes("amigo") || b.includes("descontra");
}
function isMoreDirectPressure(pressureLevel) {
  const s = normalizeForMatch(pressureLevel);
  return s.includes("alta") || s.includes("agressiv") || s.includes("forte");
}

function applyTrainingToOutgoing(text, ht = {}, stage = "") {
  let out = String(text ?? "");

  if (isNoEmojiPolicy(ht.emoji_usage)) out = removeKnownEmojis(out);
  else if (isHighEmojiPolicy(ht.emoji_usage)) {
    if (!textHasEmoji(out)) out = out + " ­ƒÖé";
  }

  const energy = normalizeForMatch(ht.energy);
  if (energy.includes("baixa")) out = out.replace(/!{2,}/g, "!").replace(/­ƒÿè|­ƒÖé/g, "").trim();

  if (isMoreDirectPressure(ht.pressure_level)) out = out.replace(/\s*\n\s*\n/g, "\n").trim();

  if (stage === "send_final") {
    const tail = "Se precisar, eu te ajudo por aqui.";
    if (!out.toLowerCase().includes("se precisar")) out = out + "\n\n" + tail;
  }

  return out;
}

/* ======================
   Copy (mensagens)
====================== */
function humanAskCep(ht) {
  const informal = isInformalLanguage(ht.language_level, ht.tone_style);
  const msg = informal
    ? "Fechou! Me passa teu *CEP* (ex: 01001-000) pra eu ver o prazo ­ƒÖé"
    : "Perfeito! ­ƒÿè Me passa seu *CEP* (ex: 01001-000) pra calcular o prazo.";
  return applyTrainingToOutgoing(msg, ht, "ask_cep");
}
function humanAskPayment(ht) {
  const informal = isInformalLanguage(ht.language_level, ht.tone_style);
  const msg = informal ? "Boa! Vai pagar no *PIX* ou no *cart├úo*? ­ƒÖé" : "Show! Voc├¬ prefere pagar no *PIX* ou *cart├úo*? ­ƒÖé";
  return applyTrainingToOutgoing(msg, ht, "ask_payment");
}
function humanAskChannel(ht) {
  const informal = isInformalLanguage(ht.language_level, ht.tone_style);
  const msg = informal ? "Qual canal voc├¬ quer? *Amazon* / *Mercado Livre* / *Loja oficial*" : "Confirma o canal: *Amazon* / *Mercado Livre* / *Loja oficial*?";
  return applyTrainingToOutgoing(msg, ht, "ask_channel");
}
function humanAskAffiliateLink(channel, ht) {
  const label = channel === "amazon" ? "Amazon" : channel === "mercado_livre" ? "Mercado Livre" : "Loja oficial";
  const informal = isInformalLanguage(ht.language_level, ht.tone_style);
  const msg = informal
    ? `Show Ô£à Canal: *${label}*. Agora me manda teu link do produto (afiliado) pra eu te passar o final aqui ­ƒÖé`
    : `Perfeito Ô£à Canal escolhido: *${label}*. Agora me manda o link do produto (seu link de afiliado) pra eu te entregar aqui e finalizar ­ƒÖé`;
  return applyTrainingToOutgoing(msg, ht, "ask_affiliate");
}
function humanSendFinalLink(url, ht) {
  const informal = isInformalLanguage(ht.language_level, ht.tone_style);
  const direct = isMoreDirectPressure(ht.pressure_level);

  let msg;
  if (direct) msg = `Link pra finalizar: ${url}`;
  else if (informal) msg = `Pronto Ô£à Finaliza por aqui: ${url}`;
  else msg = `Perfeito Ô£à Finalize por aqui: ${url}`;

  return applyTrainingToOutgoing(msg, ht, "send_final");
}
function humanInvalidCep(ht) {
  const informal = isInformalLanguage(ht.language_level, ht.tone_style);
  const msg = informal ? "Me manda o CEP assim: *01001-000* ­ƒÖé" : "Me manda seu CEP nesse formato: *01001-000* ­ƒÖé";
  return applyTrainingToOutgoing(msg, ht, "invalid");
}
function humanInvalidPayment(ht) {
  const msg = "S├│ pra eu seguir: voc├¬ prefere *PIX* ou *cart├úo*? ­ƒÖé";
  return applyTrainingToOutgoing(msg, ht, "invalid");
}
function humanInvalidAffiliateLink(ht) {
  const msg = "Me manda o *link completo* (come├ºando com http/https) pra eu finalizar ­ƒÖé";
  return applyTrainingToOutgoing(msg, ht, "invalid");
}
function humanLLMQuotaFallback(ht) {
  const msg = "Entendi. ­ƒÖé Quer que eu te passe a op├º├úo mais em conta ou prefere que eu te explique o custo-benef├¡cio rapidinho?";
  return applyTrainingToOutgoing(msg, ht, "fallback_llm_429");
}

/* ======================
   Heur├¡stica: quando chamar o LLM fora do checkout
====================== */
function shouldUseLLMOutsideCheckout(text) {
  const t = normalizeForMatch(text);
  
  if (!t) return false;

  const keywords = [
    "caro",
    "preco",
    "valor",
    "desconto",
    "prazo",
    "demora",
    "frete",
    "nao confio",
    "medo",
    "garantia",
    "como funciona",
    "e seguro",
    "tem nota",
    "qual diferenca",
    "diferenca",
    "diferenciais",
    "me explica",
    "explica",
    "me fala",
    "fala mais",
    "detalhes",
    "beneficios",
    "vantagens",
    "vale a pena",
  ];

  if (keywords.some((k) => t.includes(k))) return true;
  if (t.endsWith("?")) return true;

  const starts = ["porque", "pq", "como", "qual", "quais", "quanto", "onde", "quando", "o que"];
  if (starts.some((s) => t.startsWith(s + " "))) return true;

  return false;
}

/* ======================
   Ô£à LLM h├¡brido dentro do checkout (pergunta pendente)
====================== */
function markPendingQuestionAppendedForInbound(facts, inboundKey) {
  if (!facts) return;
  if (!facts.checkout) facts.checkout = {};
  facts.checkout.pending_question_last_inbound_key = String(inboundKey);
  facts._dirty = true;
}

function alreadyAppendedPendingQuestionForThisInbound(facts, inboundKey) {
  const last = facts?.checkout?.pending_question_last_inbound_key;
  return last && String(last) === String(inboundKey);
}

function getCheckoutPendingQuestion(checkout, ht, channel, facts, inboundKey) {
  if (!checkout) return null;
  if (facts && inboundKey && alreadyAppendedPendingQuestionForThisInbound(facts, inboundKey)) return null;

  if (checkout.awaiting_cep) return humanAskCep(ht);
  if (checkout.awaiting_payment) return humanAskPayment(ht);
  if (checkout.awaiting_channel) return humanAskChannel(ht);
  if (checkout.awaiting_affiliate_link) return humanAskAffiliateLink(channel || checkout.channel, ht);
  return null;
}

function buildInboundKey({ customer, decision, text }) {
  const a = decision?.message_id || decision?.inbound_message_id || decision?.wa_message_id || null;
  if (a) return String(a);

  const phone = customer?.phone || customer?.customer_phone || "unknown";
  return `${phone}::${normalizeForMatch(text)}`;
}

function alreadyUsedLLMForThisInbound(facts, inboundKey) {
  const lastKey = facts?.checkout?.llm_last_inbound_key;
  return lastKey && String(lastKey) === String(inboundKey);
}

function markLLMUsedForInbound(facts, inboundKey) {
  if (!facts.checkout) facts.checkout = {};
  facts.checkout.llm_last_inbound_key = String(inboundKey);
  facts._dirty = true;
}

function looksLikeObjection(textRaw) {
  const t = normalizeForMatch(textRaw || "");
  const patterns = [
    "ta caro",
    "t├í caro",
    "caro",
    "preco",
    "pre├ºo",
    "valor",
    "desconto",
    "mais barato",
    "frete caro",
    "nao confio",
    "n├úo confio",
    "golpe",
    "reclame aqui",
    "demora",
    "prazo",
    "quando chega",
    "vou pensar",
    "desisti",
    "n├úo quero",
    "nao quero",
    "humano",
    "atendente",
    "suporte",
  ];
  return patterns.some((p) => t.includes(normalizeForMatch(p))) || t.includes("medo") || t.includes("receio") || t.includes("duvida") || t.includes("risco");
}

/* ======================
   Ô£à Classificador LLM no checkout (PASSO 4)
====================== */
function getPendingFieldFromCheckout(co) {
  if (!co) return null;
  if (co.awaiting_cep) return "cep";
  if (co.awaiting_payment) return "payment";
  if (co.awaiting_channel) return "channel";
  if (co.awaiting_affiliate_link) return "affiliate_link";
  return null;
}

function buildClassifierKey({ customer, facts, text, pendingField }) {
  const phone = customer?.phone || customer?.customer_phone || "unknown";
  const stage = facts?.stage || "";
  return `${phone}::${stage}::${pendingField || ""}::${normalizeForMatch(text)}`;
}

function parseClassifierJson(raw) {
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    const type = ["objection", "checkout_data", "other"].includes(obj?.type) ? obj.type : "other";
    const field = ["cep", "payment", "channel", "affiliate_link"].includes(obj?.field) ? obj.field : null;
    const value = typeof obj?.value === "string" ? obj.value : null;
    const confidenceNum = Number(obj?.confidence ?? 0);
    const confidence = Number.isFinite(confidenceNum) ? Math.max(0, Math.min(1, confidenceNum)) : 0;
    return { type, field, value, confidence };
  } catch {
    return { type: "other", field: null, value: null, confidence: 0 };
  }
}

function strongDetectByPending(pendingField, text) {
  if (pendingField === "cep") {
    const cep = normalizeCep(text);
    return cep ? { field: "cep", value: cep, confidence: 0.95 } : null;
  }
  if (pendingField === "payment") {
    const pay = normalizePayment(text);
    return pay ? { field: "payment", value: pay, confidence: 0.9 } : null;
  }
  if (pendingField === "channel") {
    const ch = normalizeChannel(text);
    return ch ? { field: "channel", value: ch, confidence: 0.85 } : null;
  }
  if (pendingField === "affiliate_link") {
    return looksLikeUrl(text) ? { field: "affiliate_link", value: normalizeText(text), confidence: 0.95 } : null;
  }
  return null;
}

async function classifyInboundInCheckoutLLM({ tenant_id, product_key, facts, co, pendingField, text, humanTraining }) {
  const strong = strongDetectByPending(pendingField, text);
  if (strong) return { type: "checkout_data", field: strong.field, value: strong.value, confidence: strong.confidence };

  const schemaHint =
    'Responda APENAS JSON minificado com chaves: type, field, value, confidence.\n' +
    'type: "objection" | "checkout_data" | "other"\n' +
    'field: "cep" | "payment" | "channel" | "affiliate_link" | null\n' +
    'value: string | null\n' +
    "confidence: n├║mero 0..1\n" +
    "Regras DURAS:\n" +
    `- Estamos aguardando SOMENTE o campo: ${pendingField}.\n` +
    `- Se o texto N├âO contiver claramente esse campo (${pendingField}), retorne type="other".\n` +
    `- Se for obje├º├úo (pre├ºo, medo, compara├º├úo, d├║vida, desconfian├ºa): type="objection".\n` +
    "- Nunca retorne um field diferente do pending.\n" +
    "N├úo inclua texto fora do JSON.";

  const stageContext = {
    stage: facts.stage || "checkout",
    mode: "checkout_classifier_json",
    pending_field: pendingField,
    checkout: {
      awaiting_cep: !!co.awaiting_cep,
      awaiting_payment: !!co.awaiting_payment,
      awaiting_channel: !!co.awaiting_channel,
      awaiting_affiliate_link: !!co.awaiting_affiliate_link,
    },
    instruction: schemaHint,
    training_hint: { tone_style: humanTraining?.tone_style, language_level: humanTraining?.language_level },
  };

  const userText = `PENDING_FIELD: ${pendingField}\nTEXTO: ${text}\n\n${schemaHint}`;

  try {
    const raw = await generateLLMResponse({ tenant_id, product_key, facts, stageContext, userText });
    return parseClassifierJson(raw);
  } catch (err) {
    const msg = String(err?.message || err);
    if (err?.code === "LLM_QUOTA" || msg.includes("429") || msg.toLowerCase().includes("quota")) {
      return { type: "other", field: null, value: null, confidence: 0 };
    }
    console.error("ÔØî [agent] classifier LLM error:", msg);
    return { type: "other", field: null, value: null, confidence: 0 };
  }
}

/* ======================
   Ô£à ClassKey SAFE (centralizado)
   - ├ÜNICO lugar que grava co.llm_class_last_key (exceto reset/finish => null)
====================== */
function validatePendingInputOrNull({ pendingField, text }) {
  const raw = normalizeText(text);

  if (pendingField === "cep") {
    if (looksLikeUrl(raw)) return { ok: false, reason: "url_in_cep" };
    const cepTry = normalizeCep(raw);
    if (!cepTry) return { ok: false, reason: "invalid_cep" };
    return { ok: true, normalized: cepTry };
  }

  if (pendingField === "channel") {
    if (looksLikeUrl(raw)) return { ok: false, reason: "url_in_channel" };
    const chTry = normalizeChannel(raw);
    const token = String(chTry || "").toLowerCase().replace(/\s+/g, "_");

    const allowed = new Set(["amazon", "mercado_livre", "loja_oficial"]);
    const blocked = new Set(["pix", "cartao", "cart├úo", "whatsapp", "instagram", "telegram"]);

    if (!chTry || blocked.has(token) || !allowed.has(token)) return { ok: false, reason: "invalid_channel" };
    return { ok: true, normalized: chTry };
  }

  if (pendingField === "payment") {
    if (looksLikeUrl(raw)) return { ok: false, reason: "url_in_payment" };
    const payTry = normalizePayment(raw); // "pix" | "cartao"
    const token = String(payTry || "").toLowerCase().replace(/\s+/g, "_");
    const allowed = new Set(["pix", "cartao", "cart├úo"]);
    if (!payTry || !allowed.has(token)) return { ok: false, reason: "invalid_payment" };
    return { ok: true, normalized: payTry };
  }

  if (pendingField === "affiliate_link") {
    if (!looksLikeUrl(raw)) return { ok: false, reason: "invalid_affiliate_link" };
    return { ok: true, normalized: raw };
  }

  return { ok: false, reason: "unknown_pending_field" };
}

/* ======================
   Persist / stage sync
====================== */
async function maybeSyncStageToDB({ tenant_id, customer, facts }) {
  const desired = facts?.stage;
  if (!tenant_id || !customer || !desired) return;

  const customerId = customer?.id ?? customer?.customer_id ?? null;
  const phone = customer?.phone ?? customer?.customer_phone ?? null;

  const current = customer?.stage;
  if (String(current || "") === String(desired || "")) return;

  async function tryUpdate(whereSql, params) {
    const res = await db.run(
      `UPDATE customers
          SET stage = ?
        WHERE tenant_id = ?
          AND ${whereSql}`,
      [String(desired), tenant_id, ...params]
    );
    return Number(res?.changes || 0) > 0;
  }

  try {
    if (customerId) {
      const ok = await tryUpdate("id = ?", [customerId]);
      if (ok) {
        customer.stage = String(desired);
        return;
      }
    }

    if (phone) {
      const okPhone = await tryUpdate("phone = ?", [phone]);
      if (okPhone) {
        customer.stage = String(desired);
        return;
      }
    }

    console.warn("ÔÜá´©Å [agent] stage sync: nenhuma linha atualizada", { tenant_id, customerId, phone, desired });
  } catch (e) {
    console.error("ÔØî [agent] stage sync failed:", e?.message || String(e));
  }
}

async function persistFactsJson({ tenant_id, customer, facts }) {
  if (!tenant_id || !customer) return;

  const customerId = customer?.id ?? customer?.customer_id ?? null;
  const phone = customer?.phone ?? customer?.customer_phone ?? null;

  const factsStr = JSON.stringify(facts || {});

  async function tryUpdate(whereSql, params) {
    const res = await db.run(
      `UPDATE customers
          SET facts_json = ?
        WHERE tenant_id = ?
          AND ${whereSql}`,
      [factsStr, tenant_id, ...params]
    );
    return Number(res?.changes || 0) > 0;
  }

  try {
    if (customerId) {
      const ok = await tryUpdate("id = ?", [customerId]);
      if (ok) return;
    }

    if (phone) {
      const okPhone = await tryUpdate("phone = ?", [phone]);
      if (okPhone) return;
    }

    console.warn("ÔÜá´©Å [agent] persist facts_json: nenhuma linha atualizada", { tenant_id, customerId, phone });
  } catch (e) {
    console.warn("[agent] WARN persist facts_json failed", { tenant_id, customerId, phone, err: String(e?.message || e) });
  }
}

async function finishCheckout({ tenant_id, customer, facts, co }) {
  const now = new Date().toISOString();

  co.sent = true;
  co.sent_at = now;
  co.missing = false;

  co.awaiting_cep = false;
  co.awaiting_payment = false;
  co.awaiting_channel = false;
  co.awaiting_affiliate_link = false;

  facts.last_order = {
    completed_at: now,
    channel: co.channel || null,
    affiliate_url: co.affiliate_url || null,
    checkout_url: co.checkout_url || null,
  };

  facts.stage = "pos_checkout";

  // reset anti-loop markers
  co.llm_class_last_key = null;
  co.llm_last_inbound_key = null;
  co.pending_question_last_inbound_key = null;

  facts._dirty = true;

  await maybeSyncStageToDB({ tenant_id, customer, facts });
  await persistFactsJson({ tenant_id, customer, facts });
}

function shouldAutoPersistFacts() {
  const mode = normalizeForMatch(process.env.PERSIST_FACTS_MODE || "auto");
  if (mode.includes("manual")) return "manual";
  if (mode.includes("always")) return "always";
  return "auto";
}

async function respond({ tenant_id, customer, facts, payload }) {
  await maybeSyncStageToDB({ tenant_id, customer, facts });

  const mode = shouldAutoPersistFacts();
  if (mode === "always" || (mode === "auto" && facts && facts._dirty)) {
    await persistFactsJson({ tenant_id, customer, facts });
    if (facts) facts._dirty = false;
  }

  return payload;
}

/* ==========================================================
   Ô£à PASSO 5.5 ÔÇö BYPASS product_intelligence
========================================================== */
function buildIntelBypassResponse({ text, product_intelligence }) {
  if (!text) return null;
  if (!product_intelligence || typeof product_intelligence !== "object") return null;

  const t = normalizeForMatch(text);
  

  const intelKeywords = [
    "diferencial",
    "diferenciais",
    "beneficio",
    "beneficios",
    "vantagem",
    "vantagens",
    "garantia",
    "prova",
    "provas",
    "evidencia",
    "evidencias",
    "porque comprar",
    "vale a pena",
    "sobre o produto",
  ];

  if (!intelKeywords.some((k) => t.includes(k))) return null;

  const diffs = Array.isArray(product_intelligence.differentials) ? product_intelligence.differentials.filter(Boolean) : [];
  const benefits = Array.isArray(product_intelligence.main_benefits) ? product_intelligence.main_benefits.filter(Boolean) : [];
  const proof = Array.isArray(product_intelligence.proof) ? product_intelligence.proof.filter(Boolean) : [];

  const line1 = diffs[0] || benefits[0] || null;
  const line2 = diffs[1] || benefits[1] || proof[0] || null;

  const lines = [line1, line2].filter(Boolean).slice(0, 2);
  if (!lines.length) return null;

  return lines.map((s) => String(s).trim()).join("\n");
}

/* ======================
   Controle de duplica├º├úo no h├¡brido
====================== */
function answerAlreadyMentionsPending(answer, pendingField) {
  const a = normalizeForMatch(answer || "");
  if (!a) return false;

  if (pendingField === "cep") return a.includes("cep");
  if (pendingField === "payment") return a.includes("pix") || a.includes("cartao") || a.includes("boleto");
  if (pendingField === "channel") return a.includes("amazon") || a.includes("mercado") || a.includes("loja");
  if (pendingField === "affiliate_link") return a.includes("http") || a.includes("link");

  return false;
}

/* ======================
   DB helper: primeira intera├º├úo real (inbound)
====================== */
async function inboundCountByPhone({ tenant_id, phone }) {
  if (!tenant_id || !phone) return 0;

  try {
    const r1 = await db.get(
      `SELECT COUNT(*) AS c
         FROM messages
        WHERE tenant_id = ?
          AND direction = 'in'
          AND phone = ?`,
      [tenant_id, String(phone)]
    );
    return Number(r1?.c || 0);
  } catch {
    const r2 = await db.get(
      `SELECT COUNT(*) AS c
         FROM messages
        WHERE tenant_id = ?
          AND direction = 'in'
          AND customer_phone = ?`,
      [tenant_id, String(phone)]
    );
    return Number(r2?.c || 0);
  }
}

/* ======================
   Main
====================== */
async function run({ tenant_id, customer, incomingText, decision }) {
  const text = normalizeText(incomingText);

  // 🚀 OBJECTION FIRST (correto)
  if (looksLikeObjection(text)) {
    console.log("[agent] FORCE LLM (OBJECTION FIRST)");

    try {
      const stageContext = { stage: "abertura", goal: "acolher_objecao_responder_com_seguranca_e_conduzir_para_proximo_microcompromisso_de_compra" };

      const llmOut = await generateLLMResponse({
        tenant_id,
        product_key: "DEFAULT",
        facts,
        stageContext,
        userText: text,
      });

      const finalText = appendSmartAdvance(applyTrainingToOutgoing(llmOut, humanTraining, "llm_objection_first"), facts);

      return await respond({
        tenant_id,
        customer,
        facts,
        payload: { type: "text", text: finalText, facts },
      });
    } catch (err) {
      console.error("[agent] LLM objection-first error:", err);
    }
  }
  const phone = customer?.phone || customer?.customer_phone || null;

  console.log("### RUN CALLED ###", { tenant_id, phone, incomingText: text });
  console.log("AGENT EXECUTANDO", {
    tenant_id,
    phone,
    incomingText: text,
    customerStage: customer?.stage,
  });

  // 1) Facts
  let facts = safeJsonParse(customer?.facts_json, {});
  if (!facts || typeof facts !== "object") facts = {};
  facts = normalizeFactsForCheckout(facts);
  facts = ensureFactsDefaults(facts, customer);

  // Ô£à STAGE SYNC (load): customers.stage Ôåö facts.stage
  {
    const dbStage = String(customer?.stage || "").trim();
    const factsStage = String(facts?.stage || "").trim();
    if (dbStage && dbStage !== factsStage) {
      facts.stage = dbStage;
      facts._dirty = true;
      facts.llm = facts.llm && typeof facts.llm === "object" ? facts.llm : {};
      facts.llm.last_reason = "stage_sync_from_customer";
      console.log("[agent] STAGE SYNC (load)", { tenant_id, phone, dbStage, factsStage });
    }
  }

  // 2) Product + training (+ product_intelligence)
  const product_key = await getCustomerProductKey(tenant_id, customer);

  const bundle = await getEffectiveTraining({ tenant_id, product_key });
  const humanTraining = bundle?.training ? bundle.training : bundle;
  const product_intelligence = bundle?.product_intelligence || null;

  // 3) Carrega playbook (1x)
  const pbWrap = await getPlaybookRowWithFallback({ tenant_id, product_key });
  const pb = pbWrap?.pb || null;

  console.log("[agent] PLAYBOOK INFO", {
    tenant_id,
    phone,
    product_key_requested: product_key,
    pb_found: !!pb,
    pb_product_key: pb?.product_key,
    fallback_used: !!pbWrap?.fallback_used,
    used_product_key: pbWrap?.used_product_key,
    pitch_by_stage_type: typeof pb?.pitch_by_stage,
    pitch_by_stage: pb?.pitch_by_stage,
    meta: pbWrap?._meta,
  });

  // 🚀 PRIORIDADE: OBJEÇÃO NO PRIMEIRO CONTATO (ANTES DO PLAYBOOK)
  if (looksLikeObjection(text)) {
    console.log("[agent] FORCE LLM (objection first)");
    try {
      const stageContext = { stage: facts.stage || "abertura", goal: "acolher_objecao_responder_com_seguranca_e_conduzir_para_proximo_microcompromisso_de_compra" };
      const llmOut = await generateLLMResponse({ tenant_id, product_key, facts, stageContext, userText: text });
      const finalText = appendSmartAdvance(applyTrainingToOutgoing(llmOut, humanTraining, "llm_objection_first"), facts);
      return await respond({ tenant_id, customer, facts, payload: { type: "text", text: finalText, facts } });
    } catch (err) {
      console.error("[agent] LLM objection-first error:", err);
    }
  }

  // 4) Buy intent => reset forte e entra em checkout
  if (isBuyIntent(text) && !looksLikeObjection(text)) {
    facts = resetCheckoutState(facts);
    facts.checkout.awaiting_cep = true;
    enforceSingleAwaiting(facts.checkout);

    console.log("[agent] ENTER CHECKOUT (reset by buy intent)", { tenant_id, product_key, phone });

    return await respond({
      tenant_id,
      customer,
      facts,
      payload: { type: "text", text: humanAskCep(humanTraining), facts },
    });
  }

  // 5) Checkout state machine flags
  facts.checkout = enforceSingleAwaiting(facts.checkout);
  const co = facts.checkout;

  // auto-heal awaitings
  if (co.awaiting_affiliate_link && co.affiliate_url) co.awaiting_affiliate_link = false;
  if (co.awaiting_channel && co.channel) co.awaiting_channel = false;
  if (co.awaiting_payment && co.payment) co.awaiting_payment = false;
  if (co.awaiting_cep && co.cep) co.awaiting_cep = false;

  // se sent => mata awaitings e garante pos_checkout (mas N├âO bloqueia LLM fora do checkout)
  if (co.sent) {
    co.awaiting_cep = false;
    co.awaiting_payment = false;
    co.awaiting_channel = false;
    co.awaiting_affiliate_link = false;
    enforceSingleAwaiting(co);

    if (!facts.stage || facts.stage === "checkout_start" || String(facts.stage).startsWith("checkout_")) {
      facts.stage = "pos_checkout";
      facts._dirty = true;
    }
  }

  const needsCheckoutFlow =
    co.awaiting_cep ||
    co.awaiting_payment ||
    co.awaiting_channel ||
    co.awaiting_affiliate_link ||
    (!co.sent && (!!co.cep || !!co.payment || !!co.channel || !!co.affiliate_url));

  console.log("[agent] LLM CHECK:", {
    needsCheckoutFlow,
    sent: !!co.sent,
    stage: facts.stage,
    awaiting: {
      cep: !!co.awaiting_cep,
      payment: !!co.awaiting_payment,
      channel: !!co.awaiting_channel,
      affiliate: !!co.awaiting_affiliate_link,
    },
  });

  console.log("[agent] LLM DECISION:", {
    needsCheckoutFlow,
    shouldUseLLM: !needsCheckoutFlow && shouldUseLLMOutsideCheckout(text),
    rawText: text,
    normalizedForMatch: normalizeForMatch(text),
  });

  /* ==========================================================
     Ô£à ATALHO POS-CHECKOUT (DENTRO do run)
  ========================================================== */
  if (!needsCheckoutFlow && facts?.stage === "pos_checkout" && co?.sent === true) {
    console.log("[agent] POS_CHECKOUT GUARD -> HIT", { tenant_id, phone, inbound: String(text || ""), sent_at: co?.sent_at });

    const inboundNorm = normalizeText(text);
    const m = normalizeForMatch(inboundNorm);

    const isBuyAgain =
      isBuyIntent(inboundNorm) || m.includes("comprar de novo") || m.includes("novo pedido") || m.includes("outro");

    if (isBuyAgain) {
      facts = resetCheckoutState(facts);
      facts.checkout.awaiting_cep = true;
      enforceSingleAwaiting(facts.checkout);

      console.log("[agent] POS_CHECKOUT -> restart checkout", { tenant_id, phone });

      return await respond({
        tenant_id,
        customer,
        facts,
        payload: { type: "text", text: humanAskCep(humanTraining), facts },
      });
    }

    const msg =
      "Fechou Ô£à Seu link j├í foi enviado. " +
      "Se quiser *comprar de novo*, diga **quero comprar**. " +
      "Se tiver alguma d├║vida, me chama aqui ­ƒÖé";

    const out = applyTrainingToOutgoing(msg, humanTraining, "pos_checkout_nudge");
    return await respond({ tenant_id, customer, facts, payload: { type: "text", text: out, facts } });
  }

  /* ==========================================================
     Ô£à BLOCO PR├ë-LLM (fora do checkout)
========================================================== */
  if (!needsCheckoutFlow) {
    const inboundNorm = normalizeText(text);
    const ping = isPingLike(inboundNorm);

    facts.last_playbook_product_key = pbWrap?.used_product_key || product_key;
    facts.last_reason = pb ? (pbWrap?.fallback_used ? "playbook_default_fallback" : "playbook_product") : "playbook_missing";

    /* ======================
       (1) Router PRE├çO => OFERTA (ANTES de nudge/abertura)
    ====================== */
    if (isPriceIntent(inboundNorm)) {
      facts.stage = "oferta";
      facts._dirty = true;

      const pitchOferta = pb?.pitch_by_stage?.oferta ? String(pb.pitch_by_stage.oferta).trim() : "";

      if (pitchOferta && !wasPitchSentFacts(facts, "oferta")) {
        markPitchSentFacts(facts, "oferta");
        const out = applyTrainingToOutgoing(pitchOferta, humanTraining, "playbook_pitch_oferta_router_preco");
        console.log("[agent] ROUTER PRECO -> OFERTA (pitch)", { tenant_id, phone, used_product_key: facts.last_playbook_product_key });

        return await respond({ tenant_id, customer, facts, payload: { type: "text", text: out, facts } });
      }

      const fallback =
        "Consigo te passar o valor certinho ­ƒÖé\n" +
        "S├│ me diz: qual produto voc├¬ quer (ou qual modelo/kit)?";
      const out = applyTrainingToOutgoing(fallback, humanTraining, "router_preco_fallback");
      console.log("[agent] ROUTER PRECO -> OFERTA (fallback)", { tenant_id, phone, hasPitchOferta: !!pitchOferta });

      return await respond({ tenant_id, customer, facts, payload: { type: "text", text: out, facts } });
    }

    /* ======================
       (2) Objection-first (GANHA da abertura/diagn├│stico/nudge)
    ====================== */
    if (pb?.objections_json) {
      try {
        const stageNow = String(facts?.stage || "").trim() || "abertura";

        const objectionsObj =
          typeof pb.objections_json === "string"
            ? safeJsonParse(pb.objections_json, {})
            : pb.objections_json && typeof pb.objections_json === "object"
              ? pb.objections_json
              : {};

        console.log("[agent] MARKER OBJECTION-FIRST reached", {
          tenant_id,
          phone,
          inboundNorm,
          stageNow,
          objectionsKeys: Object.keys(objectionsObj || {}).slice(0, 10),
        });

        const hit = detectObjection({
          objections_json: objectionsObj,
          inboundText: inboundNorm,
          stage: stageNow,
        });

        let chosen = "";
        if (hit?.key) {
          if (Array.isArray(hit?.answers) && hit.answers.length) chosen = String(pickFirst(hit.answers) || "").trim();
          else if (typeof hit?.answers === "string" && hit.answers.trim()) chosen = hit.answers.trim();
          else if (typeof hit?.answer === "string" && hit.answer.trim()) chosen = hit.answer.trim();
          else if (hit?.answer && typeof hit.answer === "object") {
            const maybe =
              (typeof hit.answer.text === "string" && hit.answer.text.trim()) ||
              (typeof hit.answer.value === "string" && hit.answer.value.trim()) ||
              "";
            chosen = String(maybe || "").trim();
          }
        }

        if (hit?.key && chosen) {
          facts._dirty = true;
          facts.llm = facts.llm && typeof facts.llm === "object" ? facts.llm : {};
          facts.llm.last_used_at = null;
          facts.llm.last_reason = "playbook_objection_first";

          const out = appendSmartAdvance(applyTrainingToOutgoing(chosen, humanTraining, `playbook_objection_${hit.key}`), facts);

          console.log("[agent] OBJECTION-FIRST -> hit", {
            tenant_id,
            phone,
            key: hit.key,
            stage: stageNow,
            chosen_preview: out.slice(0, 80),
          });

          return await respond({ tenant_id, customer, facts, payload: { type: "text", text: out, facts } });
        }
      } catch (e) {
        console.warn("[agent] WARN OBJECTION-FIRST failed", { err: String(e?.message || e) });
      }
    }

    /* ======================
       (3) Anti-loop do NUDGE gen├®rico (ganha do fluxo)
    ====================== */
    if (facts.stage === "abertura" && ping) {
      if (wasPitchSentFacts(facts, "abertura_nudge")) {
        const alt = "Me diz s├│ uma coisa pra eu te ajudar r├ípido: **qual produto** voc├¬ quer ou **qual d├║vida** voc├¬ tem? ­ƒÖé";
        const outAlt = applyTrainingToOutgoing(alt, humanTraining, "abertura_nudge_alt_no_repeat");
        facts._dirty = true;

        console.log("[agent] NUDGE LOOP -> ALT", { tenant_id, phone });
        return await respond({ tenant_id, customer, facts, payload: { type: "text", text: outAlt, facts } });
      }
    }

    /* ======================
       (4) DIAGN├ôSTICO anti-repeat p/ ping
    ====================== */
    if (facts.stage === "diagnostico") {
      const already = wasPitchSentFacts(facts, "diagnostico");
      const pitchDiag = pb?.pitch_by_stage?.diagnostico ? String(pb.pitch_by_stage.diagnostico).trim() : "";

      if (already && ping) {
        const nudge =
          "Fechado ­ƒÖé Me diz rapidinho o que voc├¬ quer fazer: **comprar** ou **tirar uma d├║vida**? " +
          "Se quiser, j├í fala o produto/assunto tamb├®m.";
        const out = applyTrainingToOutgoing(nudge, humanTraining, "playbook_diag_nudge_no_repeat");
        console.log("[agent] DIAGNOSTICO (anti-repeat) -> nudge", { tenant_id, phone, inboundNorm });

        return await respond({ tenant_id, customer, facts, payload: { type: "text", text: out, facts } });
      }

      if (!already && pitchDiag) {
        markPitchSentFacts(facts, "diagnostico");
        const out = applyTrainingToOutgoing(pitchDiag, humanTraining, "playbook_pitch_diagnostico");
        console.log("[agent] PLAYBOOK DIAGNOSTICO -> hit", { tenant_id, phone, used_product_key: facts.last_playbook_product_key });

        return await respond({ tenant_id, customer, facts, payload: { type: "text", text: out, facts } });
      }
    }

    /* ======================
       (5) ABERTURA 1x (primeira intera├º├úo real) + anti-spam
    ====================== */
    try {
      if (phone) {
        const inboundCount = await inboundCountByPhone({ tenant_id, phone });
        const first = inboundCount <= 1;
        const pitchAbertura = pb?.pitch_by_stage?.abertura ? String(pb.pitch_by_stage.abertura).trim() : "";

        console.log("[agent] ABERTURA DEBUG", {
          tenant_id,
          phone,
          inboundCount,
          first,
          hasPitchAbertura: !!pitchAbertura,
          alreadySentFacts: wasPitchSentFacts(facts, "abertura"),
          used_product_key: facts.last_playbook_product_key,
          last_reason: facts.last_reason,
          looksLikeObjectionNow: looksLikeObjection(text),
        });

        if (first && pitchAbertura && !wasPitchSentFacts(facts, "abertura") && !looksLikeObjection(text) && !normalizeForMatch(text).includes("medo") && !normalizeForMatch(text).includes("receio") && !normalizeForMatch(text).includes("duvida") && !normalizeForMatch(text).includes("risco")) {
          markPitchSentFacts(facts, "abertura");
          const out = applyTrainingToOutgoing(pitchAbertura, humanTraining, "playbook_pitch_abertura");
          console.log("[agent] PLAYBOOK ABERTURA -> hit", { tenant_id, phone, used_product_key: facts.last_playbook_product_key });

          return await respond({ tenant_id, customer, facts, payload: { type: "text", text: out, facts } });
        }
      }
    } catch (e) {
      console.warn("[agent] WARN ABERTURA failed", { err: String(e?.message || e) });
    }

    /* ======================
       (6) OFERTA/FECHAMENTO por stage (anti-spam)
    ====================== */
    {
      const stageNow = String(facts?.stage || "").trim();

      if (stageNow === "oferta" && !wasPitchSentFacts(facts, "oferta")) {
        const pitch = pb?.pitch_by_stage?.oferta ? String(pb.pitch_by_stage.oferta).trim() : "";
        if (pitch) {
          markPitchSentFacts(facts, "oferta");
          const out = applyTrainingToOutgoing(pitch, humanTraining, "playbook_pitch_oferta");
          console.log("[agent] PLAYBOOK OFERTA -> hit", { tenant_id, phone, used_product_key: facts.last_playbook_product_key });

          return await respond({ tenant_id, customer, facts, payload: { type: "text", text: out, facts } });
        }
      }

      if (stageNow === "fechamento" && !wasPitchSentFacts(facts, "fechamento")) {
        const pitch = pb?.pitch_by_stage?.fechamento ? String(pb.pitch_by_stage.fechamento).trim() : "";
        if (pitch) {
          markPitchSentFacts(facts, "fechamento");
          const out = applyTrainingToOutgoing(pitch, humanTraining, "playbook_pitch_fechamento");
          console.log("[agent] PLAYBOOK FECHAMENTO -> hit", { tenant_id, phone, used_product_key: facts.last_playbook_product_key });

          return await respond({ tenant_id, customer, facts, payload: { type: "text", text: out, facts } });
        }
      }
    }

    /* ======================
       (7) applyPlaybook() (pitches residuais / policies / rules)
    ====================== */
    if (pb) {
      const applied = await applyPlaybook({
        playbook: pb,
        inboundText: text,
        facts,
        applyTrainingToOutgoing,
        humanTraining,
      });

      if (applied.handled) {
        const appliedText = String(applied?.text || "").trim();

        applied.facts = applied.facts && typeof applied.facts === "object" ? applied.facts : {};
        applied.facts = ensureFactsShape(applied.facts);

        const isPlaybookNudge =
          appliedText.startsWith("Oi!") &&
          appliedText.includes("Me diz rapidinho") &&
          appliedText.includes("comprar") &&
          appliedText.includes("d├║vida");

        if (applied.facts?.stage === "abertura" && ping && isPlaybookNudge) {
          if (wasPitchSentFacts(applied.facts, "abertura_nudge")) {
            const alt = "Me diz s├│ uma coisa pra eu te ajudar r├ípido: **qual produto** voc├¬ quer ou **qual d├║vida** voc├¬ tem? ­ƒÖé";
            const outAlt = applyTrainingToOutgoing(alt, humanTraining, "abertura_nudge_alt_no_repeat");
            applied.facts._dirty = true;

            console.log("[agent] PLAYBOOK NUDGE LOOP -> ALT", { tenant_id, phone });
            return await respond({
              tenant_id,
              customer,
              facts: applied.facts,
              payload: { type: "text", text: outAlt, facts: applied.facts },
            });
          }

          applied.facts = markPitchSentFacts(applied.facts, "abertura_nudge");
        }

        applied.facts.llm = applied.facts.llm && typeof applied.facts.llm === "object" ? applied.facts.llm : {};
        applied.facts.llm.last_used_at = null;
        applied.facts.llm.last_reason = "playbook";
        applied.facts._dirty = true;

        return await respond({
          tenant_id,
          customer,
          facts: applied.facts,
          payload: { type: "text", text: applied.text, facts: applied.facts },
        });
      }
    }
  }

/* ==========================================================
   Ô£à 4.0) CHECKOUT: STRONG DETECT + H├ìBRIDO (OBJE├ç├âO) + CLASSIFICADOR (JSON) + HARD RULE
   - Importante: llm_class_last_key s├│ ├® escrito via setCheckoutClassKeySafe()
========================================================== */
if (needsCheckoutFlow) {
  const pendingField = getPendingFieldFromCheckout(co);

  if (pendingField) {
    /* ======================
       4.0.a) STRONG DETECT
    ====================== */
    const strong = strongDetectByPending(pendingField, text);

    if (strong) {
      console.log("[agent] CHECKOUT STRONG DETECT ->", { pendingField });

      if (pendingField === "cep") {
        co.cep = strong.value;
        co.awaiting_cep = false;
        co.awaiting_payment = true;
        enforceSingleAwaiting(co);

        facts.stage = "checkout_payment";
        facts._dirty = true;

        return await respond({
          tenant_id,
          customer,
          facts,
          payload: { type: "text", text: humanAskPayment(humanTraining), facts },
        });
      }

      if (pendingField === "payment") {
        co.payment = strong.value;
        co.awaiting_payment = false;
        co.awaiting_channel = true;
        enforceSingleAwaiting(co);

        facts.stage = "checkout_channel";
        facts._dirty = true;

        return await respond({
          tenant_id,
          customer,
          facts,
          payload: { type: "text", text: humanAskChannel(humanTraining), facts },
        });
      }

      if (pendingField === "channel") {
        co.channel = strong.value;
        co.awaiting_channel = false;
        facts.stage = "checkout_link";
        facts._dirty = true;

        const directUrl = await getCheckoutUrl({ tenant_id, product_key, channel: co.channel });

        if (directUrl) {
          co.checkout_url = directUrl;
          facts._dirty = true;
          await finishCheckout({ tenant_id, customer, facts, co });

          return await respond({
            tenant_id,
            customer,
            facts,
            payload: { type: "text", text: humanSendFinalLink(directUrl, humanTraining), facts },
          });
        }

        co.awaiting_affiliate_link = true;
        enforceSingleAwaiting(co);
        facts._dirty = true;

        return await respond({
          tenant_id,
          customer,
          facts,
          payload: { type: "text", text: humanAskAffiliateLink(co.channel, humanTraining), facts },
        });
      }

      if (pendingField === "affiliate_link") {
        co.affiliate_url = strong.value;
        co.awaiting_affiliate_link = false;
        co.checkout_url = strong.value;
        facts._dirty = true;

        await finishCheckout({ tenant_id, customer, facts, co });

        return await respond({
          tenant_id,
          customer,
          facts,
          payload: { type: "text", text: humanSendFinalLink(co.checkout_url, humanTraining), facts },
        });
      }
    }

    /* ======================
       Ô£à 4.0.a.5) H├ìBRIDO (OBJE├ç├âO) ÔÇö ANTES da valida├º├úo dura
       - S├│ entra se N├âO parece dado esperado do pending
       - Anti-loop: 1x por inboundKey
    ====================== */
    {
      const inboundKey = buildInboundKey({ customer, decision, text });

      const looksLikeExpectedData =
        (co.awaiting_cep && !!normalizeCep(text)) ||
        (co.awaiting_payment && !!normalizePayment(text)) ||
        (co.awaiting_channel && !!normalizeChannel(text)) ||
        (co.awaiting_affiliate_link && !!looksLikeUrl(text));

      const pendingQuestion = getCheckoutPendingQuestion(co, humanTraining, co.channel, facts, inboundKey);

      const canHybrid =
        !!pendingQuestion &&
        !looksLikeExpectedData &&
        looksLikeObjection(text) &&
        !alreadyUsedLLMForThisInbound(facts, inboundKey);

      if (canHybrid) {
        console.log("[agent] ENTER LLM (checkout_hybrid)", { tenant_id, product_key, inboundKey, pendingField });

        try {
          const stageContext = {
            stage: facts.stage || "checkout",
            goal: "responder_objecao_sem_quebrar_checkout_e_retornar_para_pergunta_pendente",
            mode: "checkout_hybrid",
            pending_field: pendingField,
            pending_question: removeKnownEmojis(String(pendingQuestion || "")),
            hard_rule: "NAO repita a pergunta pendente; eu vou anexar se precisar.",
          };

          const llmOut = await generateLLMResponse({
            tenant_id,
            product_key,
            facts,
            stageContext,
            userText: text,
          });

          // marca anti-loop do h├¡brido
          markLLMUsedForInbound(facts, inboundKey);

          facts.llm = facts.llm && typeof facts.llm === "object" ? facts.llm : {};
          facts.llm.last_used_at = new Date().toISOString();
          facts.llm.last_reason = "checkout_hybrid";
          facts._dirty = true;

          const answer = applyTrainingToOutgoing(llmOut, humanTraining, "llm_checkout_hybrid");

          const shouldAppend = !answerAlreadyMentionsPending(answer, pendingField);
          const finalText = shouldAppend ? `${answer}\n\n${pendingQuestion}` : answer;

          if (shouldAppend) markPendingQuestionAppendedForInbound(facts, inboundKey);

          return await respond({
            tenant_id,
            customer,
            facts,
            payload: { type: "text", text: finalText, facts },
          });
        } catch (err) {
          const msg = String(err?.message || err);

          if (err?.code === "LLM_QUOTA" || msg.includes("429") || msg.toLowerCase().includes("quota")) {
            const inboundKey2 = inboundKey;
            const pendingQuestion2 = pendingQuestion;

            const fallback = humanLLMQuotaFallback(humanTraining);
            const shouldAppend = !answerAlreadyMentionsPending(fallback, pendingField);
            const finalText = shouldAppend ? `${fallback}\n\n${pendingQuestion2}` : fallback;

            if (shouldAppend) markPendingQuestionAppendedForInbound(facts, inboundKey2);

            return await respond({
              tenant_id,
              customer,
              facts,
              payload: { type: "text", text: finalText, facts },
            });
          }

          console.error("ÔØî [agent] LLM checkout_hybrid error:", msg);
          // se falhar, segue pro fluxo abaixo (valida├º├úo / classificador / determin├¡stico)
        }
      }
    }

    /* ======================
       4.0.b) VALIDA├ç├âO DURA
    ====================== */
    const v = validatePendingInputOrNull({ pendingField, text });

    if (!v.ok) {
      console.log("[agent] CHECKOUT INVALID (pre-classifier)", {
        pendingField,
        reason: v.reason,
      });

      if (pendingField === "cep")
        return await respond({ tenant_id, customer, facts, payload: { type: "text", text: humanInvalidCep(humanTraining), facts } });

      if (pendingField === "payment")
        return await respond({ tenant_id, customer, facts, payload: { type: "text", text: humanInvalidPayment(humanTraining), facts } });

      if (pendingField === "channel")
        return await respond({ tenant_id, customer, facts, payload: { type: "text", text: humanAskChannel(humanTraining), facts } });

      if (pendingField === "affiliate_link")
        return await respond({
          tenant_id,
          customer,
          facts,
          payload: { type: "text", text: humanInvalidAffiliateLink(humanTraining), facts },
        });
    }

    if (v.ok && !v.normalized) {
      return await respond({
        tenant_id,
        customer,
        facts,
        payload: {
          type: "text",
          text: getCheckoutPendingQuestion(co, humanTraining, co.channel, facts),
          facts,
        },
      });
    }

    /* ======================
       4.0.c) CLASSIFICADOR SEGURO
       - usa normalized pra classKey
       - aplica cls.value diretamente (sem recurs├úo run())
    ====================== */
    const norm = v.normalized;

    const ck = setCheckoutClassKeySafe({
      co,
      facts,
      customer,
      text: norm,
      pendingField,
    });

    if (ck.allowed && ck.classKey && ck.written === true) {
      const cls = await classifyInboundInCheckoutLLM({
        tenant_id,
        product_key,
        facts,
        co,
        pendingField,
        text,
        humanTraining,
      });

      if (cls.type === "checkout_data" && cls.field === pendingField && cls.value) {
        console.log("[agent] CHECKOUT CLASSIFIER ACCEPTED", cls);

        // aplica diretamente o valor classificado (sem chamar run())
        if (pendingField === "cep") {
          const cep = normalizeCep(cls.value) || normalizeCep(norm);
          if (!cep) {
            return await respond({ tenant_id, customer, facts, payload: { type: "text", text: humanInvalidCep(humanTraining), facts } });
          }
          co.cep = cep;
          co.awaiting_cep = false;
          co.awaiting_payment = true;
          enforceSingleAwaiting(co);

          facts.stage = "checkout_payment";
          facts._dirty = true;

          return await respond({ tenant_id, customer, facts, payload: { type: "text", text: humanAskPayment(humanTraining), facts } });
        }

        if (pendingField === "payment") {
          const pay = normalizePayment(cls.value) || normalizePayment(norm);
          if (!pay) {
            return await respond({
              tenant_id,
              customer,
              facts,
              payload: { type: "text", text: humanInvalidPayment(humanTraining), facts },
            });
          }
          co.payment = pay;
          co.awaiting_payment = false;
          co.awaiting_channel = true;
          enforceSingleAwaiting(co);

          facts.stage = "checkout_channel";
          facts._dirty = true;

          return await respond({ tenant_id, customer, facts, payload: { type: "text", text: humanAskChannel(humanTraining), facts } });
        }

        if (pendingField === "channel") {
          const ch = normalizeChannel(cls.value) || normalizeChannel(norm);
          if (!ch) {
            return await respond({ tenant_id, customer, facts, payload: { type: "text", text: humanAskChannel(humanTraining), facts } });
          }

          co.channel = ch;
          co.awaiting_channel = false;
          facts.stage = "checkout_link";
          facts._dirty = true;

          const directUrl = await getCheckoutUrl({ tenant_id, product_key, channel: ch });
          if (directUrl) {
            co.checkout_url = directUrl;
            facts._dirty = true;
            await finishCheckout({ tenant_id, customer, facts, co });

            return await respond({
              tenant_id,
              customer,
              facts,
              payload: { type: "text", text: humanSendFinalLink(directUrl, humanTraining), facts },
            });
          }

          co.awaiting_affiliate_link = true;
          enforceSingleAwaiting(co);
          facts._dirty = true;

          return await respond({
            tenant_id,
            customer,
            facts,
            payload: { type: "text", text: humanAskAffiliateLink(ch, humanTraining), facts },
          });
        }

        if (pendingField === "affiliate_link") {
          const link = looksLikeUrl(cls.value) ? cls.value : looksLikeUrl(norm) ? norm : null;
          if (!link) {
            return await respond({
              tenant_id,
              customer,
              facts,
              payload: { type: "text", text: humanInvalidAffiliateLink(humanTraining), facts },
            });
          }

          co.affiliate_url = link;
          co.awaiting_affiliate_link = false;
          co.checkout_url = link;
          facts._dirty = true;

          await finishCheckout({ tenant_id, customer, facts, co });

          return await respond({
            tenant_id,
            customer,
            facts,
            payload: { type: "text", text: humanSendFinalLink(co.checkout_url, humanTraining), facts },
          });
        }
      }
    }
  } // <-- fecha pendingField
} // <-- fecha needsCheckoutFlow

  /* ======================
     Ô£à 4.1) LLM h├¡brido dentro do checkout (obje├º├úo + volta p/ pending)
  ====================== */
  if (needsCheckoutFlow) {
    const inboundKey = buildInboundKey({ customer, decision, text });

    const looksLikeExpectedData =
      (co.awaiting_cep && !!normalizeCep(text)) ||
      (co.awaiting_payment && !!normalizePayment(text)) ||
      (co.awaiting_channel && !!normalizeChannel(text)) ||
      (co.awaiting_affiliate_link && !!looksLikeUrl(text));

    const pendingField = getPendingFieldFromCheckout(co);
    const pendingQuestion = getCheckoutPendingQuestion(co, humanTraining, co.channel, facts, inboundKey);

    const canHybrid =
      !!pendingQuestion &&
      !looksLikeExpectedData &&
      looksLikeObjection(text) &&
      !alreadyUsedLLMForThisInbound(facts, inboundKey);

    if (canHybrid) {
      console.log("[agent] ENTER LLM (checkout_hybrid)", { tenant_id, product_key, inboundKey, pendingField });

      try {
        const stageContext = {
          stage: facts.stage || "checkout",
          goal: "responder_objecao_sem_quebrar_checkout_e_retornar_para_pergunta_pendente",
          mode: "checkout_hybrid",
          pending_field: pendingField,
          pending_question: removeKnownEmojis(String(pendingQuestion || "")),
          hard_rule: "NAO repita a pergunta pendente; eu vou anexar se precisar.",
        };

        const llmOut = await generateLLMResponse({ tenant_id, product_key, facts, stageContext, userText: text });
        markLLMUsedForInbound(facts, inboundKey);

        facts.llm = facts.llm && typeof facts.llm === "object" ? facts.llm : {};
        facts.llm.last_used_at = new Date().toISOString();
        facts.llm.last_reason = "checkout_hybrid";
        facts._dirty = true;

        const answer = applyTrainingToOutgoing(llmOut, humanTraining, "llm_checkout_hybrid");

        const shouldAppend = !answerAlreadyMentionsPending(answer, pendingField);
        const finalText = shouldAppend ? `${answer}\n\n${pendingQuestion}` : answer;
        if (shouldAppend) markPendingQuestionAppendedForInbound(facts, inboundKey);

        return await respond({ tenant_id, customer, facts, payload: { type: "text", text: finalText, facts } });
      } catch (err) {
        const msg = String(err?.message || err);

        if (err?.code === "LLM_QUOTA" || msg.includes("429") || msg.toLowerCase().includes("quota")) {
          const fallback = humanLLMQuotaFallback(humanTraining);
          const shouldAppend = !answerAlreadyMentionsPending(fallback, pendingField);
          const finalText = shouldAppend ? `${fallback}\n\n${pendingQuestion}` : fallback;
          if (shouldAppend) markPendingQuestionAppendedForInbound(facts, inboundKey);

          return await respond({ tenant_id, customer, facts, payload: { type: "text", text: finalText, facts } });
        }

        console.error("ÔØî [agent] LLM checkout_hybrid error:", msg);
      }
    }
  }

  /* ======================
     4.2) CEP (determin├¡stico)
  ====================== */
  if (co.awaiting_cep) {
    console.log("[agent] ENTER CHECKOUT (awaiting_cep)");
    const cep = normalizeCep(text);
    if (!cep) {
      return await respond({ tenant_id, customer, facts, payload: { type: "text", text: humanInvalidCep(humanTraining), facts } });
    }

    co.cep = cep;
    co.awaiting_cep = false;
    co.awaiting_payment = true;
    enforceSingleAwaiting(co);

    facts.stage = "checkout_payment";
    facts._dirty = true;
    return await respond({ tenant_id, customer, facts, payload: { type: "text", text: humanAskPayment(humanTraining), facts } });
  }

  /* ======================
     4.3) Payment (determin├¡stico)
  ====================== */
  if (co.awaiting_payment) {
    console.log("[agent] ENTER CHECKOUT (awaiting_payment)");
    const pay = normalizePayment(text);
    if (!pay) {
      return await respond({ tenant_id, customer, facts, payload: { type: "text", text: humanInvalidPayment(humanTraining), facts } });
    }

    co.payment = pay;
    co.awaiting_payment = false;
    co.awaiting_channel = true;
    enforceSingleAwaiting(co);

    facts.stage = "checkout_channel";
    facts._dirty = true;
    return await respond({ tenant_id, customer, facts, payload: { type: "text", text: humanAskChannel(humanTraining), facts } });
  }

  /* ======================
     4.4) Channel (determin├¡stico)
  ====================== */
  if (co.awaiting_channel) {
    console.log("[agent] ENTER CHECKOUT (awaiting_channel)");
    const ch = normalizeChannel(text);
    if (!ch) {
      return await respond({ tenant_id, customer, facts, payload: { type: "text", text: humanAskChannel(humanTraining), facts } });
    }

    co.channel = ch;
    co.awaiting_channel = false;
    facts.stage = "checkout_link";
    facts._dirty = true;

    const directUrl = await getCheckoutUrl({ tenant_id, product_key, channel: ch });
    if (directUrl) {
      co.checkout_url = directUrl;
      facts._dirty = true;
      await finishCheckout({ tenant_id, customer, facts, co });
      return await respond({ tenant_id, customer, facts, payload: { type: "text", text: humanSendFinalLink(directUrl, humanTraining), facts } });
    }

    co.awaiting_affiliate_link = true;
    enforceSingleAwaiting(co);
    facts._dirty = true;

    return await respond({ tenant_id, customer, facts, payload: { type: "text", text: humanAskAffiliateLink(ch, humanTraining), facts } });
  }

  /* ======================
     4.5) Affiliate link (determin├¡stico)
  ====================== */
  if (co.awaiting_affiliate_link) {
    console.log("[agent] ENTER CHECKOUT (awaiting_affiliate_link)");
    if (!looksLikeUrl(text)) {
      return await respond({ tenant_id, customer, facts, payload: { type: "text", text: humanInvalidAffiliateLink(humanTraining), facts } });
    }

    co.affiliate_url = text;
    co.awaiting_affiliate_link = false;
    co.checkout_url = co.affiliate_url;
    facts._dirty = true;

    await finishCheckout({ tenant_id, customer, facts, co });
    return await respond({ tenant_id, customer, facts, payload: { type: "text", text: humanSendFinalLink(co.checkout_url, humanTraining), facts } });
  }

  // 5) CEP ÔÇ£soltoÔÇØ inicia checkout inteligente
  if (!needsCheckoutFlow) {
    const maybeCep = normalizeCep(text);
    if (maybeCep) {
      facts = resetCheckoutState(facts);
      facts.checkout.cep = maybeCep;
      facts.checkout.awaiting_payment = true;
      enforceSingleAwaiting(facts.checkout);

      facts.stage = "checkout_payment";
      facts._dirty = true;
      console.log("[agent] ENTER CHECKOUT (smart cep start)", { cep: maybeCep });

      return await respond({ tenant_id, customer, facts, payload: { type: "text", text: humanAskPayment(humanTraining), facts } });
    }
  }

  /* ======================
     Ô£à 5.5) BYPASS INTELIGENTE ÔÇö DIFERENCIAIS / BENEF├ìCIOS
  ====================== */
  if (!needsCheckoutFlow) {
    const bypass = buildIntelBypassResponse({ text, product_intelligence });
    if (bypass) {
      console.log("[agent] INTEL BYPASS HIT");
      const finalText = applyTrainingToOutgoing(bypass, humanTraining, "intel_bypass");
      return await respond({ tenant_id, customer, facts, payload: { type: "text", text: finalText, facts } });
    }
  }

  // trava: se est├í no diagnostico e ainda n├úo enviou pitch, n├úo deixa o LLM tomar o controle
  const blockLLMForDiagPitch = !needsCheckoutFlow && facts?.stage === "diagnostico" && !wasPitchSentFacts(facts, "diagnostico") && !looksLikeObjection(text);

  /* ======================
     6) LLM fora do checkout
  ====================== */
  if (
    !blockLLMForDiagPitch &&
    !needsCheckoutFlow &&
    (process.env.LLM_OUTSIDE_CHECKOUT_MODE === "always" || shouldUseLLMOutsideCheckout(text) || looksLikeObjection(text))
  ) {
    console.log("[agent] LLM OUTSIDE DEBUG", { stage: facts?.stage, needsCheckoutFlow, blockLLMForDiagPitch, shouldUseLLMOutsideCheckout: shouldUseLLMOutsideCheckout(text), looksLikeObjection: looksLikeObjection(text), text });    console.log("[agent] ENTER LLM");
    try {
      const stageContext = { stage: facts.stage || "abertura", goal: "responder_duvida_ou_objecao_com_clareza_e_levar_o_cliente_para_um_proximo_passo_de_compra_sem_pressionar" };

      const llmOut = await generateLLMResponse({ tenant_id, product_key, facts, stageContext, userText: text });

      facts.llm = facts.llm && typeof facts.llm === "object" ? facts.llm : {};
      facts.llm.last_used_at = new Date().toISOString();
      facts.llm.last_reason = "outside_checkout";
      facts._dirty = true;

      const finalText = applyTrainingToOutgoing(llmOut, humanTraining, "llm");
      return await respond({ tenant_id, customer, facts, payload: { type: "text", text: finalText, facts } });
    } catch (err) {
      const msg = String(err?.message || err);

      if (err?.code === "LLM_QUOTA" || msg.includes("429") || msg.toLowerCase().includes("quota")) {
        return await respond({ tenant_id, customer, facts, payload: { type: "text", text: humanLLMQuotaFallback(humanTraining), facts } });
      }

      console.error("ÔØî [agent] LLM error:", msg);
    }
  } else if (blockLLMForDiagPitch) {
    console.log("[agent] BLOCK LLM (waiting pitch diagnostico once)");
  }

  /* ======================
     7) Fallback gen├®rico (FIX: n├úo repetir ABERTURA id├¬ntica)
  ====================== */
  const lower = normalizeForMatch(text);
  const hasOpened = wasPitchSentFacts(facts, "abertura");

  let fallbackBase;
  if (lower === "oi") {
    fallbackBase = hasOpened
      ? "Beleza ­ƒÖé me diz: voc├¬ quer comprar agora ou qual ├® a tua d├║vida?"
      : "Oi! ­ƒÖé Me diz rapidinho: voc├¬ quer comprar agora ou tirar uma d├║vida?";
  } else {
    fallbackBase = "Antes de te passar o melhor caminho, me diz: voc├¬ quer comprar agora ou s├│ tirar uma d├║vida? ­ƒÖé";
  }

  if (!needsCheckoutFlow && isPingLike(text) && fallbackBase.includes("Me diz rapidinho")) {
    if (!wasPitchSentFacts(facts, "abertura_nudge")) {
      markPitchSentFacts(facts, "abertura_nudge");
    }
  }

  const fallback = applyTrainingToOutgoing(fallbackBase, humanTraining, "fallback");
  return await respond({ tenant_id, customer, facts, payload: { type: "text", text: fallback, facts } });
}

module.exports = { run };






















function appendSmartAdvance(text, facts) {
  if (!text || typeof text !== "string") return text;

  const t = text.toLowerCase();

  // evita duplicar pergunta
  if (t.includes("pix") || t.includes("cartão") || t.includes("cartao")) return text;

  // se estiver em checkout ativo, não interferir
  const checkout = facts?.checkout && typeof facts.checkout === "object" ? facts.checkout : null;
  const hasActiveCheckout = !!(checkout && (checkout.awaiting_cep || checkout.awaiting_payment || checkout.awaiting_channel || checkout.awaiting_affiliate_link));
  if (hasActiveCheckout) return text;

  // condução suave de avanço
  const advance = "\n\nSe fizer sentido pra você, posso te explicar rapidinho como funciona o pagamento 🙂 Você prefere pix ou cartão?";

  return text + advance;
}






