import { defineConfig, devices } from '@playwright/test';

// Opens the built check/ page (npm run build first) in Chromium and WebKit.
// Run through `npm run test:determinism`, which builds and prints the runtime table.
const PORT = 4179;

export default defineConfig({
  testDir: 'tests',
  timeout: 120_000,
  reporter: [['list']],
  // vite preview serves HTTPS with a self-signed certificate (the IWSDK dev plugin).
  use: { baseURL: `https://localhost:${PORT}/`, ignoreHTTPSErrors: true },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // Phone-sized WebKit, like the iPhones the game targets.
    { name: 'webkit-iphone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `https://localhost:${PORT}/check/`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
