import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('src');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const ignoredNames = new Set(['vite-env.d.ts']);

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !ignoredNames.has(entry.name)) files.push(full);
  }
  return files;
}

function normalizeSpecifier(specifier, importer) {
  if (specifier.startsWith('@/')) return path.resolve('src', specifier.slice(2));
  if (specifier.startsWith('.')) return path.resolve(path.dirname(importer), specifier);
  return null;
}

function resolveModule(specifier, importer) {
  const base = normalizeSpecifier(specifier, importer);
  if (!base) return null;
  const candidates = [
    base,
    ...[...SOURCE_EXTENSIONS].map((ext) => `${base}${ext}`),
    ...[...SOURCE_EXTENSIONS].map((ext) => path.join(base, `index${ext}`)),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

const files = walk(ROOT);
const forbidden = files
  .map((file) => path.relative(process.cwd(), file).replaceAll('\\', '/'))
  .filter((rel) => /(?:V[0-9]+|\.tmp)(?:\.(?:ts|tsx|js|jsx))$/i.test(rel));

const reachable = new Set();
const queue = [path.resolve('src/main.tsx')];
const importRegex = /(?:import|export)\s+(?:[^'\";]*?\s+from\s+)?['\"]([^'\"]+)['\"]|import\s*\(\s*['\"]([^'\"]+)['\"]\s*\)/g;

while (queue.length) {
  const file = queue.pop();
  if (!file || reachable.has(file) || !fs.existsSync(file)) continue;
  reachable.add(file);
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(importRegex)) {
    const specifier = match[1] ?? match[2];
    const resolved = resolveModule(specifier, file);
    if (resolved) queue.push(resolved);
  }
}

const orphan = files
  .filter((file) => !reachable.has(file))
  .map((file) => path.relative(process.cwd(), file).replaceAll('\\', '/'))
  .filter((rel) => !rel.endsWith('/vite-env.d.ts'));

console.log(`Canonical source report: ${files.length} source files inspected.`);
console.log(`Reachable runtime modules: ${reachable.size}.`);
console.log(`Unreachable runtime modules: ${orphan.length}.`);
console.log(`Versioned/temp runtime files: ${forbidden.length}.`);

if (orphan.length) {
  console.log('\nUnreachable runtime candidates (review only):');
  orphan.forEach((file) => console.log(`- ${file}`));
}

if (forbidden.length) {
  console.log('\nVersioned/temp runtime candidates (review only):');
  forbidden.forEach((file) => console.log(`- ${file}`));
}

console.log('\nCanonical source report completed without modifying runtime code.');
