require("dotenv").config();
const express = require("express");
const { upsertCustomer, saveMessage } = require("./db");

const app = express();
app.use(express.json());

// ✅ Rota de teste: servidor + banco
app.get("/", async (req, res) => {
  try {
    await upsertCustomer({ phone: "5511999999999", name: "Teste" });
    await saveMessage({
      customer_phone: "5511999999999",
      direction: "in",
      text: "Mensagem de teste"
    });

    res.send("Servidor OK 🚀 + Banco OK ✅");
  } catch (err) {
    console.error("Erro no banco:", err.message);
    res.status(500).send("Servidor OK 🚀, mas banco deu erro ❌");
  }
});

// ✅ Webhook local (simulação): você manda um JSON e ele salva no banco
app.post("/webhook", async (req, res) => {
  try {
    // Espera algo como: { "from": "5511...", "name": "Jairo", "text": "oi" }
    const { from, name, text } = req.body;

    if (!from || !text) {
      return res.status(400).json({
        ok: false,
        error: "Envie JSON com 'from' e 'text' (name é opcional)."
      });
    }

    await upsertCustomer({ phone: from, name: name || null });
    await saveMessage({ customer_phone: from, direction: "in", text });

    return res.json({ ok: true, saved: { from, name: name || null, text } });
  } catch (err) {
    console.error("Erro no /webhook:", err.message);
    return res.status(500).json({ ok: false, error: "Erro interno." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
