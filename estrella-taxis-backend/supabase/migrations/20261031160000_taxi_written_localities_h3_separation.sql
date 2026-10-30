-- Written taxi localities are a separate fare directory. H3 remains the GPS tariff map.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TEMP TABLE taxi_written_locality_target ON COMMIT DROP AS
SELECT id AS tenant_id FROM public.empresas WHERE tipo_negocio='taxi' AND nombre_empresa='Servicio de Taxis Pompeyo Express';
DO $$BEGIN
 IF (SELECT count(*) FROM taxi_written_locality_target)<>1 THEN
  RAISE EXCEPTION 'Expected exactly one Pompeyo taxi base for the reviewed locality import';
 END IF;
END $$;

CREATE TABLE public.taxi_bot_localities(
 tenant_id uuid NOT NULL REFERENCES public.empresas(id),
 category text NOT NULL CHECK(category IN('barrio','fraccionamiento','colonia','otro_punto','escuela','motel','rancheria','lugar','ejido','cash_a','punto')),
 label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 100),
 aliases text[] NOT NULL DEFAULT '{}' CHECK(cardinality(aliases)<=12),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=500),
 fare_cents integer CHECK(fare_cents BETWEEN 1 AND 10000000),
 updated_at timestamptz NOT NULL DEFAULT now(),updated_by bigint,
 PRIMARY KEY(tenant_id,category,label)
);
ALTER TABLE public.taxi_bot_localities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxi_bot_localities FROM PUBLIC,anon,authenticated,service_role;

-- Move the earlier text-only reference rates out of the H3 metadata table.
INSERT INTO public.taxi_bot_localities(tenant_id,category,label,aliases,description,fare_cents,updated_by)
SELECT tenant_id,
 CASE WHEN public.taxi_bot_neighborhood_key(label) IN('la esmeralda','campo de la mariano n ruiz','san juan','27 de junio','manuel velasco','reforma','la esperanza','chula vista','monte cristo','chichima sabinal','chichima acapetahua') THEN 'colonia' ELSE 'otro_punto' END,
 label,aliases,description,reference_price_cents,updated_by
FROM public.taxi_bot_neighborhoods WHERE reference_price_cents IS NOT NULL
ON CONFLICT(tenant_id,category,label) DO NOTHING;
UPDATE public.taxi_bot_neighborhoods SET reference_price_cents=NULL,updated_at=clock_timestamp()
WHERE reference_price_cents IS NOT NULL;

