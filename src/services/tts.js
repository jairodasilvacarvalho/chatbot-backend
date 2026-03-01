console.log("🔥 TTS NOVO CARREGADO — FAIL SAFE ATIVO 🔥");

// src/services/tts.js
// ✅ ElevenLabs TTS (FAIL-SAFE TOTAL)
// - NUNCA lança erro
// - Se falhar, retorna null
// - Texto SEMPRE continua funcionando

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/* ======================
   Utils
====================== */
function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

function baseUrl() {
  const raw = String(process.env.PUBLIC_BASE_URL || "").trim();
  return raw ? raw.replace(/\/$/, "") : "http://127.0.0.1:3001";
}

function audioDir() {
  return String(process.env.TTS_AUDIO_DIR || "storage/audio").trim();
}

function defaultVoiceId() {
  return String(process.env.ELEVENLABS_VOICE_ID || "").trim();
}

function apiKey() {
  return String(process.env.ELEVENLABS_API_KEY || "").trim();
}

function modelId() {
  return String(process.env.TTS_MODEL_ID || "eleven_multilingual_v2").trim();
}

function randomId(len = 6) {
  return crypto.randomBytes(len).toString("hex");
}

function safeFileName(prefix = "tts") {
  return `${prefix}_${Date.now()}_${randomId()}.mp3`;
}

/* ======================
   ElevenLabs (FAIL-SAFE)
====================== */
async function elevenLabsTtsToMp3Buffer({ text, voiceId }) {
  const key = apiKey();
  const vid = String(voiceId || defaultVoiceId()).trim();

  // 🔒 Bloqueios silenciosos
  if (!key || !vid || !text) {
    console.warn("⚠️ TTS ignorado (key/voice/text ausente)");
    return null;
  }

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`, {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId(),
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.8,
        },
      }),
    });

    if (!res.ok) {
      console.warn(`⚠️ ElevenLabs respondeu ${res.status} — TTS ignorado`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, voice_id: vid };
  } catch (err) {
    console.warn("⚠️ Erro ao chamar ElevenLabs — TTS ignorado");
    return null;
  }
}

/* ======================
   API pública
====================== */
async function synthesizeToFile({ text, voiceId, fileName }) {
  const t = String(text || "").trim();
  if (!t) return null;

  const audio = await elevenLabsTtsToMp3Buffer({ text: t, voiceId });
  if (!audio) return null;

  try {
    const dir = audioDir();
    ensureDir(dir);

    const finalName = fileName || safeFileName("tts");
    const filePath = path.resolve(dir, finalName);

    fs.writeFileSync(filePath, audio.buffer);

    return {
      ok: true,
      fileName: finalName,
      filePath,
      audio_url: `${baseUrl()}/media/audio/${encodeURIComponent(finalName)}`,
      audio_duration_ms: null,
      audio_voice_id: audio.voice_id,
    };
  } catch (err) {
    console.warn("⚠️ Falha ao salvar áudio — TTS ignorado");
    return null;
  }
}

module.exports = {
  synthesizeToFile,
};
