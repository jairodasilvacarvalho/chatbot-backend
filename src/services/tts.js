// src/services/tts.js
import fs from "fs";
import path from "path";
import crypto from "crypto";

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
const MODEL_ID = process.env.TTS_MODEL_ID || "eleven_multilingual_v2";

const AUDIO_DIR = process.env.TTS_AUDIO_DIR || "storage/audio";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "http://127.0.0.1:3000";

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function hashText(text, voiceId) {
  return crypto.createHash("sha1").update(`${voiceId}::${text}`).digest("hex");
}

/**
 * Gera mp3 com ElevenLabs e salva em disco.
 * Retorna metadata pronta para persistir.
 */
export async function synthesizeToFile(text, opts = {}) {
  if (!ELEVEN_API_KEY) throw new Error("ELEVENLABS_API_KEY missing");
  if (!VOICE_ID) throw new Error("ELEVENLABS_VOICE_ID missing");

  const voiceId = opts.voiceId || VOICE_ID;
  const modelId = opts.modelId || MODEL_ID;

  ensureDir(AUDIO_DIR);

  // cache por texto/voz (evita gerar de novo em testes)
  const key = hashText(text, voiceId);
  const filename = `${key}.mp3`;
  const filepath = path.join(AUDIO_DIR, filename);

  if (!fs.existsSync(filepath)) {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVEN_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        // você pode ajustar voice_settings depois, se quiser
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!resp.ok) {
      const errTxt = await resp.text().catch(() => "");
      throw new Error(`ElevenLabs error: ${resp.status} ${errTxt}`);
    }

    const arrayBuffer = await resp.arrayBuffer();
    fs.writeFileSync(filepath, Buffer.from(arrayBuffer));
  }

  const publicUrl = `${PUBLIC_BASE_URL}/media/audio/${filename}`;

  // duração: (opcional) você pode calcular com lib, mas por enquanto deixa null
  return {
    audio_url: publicUrl,
    audio_duration_ms: null,
    audio_voice_id: voiceId,
    has_audio: 1,
    filename,
  };
}
