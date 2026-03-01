-- sql/030_customers_add_product_key.sql
-- PASSO B1 — Produto por cliente
-- Adiciona product_key na tabela customers
-- Runtime faz fallback para DEFAULT_PRODUCT_KEY (.env)

PRAGMA foreign_keys=OFF;

ALTER TABLE customers
ADD COLUMN product_key TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_product_key
ON customers(product_key);

PRAGMA foreign_keys=ON;
