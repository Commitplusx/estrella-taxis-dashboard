-- Crear tabla pedidos para negocios de comida
CREATE TABLE pedidos (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  cliente_tel text NOT NULL,
  cliente_nombre text,
  detalle_pedido text NOT NULL,
  direccion_entrega text NOT NULL,
  origen_lat double precision,
  origen_lng double precision,
  costo_envio numeric,
  estado text NOT NULL DEFAULT 'pendiente',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pedidos_pkey PRIMARY KEY (id),
  CONSTRAINT pedidos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES empresas(id) ON DELETE CASCADE
);

-- Políticas de RLS
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Los tenants pueden ver sus propios pedidos" 
ON pedidos 
FOR SELECT 
USING (tenant_id = (SELECT id FROM empresas WHERE auth.uid() = user_id));

CREATE POLICY "Los tenants pueden actualizar sus propios pedidos" 
ON pedidos 
FOR UPDATE 
USING (tenant_id = (SELECT id FROM empresas WHERE auth.uid() = user_id));
