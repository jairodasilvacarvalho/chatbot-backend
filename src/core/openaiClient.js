// src/core/openaiClient.js
// ✅ Compatível com: const openai = require("./openaiClient")
// ✅ Lazy init: não quebra no require se faltar OPENAI_API_KEY
// ✅ Cria o client apenas quando for realmente usar
// ✅ Exporta também getOpenAIClient() opcional

const OpenAI = require("openai");

let client = null;

function buildMissingKeyError() {
  const err = new Error(
    "Missing credentials. Please pass an `apiKey`, or set the `OPENAI_API_KEY` environment variable."
  );
  err.name = "OpenAIError";
  err.code = "MISSING_OPENAI_API_KEY";
  err.status = 401;
  return err;
}

function ensureClient() {
  if (client) return client;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw buildMissingKeyError();

  client = new OpenAI({ apiKey });
  return client;
}

/**
 * Proxy para manter compatibilidade com o uso atual:
 * openai.chat.completions.create(req, opts)
 */
const openaiProxy = {
  chat: {
    completions: {
      create: async (...args) => {
        const c = ensureClient();
        return c.chat.completions.create(...args);
      },
    },
  },

  // Opcional: migração futura
  getOpenAIClient: () => {
    try {
      return ensureClient();
    } catch {
      return null;
    }
  },

  // Opcional: útil em testes/hot reload
  reset: () => {
    client = null;
  },
};

module.exports = openaiProxy;