// models/nicheProfiles.js

function httpError(status, code) {
  const err = new Error(code);
  err.status = status;
  err.code = code;
  return err;
}

function normalizeKey(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/**
 * createNicheProfile(db, payload)
 */
async function createNicheProfile(db, payload = {}) {
  const tenantId =
    payload.tenant_id ??
    payload.tenantId ??
    null;

  const nicheKey =
    payload.niche_key ??
    payload.nicheKey ??
    null;

  let dataJson =
    payload.data_json ??
    payload.dataJson ??
    null;

  if (!tenantId || !nicheKey || !dataJson) {
    throw httpError(400, "missing_required_fields");
  }

  const cleanKey = normalizeKey(nicheKey);
  if (!cleanKey) {
    throw httpError(400, "invalid_niche_key");
  }

  // garante JSON string
  if (typeof dataJson === "object") {
    dataJson = JSON.stringify(dataJson);
  }

  if (typeof dataJson !== "string") {
    throw httpError(400, "invalid_data_json");
  }

  // evita duplicado por tenant
  const exists = await db.get(
    `SELECT id FROM niche_profiles WHERE tenant_id = ? AND niche_key = ?`,
    [tenantId, cleanKey]
  );

  if (exists) {
    throw httpError(409, "niche_profile_already_exists");
  }

  const res = await db.run(
    `INSERT INTO niche_profiles (tenant_id, niche_key, data_json)
     VALUES (?, ?, ?)`,
    [tenantId, cleanKey, dataJson]
  );

  return await db.get(
    `SELECT id, tenant_id, niche_key, data_json, created_at
     FROM niche_profiles
     WHERE id = ?`,
    [res.lastID]
  );
}

/**
 * listNicheProfiles(db, tenantId?)
 */
async function listNicheProfiles(db, tenantId = null) {
  if (tenantId) {
    return db.all(
      `SELECT id, tenant_id, niche_key, data_json, created_at
       FROM niche_profiles
       WHERE tenant_id = ?
       ORDER BY id DESC`,
      [tenantId]
    );
  }

  return db.all(
    `SELECT id, tenant_id, niche_key, data_json, created_at
     FROM niche_profiles
     ORDER BY id DESC`
  );
}

module.exports = {
  createNicheProfile,
  listNicheProfiles,
};
