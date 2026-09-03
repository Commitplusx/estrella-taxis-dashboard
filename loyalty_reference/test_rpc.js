import { execSync } from 'child_process'

const raw = execSync(
  `npx supabase db query "SELECT * FROM search_colonia_fuzzy('Pilita seca');" --linked --output json`,
  { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
)
console.log(raw)
