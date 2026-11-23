// Run a TypeScript script that imports src/core (extensionless imports) through
// Vite's module runner. No extra dependency. Usage: node scripts/run-ts.mjs <file.ts> [args]
import { resolve } from 'node:path';
import { runnerImport } from 'vite';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/run-ts.mjs <file.ts> [args]');
  process.exit(2);
}
const mod = await runnerImport(resolve(file), { configFile: false, logLevel: 'warn' });
if (typeof mod.module.main === 'function') {
  const code = await mod.module.main(process.argv.slice(3));
  if (typeof code === 'number') process.exitCode = code;
}
