import fs from 'fs';
import { execSync } from 'child_process';

const pem = fs.readFileSync('flows_private.pem', 'utf8');

try {
  // Pass secret via cross-platform friendly method or just write .env.local
  // Wait, the best way to set secrets containing newlines in supabase cli is piping via stdin or .env file.
  const envFileContent = `FLOWS_PRIVATE_KEY="${pem.replace(/\n/g, '\\n')}"\n`;
  fs.writeFileSync('.env.flows', envFileContent);
  console.log('Setting secrets from .env.flows...');
  execSync('npx supabase secrets set --env-file .env.flows', { stdio: 'inherit' });
  console.log('Secret set successfully.');
} catch (e) {
  console.error(e);
}
