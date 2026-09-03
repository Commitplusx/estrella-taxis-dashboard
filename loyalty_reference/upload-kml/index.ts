import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { DOMParser } from "npm:@xmldom/xmldom";
import { kml } from "npm:@tmcw/togeojson";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function geojsonToWKT(geom: any): string {
  if (geom.type === 'Polygon') {
    const rings = geom.coordinates.map((ring: any[]) => {
      return '(' + ring.map((coord: any[]) => `${coord[0]} ${coord[1]}`).join(', ') + ')'
    })
    return `POLYGON(${rings.join(', ')})`
  }
  if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates.map((poly: any[]) => {
      const rings = poly.map((ring: any[]) => {
        return '(' + ring.map((coord: any[]) => `${coord[0]} ${coord[1]}`).join(', ') + ')'
      })
      return '(' + rings.join(', ') + ')'
    })
    return `MULTIPOLYGON(${polys.join(', ')})`
  }
  throw new Error("Unsupported geometry type: " + geom.type);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    
    // Auth Check
    if (!authHeader || authHeader.replace('Bearer ', '').trim() !== serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { kmlText } = await req.json();

    if (!kmlText) {
      throw new Error("No kmlText provided");
    }

    // 1. Parser KML
    const parser = new DOMParser();
    const doc = parser.parseFromString(kmlText, "text/xml");
    const geojson = kml(doc);

    const features = geojson.features;
    if (!features || features.length === 0) {
      throw new Error("No features found in KML");
    }

    // 2. Conectar a Supabase (usamos Service Role para saltar RLS y borrar/insertar)
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 3. Borrar todas las zonas KML anteriores
    const { error: deleteError } = await supabaseClient
      .from('zonas_kml')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

    if (deleteError) {
      throw deleteError;
    }

    // 4. Insertar nuevas zonas
    let count = 0;
    for (const feature of features) {
      if (feature.geometry && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')) {
        const nombre = feature.properties?.name || 'ZONA SIN NOMBRE';
        const precio = 50; // default

        try {
          const wkt = geojsonToWKT(feature.geometry);
          // Insertar
          const { error: insertError } = await supabaseClient
            .from('zonas_kml')
            .insert({
              nombre: nombre,
              precio: precio,
              geom: wkt
            });
          
          if (insertError) {
            console.error("Error insertando feature:", insertError);
          } else {
            count++;
          }
        } catch (geomErr) {
          console.error("Error convirtiendo geom:", geomErr);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, count: count }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
