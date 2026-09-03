import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') || '' // Try to see if it works without service role, or we can use SERVICE_ROLE_KEY

async function test() {
  console.log("Starting test...")
}
test()
