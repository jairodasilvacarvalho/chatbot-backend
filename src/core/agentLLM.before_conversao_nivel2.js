// src/core/agentLLM.js
// âœ… GeraÃ§Ã£o LLM com treino humano (loader oficial) + product_intelligence + contexto de estÃ¡gio + facts
// âœ… CommonJS compatÃ­vel com backend atual
// âœ… ConfigurÃ¡vel por ENV (modelo/temperature/max_tokens/timeout)
// âœ… Erros padronizados (inclui 429 quota) para fallback controlado no agent.js
// âœ… FIX: nÃ£o quebra no require sem OPENAI_API_KEY (lazy client + guard)

const { getEffectiveTraining } = require("../../services/humanTrainingService");
const { buildHumanTrainingSystemBlock } = require("../services/humanTrainingPromptBuilder");

// âœ… CompatÃ­vel com 2 formatos:
// 1) novo: module.exports = { getOpenAIClient }
// 2) antigo: module.exports = openaiClientInstance
const openaiClientModule = require("./openaiClient");

function safeJsonStringify(obj, fallback = "{}") {
  try {
    return JSON.stringify(obj ?? {}, null, 2);
  } catch {
    return fallback;
  }
}

function normalizeOut(text) {
  return String(text ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeUserText(text) {
  const t = String(text ?? "").trim();
  // evita prompt gigantesco acidental
  return t.length > 2000 ? t.slice(0, 2000) : t;
}

function getEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function getEnvString(name, fallback) {
  const raw = process.env[name];
  return raw ? String(raw) : fallback;
}

function extractStatus(err) {
  // cobre SDKs diferentes
  return err?.status || err?.response?.status || err?.code || null;
}

function buildLLMError(err) {
  const status = extractStatus(err);
  const message = String(err?.message || err || "LLM error");
  const e = new Error(message);
  e.name = "LLM_ERROR";
  e.status = status;

  // padroniza 429 quota
  if (
    String(status) === "429" ||
    message.includes("429") ||
    message.toLowerCase().includes("quota")
  ) {
    e.code = "LLM_QUOTA";
    e.name = "LLM_QUOTA";
  }

  // padroniza "missing key" (desabilitado)
  if (
    e.code !== "LLM_QUOTA" &&
    (message.toLowerCase().includes("missing credentials") ||
      message.toLowerCase().includes("openai_api_key") ||
      message.toLowerCase().includes("api key"))
  ) {
    e.code = "LLM_MISSING_KEY";
    e.name = "LLM_MISSING_KEY";
  }

  return e;
}

function getOpenAIClientSafe() {
  // Novo formato
  if (openaiClientModule && typeof openaiClientModule.getOpenAIClient === "function") {
    return openaiClientModule.getOpenAIClient(); // pode retornar null
  }

  // Antigo formato: exportava o client diretamente
  // (mas isso pode quebrar no require se nÃ£o tiver key â€” por isso preferimos o novo)
  if (openaiClientModule && typeof openaiClientModule === "object") {
    const maybe = openaiClientModule;
    if (maybe?.chat?.completions?.create) return maybe;
  }

  return null;
}

/**
 * stageContext recomendado (exemplo):
 * {
 *   stage: "abertura" | "diagnostico" | "oferta" | "fechamento" | "checkout" | "pos_checkout",
 *   goal: "descobrir necessidade" | "responder preÃ§o" | ...
 * }
 */
async function generateLLMResponse({ tenant_id, product_key, facts, stageContext, userText }) {
  const user = normalizeUserText(userText);
  if (!user) return "";

  // ✅ Se não tiver OPENAI_API_KEY, nem tenta
  const openai = getOpenAIClientSafe();
  if (!openai) {
    const e = new Error("LLM disabled: missing OPENAI_API_KEY");
    e.name = "LLM_MISSING_KEY";
    e.code = "LLM_MISSING_KEY";
    e.status = null;
    throw e;
  }

  // ✅ Loader oficial
  const { training: humanTraining, product_intelligence, source } = await getEffectiveTraining({
    tenant_id,
    product_key,
  });

  console.log("[LLM] loaded training bundle", {
    tenant_id,
    product_key,
    source,
    has_product_intelligence: !!product_intelligence,
    humanTraining,
  });

  const benefit = (product_intelligence?.main_benefits || [])[0] || "";
  const diff = (product_intelligence?.differentials || [])[0] || "";
  const proof = (product_intelligence?.proof || [])[0] || "";
  const baseSalesText = [benefit, diff, proof].filter(Boolean).join(". ");

  console.log("[DEBUG baseSalesText TOP]", baseSalesText);

  if (baseSalesText) {
    const objectionLike = /nao funcionou|não funcionou|ja tentei|já tentei|nao deu certo|não deu certo|tentei outras|tentei de tudo/i.test(user);
    return objectionLike
      ? `Entendo, isso acontece bastante quando a pessoa já tentou outras formas e não teve o resultado esperado. ${benefit}. ${diff}. ${proof}. Pra eu te orientar melhor, me conta: o que você já tentou antes e o que sentiu que não funcionou?`
      : `Claro. ${baseSalesText}. O que mais te chamou atenção nesse produto até agora?`;
  }

  const productIntelBlock = `
PRODUCT_INTELLIGENCE:
${safeJsonStringify(product_intelligence || {}, "{}")}

- Voce DEVE usar informacoes reais do JSON acima.
- E PROIBIDO responder de forma generica.
- Se "differentials" existir:
  -> use EXATAMENTE 2 itens da lista.
- Se "main_benefits" existir:
  -> use EXATAMENTE 1 item.
- Se "proof" existir:
  -> use no maximo 1 prova.
- Se o cliente ja tentou outras solucoes:
  -> explique rapidamente por que falhou;
  -> conecte com UM diferencial real.
- NAO invente dados.
- NAO ignore o JSON acima.
`.trim();

  const systemBase = `
Você é um vendedor consultivo de WhatsApp, humano, direto e persuasivo.
Sua função é responder a mensagem do cliente de forma natural, útil e específica, usando os dados reais do produto e o contexto recebido.
Nunca soe robótico.
Nunca invente informações.
Evite respostas genéricas.
Conduza a conversa um passo por vez, sempre com clareza.
`.trim();

  const humanBlock = buildHumanTrainingSystemBlock(humanTraining);

  const selectedIntel = {
    name: product_intelligence?.name || "Produto",
    benefit,
    differential: diff,
    proof,
  };

  const stageBlock = `
SELECTED_PRODUCT_DATA:
${safeJsonStringify(selectedIntel, "{}")}

STAGE_CONTEXT:
${safeJsonStringify(stageContext || {}, "{}")}
`.trim();

  const factsBlock = `
FACTS_ATUAIS:
${safeJsonStringify(facts || {}, "{}")}
`.trim();

  const messages = [
    {
      role: "system",
      content: humanBlock ? `${systemBase}\n\n${humanBlock}` : systemBase,
    },
    {
      role: "system",
      content: productIntelBlock,
    },
    {
      role: "system",
      content: `${stageBlock}\n\n${factsBlock}`,
    },
        {
      role: "system",
      content: baseSalesText
        ? `BASE_SALES_TEXT OBRIGATORIO:
${baseSalesText}

Use esse conteúdo real como base da resposta. Você pode humanizar, encurtar e conectar com a dúvida do cliente, mas não deve ignorar essas informações.`
        : "BASE_SALES_TEXT OBRIGATORIO: vazio",
    },
    {
      role: "user",
      content: user,
    },
  ];

  // âœ… ENVs (com defaults seguros)
  const model = getEnvString("OPENAI_MODEL", "gpt-4.1-mini");
  const temperature = getEnvNumber("OPENAI_TEMPERATURE", 0.6);
  const max_tokens = getEnvNumber("OPENAI_MAX_TOKENS", 220);
  const timeout_ms = getEnvNumber("OPENAI_TIMEOUT_MS", 20000);

  try {
    const req = {
      model,
      messages,
      temperature,
      max_tokens,
    };

    // Alguns clients suportam timeout via options, outros no prÃ³prio objeto.
    // Tentamos os dois formatos sem quebrar:
    let response;
    try {
      response = await openai.chat.completions.create(req, { timeout: timeout_ms });
    } catch {
      response = await openai.chat.completions.create({ ...req, timeout: timeout_ms });
    }

    const out = response?.choices?.[0]?.message?.content ?? "";
    return normalizeOut(out);
  } catch (err) {
    throw buildLLMError(err);
  }
}

module.exports = { generateLLMResponse };












