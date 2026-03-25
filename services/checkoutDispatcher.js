// services/checkoutDispatcher.js

/**
 * Envia checkout automaticamente quando o closing terminar.
 * - Se existir playbook.checkout_url => envia link e marca facts.checkout.sent
 * - Se não existir => envia fallback e marca facts.checkout.missing
 * - Não duplica
 */
async function dispatchCheckoutIfDone({
  tenantId,
  customerPhone,
  facts,
  playbook,
  sendText,        // fn: async ({tenantId, customerPhone, text}) => void
  saveFacts,       // fn: async ({tenantId, customerPhone, facts}) => void
  nowIso = () => new Date().toISOString(),
}) {
  if (!facts?.closing || facts.closing.step !== "done") return;

  facts.checkout = facts.checkout || {};

  // anti-duplicação
  if (facts.checkout.sent === true) return;

  const checkoutUrl = (playbook?.checkout_url || "").trim();

  if (checkoutUrl) {
    const text =
      `Perfeito ✅ Pagamento confirmado.\n` +
      `Finalize por aqui:\n${checkoutUrl}`;

    await sendText({ tenantId, customerPhone, text });

    facts.checkout.sent = true;
    facts.checkout.sent_at = nowIso();
    facts.checkout.missing = false;

    await saveFacts({ tenantId, customerPhone, facts });
    return;
  }

  // Fallback (afiliado sem link ainda)
  const fallback =
    `Fechado ✅ Só falta eu te mandar o link final.\n` +
    `Você prefere comprar por qual canal: Amazon / Mercado Livre / Loja oficial / outro?`;

  await sendText({ tenantId, customerPhone, text: fallback });

  facts.checkout.sent = false;
  facts.checkout.missing = true;
  facts.checkout.missing_at = nowIso();

  await saveFacts({ tenantId, customerPhone, facts });
}

module.exports = { dispatchCheckoutIfDone };
