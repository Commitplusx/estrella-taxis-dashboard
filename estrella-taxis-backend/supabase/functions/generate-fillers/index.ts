import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY') || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // same as the bot
const AUDIO_BUCKET = 'voice-bot-audio';

const fillers = [
  { id: 'claro', text: 'Claro...' },
  { id: 'entiendo', text: 'Entiendo...' },
  { id: 'un_momento', text: 'Un momento...' },
  { id: 'permiteme', text: 'Permíteme...' },
  { id: 'verificando_mapa', text: 'Permíteme un momento, estoy verificando la dirección en el mapa...' }
];

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const results = [];
  
  for (const filler of fillers) {
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: filler.text,
          model_id: "eleven_multilingual_v2",
        }),
      });

      if (!response.ok) {
        throw new Error(`ElevenLabs error: ${response.statusText}`);
      }

      const audioBuffer = await response.arrayBuffer();
      const audioBytes = new Uint8Array(audioBuffer);
      const fileName = `fillers/${filler.id}.mp3`;

      const { error: uploadError } = await supabase.storage
        .from(AUDIO_BUCKET)
        .upload(fileName, audioBytes, {
          contentType: 'audio/mpeg',
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from(AUDIO_BUCKET).getPublicUrl(fileName);
      results.push({ id: filler.id, url: publicUrlData.publicUrl });
      
    } catch (err: any) {
      results.push({ id: filler.id, error: err.message });
    }
  }

  return new Response(JSON.stringify({ results }), { 
    headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
  });
});
