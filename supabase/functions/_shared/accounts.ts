// sign-up and delete-account: the only ways a student account is made or removed from the phone.
// Pure over `Accounts`, so Deno tests call them with a fake. Rules: ./account-rules.ts.

import { checkEmail, checkPasscode } from './account-rules.ts';
import type { Reply } from './types.ts';

/** What the account handlers need (Supabase Auth admin + SQL in production, a fake in tests). */
export interface Accounts {
  /** False past the project-wide cap of new accounts a minute (public.sign_up_allowed). */
  signUpAllowed(): Promise<boolean>;
  /** Creates a confirmed email + password user. 'taken' when the email already has an account. */
  createUser(email: string, passcode: string): Promise<{ id: string } | 'taken'>;
  /** The student's row with the enrolment year (public.create_account). */
  createAccount(userId: string, enrolYear: number): Promise<void>;
  /** Deletes the auth user; the database deletes everything personal and keeps the runs. */
  deleteUser(userId: string): Promise<void>;
}

/**
 * POST { email, passcode } → 200 { ok: true }; the phone then signs in with the same pair.
 * 400 badRequest | badEmail | badYear | badPasscode | weakPasscode, 409 emailTaken, 429 tooMany.
 */
export async function signUp(accounts: Accounts, body: unknown, nowMs: number = Date.now()): Promise<Reply> {
  if (!body || typeof body !== 'object') return { status: 400, body: { error: 'badRequest' } };
  const b = body as Record<string, unknown>;
  const email = checkEmail(b.email, nowMs);
  if (!email.ok) return { status: 400, body: { error: email.reason } };
  const passcode = checkPasscode(b.passcode);
  if (!passcode.ok) return { status: 400, body: { error: passcode.reason } };

  if (!(await accounts.signUpAllowed())) return { status: 429, body: { error: 'tooMany' } };
  const user = await accounts.createUser(email.email, passcode.passcode);
  if (user === 'taken') return { status: 409, body: { error: 'emailTaken' } };
  try {
    await accounts.createAccount(user.id, email.enrolYear);
  } catch (e) {
    // No half-made accounts: without its student row the user could never play ranked.
    await accounts.deleteUser(user.id).catch((d) => console.error('rollback failed', user.id, d));
    throw e;
  }
  return { status: 200, body: { ok: true } };
}

/** POST {} by the signed-in student → 200 { ok: true }. Runs stay, without a user. */
export async function deleteAccount(accounts: Accounts, userId: string): Promise<Reply> {
  await accounts.deleteUser(userId);
  return { status: 200, body: { ok: true } };
}
