import { defineConfig } from 'vite';

// The sim bundle: src/core as one import-free ESM file for Deno (Supabase Edge Functions).
// `npm run build:sim` writes it; src/core/sim-bundle.test.ts fails when it is out of date.
export default defineConfig({
  configFile: false,
  logLevel: 'warn',
  publicDir: false,
  build: {
    outDir: 'supabase/functions/_shared',
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    target: 'es2020',
    lib: {
      entry: 'src/core/sim-entry.ts',
      formats: ['es'],
      fileName: () => 'joud-sim.js',
    },
  },
});