-- Guarded reversal of the earlier PDF import: restore only the exact 293 cells and tariffs
-- captured before that import. Any changed H3 cell or tariff aborts the entire migration.
CREATE TEMP TABLE taxi_pdf_h3_restore(h3_index text PRIMARY KEY,label text,old_cents integer,new_cents integer) ON COMMIT DROP;
INSERT INTO taxi_pdf_h3_restore(h3_index,label,old_cents,new_cents) VALUES
('8a6d2e880007fff','Las brisas',4500,6500),
('8a6d2e88000ffff','El brasilito',5000,6500),
('8a6d2e880017fff','Las brisas',4500,6500),
('8a6d2e88001ffff','Las brisas',4500,6500),
('8a6d2e880027fff','Las brisas',4500,6500),
('8a6d2e88002ffff','Las brisas',4500,6500),
('8a6d2e880047fff','El brasilito',5000,6500),
('8a6d2e88004ffff','El brasilito',5000,6500),
('8a6d2e880057fff','El brasilito',5000,6500),
('8a6d2e88005ffff','El brasilito',5000,6500),
('8a6d2e880067fff','El brasilito',5000,6500),
('8a6d2e88006ffff','Jacarandas',5000,6500),
('8a6d2e880077fff','El brasilito',5000,6500),
('8a6d2e8800affff','Las brisas',4500,6500),
('8a6d2e8800c7fff','El brasilito',5000,6500),
('8a6d2e8800e7fff','El brasilito',5000,6500),
('8a6d2e8800effff','El brasilito',5000,6500),
('8a6d2e8800f7fff','El brasilito',5000,6500),
('8a6d2e880107fff','Valle Balun Canan',4500,6500),
('8a6d2e88010ffff','Valle Balun Canan',4500,6500),
('8a6d2e880117fff','Valle Balun Canan',4500,6500),
('8a6d2e88011ffff','Valle Balun Canan',4500,6500),
('8a6d2e880127fff','Valle Balun Canan',4500,6500),
('8a6d2e88012ffff','Valle Balun Canan',4500,6500),
('8a6d2e880137fff','Valle Balun Canan',4500,6500),
('8a6d2e880147fff','Las brisas',4500,6500),
('8a6d2e88014ffff','Las brisas',4500,6500),
('8a6d2e880157fff','Las brisas',4500,6500),
('8a6d2e88015ffff','Las brisas',4500,6500),
('8a6d2e880187fff','Valle Balun Canan',4500,6500),
('8a6d2e88018ffff','Valle Balun Canan',4500,6500),
('8a6d2e8801a7fff','Valle Balun Canan',4500,6500),
('8a6d2e8801affff','Valle Balun Canan',4500,6500),
('8a6d2e8801b7fff','Valle Balun Canan',4500,6500),
('8a6d2e880807fff','Colonia Miguel Aleman',4500,5500),
('8a6d2e88080ffff','Los pinos',4500,5500),
('8a6d2e880817fff','Colonia Miguel Aleman',4500,5500),
('8a6d2e880827fff','Colonia Miguel Aleman',4500,5500),
('8a6d2e88082ffff','Los pinos',4500,5500),
('8a6d2e880837fff','Colonia Miguel Aleman',4500,5500),
('8a6d2e880847fff','Los pinos',4500,5500),
('8a6d2e88084ffff','Los pinos',4500,5500),
('8a6d2e880857fff','Los pinos',4500,5500),
('8a6d2e88085ffff','Los pinos',4500,5500),
('8a6d2e880867fff','Los pinos',4500,5500),
('8a6d2e88086ffff','Los pinos',4500,5500),
('8a6d2e880877fff','Los pinos',4500,5500),
('8a6d2e880887fff','Valle Balun Canan',4500,6500),
('8a6d2e88088ffff','Valle Balun Canan',4500,6500),
('8a6d2e880897fff','Valle Balun Canan',4500,6500),
('8a6d2e88089ffff','Valle Balun Canan',4500,6500),
('8a6d2e8808a7fff','Colonia Miguel Aleman',4500,5500),
('8a6d2e8808affff','Colonia Miguel Aleman',4500,5500),
('8a6d2e8808b7fff','Valle Balun Canan',4500,6500),
('8a6d2e880907fff','Colonia Miguel Aleman',4500,5500),
('8a6d2e88090ffff','Colonia Miguel Aleman',4500,5500),
('8a6d2e880917fff','Colonia Miguel Aleman',4500,5500),
('8a6d2e88091ffff','Colonia Miguel Aleman',4500,5500),
('8a6d2e880957fff','Colonia Miguel Aleman',4500,5500),
('8a6d2e88095ffff','Los pinos',4500,5500),
('8a6d2e88098ffff','Colonia Miguel Aleman',4500,5500),
('8a6d2e8809affff','Colonia Miguel Aleman',4500,5500),
('8a6d2e880a87fff','El brasilito',5000,6500),
('8a6d2e880a97fff','El brasilito',5000,6500),
('8a6d2e880a9ffff','Jacarandas',5000,6500),
('8a6d2e880ab7fff','El brasilito',5000,6500),
('8a6d2e880b37fff','Los pinos',4500,5500),
('8a6d2e880c0ffff','Valle Balun Canan',4500,6500),
('8a6d2e880c27fff','Valle Balun Canan',4500,6500),
('8a6d2e880c2ffff','Valle Balun Canan',4500,6500),
('8a6d2e880c47fff','Valle Balun Canan',4500,6500),
('8a6d2e880c4ffff','Valle Balun Canan',4500,6500),
('8a6d2e880c57fff','Valle Balun Canan',4500,6500),
('8a6d2e880c5ffff','Valle Balun Canan',4500,6500),
('8a6d2e880c67fff','Valle Balun Canan',4500,6500),
('8a6d2e880c6ffff','Valle Balun Canan',4500,6500),
('8a6d2e880c77fff','Valle Balun Canan',4500,6500),
('8a6d2e880ceffff','Valle Balun Canan',4500,6500),
('8a6d2e880d07fff','Popular',4500,5500),
('8a6d2e880d0ffff','Valle Balun Canan',4500,6500),
('8a6d2e880d17fff','Popular',4500,5500),
('8a6d2e880d27fff','1ro de mayo',4500,5500),
('8a6d2e880d2ffff','1ro de mayo',4500,5500),
('8a6d2e880d37fff','Popular',4500,5500),
('8a6d2e880d47fff','Valle Balun Canan',4500,6500),
('8a6d2e880d4ffff','Valle Balun Canan',4500,6500),
('8a6d2e880d57fff','Valle Balun Canan',4500,6500),
('8a6d2e880d5ffff','Valle Balun Canan',4500,6500),
('8a6d2e884517fff','Infonavit',4500,5500),
('8a6d2e884617fff','1ro de mayo',4500,5500),
('8a6d2e88461ffff','1ro de mayo',4500,5500),
('8a6d2e884637fff','1ro de mayo',4500,5500),
('8a6d2e884687fff','1ro de mayo',4500,5500),
('8a6d2e88468ffff','1ro de mayo',4500,5500),
('8a6d2e884697fff','Popular',4500,5500),
('8a6d2e88469ffff','Popular',4500,5500),
('8a6d2e8846a7fff','1ro de mayo',4500,5500),
('8a6d2e8846affff','1ro de mayo',4500,5500),
('8a6d2e8846c7fff','1ro de mayo',4500,5500),
('8a6d2e8846d7fff','1ro de mayo',4500,5500),
('8a6d2e8846dffff','1ro de mayo',4500,5500),
('8a6d2e8846e7fff','1ro de mayo',4500,5500),
('8a6d2e8846effff','1ro de mayo',4500,5500),
('8a6d2e8846f7fff','1ro de mayo',4500,5500),
('8a6d2e88478ffff','1ro de mayo',4500,5500),
('8a6d2e88479ffff','1ro de mayo',4500,5500),
('8a6d2e8847affff','1ro de mayo',4500,5500),
('8a6d2e884c27fff','Centro',4500,5500),
('8a6d2e884c2ffff','Centro',4500,5500),
('8a6d2e884d0ffff','Centro',4500,5500),
('8a6d2e884d1ffff','Centro',4500,5500),
('8a6d2e884d2ffff','Centro',4500,5500),
('8a6d2e884d47fff','Centro',4500,5500),
('8a6d2e884d57fff','Centro',4500,5500),
('8a6d2e884d67fff','Centro',4500,5500),
('8a6d2e884d77fff','Centro',4500,5500),
('8a6d2e885007fff','Mariano N Ruiz',5000,5500),
('8a6d2e885017fff','Mariano N Ruiz',5000,5500),
('8a6d2e88501ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885027fff','Mariano N Ruiz',5000,5500),
('8a6d2e88502ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885037fff','Mariano N Ruiz',5000,5500),
('8a6d2e885087fff','Mariano N Ruiz',5000,5500),
('8a6d2e88508ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885097fff','Mariano N Ruiz',5000,5500),
('8a6d2e88509ffff','Mariano N Ruiz',5000,5500),
('8a6d2e8850a7fff','Mariano N Ruiz',5000,5500),
('8a6d2e8850affff','Mariano N Ruiz',5000,5500),
('8a6d2e8850b7fff','Mariano N Ruiz',5000,5500),
('8a6d2e8850c7fff','Mariano N Ruiz',5000,5500),
('8a6d2e8850cffff','Mariano N Ruiz',5000,5500),
('8a6d2e8850d7fff','Mariano N Ruiz',5000,5500),
('8a6d2e8850dffff','Mariano N Ruiz',5000,5500),
('8a6d2e8850e7fff','Mariano N Ruiz',5000,5500),
('8a6d2e8850effff','Mariano N Ruiz',5000,5500),
('8a6d2e8850f7fff','Mariano N Ruiz',5000,5500),
('8a6d2e885107fff','Mariano N Ruiz',5000,5500),
('8a6d2e88510ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885117fff','Mariano N Ruiz',5000,5500),
('8a6d2e88511ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885127fff','Mariano N Ruiz',5000,5500),
('8a6d2e88512ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885137fff','Mariano N Ruiz',5000,5500),
('8a6d2e885147fff','Mariano N Ruiz',5000,5500),
('8a6d2e885157fff','Mariano N Ruiz',5000,5500),
('8a6d2e885167fff','Mariano N Ruiz',5000,5500),
('8a6d2e885177fff','Mariano N Ruiz',5000,5500),
('8a6d2e885187fff','Mariano N Ruiz',5000,5500),
('8a6d2e88518ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885197fff','Mariano N Ruiz',5000,5500),
('8a6d2e88519ffff','Mariano N Ruiz',5000,5500),
('8a6d2e8851a7fff','Mariano N Ruiz',5000,5500),
('8a6d2e8851affff','Mariano N Ruiz',5000,5500),
('8a6d2e8851b7fff','Mariano N Ruiz',5000,5500),
('8a6d2e885397fff','Mariano N Ruiz',5000,5500),
('8a6d2e8853b7fff','Mariano N Ruiz',5000,5500),
('8a6d2e885407fff','Mariano N Ruiz',5000,5500),
('8a6d2e88540ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885417fff','Mariano N Ruiz',5000,5500),
('8a6d2e88541ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885427fff','Mariano N Ruiz',5000,5500),
('8a6d2e88542ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885447fff','Mariano N Ruiz',5000,5500),
('8a6d2e88544ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885467fff','Mariano N Ruiz',5000,5500),
('8a6d2e88546ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885477fff','Mariano N Ruiz',5000,5500),
('8a6d2e885487fff','Los pinos',4500,5500),
('8a6d2e885497fff','Los pinos',4500,5500),
('8a6d2e88549ffff','Los pinos',4500,5500),
('8a6d2e885547fff','Mariano N Ruiz',5000,5500),
('8a6d2e88554ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885557fff','Mariano N Ruiz',5000,5500),
('8a6d2e88555ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885567fff','Mariano N Ruiz',5000,5500),
('8a6d2e88556ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885577fff','Mariano N Ruiz',5000,5500),
('8a6d2e885627fff','Mariano N Ruiz',5000,5500),
('8a6d2e88562ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885707fff','Mariano N Ruiz',5000,5500),
('8a6d2e88570ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885717fff','Mariano N Ruiz',5000,5500),
('8a6d2e88571ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885727fff','Mariano N Ruiz',5000,5500),
('8a6d2e88572ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885737fff','Mariano N Ruiz',5000,5500),
('8a6d2e885747fff','Mariano N Ruiz',5000,5500),
('8a6d2e885757fff','Mariano N Ruiz',5000,5500),
('8a6d2e88575ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885767fff','Mariano N Ruiz',5000,5500),
('8a6d2e885777fff','Mariano N Ruiz',5000,5500),
('8a6d2e885807fff','Mariano N Ruiz',5000,5500),
('8a6d2e88580ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885817fff','Mariano N Ruiz',5000,5500),
('8a6d2e88581ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885827fff','Mariano N Ruiz',5000,5500),
('8a6d2e88582ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885837fff','Mariano N Ruiz',4500,5500),
('8a6d2e885847fff','Mariano N Ruiz',5000,5500),
('8a6d2e88584ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885857fff','Mariano N Ruiz',5000,5500),
('8a6d2e88585ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885867fff','Mariano N Ruiz',5000,5500),
('8a6d2e88586ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885877fff','Mariano N Ruiz',5000,5500),
('8a6d2e885887fff','Mariano N Ruiz',4500,5500),
('8a6d2e88588ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885897fff','Mariano N Ruiz',4500,5500),
('8a6d2e88589ffff','Mariano N Ruiz',5000,5500),
('8a6d2e8858a7fff','Mariano N Ruiz',4500,5500),
('8a6d2e8858affff','Mariano N Ruiz',5000,5500),
('8a6d2e8858b7fff','Mariano N Ruiz',4500,5500),
('8a6d2e8858c7fff','Mariano N Ruiz',5000,5500),
('8a6d2e8858cffff','Mariano N Ruiz',5000,5500),
('8a6d2e8858d7fff','Mariano N Ruiz',5000,5500),
('8a6d2e8858dffff','Mariano N Ruiz',5000,5500),
('8a6d2e8858e7fff','Mariano N Ruiz',5000,5500),
('8a6d2e8858effff','Mariano N Ruiz',5000,5500),
('8a6d2e8858f7fff','Mariano N Ruiz',5000,5500),
('8a6d2e88591ffff','Mariano N Ruiz',4500,5500),
('8a6d2e88594ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885957fff','Mariano N Ruiz',5000,5500),
('8a6d2e88595ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885987fff','Mariano N Ruiz',4500,5500),
('8a6d2e88598ffff','Mariano N Ruiz',4500,5500),
('8a6d2e885997fff','Mariano N Ruiz',4500,5500),
('8a6d2e88599ffff','Mariano N Ruiz',4500,5500),
('8a6d2e8859a7fff','Mariano N Ruiz',4500,5500),
('8a6d2e8859affff','Mariano N Ruiz',4500,5500),
('8a6d2e8859b7fff','Mariano N Ruiz',4500,5500),
('8a6d2e885b37fff','Mariano N Ruiz',5000,5500),
('8a6d2e885b97fff','Mariano N Ruiz',5000,5500),
('8a6d2e885ba7fff','Mariano N Ruiz',5000,5500),
('8a6d2e885bb7fff','Mariano N Ruiz',5000,5500),
('8a6d2e885c07fff','Mariano N Ruiz',4500,5500),
('8a6d2e885c0ffff','Mariano N Ruiz',4500,5500),
('8a6d2e885c27fff','Mariano N Ruiz',4500,5500),
('8a6d2e885c2ffff','Mariano N Ruiz',4500,5500),
('8a6d2e885c37fff','Mariano N Ruiz',4500,5500),
('8a6d2e885c47fff','Mariano N Ruiz',4500,5500),
('8a6d2e885c4ffff','Mariano N Ruiz',5000,5500),
('8a6d2e885c57fff','Mariano N Ruiz',4500,5500),
('8a6d2e885c5ffff','Mariano N Ruiz',4500,5500),
('8a6d2e885c67fff','Mariano N Ruiz',4500,5500),
('8a6d2e885c6ffff','Mariano N Ruiz',4500,5500),
('8a6d2e885c77fff','Mariano N Ruiz',4500,5500),
('8a6d2e885ccffff','Mariano N Ruiz',5000,5500),
('8a6d2e885cdffff','Mariano N Ruiz',5000,5500),
('8a6d2e885ceffff','Mariano N Ruiz',5000,5500),
('8a6d2e885d0ffff','Mariano N Ruiz',4500,5500),
('8a6d2e885d47fff','Mariano N Ruiz',4500,5500),
('8a6d2e885d4ffff','Mariano N Ruiz',4500,5500),
('8a6d2e885d57fff','Mariano N Ruiz',4500,5500),
('8a6d2e885d5ffff','Mariano N Ruiz',4500,5500),
('8a6d2e885d67fff','Mariano N Ruiz',4500,5500),
('8a6d2e885d6ffff','Mariano N Ruiz',4500,5500),
('8a6d2e885d77fff','Mariano N Ruiz',4500,5500),
('8a6d2e886a27fff','Fovisste',4500,5500),
('8a6d2e886a2ffff','Fovisste',4500,5500),
('8a6d2e886a4ffff','Popular',4500,5500),
('8a6d2e886a6ffff','Popular',4500,5500),
('8a6d2e886b47fff','Fovisste',4500,5500),
('8a6d2e886b57fff','Fovisste',4500,5500),
('8a6d2e886b77fff','Fovisste',4500,5500),
('8a6d2e8a2037fff','Bugambilias segunda seccion',6000,8000),
('8a6d2e8a20b7fff','Bugambilias segunda seccion',6000,8000),
('8a6d2e8a2187fff','Bugambilias segunda seccion',6000,8000),
('8a6d2e8a218ffff','Bugambilias segunda seccion',6000,8000),
('8a6d2e8a2197fff','Bugambilias primera seccion',6000,8000),
('8a6d2e8a219ffff','Bugambilias segunda seccion',6000,8000),
('8a6d2e8a21affff','Bugambilias segunda seccion',6000,8000),
('8a6d2e8a2547fff','Bugambilias primera seccion',6000,8000),
('8a6d2e8a2567fff','Bugambilias primera seccion',6000,8000),
('8a6d2e8a256ffff','Bugambilias primera seccion',6000,8000),
('8a6d2e8a259ffff','Junchavin',5000,8000),
('8a6d2e8a26dffff','Centro',4500,5500),
('8a6d2e8a309ffff','Paraiso comiteco',5000,8000),
('8a6d2e8a3447fff','Paraiso comiteco',5000,8000),
('8a6d2e8a344ffff','Paraiso comiteco',5000,8000),
('8a6d2e8a3457fff','Paraiso comiteco',5000,8000),
('8a6d2e8a345ffff','Paraiso comiteco',5000,8000),
('8a6d2e8a346ffff','Paraiso comiteco',5000,8000),
('8a6d2e8a34e7fff','Paraiso comiteco',5000,8000),
('8a6d2e8a34effff','Paraiso comiteco',5000,8000),
('8a6d2e8a36cffff','Mariano N Ruiz',4500,5500),
('8a6d2e8ae487fff','Mariano N Ruiz',5000,5500),
('8a6d2e8ae48ffff','Mariano N Ruiz',5000,5500),
('8a6d2e8ae497fff','Mariano N Ruiz',5000,5500),
('8a6d2e8ae49ffff','Mariano N Ruiz',5000,5500),
('8a6d2e8ae4affff','Mariano N Ruiz',5000,5500),
('8a6d2e8ae4b7fff','Mariano N Ruiz',5000,5500),
('8a6d2e8b124ffff','Infonavit',4500,5500),
('8a6d2e8b196ffff','Junchavin',5000,8000);
DO $$
DECLARE target uuid;matched integer;changed integer;
BEGIN
 SELECT tenant_id INTO target FROM taxi_written_locality_target;
 SELECT count(*) INTO matched FROM taxi_pdf_h3_restore r JOIN public.taxi_bot_base_zones z ON z.tenant_id=target AND z.h3_index=r.h3_index AND z.label=r.label AND z.price_cents=r.new_cents;
 IF matched=0 THEN RETURN; END IF;
 IF matched<>(SELECT count(*) FROM taxi_pdf_h3_restore) OR EXISTS(
  SELECT 1 FROM taxi_pdf_h3_restore r LEFT JOIN public.taxi_bot_base_zones z ON z.tenant_id=target AND z.h3_index=r.h3_index
  WHERE z.h3_index IS NULL OR z.label IS DISTINCT FROM r.label OR z.price_cents IS DISTINCT FROM r.new_cents
 ) THEN RAISE EXCEPTION 'Pompeyo H3 fares changed after the PDF import; safe restore stopped'; END IF;
 IF EXISTS(SELECT 1 FROM public.taxi_bot_base_zones z WHERE z.tenant_id=target AND z.label IN(SELECT DISTINCT label FROM taxi_pdf_h3_restore)
   AND NOT EXISTS(SELECT 1 FROM taxi_pdf_h3_restore r WHERE r.h3_index=z.h3_index AND r.label=z.label)
 ) THEN RAISE EXCEPTION 'Pompeyo H3 coverage changed after the PDF import; safe restore stopped'; END IF;
 UPDATE public.taxi_bot_base_zones z SET price_cents=r.old_cents
 FROM taxi_pdf_h3_restore r WHERE z.tenant_id=target AND z.h3_index=r.h3_index AND z.label=r.label;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>(SELECT count(*) FROM taxi_pdf_h3_restore) THEN RAISE EXCEPTION 'Pompeyo H3 restore did not update the reviewed cell count'; END IF;
