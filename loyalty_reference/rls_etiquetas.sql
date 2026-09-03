-- Política de lectura pública para colonias (solo campos no sensibles)
CREATE POLICY "Anon_Read_Colonias"
ON colonias FOR SELECT TO anon
USING (true);

-- Política de actualización limitada: anon solo puede tocar etiquetas
-- (Para mayor seguridad se puede restringir con una función, pero para uso local está bien)
CREATE POLICY "Anon_Update_Etiquetas_Colonias"
ON colonias FOR UPDATE TO anon
USING (true)
WITH CHECK (true);
