const q = require("./db/queries_admin");

(async () => {
  const customers = await q.getCustomers({ page: 1, limit: 10 });
  console.log("CUSTOMERS:", customers);

  if (customers.items[0]?.phone) {
    const phone = customers.items[0].phone;
    const convo = await q.getConversationByPhone(phone);
    console.log("CONVERSA:", convo.customer?.phone, "msgs:", convo.messages.length);
  }

  const stats = await q.getAdminStats();
  console.log("STATS:", stats);

  // Exemplo update stage (troque o phone se quiser)
  // const upd = await q.updateCustomerStage("5511999999999", "oferta");
  // console.log("UPDATE:", upd);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
