/// <reference types="node" />
// The committed sim bundle (and its fixture copies) must match a fresh build of src/core.
// Fix with `npm run build:sim`.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const lf = (s: string) => s.replace(/\r\n/g, '\n');

describe('sim bundle', () => {
  it('is up to date (run `npm run build:sim`)', async () => {
    const url = pathToFileURL(resolve('scripts/build-sim.mjs')).href;
    const mod = (await import(/* @vite-ignore */ url)) as {
      SHARED: string;
      buildSimFiles: () => Promise<Record<string, string>>;
    };
    const files = await mod.buildSimFiles();
    expect(Object.keys(files).sort()).toEqual([
      'fixtures/mobile-1.json',
      'fixtures/vr-1.json',
      'joud-sim.js',
    ]);
    for (const [name, text] of Object.entries(files)) {
      const committed = lf(readFileSync(resolve(mod.SHARED, name), 'utf8'));
      expect(committed === text, `${name} is out of date: run npm run build:sim`).toBe(true);
    }
    expect(files['joud-sim.js']).not.toMatch(/^\s*import\s/m);
  }, 60_000);
});
