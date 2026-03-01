const events = require("../services/conversationEvents.service");

(async () => {
  const tenantId = 1;
  const customerId = 1;

  await events.logEvent(tenantId, customerId, "text_sent", "teste");
  const last = await events.getLastEvents(tenantId, customerId, 5);
  console.log(last);

  const c = await events.countEvents(tenantId, customerId, "text_sent", 60);
  console.log("text_sent últimos 60 min:", c.total);
})();
