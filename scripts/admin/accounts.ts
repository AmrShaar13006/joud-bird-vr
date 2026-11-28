// Officer tools for student accounts, over Supabase Auth's admin API. Never SQL on auth.users.
// Needs SUPABASE_URL and SUPABASE_SECRET_KEY (the service key) in the environment, for example
// from an untracked .env.admin file. Steps and when to use each command: docs/accounts-runbook.md.
//
//   node --env-file=.env.admin scripts/run-ts.mjs scripts/admin/accounts.ts <command> [args]
//
//   find <email>                      show the account (never the passcode)
//   reset-passcode <email> <digits>   set a temporary passcode for a student who lost theirs
//   delete <email> [--yes]            remove one account (a squatter, or on request)
//   delete-anonymous [--yes]          pre-launch reset: remove the old anonymous test users
//   delete-all [--yes]                the deletion date: remove every account
//
// Deleting keeps runs without a user (the impact total stays); everything personal goes.
// Without --yes the delete commands only list what they would delete.

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { checkPasscode, normalizeEmail } from '../../supabase/functions/_shared/account-rules';

function client(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (see docs/accounts-runbook.md).');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function allUsers(sb: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

async function byEmail(sb: SupabaseClient, raw: string | undefined): Promise<User> {
  if (!raw) throw new Error('Give the student email.');
  const email = normalizeEmail(raw);
  const user = (await allUsers(sb)).find((u) => u.email === email);
  if (!user) throw new Error(`No account for ${email}.`);
  return user;
}

function describe(u: User): string {
  return `${u.email ?? '(anonymous)'}  id ${u.id}  created ${u.created_at}  last sign-in ${u.last_sign_in_at ?? 'never'}`;
}

async function remove(sb: SupabaseClient, users: User[], yes: boolean): Promise<void> {
  for (const u of users) console.log(`${yes ? 'deleting' : 'would delete'}  ${describe(u)}`);
  if (!yes) {
    console.log(`${users.length} account(s). Nothing deleted: add --yes to delete.`);
    return;
  }
  for (const u of users) {
    const { error } = await sb.auth.admin.deleteUser(u.id);
    if (error) throw error;
  }
  console.log(`${users.length} account(s) deleted. Their runs stay, without a user.`);
}

const COMMANDS = ['find', 'reset-passcode', 'delete', 'delete-anonymous', 'delete-all'];

export async function main(args: string[]): Promise<number> {
  const [command, a, b] = args;
  if (!COMMANDS.includes(command)) {
    console.error(`Commands: ${COMMANDS.join(', ')}. See docs/accounts-runbook.md.`);
    return 2;
  }
  try {
    return await run(command, a, b, args.includes('--yes'));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return 1;
  }
}

async function run(command: string, a: string | undefined, b: string | undefined, yes: boolean): Promise<number> {
  const sb = client();
  switch (command) {
    case 'find':
      console.log(describe(await byEmail(sb, a)));
      return 0;
    case 'reset-passcode': {
      const user = await byEmail(sb, a);
      const passcode = checkPasscode(b);
      if (!passcode.ok) throw new Error(`Passcode refused (${passcode.reason}): 6-12 digits, not 123456 or 111111.`);
      const { error } = await sb.auth.admin.updateUserById(user.id, { password: passcode.passcode });
      if (error) throw error;
      console.log(`New passcode set for ${user.email}. Ask the student to change it on the account screen.`);
      return 0;
    }
    case 'delete':
      await remove(sb, [await byEmail(sb, a)], yes);
      return 0;
    case 'delete-anonymous':
      await remove(sb, (await allUsers(sb)).filter((u) => u.is_anonymous), yes);
      return 0;
    case 'delete-all':
      await remove(sb, await allUsers(sb), yes);
      return 0;
    default:
      return 2;
  }
}
