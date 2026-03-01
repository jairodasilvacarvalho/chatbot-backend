const express = require("express");
const router = express.Router();

// registra rotas de produtos
const trainingRoutes = require("./products/product_key/training");
router.use("/products/:product_key/training", trainingRoutes);

module.exports = router;
