import { expect, test } from '@playwright/test';

// End to end against the STAGING project: the autopilot plays one ranked round, the server
// replays it, and its verified score must equal the phone's own result.
// Needs anonymous sign-ins enabled on staging and a staging build:
//   VITE_STAGING=1 VITE_SUPABASE_URL=… VITE_SUPABASE_PUBLISHABLE_KEY=… npm run build
//   E2E_ONLINE=1 npx playwright test tests/online.spec.ts --project=chromium
// Skipped otherwise (npm run test:determinism never runs it).
test.skip(process.env.E2E_ONLINE !== '1', 'set E2E_ONLINE=1 with a staging build (see the comment above)');

test('a ranked round is verified by the server with the same score', async ({ page }) => {
  test.setTimeout(120_000);
  const runs: { score: number }[] = [];
  const verdicts: { valid: boolean; score?: number; reason?: string }[] = [];
  page.on('console', async (msg) => {
    const text = msg.text();
    if (text.startsWith('[joud] ranked run')) {
      const args = await Promise.all(msg.args().map((a) => a.jsonValue().catch(() => null)));
      runs.push(args[2] as { score: number });
    } else if (text.startsWith('[joud] verdict')) {
      verdicts.push((await msg.args()[1].jsonValue()) as { valid: boolean; score?: number });
    }
  });
  await page.goto('play/?debug=1&autoplay=1&tier=low&mode=easy');
  await expect.poll(() => verdicts.length, { timeout: 100_000 }).toBeGreaterThan(0);
  expect(verdicts[0].valid, `rejected: ${verdicts[0].reason}`).toBe(true);
  expect(verdicts[0].score).toBe(runs[0].score);
});
