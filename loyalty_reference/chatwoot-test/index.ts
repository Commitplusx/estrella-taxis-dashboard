import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

serve(async (req) => {
  const env = Deno.env.toObject()
  return new Response(JSON.stringify({ keys: Object.keys(env) }))
})
