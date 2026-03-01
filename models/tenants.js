// models/tenants.js

function normalizeSlug(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")                 // remove acentos (ex: ç, ã)
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")             // espaços -> hífen
    .replace(/-+/g, "-")              // evita múltiplos hífens
    .replace(/[^a-z0-9-]/g, "")       // remove chars inválidos
    .replace(/^-+/, "")               // remove hífen no começo
    .replace(/-+$/, "");              // remove hífen no fim
}

function isValidSlug(slug) {
  if (!slug) return false;
  if (slug.length < 2) return false;
  if (slug.length > 60) return false;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return false; // evita "--" e evita terminar com "-"
  return true;
}

function httpError(code, message) {
  const err = new Error(message);
  err.status = code;
  err.code = message;
  return err;
}

/**
 * createTenant(db, { name, slug })
 * - db deve expor: get(sql, params), run(sql, params)
 */
async function createTenant(db, { name, slug }) {
  const cleanName = String(name || "").trim();

  if (!cleanName) throw httpError(400, "name_required");
  if (cleanName.length < 2) throw httpError(400, "name_too_short");
  if (cleanName.length > 80) throw httpError(400, "name_too_long");

  // Se slug não vier, gera a partir do nome
  const cleanSlug = normalizeSlug(slug || cleanName);

  if (!isValidSlug(cleanSlug)) throw httpError(400, "invalid_slug");

  const exists = await db.get(`SELECT id FROM tenants WHERE slug = ?`, [cleanSlug]);
  if (exists) throw httpError(409, "slug_already_exists");

  const res = await db.run(
    `INSERT INTO tenants (name, slug) VALUES (?, ?)`,
    [cleanName, cleanSlug]
  );

  return await db.get(
    `SELECT id, name, slug, created_at FROM tenants WHERE id = ?`,
    [res.lastID]
  );
}

/**
 * listTenants(db)
 * - db deve expor: all(sql, params)
 */
async function listTenants(db) {
  return await db.all(
    `SELECT id, name, slug, created_at
     FROM tenants
     ORDER BY id DESC`
  );
}

module.exports = {
  createTenant,
  listTenants,
  normalizeSlug,
  isValidSlug,
};