END $$;

-- Human-readable fare schedule for typed addresses. Ambiguous printed prices stay unpriced
-- until an administrator resolves them; they cannot produce an automatic quote.
INSERT INTO public.taxi_bot_localities(tenant_id,category,label,aliases,description,fare_cents)
SELECT t.tenant_id,v.category,v.label,v.aliases,v.description,v.cents
FROM (VALUES
 ('barrio','Cruz Grande',ARRAY[]::text[],'',5500),('barrio','Santa Cruz',ARRAY[]::text[],'',5500),('barrio','Santa Cecilia',ARRAY[]::text[],'',5500),
 ('barrio','La Cueva',ARRAY[]::text[],'',5500),('barrio','La Represa',ARRAY[]::text[],'',5500),('barrio','San Martín',ARRAY[]::text[],'',5500),
 ('barrio','Candelaria',ARRAY[]::text[],'',5500),('barrio','El Piedrón',ARRAY[]::text[],'',5500),('barrio','San Vicente',ARRAY[]::text[],'',5500),
 ('barrio','Pashtón',ARRAY[]::text[],'',5500),('barrio','Cristóbal Colón',ARRAY[]::text[],'',5500),('barrio','Nicalococ',ARRAY['NicalococK'],'',5500),
 ('barrio','Santa Ana',ARRAY[]::text[],'',5500),('barrio','Concepción Bella Vista',ARRAY[]::text[],'',5500),('barrio','Belisario Domínguez',ARRAY[]::text[],'',5500),
 ('barrio','Calzada del Panteón',ARRAY[]::text[],'',5500),('barrio','La Pileta',ARRAY[]::text[],'',5500),('barrio','San Sebastián',ARRAY[]::text[],'',5500),
 ('barrio','Guadalupe',ARRAY[]::text[],'',5500),('barrio','Calle Zapata',ARRAY[]::text[],'',5500),('barrio','Los Sabinos',ARRAY[]::text[],'',5500),
 ('barrio','Yalchivol',ARRAY[]::text[],'',5500),('barrio','El Arenal',ARRAY[]::text[],'',5500),('barrio','Magueyes',ARRAY[]::text[],'',5500),
 ('barrio','Cipreces',ARRAY['Cipreses'],'',5500),('barrio','Las Chilcas',ARRAY[]::text[],'',5500),('barrio','Cerrito Concepción',ARRAY[]::text[],'',5500),
 ('barrio','San Agustín',ARRAY[]::text[],'',5500),('barrio','Pilita Seca',ARRAY[]::text[],'',5500),('barrio','Linda Vista',ARRAY[]::text[],'',5500),
 ('barrio','El Jordán',ARRAY[]::text[],'',5500),('barrio','7 Esquinas',ARRAY['Siete Esquinas'],'',5500),('barrio','La Pila',ARRAY[]::text[],'',5500),
 ('barrio','Jerusalén',ARRAY[]::text[],'',5500),('barrio','El Cedro',ARRAY[]::text[],'',5500),('barrio','Tepeyac',ARRAY[]::text[],'',5500),('barrio','San Miguel',ARRAY[]::text[],'',5500),
 ('fraccionamiento','Lomas del Sur',ARRAY[]::text[],'',5500),('fraccionamiento','Luis Donaldo Colosio',ARRAY[]::text[],'',5500),('fraccionamiento','El Campanario',ARRAY[]::text[],'',5500),
 ('fraccionamiento','El Rosario',ARRAY[]::text[],'',5500),('fraccionamiento','Las Flores',ARRAY[]::text[],'',5500),('fraccionamiento','Maya',ARRAY[]::text[],'',5500),
 ('fraccionamiento','Tenam',ARRAY[]::text[],'',5500),('fraccionamiento','Bosques',ARRAY[]::text[],'',5500),('fraccionamiento','Arboledas',ARRAY[]::text[],'',5500),
 ('fraccionamiento','Providencia',ARRAY[]::text[],'',5500),('fraccionamiento','Tikal',ARRAY[]::text[],'',5500),('fraccionamiento','Privada Las Orquídeas',ARRAY[]::text[],'',5500),
 ('fraccionamiento','Magisterial',ARRAY[]::text[],'',5500),('fraccionamiento','Robles',ARRAY[]::text[],'',5500),('fraccionamiento','Monte Verde',ARRAY[]::text[],'',5500),
 ('fraccionamiento','Joyas del Pedregal',ARRAY[]::text[],'',5500),('fraccionamiento','Lomas del Valle',ARRAY[]::text[],'',5500),('fraccionamiento','El Herraje',ARRAY[]::text[],'',5500),
 ('fraccionamiento','Esthela Morales',ARRAY[]::text[],'',5500),('fraccionamiento','Libertad',ARRAY[]::text[],'',5500),('fraccionamiento','28 de Agosto',ARRAY[]::text[],'',5500),
 ('fraccionamiento','Los Lagos',ARRAY[]::text[],'',5500),('fraccionamiento','9 Estrellas',ARRAY[]::text[],'',5500),('fraccionamiento','Comitlán',ARRAY[]::text[],'',5500),
 ('fraccionamiento','Los Laureles',ARRAY[]::text[],'',5500),('fraccionamiento','Tucán',ARRAY[]::text[],'',5500),('fraccionamiento','Bethel',ARRAY[]::text[],'',5500),
 ('fraccionamiento','Terrazas Miramar',ARRAY[]::text[],'',5500),('fraccionamiento','La Paz',ARRAY[]::text[],'',5500),
 ('colonia','Infonavit',ARRAY[]::text[],'',5500),('colonia','Miguel Aleman',ARRAY['Miguel Alemán'],'',5500),('colonia','La Esmeralda',ARRAY[]::text[],'',5500),
 ('colonia','Fovissste',ARRAY['Fovisste'],'',5500),('colonia','Popular',ARRAY[]::text[],'',5500),('colonia','1ro de mayo',ARRAY['1 de mayo'],'',5500),
 ('colonia','Pinos',ARRAY[]::text[],'',5500),('colonia','Mariano N Ruiz',ARRAY['Mariano N. Ruiz'],'',5500),('colonia','Centro',ARRAY[]::text[],'',5500),
 ('colonia','Campo de la Mariano N. Ruiz',ARRAY[]::text[],'',5500),('colonia','San Juan',ARRAY[]::text[],'',5500),('colonia','27 de Junio',ARRAY[]::text[],'',5500),
 ('otro_punto','Conafe',ARRAY[]::text[],'',5500),('otro_punto','Gasolinera Morales (salida a Margaritas)',ARRAY[]::text[],'',5500),
 ('otro_punto','Casa de Campo San Juan',ARRAY[]::text[],'',5500),('otro_punto','Camino Viejo',ARRAY[]::text[],'',5500),('otro_punto','Entronque Periférico Altamirano',ARRAY[]::text[],'',5500),
 ('escuela','CBTIS',ARRAY[]::text[],'',6500),('escuela','UNACH',ARRAY[]::text[],'',6500),('escuela','Tecnológico (por la Coca)',ARRAY[]::text[],'',6500),
 ('escuela','UVG',ARRAY[]::text[],'',6500),('escuela','UDS',ARRAY[]::text[],'',6500),('escuela','ICATECH',ARRAY[]::text[],'',6500),
 ('barrio','La Cueva 2da sección',ARRAY[]::text[],'',6500),('barrio','Los Desamparados',ARRAY[]::text[],'',6500),('barrio','Sabinos 2da sección',ARRAY[]::text[],'',6500),
 ('fraccionamiento','Las Tinajas',ARRAY[]::text[],'',6500),
 ('colonia','El Brasilito',ARRAY[]::text[],'',6500),('colonia','Jacarandas',ARRAY[]::text[],'',6500),('colonia','Las Brisas',ARRAY[]::text[],'',6500),('colonia','Valle Balún Canán',ARRAY[]::text[],'',6500),
 ('otro_punto','Las 3 Rosas',ARRAY[]::text[],'',6500),('otro_punto','El Mirador (hasta el tanque 20 de Noviembre, calle pavimentada)',ARRAY[]::text[],'',6500),
 ('otro_punto','Embotelladora Los Lagos',ARRAY[]::text[],'',6500),('otro_punto','Alberca La Alborada',ARRAY[]::text[],'',6500),('otro_punto','15° Regimiento',ARRAY[]::text[],'',6500),
 ('otro_punto','Plaza Las Flores',ARRAY[]::text[],'',6500),('otro_punto','Superior',ARRAY[]::text[],'',6500),('otro_punto','Coca Cola',ARRAY[]::text[],'',6500),
 ('otro_punto','Gasolinera Villatoro',ARRAY[]::text[],'',6500),('otro_punto','Bodegas CEMEX',ARRAY[]::text[],'',6500),('otro_punto','Chapultepec',ARRAY[]::text[],'',6500),('otro_punto','Caseta de Migración',ARRAY[]::text[],'',6500),
 ('colonia','Junchavín',ARRAY[]::text[],'',8000),('colonia','Manuel Velasco',ARRAY[]::text[],'',8000),('colonia','Bugambilias',ARRAY[]::text[],'',8000),
 ('colonia','Reforma',ARRAY[]::text[],'',8000),('colonia','La Esperanza',ARRAY[]::text[],'',8000),('colonia','Chula Vista',ARRAY[]::text[],'',8000),
 ('barrio','La Merced',ARRAY[]::text[],'',8000),('barrio','Cerrito Nitre',ARRAY[]::text[],'',8000),('barrio','Manantial',ARRAY[]::text[],'',8000),
 ('otro_punto','Consorcio Avícola',ARRAY[]::text[],'',8000),('otro_punto','Reclusorio',ARRAY[]::text[],'',8000),('otro_punto','Hospital Materno',ARRAY[]::text[],'',8000),
 ('otro_punto','Rejoyita',ARRAY[]::text[],'',8000),('otro_punto','Bodega Lala',ARRAY[]::text[],'',8000),('otro_punto','Antena Radio IMER',ARRAY[]::text[],'',8000),
 ('otro_punto','Zona de Tolerancia',ARRAY[]::text[],'',8000),('otro_punto','Campo 2 de Febrero',ARRAY[]::text[],'',8000),('otro_punto','Rastro',ARRAY[]::text[],'',8000),
 ('fraccionamiento','Rosario Castellanos',ARRAY[]::text[],'El PDF la incluye a $80 y a $90. Definir cuál tarifa corresponde antes de cotizar.',NULL),
 ('colonia','Monte Cristo',ARRAY[]::text[],'',8000),('colonia','Paraíso Comiteco',ARRAY[]::text[],'',8000),('escuela','Salázar',ARRAY['Salazar'],'',8000),
 ('motel','Venecia',ARRAY[]::text[],'',8000),('motel','Jardín',ARRAY[]::text[],'',8000),('motel','Los Pinos',ARRAY[]::text[],'',8000),
 ('motel','Greens',ARRAY[]::text[],'',8000),('motel','Paraíso',ARRAY[]::text[],'',8000),('motel','Las Palmas',ARRAY[]::text[],'',8000),
 ('otro_punto','Fábrica de Mezclilla',ARRAY[]::text[],'',8000),('otro_punto','PFP',ARRAY[]::text[],'',8000),('otro_punto','Plaza a Bugambilias',ARRAY[]::text[],'',8000),
 ('otro_punto','Plaza a Chula Vista',ARRAY[]::text[],'',8000),('otro_punto','Plaza a Crucero Altamirano',ARRAY[]::text[],'',8000),
 ('otro_punto','Valle a CBTIS 108',ARRAY[]::text[],'',8000),('otro_punto','Cabañas Oro y Plata',ARRAY[]::text[],'',8000),
 ('barrio','San Diego',ARRAY[]::text[],'',9000),('otro_punto','Crucero a Chichima',ARRAY[]::text[],'',9000),
 ('punto','Mirador hasta el asta',ARRAY[]::text[],'',10000),('punto','Plaza Las Flores a Panteón de Pashtón',ARRAY[]::text[],'',10000),
 ('punto','Atrás del 15° Regimiento',ARRAY[]::text[],'',10000),('punto','Crucero de Cash Independencia',ARRAY[]::text[],'',10000),
 ('punto','Quijá',ARRAY[]::text[],'',10000),('punto','Gasolinera Quijá',ARRAY[]::text[],'',10000),('punto','San Diego por Pashtón',ARRAY[]::text[],'',10000),
 ('punto','Motel Pecatto',ARRAY[]::text[],'',10000),('punto','Motel Deseos',ARRAY[]::text[],'',10000),
 ('cash_a','Plaza Las Flores',ARRAY[]::text[],'',11000),('cash_a','Hospital Materno',ARRAY[]::text[],'',11000),('cash_a','Tepeyac por telesecundaria',ARRAY[]::text[],'',11000),
 ('cash_a','Colonia Nueva Era',ARRAY[]::text[],'',11000),('cash_a','Lázaro Cárdenas',ARRAY[]::text[],'',11000),('cash_a','Laguna Soccer',ARRAY[]::text[],'',11000),
 ('cash_a','Maranatha',ARRAY[]::text[],'',11000),('cash_a','Tecnológico del Rosario',ARRAY[]::text[],'',11000),('cash_a','Motel Pasión',ARRAY[]::text[],'',11000),
 ('cash_a','Comitancillo',ARRAY[]::text[],'',11000),
 ('colonia','Chichima Sabinal',ARRAY[]::text[],'',16000),('colonia','Chichima Acapetahua',ARRAY[]::text[],'',16000),
 ('rancheria','San José Obrero',ARRAY[]::text[],'',16000),('rancheria','Yocnajab El Rosario',ARRAY[]::text[],'',16000),('rancheria','Guadalupe Yocnajab',ARRAY[]::text[],'',16000),
 ('rancheria','Río Grande hasta el puente',ARRAY[]::text[],'',16000),('rancheria','Jatón',ARRAY[]::text[],'',16000),('rancheria','Bimbo',ARRAY[]::text[],'',16000),
 ('otro_punto','Cresur',ARRAY[]::text[],'',16000),('otro_punto','Aeropuerto Cash',ARRAY[]::text[],'',16000),('otro_punto','Gas',ARRAY[]::text[],'',16000),('otro_punto','Rebequita',ARRAY[]::text[],'',16000),
 ('lugar','Aposento Alto',ARRAY[]::text[],'',13000),('lugar','Fábrica de Charrito',ARRAY[]::text[],'',13500),
 ('lugar','Hospital Materno a Quijá',ARRAY[]::text[],'',13500),('lugar','27 de Junio',ARRAY[]::text[],'Tarifa listada en la sección LUGAR; también aparece una tarifa de colonia de $55.',13500),
 ('lugar','Polideportivo',ARRAY[]::text[],'',13500),
 ('ejido','Las Flores',ARRAY[]::text[],'',20000),('ejido','Pueblo Nuevo',ARRAY[]::text[],'',20000),('ejido','Chacaljocom',ARRAY['Chacalujócom'],'',20000),
 ('otro_punto','Migración',ARRAY[]::text[],'',20000),('otro_punto','Crematorio Elite',ARRAY[]::text[],'',20000),
 ('motel','Las Vegas',ARRAY[]::text[],'',26000),('rancheria','Izlapá',ARRAY[]::text[],'',35000)
) AS v(category,label,aliases,description,cents)
CROSS JOIN taxi_written_locality_target t
ON CONFLICT(tenant_id,category,label) DO NOTHING;

