import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts on purpose: the game core is plain TypeScript and
// must be testable without the IWSDK dev plugin, a browser or WebXR.
export default defineConfig({
  test: {
    include: ['src/core/**/*.test.ts', 'src/mobile/**/*.test.ts'],
    environment: 'node',
  },
});
