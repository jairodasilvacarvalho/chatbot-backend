// src/utils/pickObjectionReply.js
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickObjectionReply(objections_json, key) {
  if (!objections_json || !objections_json[key]) return null;

  const v = objections_json[key];
  if (Array.isArray(v)) return pickRandom(v);
  if (typeof v === "string") return v;

  return null;
}

module.exports = { pickObjectionReply };
