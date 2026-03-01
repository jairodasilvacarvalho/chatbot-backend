// public/admin/app.js
// ✅ Lista clientes
// ✅ Abre conversa + facts
// ✅ Botão "Reset Funil"
// ✅ TREINO HUMANO (UI) plug-in
// ✅ NOVO: LOGIN JWT + Bearer automático + fallback (x-admin-key) só para /admin/login
// ✅ Se token expirar: limpa token e pede login de novo

// ------------------------------
// JWT helpers
// ------------------------------
function getToken() {
  return localStorage.getItem("admin_token") || "";
}
function setToken(token) {
  localStorage.setItem("admin_token", token);
}
function clearToken() {
  localStorage.removeItem("admin_token");
}
function hasToken() {
  return !!getToken();
}

// ------------------------------
// Base helpers
// ------------------------------
function el(id) {
  return document.getElementById(id);
}
function esc(s) {
  return String(s || "").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// ------------------------------
// Auth getters (UI)
// ------------------------------
function getTenantId() {
  return (el("tenantId")?.value || "1").trim() || "1";
}
function getAdminKeyRaw() {
  return (el("adminKey")?.value || "").trim();
}

function getAuth({ requireKey = false } = {}) {
  const tenantId = getTenantId();
  const adminKey = getAdminKeyRaw();

  if (requireKey && !adminKey) throw new Error("Preencha o x-admin-key (adminKey) para fazer login.");

  return { adminKey, tenantId };
}

// ------------------------------
// Login (JWT)
// ------------------------------
async function adminLogin({ adminKey, tenantId, username = "admin" }) {
  const res = await fetch("/admin/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": adminKey,
      "x-tenant-id": String(tenantId || 1),
    },
    body: JSON.stringify({ username }),
  });

  const text = await res.text();
  const data = safeJsonParse(text);

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  }

  const token = data?.data?.token;
  if (!token) throw new Error("Login retornou ok, mas não veio token.");

  setToken(token);
  return data;
}

