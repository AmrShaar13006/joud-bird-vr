// Writes every noun + adjective pair of the public names (the adjective in the noun's form) to
// docs/name-pairs.txt, read from the lists in the accounts migration, for a language review.
// Usage: node scripts/run-ts.mjs scripts/print-name-pairs.ts

import { readFileSync, writeFileSync } from 'node:fs';

const MIGRATION = 'supabase/migrations/20261127120000_accounts.sql';
const OUT = 'docs/name-pairs.txt';

/** The SQL from `start` up to the next semicolon. */
function block(sql: string, start: string): string {
  const i = sql.indexOf(start);
  if (i < 0) throw new Error(`${start} not found in ${MIGRATION}`);
  return sql.slice(i, sql.indexOf(';', i));
}

export function main(): number {
  const sql = readFileSync(MIGRATION, 'utf8');
  const nouns = [...block(sql, 'insert into public.nicknames').matchAll(/\((\d+), '([^']+)', '([mf])', (true|false)\)/g)]
    .map(([, id, label, form, active]) => ({ id: Number(id), label, form, active: active === 'true' }))
    .filter((n) => n.active);
  const adjectives = [...block(sql, 'insert into public.adjectives').matchAll(/\((\d+), '([^']+)', '([^']+)'\)/g)].map(
    ([, id, masc, fem]) => ({ id: Number(id), masc, fem }),
  );
  const f = nouns.filter((n) => n.form === 'f').length;
  const lines = [
    `# Every public name pair (noun + adjective), from ${MIGRATION}.`,
    `# ${nouns.length} active nouns (${f} feminine, ${nouns.length - f} masculine) x ${adjectives.length} adjectives = ${nouns.length * adjectives.length} pairs.`,
    '# Each name also gets a tag from 10 to 99. Ids at the end of a line: noun-adjective.',
    '# Regenerate: node scripts/run-ts.mjs scripts/print-name-pairs.ts',
  ];
  for (const n of nouns) {
    lines.push('', `## ${n.label} (${n.form === 'm' ? 'masculine' : 'feminine'})`);
    for (const a of adjectives) lines.push(`${n.label} ${n.form === 'm' ? a.masc : a.fem}    ${n.id}-${a.id}`);
  }
  writeFileSync(OUT, lines.join('\n') + '\n');
  console.log(`wrote ${OUT}: ${nouns.length * adjectives.length} pairs`);
  return 0;
}
