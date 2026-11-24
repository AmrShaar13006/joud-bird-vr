/// <reference types="node" />
// Fails if a non-test file in src/core uses something that can differ between V8
// (Chrome, Node, Deno) and JavaScriptCore (Safari), or reads the clock or randomness.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE = resolve('src/core');

const BANNED: [RegExp, string][] = [
  [
    /\bMath\s*\.\s*(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot|random)\b/,
    'transcendental or random Math function',
  ],
  [/\*\*/, 'the ** operator'],
  [/\bDate\s*\.\s*now\b/, 'Date.now'],
  [/\bnew\s+Date\b/, 'new Date'],
  [/\bperformance\b/, 'performance'],
  [/\bcrypto\b/, 'crypto'],
  [/\b(setTimeout|setInterval|setImmediate|requestAnimationFrame|queueMicrotask)\b/, 'timers'],
];

/** Remove comments and string literals, keeping line breaks so line numbers stay right. */
export function stripCode(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
    } else if (c === "'" || c === '"' || c === '`') {
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') i++;
        else if (src[i] === '\n') out += '\n';
        i++;
      }
      i++;
      out += '""';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export function findBanned(src: string): string[] {
  const hits: string[] = [];
  stripCode(src)
    .split('\n')
    .forEach((line, idx) => {
      for (const [re, what] of BANNED) if (re.test(line)) hits.push(`line ${idx + 1}: ${what}`);
    });
  return hits;
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(p));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(p);
  }
  return files;
}

describe('determinism guard', () => {
  it('finds the core sources', () => {
    const names = sourceFiles(CORE).map((f) => relative(CORE, f));
    expect(names).toEqual(expect.arrayContaining(['game.ts', 'obstacles.ts', 'rng.ts', 'replay.ts']));
  });

  it.each(sourceFiles(CORE).map((f) => [relative(CORE, f), f]))('%s uses no banned token', (_n, file) => {
    expect(findBanned(readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('catches each banned token and ignores comments and strings', () => {
    expect(findBanned('const a = Math.sin(x);')).toHaveLength(1);
    expect(findBanned('const a = Math.random();')).toHaveLength(1);
    expect(findBanned('const a = x ** 2;')).toHaveLength(1);
    expect(findBanned('const t = Date.now();')).toHaveLength(1);
    expect(findBanned('const d = new Date();')).toHaveLength(1);
    expect(findBanned('performance.now()')).toHaveLength(1);
    expect(findBanned('crypto.getRandomValues(a)')).toHaveLength(1);
    expect(findBanned('setTimeout(f, 1)')).toHaveLength(1);
    expect(findBanned('/** Math.sin in a doc comment ** */ const a = 1; // Math.pow')).toEqual([]);
    expect(findBanned("const s = 'Math.exp(1) ** 2';")).toEqual([]);
    // best.ts takes a Date argument: reading one passed in is allowed.
    expect(findBanned('function f(date: Date) { return date.getFullYear(); }')).toEqual([]);
    expect(findBanned('Math.sqrt(x) + Math.imul(a, b) + Math.floor(y)')).toEqual([]);
  });
});