// ------------------------------
// API wrapper (JWT + tenant)
// ------------------------------
async function api(path, { method = "GET", body, requireAuth = true } = {}) {
  const { tenantId } = getAuth({ requireKey: false });

  const headers = {
    "x-tenant-id": String(tenantId || 1),
  };

  // Bearer automático
  const token = getToken();
  if (requireAuth && token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = safeJsonParse(text);

  // Se 401: token expirou / inválido
  if (res.status === 401 || data?.error === "invalid_or_expired_token" || data?.error === "missing_bearer_token") {
    // limpa token e força relogar
    clearToken();
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  }

  return data;
}

// ------------------------------
// UI helpers
// ------------------------------
function setSelected(phone) {
  el("currentPhone").textContent = phone ? `Selecionado: ${phone}` : "Selecionado: -";
  const btn = el("btnReset");
  if (btn) btn.disabled = !phone;
}

function renderCustomers(list, onClick) {
  const box = el("customers");
  box.innerHTML = "";
  (list || []).forEach((c) => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div><b>${esc(c.phone)}</b> <span class="muted">(#${esc(c.id)})</span></div>
      <div class="muted">
        stage: ${esc(c.stage || "-")} |
        product: ${esc(c.product_key || "-")} |
        last_seen: ${esc(c.last_seen_at || "-")}
      </div>
    `;
    div.onclick = () => onClick(c);
    box.appendChild(div);
  });
}

function renderMessages(list) {
  const box = el("messages");
  box.innerHTML = "";
  (list || []).forEach((m) => {
    const div = document.createElement("div");
    div.className = "msg " + (m.direction === "out" ? "out" : "in");
    div.innerHTML = `
      <div>${esc(m.text || "")}</div>
      <div class="muted">${esc(m.created_at || "")}</div>
    `;
    box.appendChild(div);
  });

  box.scrollTop = box.scrollHeight;
}

// ------------------------------
// Data loaders
// ------------------------------
/**
 * GET /admin/customers -> { ok:true, data:{ items:[...] } }
 */
async function loadCustomers() {
  const resp = await api("/admin/customers");
  return resp?.data?.items || [];
}

/**
 * GET /admin/conversations/:phone -> { ok:true, data:{ customer, messages } }
 */
async function loadConversation(phone) {
  const resp = await api(`/admin/conversations/${phone}`);
  return resp?.data || { customer: null, messages: [] };
}

/**
 * POST /admin/customers/:phone/reset
 */
async function resetFunnel(phone) {
  if (!phone) return;
  if (!confirm(`Resetar funil do cliente ${phone}?`)) return;

  await api(`/admin/customers/${phone}/reset`, { method: "POST" });

  alert("Funil resetado ✅");

  // Recarrega conversa e facts após reset
  const convo = await loadConversation(phone);
  renderMessages(convo.messages || []);

  const facts = convo.customer?.facts_json || "{}";
  let obj;
  try {
    obj = typeof facts === "string" ? JSON.parse(facts) : facts;
  } catch {
    obj = { raw: facts };
  }
  el("facts").textContent = JSON.stringify(obj, null, 2);
}

// ------------------------------
// Login UI (overlay leve)
// ------------------------------
function ensureLoginUI() {
  if (document.getElementById("loginBox")) return;

  const wrap = document.createElement("div");
  wrap.id = "loginBox";
  wrap.style.margin = "10px 0";
  wrap.style.padding = "10px";
  wrap.style.border = "1px solid #ddd";
  wrap.style.borderRadius = "10px";
  wrap.style.background = "#fff";

  wrap.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <b>🔐 Login</b>
      <span id="loginStatus" style="font-size:12px;color:#666;"></span>
    </div>

    <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-top:10px;">
      <div>
        <div style="font-size:12px;color:#555;">x-tenant-id</div>
        <input id="tenantId" value="${esc(getTenantId())}" style="padding:8px;width:120px;">
      </div>

      <div>
        <div style="font-size:12px;color:#555;">x-admin-key (apenas para login)</div>
        <input id="adminKey" placeholder="admin_dev_local_2026" style="padding:8px;width:220px;">
      </div>

      <div>
        <div style="font-size:12px;color:#555;">username (opcional)</div>
        <input id="adminUser" value="admin" style="padding:8px;width:140px;">
      </div>

      <button id="btnLogin" style="padding:8px 12px;">Entrar</button>
      <button id="btnLogout" style="padding:8px 12px;">Sair</button>
    </div>
  `;

  // coloca no topo do painel
  const anchor = document.body.firstElementChild || document.body;
  document.body.insertBefore(wrap, anchor);

  function setStatus(msg, ok = true) {
    const s = document.getElementById("loginStatus");
    if (!s) return;
    s.textContent = msg;
    s.style.color = ok ? "green" : "crimson";
  }

  const btnLogin = document.getElementById("btnLogin");
  const btnLogout = document.getElementById("btnLogout");

  btnLogin.onclick = async () => {
    try {
      const tenantId = getTenantId();
      const adminKey = getAdminKeyRaw();
      const username = (document.getElementById("adminUser")?.value || "admin").trim() || "admin";

      if (!adminKey) return setStatus("Preencha o x-admin-key para logar.", false);

      setStatus("Logando...");
      await adminLogin({ adminKey, tenantId, username });
      setStatus("Logado ✅");

    } catch (e) {
      setStatus(e.message || "Erro no login", false);
      alert("Erro: " + (e.message || e));
    }
  };

  btnLogout.onclick = () => {
    clearToken();
    setStatus("Sessão removida.");
  };

  // status inicial
  if (hasToken()) setStatus("Token carregado (localStorage).");
  else setStatus("Faça login para usar o admin.", false);
}

// ------------------------------
// Reset Button (exists)
// ------------------------------
let currentPhone = null;

function ensureResetButtonExists() {
  let actions = el("actions");
  if (!actions) {
    const cp = el("currentPhone");
    if (cp && cp.parentElement) {
      actions = document.createElement("div");
      actions.id = "actions";
      actions.style.margin = "10px 0";
      cp.parentElement.appendChild(actions);
    }
  }

  if (!actions) return;

  if (!el("btnReset")) {
    const btn = document.createElement("button");
    btn.id = "btnReset";
    btn.textContent = "🔄 Reset Funil";
    btn.disabled = true;
    btn.onclick = async () => {
      try {
        await resetFunnel(currentPhone);
      } catch (e) {
        alert("Erro: " + e.message);
      }
    };
    actions.appendChild(btn);
  }
}

async function selectCustomer(c) {
  currentPhone = c.phone;
  setSelected(currentPhone);
  ensureResetButtonExists();

  const convo = await loadConversation(c.phone);

  const msgs = convo.messages || [];
  renderMessages(msgs);

  const facts = convo.customer?.facts_json || c.facts_json || "{}";
  let obj;
  try {
    obj = typeof facts === "string" ? JSON.parse(facts) : facts;
  } catch {
    obj = { raw: facts };
  }
  el("facts").textContent = JSON.stringify(obj, null, 2);
}

// ------------------------------
// Main button
// ------------------------------
el("btnLoad").onclick = async () => {
  try {
    ensureLoginUI();
    ensureResetButtonExists();
    setSelected(null);
    currentPhone = null;

    if (!hasToken()) {
      alert("Você precisa fazer login (gerar token) antes de carregar os dados.");
      return;
    }

    const list = await loadCustomers();
    renderCustomers(list, async (c) => {
      try {
        await selectCustomer(c);
      } catch (e) {
        alert("Erro: " + e.message);
      }
    });
  } catch (e) {
    alert("Erro: " + e.message);
  }
};

// Inicializa estado
try {
  ensureLoginUI();
  ensureResetButtonExists();
  setSelected(null);
} catch {
  // ignora caso a UI ainda não tenha carregado elementos
}

// ==============================
// TREINO HUMANO (UI) — plug-in
// ==============================
(function trainingUIPlugin() {
  const PRESETS = {
    consultor: {
      tone_style: "Consultivo, calmo, profissional e humano",
      language_level: "Simples e direto (WhatsApp), sem termos técnicos",
      emoji_usage: "Moderado (1-2 por mensagem, sem exagero)",
      energy: "Média (positivo, sem gritaria)",
      sales_posture: "Vendedor consultor: diagnostica antes, recomenda com segurança",
      pressure_level: "Baixa a moderada (sem pressão, mas conduz para o próximo passo)",
      rapport_script: "Espelhamento leve + validação + 1 pergunta de qualificação antes de recomendar.",
      objections_script: "Empatia + prova/garantia + alternativa (parcelamento/benefício) + pergunta curta.",
      closing_style: "Fechamento suave: confirmar intenção e avançar etapa com objetividade.",
      never_do: "Não prometer resultado irreal. Não insistir se negar. Sem pressão excessiva."
    },
    premium: {
      tone_style: "Confiante, elegante, especialista",
      language_level: "Clara e profissional, sem gírias",
      emoji_usage: "Baixo (0-1 por mensagem)",
      energy: "Média",
      sales_posture: "Autoridade + valor + confiança",
      pressure_level: "Moderada",
      rapport_script: "Valide a intenção e demonstre domínio do produto sem enrolar.",
      objections_script: "Reforce garantia/qualidade/autoridade e ofereça melhor condição (à vista/parcelado).",
      closing_style: "Fechamento com segurança: orientar o passo exato e confirmar.",
      never_do: "Não exagerar promessas. Não ser informal demais."
    },
    agressivo: {
      tone_style: "Direto, objetivo, focado em conversão",
      language_level: "Bem curto e direto",
      emoji_usage: "Baixo",
      energy: "Alta",
      sales_posture: "Condução firme",
      pressure_level: "Alta (sem desrespeitar)",
      rapport_script: "Pouca conversa: confirme necessidade e avance.",
      objections_script: "Responder rápido e puxar pro próximo passo (CEP/pagamento/link).",
      closing_style: "Fechamento direto: passo final e pronto.",
      never_do: "Não usar culpa, não insistir após recusa."
    },
    amigo: {
      tone_style: "Informal, próximo, humano",
      language_level: "Bem simples e informal",
      emoji_usage: "Moderado",
      energy: "Média/Alta",
      sales_posture: "Amigo que ajuda a decidir",
      pressure_level: "Baixa",
      rapport_script: "Tom leve, validação rápida, pergunta simples.",
      objections_script: "Explicar sem tecnicês + tranquilizar + perguntar o que falta.",
      closing_style: "Fechamento leve: 'me passa o CEP/PIX e eu te mando o link'.",
      never_do: "Não ser invasivo, não prometer demais."
    }
  };

  const FIELDS = [
    ["tone_style", "Tom/Estilo"],
    ["language_level", "Nível de linguagem"],
    ["emoji_usage", "Uso de emojis"],
    ["energy", "Energia"],
    ["sales_posture", "Postura de vendas"],
    ["pressure_level", "Nível de pressão"],
    ["rapport_script", "Rapport (script)"],
    ["objections_script", "Objeções (script)"],
    ["closing_style", "Fechamento (estilo)"],
    ["never_do", "Nunca fazer"]
  ];

  function qs(sel) { return document.querySelector(sel); }

  function getTenantId2() {
    return (qs('#tenantId')?.value || "1").trim();
  }

  function getHeaders() {
    const tenantId = getTenantId2() || "1";
    const headers = { "x-tenant-id": tenantId };

    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    return headers;
  }

  async function apiGET(path) {
    const res = await fetch(path, { headers: getHeaders() });
    const text = await res.text();
    const data = safeJsonParse(text);

    if (res.status === 401 || data?.ok === false && (data?.error || "").includes("token")) {
      clearToken();
      throw new Error("Sessão expirada. Faça login novamente.");
    }

    return data;
  }

  async function apiPOST(path, bodyObj) {
    const headers = getHeaders();
    headers["Content-Type"] = "application/json";

    const res = await fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify(bodyObj),
    });

    const text = await res.text();
    const data = safeJsonParse(text);

    if (res.status === 401 || data?.ok === false && (data?.error || "").includes("token")) {
      clearToken();
      throw new Error("Sessão expirada. Faça login novamente.");
    }

    return data;
  }

  function ensureTrainingPanel() {
    const anchor =
      Array.from(document.querySelectorAll("h3,h4,div"))
        .find((el) => (el.textContent || "").includes("Facts"))?.parentElement
      || document.body;

    if (qs("#training-panel")) return;

    const wrap = document.createElement("div");
    wrap.id = "training-panel";
    wrap.style.marginTop = "12px";
    wrap.style.padding = "12px";
    wrap.style.border = "1px solid #ddd";
    wrap.style.borderRadius = "10px";
    wrap.style.background = "#fff";

    wrap.innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <b>Treino Humano (por produto)</b>
        <span id="training-status" style="font-size:12px;"></span>
      </div>

      <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-top:10px;">
        <div>
          <div style="font-size:12px;color:#555;">product_key</div>
          <input id="training-product-key" placeholder="ex: kit_churrasco_01" style="padding:8px;width:220px;">
        </div>

        <div>
          <div style="font-size:12px;color:#555;">Preset</div>
          <select id="training-preset" style="padding:8px;">
            <option value="">-- escolher --</option>
            <option value="consultor">consultor</option>
            <option value="premium">premium</option>
            <option value="agressivo">agressivo</option>
            <option value="amigo">amigo</option>
          </select>
        </div>

        <button id="training-apply-preset" style="padding:8px 12px;">Aplicar preset</button>
        <button id="training-load" style="padding:8px 12px;">Carregar</button>
        <button id="training-save" style="padding:8px 12px;">Salvar</button>
      </div>

      <div id="training-fields" style="margin-top:10px;display:grid;gap:10px;"></div>
    `;

    anchor.appendChild(wrap);

    const fieldsBox = qs("#training-fields");
    FIELDS.forEach(([key, label]) => {
      const row = document.createElement("div");
      row.innerHTML = `
        <div style="font-size:12px;color:#333;margin-bottom:4px;"><b>${label}</b> <span style="color:#777;">(${key})</span></div>
        <textarea id="training-${key}" rows="${key.includes("script") ? 3 : 2}" style="width:100%;padding:8px;"></textarea>
      `;
      fieldsBox.appendChild(row);
    });
  }

  function setStatus(msg, ok = true) {
    const el = qs("#training-status");
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok ? "green" : "crimson";
  }

  function readForm() {
    const obj = {};
    FIELDS.forEach(([key]) => {
      obj[key] = (qs(`#training-${key}`)?.value || "").trim();
    });
    return obj;
  }

  function fillForm(obj) {
    FIELDS.forEach(([key]) => {
      const v = (obj && obj[key] != null) ? String(obj[key]) : "";
      const el = qs(`#training-${key}`);
      if (el) el.value = v;
    });
  }

  function wireEvents() {
    qs("#training-apply-preset")?.addEventListener("click", () => {
      const p = (qs("#training-preset")?.value || "").trim();
      if (!p || !PRESETS[p]) return setStatus("Selecione um preset.", false);
      fillForm(PRESETS[p]);
      setStatus(`Preset "${p}" aplicado (não salvou ainda).`);
    });

    qs("#training-load")?.addEventListener("click", async () => {
      try {
        const productKey = (qs("#training-product-key")?.value || "").trim();
        if (!productKey) return setStatus("Informe o product_key.", false);

        if (!hasToken()) return setStatus("Faça login para usar o treino humano.", false);

        setStatus("Carregando...");
        const data = await apiGET(`/admin/product-playbooks/${encodeURIComponent(productKey)}`);
        if (!data?.ok) return setStatus(`Erro ao carregar: ${data?.error || "unknown"}`, false);

        const ht = data?.data?.data_json?.human_training || {};
        fillForm(ht);
        setStatus("Carregado ✅");
      } catch (e) {
        setStatus(e.message || "Erro", false);
        alert("Erro: " + (e.message || e));
      }
    });

    qs("#training-save")?.addEventListener("click", async () => {
      try {
        const productKey = (qs("#training-product-key")?.value || "").trim();
        if (!productKey) return setStatus("Informe o product_key.", false);

        if (!hasToken()) return setStatus("Faça login para salvar o treino humano.", false);

        const payload = { human_training: readForm() };

        setStatus("Salvando...");
        const data = await apiPOST(`/admin/products/${encodeURIComponent(productKey)}/training`, payload);
        if (!data?.ok) return setStatus(`Erro ao salvar: ${data?.error || "unknown"}`, false);

        setStatus("Salvo ✅");
      } catch (e) {
        setStatus(e.message || "Erro", false);
        alert("Erro: " + (e.message || e));
      }
    });
  }

  function init() {
    ensureTrainingPanel();
    wireEvents();
    setStatus("Pronto.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
