// models/productProfiles.js

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
 * createProductProfile(db, payload)
 * Espera salvar em product_profiles:
 * - tenant_id (INTEGER)
 * - product_key (TEXT)
 * - data_json (TEXT)
 */
async function createProductProfile(db, payload = {}) {
  const tenantId =
    payload.tenant_id ??
    payload.tenantId ??
    null;

  const productKey =
    payload.product_key ??
    payload.productKey ??
    null;

  let dataJson =
    payload.data_json ??
    payload.dataJson ??
    null;

  if (!tenantId || !productKey || !dataJson) {
    throw httpError(400, "missing_required_fields");
  }

  const cleanKey = normalizeKey(productKey);
  if (!cleanKey) {
    throw httpError(400, "invalid_product_key");
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
    `SELECT id FROM product_profiles WHERE tenant_id = ? AND product_key = ?`,
    [tenantId, cleanKey]
  );

  if (exists) {
    throw httpError(409, "product_profile_already_exists");
  }

  const res = await db.run(
    `INSERT INTO product_profiles (tenant_id, product_key, data_json)
     VALUES (?, ?, ?)`,
    [tenantId, cleanKey, dataJson]
  );

  return await db.get(
    `SELECT id, tenant_id, product_key, data_json, created_at
     FROM product_profiles
     WHERE id = ?`,
    [res.lastID]
  );
}

/**
 * listProductProfiles(db, tenantId?)
 */
async function listProductProfiles(db, tenantId = null) {
  if (tenantId) {
    return db.all(
      `SELECT id, tenant_id, product_key, data_json, created_at
       FROM product_profiles
       WHERE tenant_id = ?
       ORDER BY id DESC`,
      [tenantId]
    );
  }

  return db.all(
    `SELECT id, tenant_id, product_key, data_json, created_at
     FROM product_profiles
     ORDER BY id DESC`
  );
}

module.exports = {
  createProductProfile,
  listProductProfiles,
};
