-- Staff exclusion applies only to customer conversation. Operational receipts
-- keep the existing offer ownership, trip state and recipient checks.
ALTER TABLE public.taxi_bot_customer_access
 ADD COLUMN exclude_operational_customers boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.taxi_bot_operational_phone(p_tenant uuid,p_phone text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.taxi_bot_customer_phone(p_phone)IS NOT NULL AND (
  EXISTS(SELECT 1 FROM public.taxi_base_contacts c WHERE c.tenant_id=p_tenant
   AND c.phone=public.taxi_bot_customer_phone(p_phone)
   AND(c.role IN('driver','owner','owner_driver','staff')OR EXISTS(
    SELECT 1 FROM public.taxi_unit_drivers l WHERE l.tenant_id=c.tenant_id AND l.contact_id=c.id)))
  OR EXISTS(SELECT 1 FROM public.conductores d WHERE d.tenant_id=p_tenant
   AND public.taxi_bot_customer_phone('+'||regexp_replace(d.telefono_whatsapp,'\D','','g'))=public.taxi_bot_customer_phone(p_phone)))
$$;

CREATE OR REPLACE FUNCTION public.taxi_bot_customer_allowed(p_tenant uuid,p_phone text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.taxi_bot_customer_phone(p_phone)IS NOT NULL
 AND NOT(EXISTS(SELECT 1 FROM public.taxi_bot_customer_access WHERE tenant_id=p_tenant AND exclude_operational_customers)
  AND public.taxi_bot_operational_phone(p_tenant,p_phone))
 AND (EXISTS(SELECT 1 FROM public.taxi_bot_allowed_customers WHERE tenant_id=p_tenant AND phone=public.taxi_bot_customer_phone(p_phone))
  OR EXISTS(SELECT 1 FROM public.taxi_bot_customer_access a JOIN public.empresas e ON e.id=a.tenant_id
   WHERE a.tenant_id=p_tenant AND a.public_enabled AND e.activo AND e.tipo_negocio='taxi'))
$$;

-- An owned button is valid inbound input even when the OFFER has expired.
-- The existing native commit returns its unavailable receipt, without calling
-- the conversational model or making a late assignment.
CREATE OR REPLACE FUNCTION public.taxi_bot_inbound_allowed(p_tenant uuid,p_waba text,p_message jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.taxi_bot_customer_allowed(p_tenant,p_message->>'from') OR (
  p_message->>'type'='button'AND p_message->>'button' ~ '^tx[arf]_[0-9a-f-]{36}$'AND EXISTS(
   SELECT 1 FROM public.taxi_bot_offers o JOIN public.conductores d
    ON d.tenant_id=o.tenant_id AND d.device_id=o.device_id AND d.activo
   WHERE o.tenant_id=p_tenant AND o.waba=p_waba AND o.id::text=substr(p_message->>'button',5)
    AND public.taxi_bot_customer_phone(o.driver_phone)=public.taxi_bot_customer_phone(p_message->>'from')
    AND public.taxi_bot_customer_phone('+'||regexp_replace(d.telefono_whatsapp,'\D','','g'))=public.taxi_bot_customer_phone(p_message->>'from')
    AND(EXISTS(SELECT 1 FROM public.taxi_bot_customer_access WHERE tenant_id=p_tenant AND exclude_operational_customers)
      OR(left(p_message->>'button',3)IN('txa','txr')AND o.state='offered'AND o.expires_at>clock_timestamp())
      OR(left(p_message->>'button',3)='txf'AND o.state='accepted'))))
$$;
REVOKE ALL ON FUNCTION public.taxi_bot_operational_phone(uuid,text)FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
