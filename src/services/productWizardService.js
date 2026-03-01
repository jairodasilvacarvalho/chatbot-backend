// src/services/productWizardService.js
const crypto = require("crypto");
const db = require("../../config/db");

/* ======================
   STEPS (State Machine)
====================== */
const STEPS = [
  { stage: "product_key", key: "product_key", question: "Qual vai ser a chave do produto? (ex: kit_churrasco_01)" },
  { stage: "product_name", key: "name", question: "Nome do produto (como você quer que o cliente veja)?" },
  { stage: "description", key: "description", question: "Descrição curta do produto em 1–2 frases:" },
  { stage: "target", key: "target", question: "Para quem é esse produto? (perfil do cliente)" },
  { stage: "pain", key: "pain", question: "Qual dor principal ele resolve?" },
  { stage: "benefits", key: "benefits", question: "Liste os benefícios principais (pode ser em tópicos)." },
  { stage: "price", key: "price", question: "Qual o preço? (ex: 149.90)" },
  { stage: "payment", key: "payment", question: "Formas de pagamento? (PIX, cartão, boleto etc.)" },
  { stage: "delivery", key: "delivery", question: "Entrega/prazo/região? (ex: 3–7 dias úteis, Brasil)" },
  { stage: "pitch_abertura", key: "pitch_abertura", question: "Escreva o pitch da ABERTURA (1 mensagem curta):" },
  { stage: "pitch_diagnostico", key: "pitch_diagnostico", question: "Escreva o pitch do DIAGNÓSTICO (pergunta/sondagem):" },
  { stage: "pitch_oferta", key: "pitch_oferta", question: "Escreva o pitch da OFERTA (benefício + preço + CTA):" },
  { stage: "pitch_fechamento", key: "pitch_fechamento", question: "Escreva o pitch do FECHAMENTO (urgência/segurança/CTA final):" },
  {
    stage: "objections_loop",
    key: "objections",
    question:
      "Objeções: me diga 1 objeção comum e a resposta. Formato: 'objeção | resposta'. (Digite 'ok' para finalizar)",
  },
  { stage: "rules", key: "rules", question: "Regras do vendedor (ex: não prometer cura, não inventar estoque, etc.)." },
  { stage: "confirm_save", key: null, question: "Confirmar salvamento? Responda: 'salvar' ou 'cancelar'." },
];

/* ======================
   Helpers
====================== */
function getStepIndex(stage) {
  return STEPS.findIndex(s => s.stage === stage);
}

