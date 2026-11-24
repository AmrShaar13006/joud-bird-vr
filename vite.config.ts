/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig, type Plugin } from 'vite';

/**
 * Records which source modules went into which output chunk (.tmp/build/chunk-modules.json,
 * not deployed). scripts/check-mobile-bundle.mjs reads it to prove play/ ships no IWSDK code.
 */
function chunkModules(): Plugin {
  return {
    name: 'joud-chunk-modules',
    apply: 'build',
    writeBundle(_options, bundle) {
      const out: Record<string, { imports: string[]; dynamicImports: string[]; modules: string[] }> = {};
      for (const [file, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') continue;
        out[file] = {
          imports: chunk.imports,
          dynamicImports: chunk.dynamicImports,
          modules: chunk.moduleIds.map((id) => relative(process.cwd(), id).split('\\').join('/')),
        };
      }
      const dir = resolve('.tmp/build');
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, 'chunk-modules.json'), JSON.stringify(out, null, 1));
    },
  };
}

export default defineConfig({
  // Only for `vite build`: registered in dev (even with apply: 'build') it stalls the
  // IWSDK dev server before it prints its URL.
  plugins: process.argv.includes('build') ? [iwsdkDev(), chunkModules()] : [iwsdkDev()],
  server: { host: '0.0.0.0', port: 8081, open: false },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    // The IWSDK game, the plain Three.js fallback and the phone game (play/) share one
    // super-three chunk. check/ replays the determinism fixtures in any browser (no Three.js).
    rollupOptions: {
      input: {
        main: './index.html',
        fallback: './fallback.html',
        play: './play/index.html',
        check: './check/index.html',
      },
    },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (its own three vs the app's super-three alias). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