CREATE OR REPLACE FUNCTION public.taxi_bot_neighborhood_read(p_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF (SELECT count(*) FROM public.taxi_bot_localities WHERE tenant_id=p_tenant)>250 THEN RAISE EXCEPTION 'locality catalog limit'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'label',label,'category',category,'aliases',aliases,'description',description,
  'minCents',fare_cents,'maxCents',fare_cents,'cents',fare_cents,'cells','[]'::jsonb,
  'priceSource','reference','version',md5(category||'|'||label||'|'||coalesce(fare_cents::text,'review')||'|'||aliases::text||'|'||description)
 ) ORDER BY category,label),'[]'::jsonb) INTO result
 FROM public.taxi_bot_localities WHERE tenant_id=p_tenant;
 RETURN result;
END $$;

DROP FUNCTION IF EXISTS public.taxi_bot_neighborhood_apply(uuid,bigint,uuid,text,text,jsonb);
CREATE FUNCTION public.taxi_bot_neighborhood_apply(p_tenant uuid,p_actor bigint,p_request uuid,p_label text,p_category text,p_expected text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous public.taxi_bot_neighborhood_operations;command jsonb;rows jsonb;current_row jsonb;new_label text;new_category text;old_category text;alias_values text[];result jsonb;new_cents integer;is_create boolean;
BEGIN
 is_create:=p_label IS NULL AND p_category IS NULL AND p_expected IS NULL;
 IF p_actor IS NULL OR p_actor<=0 OR p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>4096
  OR (NOT is_create AND (p_label IS NULL OR length(btrim(p_label)) NOT BETWEEN 1 AND 100 OR p_category NOT IN('barrio','fraccionamiento','colonia','otro_punto','escuela','motel','rancheria','lugar','ejido','cash_a','punto') OR p_expected IS NULL OR p_expected!~'^[a-f0-9]{32}$'))
 THEN RAISE EXCEPTION 'invalid locality update'; END IF;
 IF jsonb_typeof(p_payload->'label') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'category') IS DISTINCT FROM 'string'
  OR p_payload->>'category' NOT IN('barrio','fraccionamiento','colonia','otro_punto','escuela','motel','rancheria','lugar','ejido','cash_a','punto')
  OR jsonb_typeof(p_payload->'description') IS DISTINCT FROM 'string' OR coalesce(length(p_payload->>'description'),501)>500
  OR coalesce(length(btrim(p_payload->>'label')),0) NOT BETWEEN 1 AND 100 OR jsonb_typeof(p_payload->'aliases') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_payload->'aliases')>12 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'aliases') a WHERE jsonb_typeof(a)<>'string' OR length(btrim(a#>>'{}')) NOT BETWEEN 1 AND 100)
  OR (p_payload->'cents' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(p_payload->'cents') IS DISTINCT FROM 'number' OR (p_payload->>'cents')::numeric<>trunc((p_payload->>'cents')::numeric) OR (p_payload->>'cents')::integer NOT BETWEEN 1 AND 10000000))
 THEN RAISE EXCEPTION 'invalid locality fields'; END IF;
 new_label:=btrim(p_payload->>'label');new_category:=p_payload->>'category';new_cents:=CASE WHEN p_payload->'cents'='null'::jsonb THEN NULL ELSE (p_payload->>'cents')::integer END;old_category:=p_category;
 SELECT coalesce(array_agg(btrim(value)),'{}') INTO alias_values FROM jsonb_array_elements_text(p_payload->'aliases');
 IF (SELECT count(DISTINCT public.taxi_bot_neighborhood_key(a)) FROM unnest(alias_values) a)<>cardinality(alias_values)
  OR EXISTS(SELECT 1 FROM unnest(alias_values) a WHERE public.taxi_bot_neighborhood_key(a)='')
 THEN RAISE EXCEPTION 'invalid locality aliases'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,61));
 command:=jsonb_build_array(p_tenant,p_label,p_category,p_expected,p_payload);
 SELECT * INTO previous FROM public.taxi_bot_neighborhood_operations WHERE actor=p_actor AND request_id=p_request;
 IF FOUND THEN IF previous.command IS DISTINCT FROM command THEN RETURN jsonb_build_object('state','request_conflict'); END IF; RETURN previous.response; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text,56));
 rows:=public.taxi_bot_neighborhood_read(p_tenant);
 IF NOT is_create THEN
  SELECT value INTO current_row FROM jsonb_array_elements(rows) WHERE value->>'label'=p_label AND value->>'category'=old_category;
  IF current_row IS NULL THEN RETURN jsonb_build_object('state','not_found'); END IF;
  IF current_row->>'version' IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('state','revision_conflict'); END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.taxi_bot_localities l WHERE l.tenant_id=p_tenant AND l.category=new_category
   AND public.taxi_bot_neighborhood_key(l.label)=public.taxi_bot_neighborhood_key(new_label)
   AND (is_create OR l.label<>p_label OR l.category<>old_category))
 THEN RETURN jsonb_build_object('state','name_conflict'); END IF;
 IF EXISTS(SELECT 1 FROM public.taxi_bot_localities l WHERE l.tenant_id=p_tenant AND l.category=new_category
   AND NOT(is_create OR (l.label=p_label AND l.category=old_category))
   AND EXISTS(SELECT 1 FROM unnest(alias_values||ARRAY[new_label]) candidate WHERE
    public.taxi_bot_neighborhood_key(candidate)=public.taxi_bot_neighborhood_key(l.label)
    OR EXISTS(SELECT 1 FROM unnest(l.aliases) existing WHERE public.taxi_bot_neighborhood_key(candidate)=public.taxi_bot_neighborhood_key(existing))))
 THEN RETURN jsonb_build_object('state','alias_conflict'); END IF;
 IF (SELECT count(*) FROM public.taxi_bot_localities WHERE tenant_id=p_tenant)>=250 AND is_create THEN RAISE EXCEPTION 'locality catalog limit'; END IF;
 IF NOT is_create AND (p_label<>new_label OR old_category<>new_category) THEN
  DELETE FROM public.taxi_bot_localities WHERE tenant_id=p_tenant AND category=old_category AND label=p_label;
 END IF;
 INSERT INTO public.taxi_bot_localities(tenant_id,category,label,aliases,description,fare_cents,updated_at,updated_by)
 VALUES(p_tenant,new_category,new_label,alias_values,btrim(p_payload->>'description'),new_cents,clock_timestamp(),p_actor)
 ON CONFLICT(tenant_id,category,label) DO UPDATE SET aliases=excluded.aliases,description=excluded.description,fare_cents=excluded.fare_cents,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
 SELECT value INTO current_row FROM jsonb_array_elements(public.taxi_bot_neighborhood_read(p_tenant))
  WHERE value->>'label'=new_label AND value->>'category'=new_category;
 result:=jsonb_build_object('state','saved','neighborhood',current_row);
 INSERT INTO public.taxi_bot_neighborhood_operations(actor,request_id,command,response) VALUES(p_actor,p_request,command,result);
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.taxi_bot_h3_quote_with_references(p_tenant uuid,p_waba text,p_origin text,p_destination text,p_origin_reference jsonb,p_destination_reference jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE origin_cents integer;destination_cents integer;row jsonb;area jsonb;matches integer;source_category text;
BEGIN
 IF p_origin IS NULL OR p_destination IS NULL OR p_origin!~'^8a[0-9a-f]{13}$' OR p_destination!~'^8a[0-9a-f]{13}$' THEN RAISE EXCEPTION 'invalid taxi H3 cell'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.taxi_bot_channels WHERE tenant_id=p_tenant AND waba=p_waba AND pricing_mode='h3_zone_max') THEN RETURN jsonb_build_object('state','channel_unavailable','mode','h3_zone_max'); END IF;
 IF p_origin_reference IS NULL THEN
  SELECT price_cents INTO origin_cents FROM public.taxi_bot_base_zones WHERE tenant_id=p_tenant AND h3_index=p_origin;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','uncovered','mode','h3_zone_max'); END IF;
  IF origin_cents IS NULL THEN RETURN jsonb_build_object('state','invalid_zone','mode','h3_zone_max'); END IF;
 ELSE
  area:=p_origin_reference;source_category:=area->>'category';
  IF jsonb_typeof(area) IS DISTINCT FROM 'object' OR area->>'priceSource'<>'reference' OR area->>'cell' IS DISTINCT FROM p_origin
    OR jsonb_typeof(area->'cents') IS DISTINCT FROM 'number' OR coalesce((area->>'cents')::integer,0) NOT BETWEEN 1 AND 10000000
    OR NOT public.taxi_bot_street_reference(area->>'reference',area->>'label') THEN RAISE EXCEPTION 'invalid neighborhood fare reference'; END IF;
  SELECT count(*) INTO matches FROM public.taxi_bot_localities WHERE tenant_id=p_tenant AND label=area->>'label' AND (source_category IS NULL OR category=source_category);
  IF matches<>1 THEN RAISE EXCEPTION 'taxi locality category required'; END IF;
  SELECT value INTO row FROM jsonb_array_elements(public.taxi_bot_neighborhood_read(p_tenant))
   WHERE value->>'label'=area->>'label' AND (source_category IS NULL OR value->>'category'=source_category);
  IF row IS NULL OR row->>'version' IS DISTINCT FROM area->>'version' OR row->'cents' IS DISTINCT FROM area->'cents'
   OR row->'cents'='null'::jsonb THEN RAISE EXCEPTION 'taxi locality changed'; END IF;
  origin_cents:=(area->>'cents')::integer;
 END IF;
 IF p_destination_reference IS NULL THEN
  SELECT price_cents INTO destination_cents FROM public.taxi_bot_base_zones WHERE tenant_id=p_tenant AND h3_index=p_destination;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','uncovered','mode','h3_zone_max'); END IF;
  IF destination_cents IS NULL THEN RETURN jsonb_build_object('state','invalid_zone','mode','h3_zone_max'); END IF;
 ELSE
  area:=p_destination_reference;source_category:=area->>'category';
  IF jsonb_typeof(area) IS DISTINCT FROM 'object' OR area->>'priceSource'<>'reference' OR area->>'cell' IS DISTINCT FROM p_destination
    OR jsonb_typeof(area->'cents') IS DISTINCT FROM 'number' OR coalesce((area->>'cents')::integer,0) NOT BETWEEN 1 AND 10000000
    OR NOT public.taxi_bot_street_reference(area->>'reference',area->>'label') THEN RAISE EXCEPTION 'invalid neighborhood fare reference'; END IF;
  SELECT count(*) INTO matches FROM public.taxi_bot_localities WHERE tenant_id=p_tenant AND label=area->>'label' AND (source_category IS NULL OR category=source_category);
  IF matches<>1 THEN RAISE EXCEPTION 'taxi locality category required'; END IF;
  SELECT value INTO row FROM jsonb_array_elements(public.taxi_bot_neighborhood_read(p_tenant))
   WHERE value->>'label'=area->>'label' AND (source_category IS NULL OR value->>'category'=source_category);
  IF row IS NULL OR row->>'version' IS DISTINCT FROM area->>'version' OR row->'cents' IS DISTINCT FROM area->'cents'
   OR row->'cents'='null'::jsonb THEN RAISE EXCEPTION 'taxi locality changed'; END IF;
  destination_cents:=(area->>'cents')::integer;
 END IF;
 RETURN jsonb_build_object('state','priced','mode','h3_zone_max','cents',greatest(origin_cents,destination_cents),'originCell',p_origin,'destinationCell',p_destination);
