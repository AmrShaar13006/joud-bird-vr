import { expect, test } from '@playwright/test';

// End to end against the STAGING project: the autopilot plays one ranked round, the server
// replays it, and its verified score must equal the phone's own result.
// Needs anonymous sign-ins enabled on staging and a staging build:
//   VITE_STAGING=1 VITE_SUPABASE_URL=… VITE_SUPABASE_PUBLISHABLE_KEY=… npm run build
//   E2E_ONLINE=1 npx playwright test tests/online.spec.ts --project=chromium
// Skipped otherwise (npm run test:determinism never runs it).
test.skip(process.env.E2E_ONLINE !== '1', 'set E2E_ONLINE=1 with a staging build (see the comment above)');

test('ranked rounds are verified by the server with the same score', async ({ page }) => {
  test.setTimeout(180_000);
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
  // Normal mode: the autopilot usually scores 10–60 and dies within half a minute.
  await page.goto('play/?debug=1&autoplay=1&tier=low&mode=normal');
  // Play until a verified round scored points ("0 = 0" proves little), or one is rejected.
  await expect
    .poll(() => verdicts.some((v) => !v.valid || (v.score ?? 0) > 0), { timeout: 160_000 })
    .toBe(true);
  expect(verdicts.length).toBeGreaterThan(0);
  verdicts.forEach((v, i) => {
    expect(v.valid, `round ${i + 1} rejected: ${v.reason}`).toBe(true);
    expect(v.score, `round ${i + 1}: server vs phone`).toBe(runs[i].score);
  });
});
