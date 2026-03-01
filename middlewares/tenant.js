// middlewares/tenant.js
module.exports = function tenantMiddleware(req, _res, next) {
  const raw = req.header("x-tenant-id");
  const parsed = Number(raw);
  req.tenant_id = Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  next();
};
