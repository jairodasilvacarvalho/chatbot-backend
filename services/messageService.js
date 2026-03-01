// services/messageService.js
const db = require("../config/db");

/**
 * Salva mensagem (IN/OUT) no schema real do seu DB:
 * messages(
 *   id, customer_phone, direction, text, created_at,
 *   has_audio, audio_url, audio_duration_ms, audio_voice_id,
 *   tenant_id, external_message_id
 * )
 */
async function saveMessage({
  tenant_id,
  customer_phone,
  direction, // "in" | "out"
  text = null,
  has_audio = 0,
  audio_url = null,
  audio_duration_ms = null,
  audio_voice_id = null,
  external_message_id = null, // wamid (somente IN)
}) {
  if (!tenant_id) throw new Error("saveMessage: missing tenant_id");
  if (!customer_phone) throw new Error("saveMessage: missing customer_phone");
  if (!direction) throw new Error("saveMessage: missing direction");

  const sql = `
    INSERT INTO messages (
      tenant_id,
      customer_phone,
      direction,
      text,
      created_at,
      has_audio,
      audio_url,
      audio_duration_ms,
      audio_voice_id,
      external_message_id
    ) VALUES (
      ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?
    )
  `;

  return db.run(sql, [
    tenant_id,
    customer_phone,
    direction,
    text,
    has_audio ? 1 : 0,
    audio_url,
    audio_duration_ms,
    audio_voice_id,
    external_message_id,
  ]);
}

/**
 * Idempotência: encontra mensagem IN já processada por external_message_id (wamid)
 */
async function getByExternalMessageId({ tenant_id, external_message_id }) {
  if (!tenant_id) throw new Error("getByExternalMessageId: missing tenant_id");
  if (!external_message_id) return null;

  const sql = `
    SELECT *
    FROM messages
    WHERE tenant_id = ?
      AND direction = 'in'
      AND external_message_id = ?
    LIMIT 1
  `;
  return db.get(sql, [tenant_id, external_message_id]);
}

/**
 * ✅ Função esperada pelo simulator (compat)
 * Retorna as últimas mensagens de um customer_phone.
 */
async function getLastMessages({ tenant_id, customer_phone, limit = 10 }) {
  if (!tenant_id) throw new Error("getLastMessages: missing tenant_id");
  if (!customer_phone) throw new Error("getLastMessages: missing customer_phone");

  const lim = Math.max(1, Math.min(Number(limit) || 10, 200));

  const sql = `
    SELECT *
    FROM messages
    WHERE tenant_id = ?
      AND customer_phone = ?
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `;
  return db.all(sql, [tenant_id, customer_phone, lim]);
}

/**
 * Útil para debug: últimas mensagens (alias, mantém compatibilidade com seu código atual)
 */
async function listRecentByPhone({ tenant_id, customer_phone, limit = 20 }) {
  return getLastMessages({ tenant_id, customer_phone, limit });
}

module.exports = {
  saveMessage,
  getByExternalMessageId,

  // compat/uso
  getLastMessages,
  listRecentByPhone,
};
