import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
export interface FunctionFile { name: string; content: string }
const repo = resolve(import.meta.dirname, '../..');
const root = resolve(repo, 'estrella-taxis-backend/supabase/functions');
const supported = ['ycloud-webhook', 'process-queue', 'taxi-bot-admin', 'ai-insights', 'calculate-driving-scores'] as const;
export function packageStellarFunction(name: string): FunctionFile[] {
  if (!supported.some((item) => item === name)) throw new Error('Unsupported Stellar entrypoint.');
  const files = new Map<string, FunctionFile>();
  function visit(file: string): void {
    const local = relative(root, file);
    if (local.startsWith('..' + sep) || local === '..') throw new Error('Dependency escaped the reviewed functions root.');
    const key = local.split(sep).join('/');
    if (files.has(key)) return;
    const content = readFileSync(file, 'utf8'); files.set(key, { name: key, content });
    const ast = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    for (const node of ast.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      const specifier = node.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith('.')) visit(resolve(dirname(file), specifier.text));
    }
  }
  visit(resolve(root, name, 'index.ts'));
  files.set(name + '/deno.json', { name: name + '/deno.json', content: JSON.stringify({ imports: { 'h3-js': 'npm:h3-js@4.5.0' } }) });
  return [...files.values()];
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [name, output] = process.argv.slice(2);
  if (!name || !output) throw new Error('Provide entrypoint and output path.');
  const files = packageStellarFunction(name);
  writeFileSync(output, JSON.stringify({ name, files }), 'utf8');
  console.log(JSON.stringify({ function: name, files: files.length, output }));
}
