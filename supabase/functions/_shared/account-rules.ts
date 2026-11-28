// Sign-up rules shared by the phone (src/mobile) and the sign-up Edge Function, so the browser
// and the server check exactly the same thing. No imports and no platform APIs: Vite, tsc,
// Vitest and Deno all load this one file.

/** Earliest enrolment year accepted (the Khobar campus took its first cohort in 2022-23). */
export const MIN_ENROL_YEAR = 2022;
export const PASSCODE_MIN = 6;
export const PASSCODE_MAX = 12;

const EMAIL = /^(20\d{2})\d{5}@yu\.edu\.sa$/;
/** Direction marks and zero-width characters that sneak in when pasting in right-to-left text. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** Arabic-Indic (٠–٩) and Persian (۰–۹) digits become 0–9: Arabic keyboards type them. */
export function toLatinDigits(s: string): string {
  return s.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => String((d.charCodeAt(0) & 0xf) % 10));
}

/** The form every email is checked and stored in: no spaces or marks, lower case, Latin digits. */
export function normalizeEmail(raw: string): string {
  return toLatinDigits(raw.replace(INVISIBLE, '').replace(/\s+/g, '').toLowerCase());
}

/** The passcode as it is sent to Supabase, at sign-up and at every sign-in. */
export function normalizePasscode(raw: string): string {
  return toLatinDigits(raw.replace(INVISIBLE, '').replace(/\s+/g, ''));
}

/** The calendar year in Riyadh (UTC+3 all year, no daylight saving). */
export function riyadhYear(nowMs: number): number {
  return new Date(nowMs + 3 * 3600_000).getUTCFullYear();
}

export type EmailCheck =
  | { ok: true; email: string; enrolYear: number }
  | { ok: false; reason: 'badEmail' | 'badYear' };

/** A YU student email: 4-digit enrolment year + 5 digits @yu.edu.sa, year from 2022 to now. */
export function checkEmail(raw: unknown, nowMs: number): EmailCheck {
  if (typeof raw !== 'string' || raw.length > 100) return { ok: false, reason: 'badEmail' };
  const email = normalizeEmail(raw);
  const m = EMAIL.exec(email);
  if (!m) return { ok: false, reason: 'badEmail' };
  const enrolYear = Number(m[1]);
  if (enrolYear < MIN_ENROL_YEAR || enrolYear > riyadhYear(nowMs)) return { ok: false, reason: 'badYear' };
  return { ok: true, email, enrolYear };
}

export type PasscodeCheck = { ok: true; passcode: string } | { ok: false; reason: 'badPasscode' | 'weakPasscode' };

/** 6–12 digits, not one digit repeated and not a straight run up or down (123456, 987654). */
export function checkPasscode(raw: unknown): PasscodeCheck {
  if (typeof raw !== 'string' || raw.length > 40) return { ok: false, reason: 'badPasscode' };
  const passcode = normalizePasscode(raw);
  if (passcode.length < PASSCODE_MIN || passcode.length > PASSCODE_MAX || !/^\d+$/.test(passcode)) {
    return { ok: false, reason: 'badPasscode' };
  }
  const steps = new Set<number>();
  for (let i = 1; i < passcode.length; i++) steps.add(passcode.charCodeAt(i) - passcode.charCodeAt(i - 1));
  if (steps.size === 1 && (steps.has(0) || steps.has(1) || steps.has(-1))) return { ok: false, reason: 'weakPasscode' };
  return { ok: true, passcode };
}
