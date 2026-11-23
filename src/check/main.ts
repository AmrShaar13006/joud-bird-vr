// check/ page: replays every fixture in this browser and shows a big PASS or FAIL with
// the user agent. Open it on real phones; Playwright opens it in Chromium and WebKit.

import { checkFixtures, type CheckReport, type FixtureFile } from '../core/fixture-check';
import mobile from '../core/fixtures/mobile-1.json';
import vr from '../core/fixtures/vr-1.json';

declare global {
  interface Window {
    __determinism?: CheckReport & { userAgent: string; ms: number };
  }
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function run(): void {
  const t0 = performance.now();
  let report: CheckReport;
  try {
    report = checkFixtures([mobile, vr] as unknown as FixtureFile[]);
  } catch (e) {
    report = { total: 0, passed: 0, hashErrors: [String(e)], lines: [], ok: false };
  }
  const ms = Math.round(performance.now() - t0);
  const ua = navigator.userAgent;
  window.__determinism = { ...report, userAgent: ua, ms };
  document.body.dataset.result = report.ok ? 'pass' : 'fail';
  $('verdict').textContent = report.ok ? 'PASS' : 'FAIL';
  $('summary').textContent = `${report.passed}/${report.total} runs · ${ms} ms`;
  $('ua').textContent = ua;
  const fails = report.lines.filter((l) => l.startsWith('FAIL'));
  $('lines').textContent = [...report.hashErrors, ...fails, ...report.lines.filter((l) => !l.startsWith('FAIL'))].join('\n');
}

// Let the page paint "…" first.
requestAnimationFrame(() => setTimeout(run, 0));
