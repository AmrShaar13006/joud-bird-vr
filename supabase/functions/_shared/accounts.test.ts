// Deno tests for sign-up and delete-account against a fake Auth + database:
//   deno test --allow-read=. supabase/functions
import { deepStrictEqual as assertEquals } from 'node:assert/strict';
import { type Accounts, deleteAccount, signUp } from './accounts.ts';

const NOW = Date.parse('2026-11-27T12:00:00Z');

/** In-memory Auth users and student rows, with switches for the failure paths. */
class FakeAccounts implements Accounts {
  users = new Map<string, { email: string; passcode: string }>();
  students = new Map<string, number>();
  allowed = true;
  failCreateAccount = false;
  private n = 0;

  signUpAllowed() {
    return Promise.resolve(this.allowed);
  }
  createUser(email: string, passcode: string) {
    if ([...this.users.values()].some((u) => u.email === email)) return Promise.resolve('taken' as const);
    const id = `u${++this.n}`;
    this.users.set(id, { email, passcode });
    return Promise.resolve({ id });
  }
  createAccount(userId: string, enrolYear: number) {
    if (this.failCreateAccount) return Promise.reject(new Error('db down'));
    this.students.set(userId, enrolYear);
    return Promise.resolve();
  }
  deleteUser(userId: string) {
    this.users.delete(userId);
    this.students.delete(userId);
    return Promise.resolve();
  }
}

const ok = { email: '202312345@yu.edu.sa', passcode: '482915' };

Deno.test('sign-up: a YU email and a passcode make a confirmed user and a student row', async () => {
  const a = new FakeAccounts();
  const r = await signUp(a, { email: '  202312345@YU.edu.sa ', passcode: '٤٨٢٩١٥' }, NOW);
  assertEquals(r, { status: 200, body: { ok: true } });
  // Stored normalized: lower case, no spaces, Latin digits.
  assertEquals([...a.users.values()], [{ email: '202312345@yu.edu.sa', passcode: '482915' }]);
  assertEquals([...a.students.values()], [2023]);
});

Deno.test('sign-up: bad emails, years and passcodes are refused before any account exists', async () => {
  const a = new FakeAccounts();
  const cases: [unknown, string][] = [
    [null, 'badRequest'],
    [{ ...ok, email: 'student@gmail.com' }, 'badEmail'],
    [{ ...ok, email: '20231234@yu.edu.sa' }, 'badEmail'],
    [{ ...ok, email: 42 }, 'badEmail'],
    [{ ...ok, email: '202112345@yu.edu.sa' }, 'badYear'],
    [{ ...ok, email: '202712345@yu.edu.sa' }, 'badYear'],
    [{ ...ok, passcode: '12345' }, 'badPasscode'],
    [{ ...ok, passcode: 482915 }, 'badPasscode'],
    [{ ...ok, passcode: '123456' }, 'weakPasscode'],
    [{ ...ok, passcode: '000000' }, 'weakPasscode'],
  ];
  for (const [body, error] of cases) assertEquals(await signUp(a, body, NOW), { status: 400, body: { error } });
  assertEquals(a.users.size, 0);
});

Deno.test('sign-up: a taken email is 409 and the cap is 429', async () => {
  const a = new FakeAccounts();
  assertEquals((await signUp(a, ok, NOW)).status, 200);
  assertEquals(await signUp(a, { ...ok, passcode: '739104' }, NOW), { status: 409, body: { error: 'emailTaken' } });
  a.allowed = false;
  assertEquals(await signUp(a, { ...ok, email: '202498765@yu.edu.sa' }, NOW), { status: 429, body: { error: 'tooMany' } });
  assertEquals(a.users.size, 1);
});

Deno.test('sign-up: if the student row fails, the new user is deleted again', async () => {
  const a = new FakeAccounts();
  a.failCreateAccount = true;
  let threw = false;
  try {
    await signUp(a, ok, NOW);
  } catch {
    threw = true; // serve() turns this into a 500 and the phone can try again
  }
  assertEquals(threw, true);
  assertEquals(a.users.size, 0);
  a.failCreateAccount = false;
  assertEquals((await signUp(a, ok, NOW)).status, 200);
});

Deno.test('delete-account: deletes the caller only', async () => {
  const a = new FakeAccounts();
  await signUp(a, ok, NOW);
  await signUp(a, { ...ok, email: '202254321@yu.edu.sa' }, NOW);
  assertEquals(await deleteAccount(a, 'u1'), { status: 200, body: { ok: true } });
  assertEquals([...a.users.keys()], ['u2']);
  assertEquals([...a.students.keys()], ['u2']);
});
