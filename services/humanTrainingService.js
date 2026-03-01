// services/humanTrainingService.js
// ✅ Compatível com seu projeto atual (CommonJS + db.get async)
// ✅ Fonte principal: products.data_json -> human_training + product_intelligence
// ✅ Fallback compat: product_playbooks.data_json -> human_training | humanTraining

const db = require("../config/db");
const { DEFAULT_TRAINING, normalizeTraining } = require("../src/core/humanTraining/contract");

function safeJsonParse(input, fallback = {}) {
  try {
    if (!input) return fallback;
    if (typeof input === "object") return input;
    return JSON.parse(input);
  } catch {
    return fallback;
  }
}

/**
 * Lê do products.data_json:
 * - human_training | humanTraining
 * - product_intelligence
 */
async function getProductDataFromProducts({ tenant_id, product_key }) {
  if (!tenant_id || !product_key) return null;

  const row = await db.get(
    `SELECT data_json
       FROM products
      WHERE tenant_id = ? AND product_key = ?
      LIMIT 1`,
    [tenant_id, product_key]
  );

  const data = safeJsonParse(row?.data_json, {});
  if (!data || typeof data !== "object") return null;

  const human_training = data?.human_training || data?.humanTraining || null;
  const product_intelligence = data?.product_intelligence || null;

  return {
    human_training: human_training && typeof human_training === "object" ? human_training : null,
    product_intelligence:
      product_intelligence && typeof product_intelligence === "object" ? product_intelligence : null,
  };
}

/**
 * Fonte compat/legada do training:
 * product_playbooks.data_json -> human_training | humanTraining
 * (não buscamos product_intelligence aqui por enquanto)
 */
async function getProductTrainingFromPlaybook({ tenant_id, product_key }) {
  if (!tenant_id || !product_key) return null;

  const row = await db.get(
    `SELECT data_json
       FROM product_playbooks
      WHERE tenant_id = ? AND product_key = ?
      LIMIT 1`,
    [tenant_id, product_key]
  );

  const data = safeJsonParse(row?.data_json, {});
  const ht = data?.human_training || data?.humanTraining || null;

  if (ht && typeof ht === "object") return ht;
  return null;
}

/**
 * Placeholder para futuro:
 * training default por tenant (ex: tenant_settings.human_training_default_json)
 * Por enquanto retorna null sem quebrar.
 */
async function getTenantDefaultTraining(/* { tenant_id } */) {
  return null;
}

/**
 * Loader oficial com fallback:
 * 1) Produto (products) ✅ fonte do dashboard (human_training + product_intelligence)
 * 2) Produto (playbook) ✅ compat (só training)
 * 3) Tenant default (futuro)
 * 4) DEFAULT_TRAINING
 *
 * Retorno agora inclui:
 * {
 *   training: <normalized training>,
 *   product_intelligence: <object|null>,
 *   source: "products" | "playbook" | "tenant_default" | "default"
 * }
 */
async function getEffectiveTraining({ tenant_id, product_key }) {
  const fromProducts = await getProductDataFromProducts({ tenant_id, product_key });
  if (fromProducts?.human_training) {
    return {
      training: normalizeTraining(fromProducts.human_training),
      product_intelligence: fromProducts.product_intelligence || null,
      source: "products",
    };
  }

  const fromPlaybook = await getProductTrainingFromPlaybook({ tenant_id, product_key });
  if (fromPlaybook) {
    return {
      training: normalizeTraining(fromPlaybook),
      product_intelligence: null,
      source: "playbook",
    };
  }

  const tenantHt = await getTenantDefaultTraining({ tenant_id });
  if (tenantHt) {
    return {
      training: normalizeTraining(tenantHt),
      product_intelligence: null,
      source: "tenant_default",
    };
  }

  return {
    training: normalizeTraining(DEFAULT_TRAINING),
    product_intelligence: null,
    source: "default",
  };
}

module.exports = { getEffectiveTraining };