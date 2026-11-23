import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

// The check/ page replays every fixture in the browser engine and must show PASS.
test('check/ replays every fixture identically', async ({ page }, info) => {
  await page.goto('check/');
  await page.waitForFunction(() => document.body.dataset.result !== 'running', null, { timeout: 110_000 });
  const report = await page.evaluate(() => window.__determinism);
  expect(report, 'the page published no report').toBeTruthy();

  // Hand the counts to scripts/determinism/run.mjs for the runtime table.
  const dir = resolve('.tmp/determinism');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, `${info.project.name}.json`),
    JSON.stringify({
      runtime: info.project.name,
      passed: report!.passed,
      total: report!.total,
      ok: report!.ok,
      userAgent: report!.userAgent,
      ms: report!.ms,
    }),
  );

  const fails = report!.lines.filter((l) => l.startsWith('FAIL'));
  expect([...report!.hashErrors, ...fails]).toEqual([]);
  expect(report!.passed).toBe(report!.total);
  await expect(page.locator('#verdict')).toHaveText('PASS');
});

declare global {
  interface Window {
    __determinism?: {
      total: number;
      passed: number;
      ok: boolean;
      lines: string[];
      hashErrors: string[];
      userAgent: string;
      ms: number;
    };
  }
}
