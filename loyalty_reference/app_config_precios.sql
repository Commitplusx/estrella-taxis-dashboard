ALTER TABLE app_config ADD COLUMN IF NOT EXISTS configuracion_precios JSONB DEFAULT '{"modo_lluvia": false, "recargo_lluvia": 15}';
UPDATE app_config SET configuracion_precios = '{"modo_lluvia": false, "recargo_lluvia": 15}' WHERE configuracion_precios IS NULL;