END $$;

CREATE OR REPLACE FUNCTION public.taxi_bot_validate_quote(p_tenant uuid,p_waba text,p_draft jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE mode text;q jsonb;scope jsonb;old_cents integer;channel public.taxi_bot_channels;item record;point jsonb;lat double precision;lng double precision;distance_km double precision;area jsonb;locality jsonb;matches integer;expected_cell text;point_source text;
BEGIN
 SELECT c.* INTO channel FROM public.taxi_bot_channels c WHERE c.tenant_id=p_tenant AND c.waba=p_waba AND c.enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'taxi pricing channel unavailable'; END IF;
 mode:=channel.pricing_mode;
 IF p_draft->>'originArea' IS NOT NULL OR p_draft->>'destinationArea' IS NOT NULL THEN RAISE EXCEPTION 'taxi locality clarification required'; END IF;
 IF p_draft ? 'fareMode' AND (jsonb_typeof(p_draft->'fareMode') IS DISTINCT FROM 'string' OR p_draft->>'fareMode' NOT IN('quoted','unquoted')) THEN RAISE EXCEPTION 'invalid taxi fare mode'; END IF;
 scope:=p_draft->'quoteH3';
 FOR item IN SELECT true is_origin,p_draft->'origin' value UNION ALL SELECT false,p_draft->'destination' LOOP
  point:=item.value;area:=point->'area';lat:=(point->>'lat')::double precision;lng:=(point->>'lng')::double precision;
  IF lat IS NULL OR lng IS NULL OR lat NOT BETWEEN -90 AND 90 OR lng NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'invalid taxi coordinates'; END IF;
  distance_km:=12742*asin(least(1,sqrt(power(sin(radians(lat-channel.center_lat)/2),2)+cos(radians(channel.center_lat))*cos(radians(lat))*power(sin(radians(lng-channel.center_lng)/2),2))));
  IF distance_km>channel.radius_km THEN RAISE EXCEPTION 'taxi coverage changed'; END IF;
  point_source:=coalesce(point->>'source',CASE WHEN area->>'priceSource'='reference' THEN 'locality' WHEN area->>'priceSource'='h3' THEN 'gps' ELSE 'written' END);
  IF point_source NOT IN('gps','written','locality') THEN RAISE EXCEPTION 'invalid taxi location source'; END IF;
  IF area IS NOT NULL AND jsonb_typeof(area)<>'null' THEN
   IF point_source<>'locality' OR area->>'priceSource'<>'reference' OR area->>'cell' IS NULL OR NOT public.taxi_bot_street_reference(area->>'reference',area->>'label')
    OR left(coalesce(point->>'text',''),17)='Zona aproximada: ' OR position(coalesce(area->>'reference','') IN coalesce(point->>'text',''))=0
   THEN RAISE EXCEPTION 'taxi locality reference required'; END IF;
   IF jsonb_typeof(scope)='object' THEN
    expected_cell:=CASE WHEN item.is_origin THEN scope->>'originCell' ELSE scope->>'destinationCell' END;
    IF area->>'cell' IS DISTINCT FROM expected_cell THEN RAISE EXCEPTION 'taxi locality coordinate changed'; END IF;
   END IF;
   PERFORM pg_advisory_xact_lock_shared(hashtextextended(p_tenant::text,56));
   SELECT count(*) INTO matches FROM public.taxi_bot_localities WHERE tenant_id=p_tenant AND label=area->>'label' AND ((area->>'category') IS NULL OR category=area->>'category');
   IF matches<>1 THEN RAISE EXCEPTION 'taxi locality category required'; END IF;
   SELECT value INTO locality FROM jsonb_array_elements(public.taxi_bot_neighborhood_read(p_tenant))
    WHERE value->>'label'=area->>'label' AND ((area->>'category') IS NULL OR value->>'category'=area->>'category');
   IF locality IS NULL OR locality->>'version' IS DISTINCT FROM area->>'version' OR locality->'cents' IS DISTINCT FROM area->'cents'
    OR locality->'cents'='null'::jsonb THEN RAISE EXCEPTION 'taxi locality changed'; END IF;
  ELSIF point_source='locality' THEN RAISE EXCEPTION 'taxi locality fare missing';
  END IF;
  IF coalesce(p_draft->>'fareMode','quoted')<>'unquoted' AND point_source='written' THEN RAISE EXCEPTION 'written taxi address needs a locality fare or an unquoted request'; END IF;
 END LOOP;
 IF p_draft->>'fareMode'='unquoted' THEN
  IF p_draft->>'quoteCents' IS NOT NULL OR p_draft->>'quoteH3' IS NOT NULL THEN RAISE EXCEPTION 'unquoted taxi cannot contain a fare'; END IF;
  RETURN;
 END IF;
 IF mode='road_distance' THEN
  IF p_draft->>'quoteH3' IS NOT NULL THEN RAISE EXCEPTION 'taxi tariff changed'; END IF;
  RETURN;
 END IF;
 IF jsonb_typeof(scope) IS DISTINCT FROM 'object' OR scope->>'originCell' IS NULL OR scope->>'destinationCell' IS NULL THEN RAISE EXCEPTION 'taxi H3 review required'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended(p_tenant::text,56));
 PERFORM z.h3_index FROM public.taxi_bot_base_zones z WHERE z.tenant_id=p_tenant AND z.h3_index IN(scope->>'originCell',scope->>'destinationCell') ORDER BY z.h3_index FOR SHARE;
 q:=public.taxi_bot_h3_quote_with_references(p_tenant,p_waba,scope->>'originCell',scope->>'destinationCell',
  CASE WHEN p_draft#>>'{origin,area,priceSource}'='reference' THEN p_draft#>'{origin,area}' ELSE NULL END,
  CASE WHEN p_draft#>>'{destination,area,priceSource}'='reference' THEN p_draft#>'{destination,area}' ELSE NULL END);
 old_cents:=(p_draft->>'quoteCents')::integer;
 IF (q->>'state'='priced' AND (q->>'cents')::integer IS NOT DISTINCT FROM old_cents)
   OR (q->>'state' IN('uncovered','invalid_zone') AND old_cents IS NULL) THEN RETURN; END IF;
 RAISE EXCEPTION 'taxi tariff changed';
END $$;

REVOKE ALL ON FUNCTION public.taxi_bot_neighborhood_read(uuid),public.taxi_bot_neighborhood_apply(uuid,bigint,uuid,text,text,text,jsonb),public.taxi_bot_h3_quote_with_references(uuid,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.taxi_bot_neighborhood_read(uuid),public.taxi_bot_neighborhood_apply(uuid,bigint,uuid,text,text,text,jsonb),public.taxi_bot_h3_quote_with_references(uuid,text,text,text,jsonb,jsonb) TO service_role;
COMMIT;
