// src/core/agentLLM.js
// ✅ Geração LLM com treino humano (loader oficial) + product_intelligence + contexto de estágio + facts
// ✅ CommonJS compatível com backend atual
// ✅ Configurável por ENV (modelo/temperature/max_tokens/timeout)
// ✅ Erros padronizados (inclui 429 quota) para fallback controlado no agent.js
// ✅ FIX: não quebra no require sem OPENAI_API_KEY (lazy client + guard)

const { getEffectiveTraining } = require("../../services/humanTrainingService");
const { buildHumanTrainingSystemBlock } = require("../services/humanTrainingPromptBuilder");

// ✅ Compatível com 2 formatos:
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
  // (mas isso pode quebrar no require se não tiver key — por isso preferimos o novo)
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
 *   goal: "descobrir necessidade" | "responder preço" | ...
 * }
 */
async function generateLLMResponse({ tenant_id, product_key, facts, stageContext, userText }) {
  const user = normalizeUserText(userText);
  if (!user) return "";

  // ✅ Se não tiver OPENAI_API_KEY, nem tenta (e não derruba o app)
  const openai = getOpenAIClientSafe();
  if (!openai) {
    const e = new Error("LLM disabled: missing OPENAI_API_KEY");
    e.name = "LLM_MISSING_KEY";
    e.code = "LLM_MISSING_KEY";
    e.status = null;
    throw e; // agent.js faz fallback controlado
  }

  // ✅ Loader oficial (fallback + contrato)
  // Agora retorna: { training, product_intelligence, source }
  const { training: humanTraining, product_intelligence, source } = await getEffectiveTraining({
    tenant_id,
    product_key,
  });

  // 🔎 DEBUG — confirmar se está carregando do products e se product_intelligence veio
  console.log("[LLM] loaded training bundle", {
    tenant_id,
    product_key,
    source,
    has_product_intelligence: !!product_intelligence,
    humanTraining,
  });

  // Base: curto, operacional, WhatsApp-style
  const systemBase = `
Você é um vendedor humano e profissional no WhatsApp.
Seu objetivo é conduzir o cliente ao próximo passo do funil até o fechamento.

REGRAS:
- Seja natural, direto e útil. Frases curtas.
- Faça no máximo 1 pergunta por mensagem quando precisar destravar o próximo passo.
- Não invente informações (prazo, preço, estoque, frete, marketplace, entrega).
- Se faltar dado essencial, peça o dado.
- Evite textos longos: máximo ~5 linhas no WhatsApp.
`.trim();

  // Treino humano (tom/energia/pressão/scripts)
  const humanBlock = buildHumanTrainingSystemBlock(humanTraining);

 // Product intelligence (benefícios/diferenciais/prova/objeções)
// ✅ Vai como SYSTEM separado
const productIntelBlock = `
PRODUCT_INTELLIGENCE:
${safeJsonStringify(product_intelligence || {}, "{}")}

REGRAS OBRIGATÓRIAS:
- Considere que o produto ativo é "${product_intelligence?.name || "Produto Atual"}".
- NÃO peça para o cliente confirmar qual produto é.
- Se existir "differentials" (lista), use EXATAMENTE 2 itens dessa lista (copie literalmente os textos).
- Se existir "main_benefits" (lista), inclua EXATAMENTE 1 item (copie literalmente).
- Se existir "proof" (lista), inclua no máximo 1 prova curta (copie literalmente).
- NÃO diga que não tem detalhes se qualquer campo do JSON acima estiver preenchido.
- NÃO invente marketplace, canal (Amazon, ML, etc.), prazo, preço ou frete.
- Se o usuário pedir "em 2 linhas", responda em no máximo 2 linhas.
- Só faça 1 pergunta se (e somente se) o JSON acima estiver completamente vazio.
`.trim();
  // Contexto do estágio
  const stageBlock = `
STAGE_CONTEXT:
${safeJsonStringify(stageContext || {}, "{}")}
`.trim();

  // Facts (estado atual)
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
      role: "user",
      content: user,
    },
  ];

  // ✅ ENVs (com defaults seguros)
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

    // Alguns clients suportam timeout via options, outros no próprio objeto.
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