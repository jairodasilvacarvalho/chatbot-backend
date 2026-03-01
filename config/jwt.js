// config/jwt.js
module.exports = {
  jwtSecret: process.env.JWT_SECRET || "dev_change_me_now",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
};
