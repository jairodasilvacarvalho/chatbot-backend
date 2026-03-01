// src/services/productPlaybookService.js
// Responsável por CRUD de Playbooks de Produto (O QUE o agente fala)
// Agora também guarda Treino Humano em: data_json.human_training

const db = require("../../config/db");

/* ======================
   Helpers
====================== */
function safeJSON(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeHumanTraining(ht) {
  if (!ht || typeof ht !== "object") return null;

  // MVP: só strings (como combinamos). Se vier algo diferente, converte pra string.
  const getStr = (v) => {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v;
    return String(v);
  };

  return {
    tone_style: getStr(ht.tone_style),
    language_level: getStr(ht.language_level),
    emoji_usage: getStr(ht.emoji_usage),
    energy: getStr(ht.energy),

    sales_posture: getStr(ht.sales_posture),
    pressure_level: getStr(ht.pressure_level),
    rapport_script: getStr(ht.rapport_script),
    objections_script: getStr(ht.objections_script),
    closing_style: getStr(ht.closing_style),

    never_do: getStr(ht.never_do),
  };
}

/* ======================
   UPSERT (Wizard + Admin)
====================== */
async function upsertByProductKey({ tenant_id, product_key, payload }) {
  if (!tenant_id) throw new Error("missing_tenant_id");
  if (!product_key) throw new Error("missing_product_key");
  if (!payload || typeof payload !== "object") throw new Error("invalid_payload");

  const name = payload.name || "";
  const description = payload.description || "";

  const pitch_by_stage = JSON.stringify(payload.pitch_by_stage || {});
  const objections_json = JSON.stringify(payload.objections_json || []);
  const rules_json = JSON.stringify(payload.rules_json || {});

  // data_json é o "baú" de configurações do produto.
  // Mantém compatibilidade com o que já existe e permite adicionar campos sem migração.
  const data_json = JSON.stringify(payload.data_json || {});

  await db.run(
    `
    INSERT INTO product_playbooks (
      tenant_id,
      product_key,
      name,
      description,
      pitch_by_stage,
      objections_json,
      rules_json,
      data_json,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(tenant_id, product_key)
    DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      pitch_by_stage = excluded.pitch_by_stage,
      objections_json = excluded.objections_json,
      rules_json = excluded.rules_json,
      data_json = excluded.data_json,
      updated_at = datetime('now')
    `,
    [
      tenant_id,
      product_key,
      name,
      description,
      pitch_by_stage,
      objections_json,
      rules_json,
      data_json,
    ]
  );

  return { ok: true, product_key };
}

/* ======================
   GET por product_key
====================== */
async function getByProductKey({ tenant_id, product_key }) {
  if (!tenant_id) throw new Error("missing_tenant_id");
  if (!product_key) throw new Error("missing_product_key");

  const row = await db.get(
    `
    SELECT *
    FROM product_playbooks
    WHERE tenant_id = ?
      AND product_key = ?
    `,
    [tenant_id, product_key]
  );

  if (!row) return null;

  return {
    id: row.id,
    tenant_id: row.tenant_id,
    product_key: row.product_key,
    name: row.name,
    description: row.description,
    pitch_by_stage: safeJSON(row.pitch_by_stage, {}),
    objections_json: safeJSON(row.objections_json, []),
    rules_json: safeJSON(row.rules_json, {}),
    data_json: safeJSON(row.data_json, {}), // <- aqui vai viver human_training
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/* ======================
   LISTAR por tenant
====================== */
async function listByTenant({ tenant_id }) {
  if (!tenant_id) throw new Error("missing_tenant_id");

  const rows = await db.all(
    `
    SELECT id, product_key, name, description, created_at, updated_at
    FROM product_playbooks
    WHERE tenant_id = ?
    ORDER BY created_at DESC
    `,
    [tenant_id]
  );

  return rows || [];
}

/* ======================
   DELETE (opcional / admin)
====================== */
async function removeByProductKey({ tenant_id, product_key }) {
  if (!tenant_id) throw new Error("missing_tenant_id");
  if (!product_key) throw new Error("missing_product_key");

  await db.run(
    `
    DELETE FROM product_playbooks
    WHERE tenant_id = ?
      AND product_key = ?
    `,
    [tenant_id, product_key]
  );

  return { ok: true };
}

/* ======================
   TREINO HUMANO (NOVO)
   Guarda em: data_json.human_training
====================== */
async function setHumanTraining({ tenant_id, product_key, human_training }) {
  if (!tenant_id) throw new Error("missing_tenant_id");
  if (!product_key) throw new Error("missing_product_key");

  const normalized = normalizeHumanTraining(human_training);
  if (!normalized) throw new Error("invalid_human_training");

  // Carrega playbook atual (pra não esmagar data_json existente)
  const current = await db.get(
    `
    SELECT data_json
    FROM product_playbooks
    WHERE tenant_id = ?
      AND product_key = ?
    `,
    [tenant_id, product_key]
  );

  // Se não existe playbook ainda, exige criar via upsert primeiro (evita criar playbook "vazio" sem nome/descrição).
  if (!current) throw new Error("playbook_not_found");

  const data = safeJSON(current.data_json, {});
  data.human_training = normalized;

  await db.run(
    `
    UPDATE product_playbooks
    SET data_json = ?,
        updated_at = datetime('now')
    WHERE tenant_id = ?
      AND product_key = ?
    `,
    [JSON.stringify(data), tenant_id, product_key]
  );

  return { ok: true, product_key, human_training: normalized };
}

async function getHumanTraining({ tenant_id, product_key }) {
  if (!tenant_id) throw new Error("missing_tenant_id");
  if (!product_key) throw new Error("missing_product_key");

  const row = await db.get(
    `
    SELECT data_json
    FROM product_playbooks
    WHERE tenant_id = ?
      AND product_key = ?
    `,
    [tenant_id, product_key]
  );

  if (!row) return null;

  const data = safeJSON(row.data_json, {});
  return data.human_training || null;
}

/* ======================
   EXPORTS
====================== */
module.exports = {
  upsertByProductKey,
  getByProductKey,
  listByTenant,
  removeByProductKey,

  // treino humano
  setHumanTraining,
  getHumanTraining,
};
