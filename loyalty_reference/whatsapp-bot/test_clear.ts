import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
const res = await supabase.from('bot_memory').delete().eq('phone', '5215659515982');
const res2 = await supabase.from('bot_memory').delete().eq('phone', '5659515982');
console.log(res, res2);