function safeJSON(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/* ======================
   Draft CRUD
====================== */
async function createDraft({ tenant_id, wizard_id }) {
  const id = wizard_id || crypto.randomUUID();
  const first = STEPS[0];

  await db.run(
    `
    INSERT INTO product_wizard_drafts
      (tenant_id, wizard_id, stage, draft_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'draft', datetime('now'), datetime('now'))
    `,
    [tenant_id, id, first.stage, JSON.stringify({})]
  );

  return {
    wizard_id: id,
    stage: first.stage,
    question: first.question,
  };
}

async function loadDraft({ tenant_id, wizard_id }) {
  const row = await db.get(
    `SELECT * FROM product_wizard_drafts WHERE tenant_id = ? AND wizard_id = ?`,
    [tenant_id, wizard_id]
  );

  if (!row) return null;

  return {
    ...row,
    draft: safeJSON(row.draft_json, {}),
  };
}

async function saveDraftRow({ tenant_id, wizard_id, stage, draft, status = "draft" }) {
  await db.run(
    `
    UPDATE product_wizard_drafts
       SET stage = ?, draft_json = ?, status = ?, updated_at = datetime('now')
     WHERE tenant_id = ? AND wizard_id = ?
    `,
    [stage, JSON.stringify(draft), status, tenant_id, wizard_id]
  );
}

/* ======================
   Wizard Logic
====================== */
async function answerStep({ tenant_id, wizard_id, answerRaw }) {
  const row = await loadDraft({ tenant_id, wizard_id });
  if (!row) throw new Error("wizard_not_found");
  if (row.status !== "draft") throw new Error("wizard_not_draft");

  const stage = row.stage;
  const stepIndex = getStepIndex(stage);
  if (stepIndex < 0) throw new Error("invalid_stage");

  const step = STEPS[stepIndex];
  const draft = row.draft;
  const answer = String(answerRaw ?? "").trim();

  /* ----- objections_loop ----- */
  if (stage === "objections_loop") {
    draft.objections = Array.isArray(draft.objections) ? draft.objections : [];

    if (answer.toLowerCase() === "ok") {
      const next = STEPS[stepIndex + 1];
      await saveDraftRow({ tenant_id, wizard_id, stage: next.stage, draft });
      return { wizard_id, stage: next.stage, question: next.question };
    }

    const parts = answer.split("|").map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) {
      return {
        wizard_id,
        stage,
        question: "Formato inválido. Use: 'objeção | resposta' ou 'ok' para finalizar.",
      };
    }

    draft.objections.push({ objection: parts[0], answer: parts.slice(1).join(" | ") });
    await saveDraftRow({ tenant_id, wizard_id, stage, draft });

    return { wizard_id, stage, question: step.question };
  }

  /* ----- confirm_save ----- */
  if (stage === "confirm_save") {
    if (answer.toLowerCase() === "cancelar") {
      await saveDraftRow({ tenant_id, wizard_id, stage, draft, status: "canceled" });
      return { wizard_id, stage, question: "Wizard cancelado." };
    }

    if (answer.toLowerCase() !== "salvar") {
      return {
        wizard_id,
        stage,
        question: "Responda 'salvar' para confirmar ou 'cancelar' para cancelar.",
      };
    }

    return {
      wizard_id,
      stage,
      question: "Confirmação recebida. Agora chame /admin/product-wizard/confirm.",
    };
  }

  /* ----- validação padrão ----- */
  if (!answer) {
    return { wizard_id, stage, question: "Resposta vazia. " + step.question };
  }

  if (step.key) draft[step.key] = answer;

  const next = STEPS[stepIndex + 1];
  await saveDraftRow({ tenant_id, wizard_id, stage: next.stage, draft });

  return {
    wizard_id,
    stage: next.stage,
    question: next.question,
  };
}

/* ======================
   Build + Persist
====================== */
function buildPlaybookFromDraft(draft) {
  if (!draft.product_key) throw new Error("missing_product_key");

  return {
    product_key: draft.product_key,
    name: draft.name || "",
    description: draft.description || "",
    pitch_by_stage: {
      abertura: draft.pitch_abertura || "",
      diagnostico: draft.pitch_diagnostico || "",
      oferta: draft.pitch_oferta || "",
      fechamento: draft.pitch_fechamento || "",
    },
    objections_json: draft.objections || [],
    rules_json: { rules: draft.rules || "" },
    data_json: {
      target: draft.target || "",
      pain: draft.pain || "",
      benefits: draft.benefits || "",
      price: draft.price || "",
      payment: draft.payment || "",
      delivery: draft.delivery || "",
    },
  };
}

async function confirmAndPersist({ tenant_id, wizard_id, productPlaybookService }) {
  const row = await loadDraft({ tenant_id, wizard_id });
  if (!row) throw new Error("wizard_not_found");
  if (row.status !== "draft") throw new Error("wizard_not_draft");

  const playbook = buildPlaybookFromDraft(row.draft);

  await productPlaybookService.upsertByProductKey({
    tenant_id,
    product_key: playbook.product_key,
    payload: playbook,
  });

  await saveDraftRow({
    tenant_id,
    wizard_id,
    stage: row.stage,
    draft: row.draft,
    status: "confirmed",
  });

  return { saved: true, product_key: playbook.product_key };
}

/* ======================
   Exports
====================== */
module.exports = {
  createDraft,
  answerStep,
  confirmAndPersist,
};
