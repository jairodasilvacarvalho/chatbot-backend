// src/services/messageService.js
const db = require("../../config/db");

function nowIso() {
  return new Date().toISOString();
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(Math.trunc(n), max));
}

function normalizeDirection(direction) {
  if (direction !== "in" && direction !== "out") {
    throw new Error("saveMessage: direction must be 'in' or 'out'");
  }
  return direction;
}

function normalizeText(text) {
  if (typeof text !== "string") throw new Error("saveMessage: text must be a string");
  const t = text.trim();
  // permite texto vazio? normalmente não. se quiser permitir, remova essa linha.
  if (!t) throw new Error("saveMessage: text cannot be empty");
  return t;
}

function normalizeAudioFields({ has_audio, audio_url, audio_duration_ms, audio_voice_id } = {}) {
  const hasAudio = has_audio ? 1 : 0;

  // Se has_audio=1, audio_url é obrigatório
  if (hasAudio === 1) {
    if (typeof audio_url !== "string" || !audio_url.trim()) {
      throw new Error("saveMessage: audio_url is required when has_audio=1");
    }
  }

  const duration =
    audio_duration_ms === null || audio_duration_ms === undefined
      ? null
      : clampInt(audio_duration_ms, 0, 60 * 60 * 1000, null); // até 1h

  const voiceId =
    audio_voice_id === null || audio_voice_id === undefined
      ? null
      : String(audio_voice_id).trim() || null;

  const url =
    audio_url === null || audio_url === undefined ? null : String(audio_url).trim() || null;

  return {
    has_audio: hasAudio,
    audio_url: url,
    audio_duration_ms: duration,
    audio_voice_id: voiceId,
  };
}

/**
 * Salva uma mensagem e retorna o registro persistido.
 * Suporta áudio real (ElevenLabs) via colunas:
 * has_audio, audio_url, audio_duration_ms, audio_voice_id
 *
 * @param {Object} params
 * @param {string} params.phone
 * @param {"in"|"out"} params.direction
 * @param {string} params.text
 * @param {string} [params.created_at] - ISO string (opcional)
 * @param {number|boolean} [params.has_audio]
 * @param {string|null} [params.audio_url]
 * @param {number|null} [params.audio_duration_ms]
 * @param {string|null} [params.audio_voice_id]
 */
async function saveMessage({
  phone,
  direction,
  text,
  created_at,
  has_audio,
  audio_url,
  audio_duration_ms,
  audio_voice_id,
}) {
  if (!phone) throw new Error("saveMessage: phone is required");

  const safeDirection = normalizeDirection(direction);
  const safeText = normalizeText(text);
  const createdAt = created_at ? String(created_at) : nowIso();

  const audio = normalizeAudioFields({
    has_audio,
    audio_url,
    audio_duration_ms,
    audio_voice_id,
  });

  // INSERT (já preparado p/ áudio)
  const result = await db.run(
    `
      INSERT INTO messages (
        customer_phone, direction, text, created_at,
        has_audio, audio_url, audio_duration_ms, audio_voice_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      phone,
      safeDirection,
      safeText,
      createdAt,
      audio.has_audio,
      audio.audio_url,
      audio.audio_duration_ms,
      audio.audio_voice_id,
    ]
  );

  const id = result?.lastID;

  // fallback mínimo se lastID não vier
  if (!id) {
    return {
      id: null,
      customer_phone: phone,
      direction: safeDirection,
      text: safeText,
      created_at: createdAt,
      ...audio,
    };
  }

  // retorna o registro completo (inclui áudio)
  const row = await db.get(`SELECT * FROM messages WHERE id = ?`, [id]);
  return row;
}

/**
 * Lista mensagens por phone (ordem crescente)
 */
async function getConversationByPhone(phone, { limit = 300, offset = 0 } = {}) {
  if (!phone) throw new Error("getConversationByPhone: phone is required");

  const safeLimit = clampInt(limit, 1, 1000, 300);
  const safeOffset = clampInt(offset, 0, 1_000_000, 0);

  const rows = await db.all(
    `
      SELECT *
      FROM messages
      WHERE customer_phone = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ? OFFSET ?
    `,
    [phone, safeLimit, safeOffset]
  );

  return rows;
}

/**
 * Retorna as últimas N mensagens (IN + OUT) de um cliente
 * Ordenadas do mais antigo → mais recente
 * (inclui campos de áudio para o Agent usar contexto e UI renderizar player)
 */
async function getLastMessages(phone, limit = 10) {
  if (!phone) return [];

  const safeLimit = clampInt(limit, 1, 200, 10);

  const rows = await db.all(
    `
      SELECT
        direction,
        text,
        created_at,
        has_audio,
        audio_url,
        audio_duration_ms,
        audio_voice_id
      FROM messages
      WHERE customer_phone = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    [phone, safeLimit]
  );

  return rows.reverse();
}

module.exports = {
  saveMessage,
  getConversationByPhone,
  getLastMessages,
};
