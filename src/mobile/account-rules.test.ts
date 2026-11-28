// The sign-up rules the phone and the sign-up Edge Function share (one file, both sides).
import { describe, expect, it } from 'vitest';
import {
  checkEmail,
  checkPasscode,
  MIN_ENROL_YEAR,
  normalizeEmail,
  normalizePasscode,
  riyadhYear,
} from '../../supabase/functions/_shared/account-rules';

const NOW = Date.parse('2026-11-27T12:00:00Z');

describe('checkEmail', () => {
  it('accepts a YU student email and reads the enrolment year', () => {
    expect(checkEmail('202312345@yu.edu.sa', NOW)).toEqual({ ok: true, email: '202312345@yu.edu.sa', enrolYear: 2023 });
  });

  it('normalizes case, spaces, direction marks and Arabic digits', () => {
    const typed = '‏ ٢٠٢٤٥٤٣٢١@YU.EDU.SA ‎';
    expect(normalizeEmail(typed)).toBe('202454321@yu.edu.sa');
    expect(checkEmail(typed, NOW)).toEqual({ ok: true, email: '202454321@yu.edu.sa', enrolYear: 2024 });
  });

  it.each([
    ['student@yu.edu.sa'],
    ['20231234@yu.edu.sa'], // 8 digits
    ['2023123456@yu.edu.sa'], // 10 digits
    ['202312345@yu.edu.sa.evil.com'],
    ['202312345@staff.yu.edu.sa'],
    ['202312345@gmail.com'],
    ['192312345@yu.edu.sa'],
    [''],
    [null],
    [202312345],
  ])('refuses %j as badEmail', (email) => {
    expect(checkEmail(email, NOW)).toEqual({ ok: false, reason: 'badEmail' });
  });

  it(`accepts years from ${MIN_ENROL_YEAR} to the current year in Riyadh only`, () => {
    expect(checkEmail(`${MIN_ENROL_YEAR}00001@yu.edu.sa`, NOW).ok).toBe(true);
    expect(checkEmail(`${MIN_ENROL_YEAR - 1}00001@yu.edu.sa`, NOW)).toEqual({ ok: false, reason: 'badYear' });
    expect(checkEmail('202600001@yu.edu.sa', NOW).ok).toBe(true);
    expect(checkEmail('202700001@yu.edu.sa', NOW)).toEqual({ ok: false, reason: 'badYear' });
  });

  it('turns the year at midnight Riyadh time, 21:00 UTC', () => {
    expect(riyadhYear(Date.parse('2026-12-31T20:59:59Z'))).toBe(2026);
    expect(riyadhYear(Date.parse('2026-12-31T21:00:00Z'))).toBe(2027);
    expect(checkEmail('202700001@yu.edu.sa', Date.parse('2026-12-31T21:00:00Z')).ok).toBe(true);
  });
});

describe('checkPasscode', () => {
  it.each(['482915', '135790', '000001', '739104826351'])('accepts %s', (p) => {
    expect(checkPasscode(p)).toEqual({ ok: true, passcode: p });
  });

  it('normalizes Arabic digits and spaces to what Supabase stores', () => {
    expect(normalizePasscode(' ٤٨٢ ٩١٥ ')).toBe('482915');
    expect(checkPasscode('۴۸۲۹۱۵')).toEqual({ ok: true, passcode: '482915' });
  });

  it.each(['12345', '7391048263512', 'abcdef', '48291a', '', null, 482915])('refuses %j as badPasscode', (p) => {
    expect(checkPasscode(p)).toEqual({ ok: false, reason: 'badPasscode' });
  });

  it.each(['000000', '777777777', '123456', '3456789', '987654', '6543210'])('refuses %s as weakPasscode', (p) => {
    expect(checkPasscode(p)).toEqual({ ok: false, reason: 'weakPasscode' });
  });
});
