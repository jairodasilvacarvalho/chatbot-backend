// services/closingFlow.js
const { detectCep } = require("./utils/detectCep");
const { estimateShippingDays } = require("./utils/estimateShipping");
const { detectPaymentMethod } = require("./utils/detectPaymentMethod");

function nowIso() {
  return new Date().toISOString();
}

function getCheckoutLink(playbook) {
  // Prioridade: playbook.data_json.checkout_url > env > null
  const pb = playbook && playbook.data_json ? playbook.data_json : {};
  const url = (pb.checkout_url || process.env.DEFAULT_CHECKOUT_URL || "").trim();
  return url || null;
}

function ensureFactsShape(facts) {
  facts.closing = facts.closing || {};
  facts.shipping = facts.shipping || {};
  facts.payment = facts.payment || {};
  facts.checkout = facts.checkout || {};
  return facts;
}

function paymentLabel(method) {
  return method === "pix" ? "PIX" : method === "card" ? "Cartão" : "Boleto";
}

function buildCheckoutReply({ method, link }) {
  const label = paymentLabel(method);

  // Com link
  if (link) {
    return (
      `Perfeito ✅ Pagamento via *${label}* confirmado.\n` +
      `Finalize aqui:\n${link}`
    );
  }

  // Sem link (afiliado ainda sem checkout_url)
  return (
    `Perfeito ✅ Pagamento via *${label}* confirmado.\n` +
    `Só falta eu te mandar o link final. Você prefere comprar por qual canal: ` +
    `*Amazon* / *Mercado Livre* / *Loja oficial* / *outro*?`
  );
}

async function handleClosingFlow({ text, customer, facts, playbook }) {
  facts = ensureFactsShape(facts);

  // default step
  if (!facts.closing.step) facts.closing.step = "need_cep";

  // =========================================================
  // PASSO 10.2 — Se já está DONE, dispara checkout 1x
  // =========================================================
  if (facts.closing.step === "done") {
    const link = getCheckoutLink(playbook);

    // anti-duplicação: se já mandou, não manda de novo
    if (facts.checkout.sent === true) {
      return {
        facts,
        reply:
          "Perfeito ✅ Já te enviei o link de finalização. Se precisar de ajuda, me chama aqui.",
      };
    }

    // Se ainda não enviou, envia agora (na reply) e marca flags
    if (link) {
      facts.checkout.sent = true;
      facts.checkout.sent_at = nowIso();
      facts.checkout.missing = false;

      return {
        facts,
        reply: buildCheckoutReply({ method: facts.payment.method, link }),
      };
    }

    // Sem link configurado: fallback e marca missing
    facts.checkout.sent = false;
    facts.checkout.missing = true;
    facts.checkout.missing_at = nowIso();

    return {
      facts,
      reply: buildCheckoutReply({ method: facts.payment.method, link: null }),
    };
  }

  // 1) precisa CEP
  if (facts.closing.step === "need_cep") {
    const cep = detectCep(text);

    if (!cep) {
      return {
        facts,
        reply:
          "Perfeito. Me passa seu *CEP* (ex: 01001-000) pra eu calcular prazo e seguir com o pagamento 🙂",
      };
    }

    facts.shipping.cep = cep;
    facts.shipping.eta = estimateShippingDays(cep);
    facts.closing.step = "need_payment";

    const { min, max } = facts.shipping.eta;

    return {
      facts,
      reply:
        `Fechou! Com o CEP *${cep}* o prazo estimado fica entre *${min} e ${max} dias úteis*.\n\n` +
        "Agora me diz a forma de pagamento: *PIX*, *Cartão* ou *Boleto*?",
    };
  }

  // 2) precisa pagamento
  if (facts.closing.step === "need_payment") {
    const method = detectPaymentMethod(text);

    if (!method) {
      return {
        facts,
        reply:
          "Show! Só confirma pra mim: você prefere *PIX*, *Cartão* ou *Boleto*? 🙂",
      };
    }

    // confirma pagamento e finaliza transação
    facts.payment.method = method;
    facts.payment.confirmed = true;
    facts.closing.step = "done";

    // IMPORTANTÍSSIMO:
    // Ao virar DONE, já dispara o checkout (na própria reply) e grava flags,
    // sem perguntar mais nada.
    const link = getCheckoutLink(playbook);

    if (link) {
      facts.checkout.sent = true;
      facts.checkout.sent_at = nowIso();
      facts.checkout.missing = false;

      return {
        facts,
        reply: buildCheckoutReply({ method, link }),
      };
    }

    facts.checkout.sent = false;
    facts.checkout.missing = true;
    facts.checkout.missing_at = nowIso();

    return {
      facts,
      reply: buildCheckoutReply({ method, link: null }),
    };
  }

  // fallback (caso estranho)
  return {
    facts,
    reply:
      "Perfeito! Já está tudo encaminhado ✅ Se precisar ajustar algo (CEP/pagamento), é só me falar.",
  };
}

module.exports = { handleClosingFlow };
