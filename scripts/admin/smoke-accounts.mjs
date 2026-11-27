// Staging smoke test for student accounts (docs/server.md). Makes one throwaway account
// through the sign-up function, walks it through profile, name, a ranked run and the board,
// then deletes it with delete-account. Prints one line per check and never prints a token.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
//     node scripts/admin/smoke-accounts.mjs [test-email]
//
// Only the publishable key is needed. Run it against staging, never production.

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!URL_ || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.');
  process.exit(2);
}
const EMAIL = process.argv[2] ?? '202699990@yu.edu.sa';
const PROBE = 'smoke-probe@example.com'; // reserved domain: no real inbox, even if sign-ups were on
const NAME_TAKEN = [5, 20, 55]; // held by an older staging profile; any taken name works
const NAME_A = [26, 1, 42];
const NAME_B = [26, 1, 43];
const RUN = { flaps: [0], endTick: 74 }; // one flap, then the floor: valid for any seed, score 0

/** A passcode that is not one repeated digit or a straight run. */
function passcode() {
  for (;;) {
    const p = String(10_000_000 + Math.floor(Math.random() * 90_000_000));
    const steps = new Set([...p].slice(1).map((c, i) => c.charCodeAt(0) - p.charCodeAt(i)));
    if (!(steps.size === 1 && (steps.has(0) || steps.has(1) || steps.has(-1)))) return p;
  }
}

async function call(method, path, { token, body } = {}) {
  const headers = { apikey: KEY, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(URL_ + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}
const fn = (name, body, token) => call('POST', `/functions/v1/${name}`, { body, token });
const rpc = (name, args, token) => call('POST', `/rest/v1/rpc/${name}`, { body: args, token });
const nameArgs = ([n, a, t]) => ({ p_nickname: n, p_adjective: a, p_tag: t });

let failed = 0;
function check(label, ok, got) {
  if (!ok) failed++;
  const shown = JSON.stringify(got, (k, v) => (/token/i.test(k) ? '<hidden>' : v));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ->  ${shown.length > 300 ? shown.slice(0, 300) + '…' : shown}`);
}
const errOf = (r) => r.body?.error_code ?? r.body?.error ?? r.body?.code ?? r.body?.message ?? r.body?.msg;
const brief = (r) => ({ status: r.status, error: errOf(r) });

const PASS = passcode();
const strays = []; // sessions to delete if an open endpoint turns out to be on

async function main() {
  // A. The open Auth endpoints are off.
  const open = await call('POST', '/auth/v1/signup', { body: { email: PROBE, password: passcode() } });
  check('open email sign-up is refused', errOf(open) === 'signup_disabled', brief(open));
  if (open.body?.access_token) strays.push(open.body.access_token);
  const anon = await call('POST', '/auth/v1/signup', { body: { data: {} } });
  check('anonymous sign-in is refused', ['anonymous_provider_disabled', 'signup_disabled'].includes(errOf(anon)), brief(anon));
  if (anon.body?.access_token) strays.push(anon.body.access_token);

  // B. The sign-up function: the only way in.
  let r = await fn('sign-up', { email: 'student@yu.edu.sa', passcode: PASS });
  check('sign-up refuses a non-student email', r.status === 400 && r.body?.error === 'badEmail', brief(r));
  r = await fn('sign-up', { email: EMAIL, passcode: '123456' });
  check('sign-up refuses a weak passcode', r.status === 400 && r.body?.error === 'weakPasscode', brief(r));
  r = await fn('sign-up', { email: EMAIL, passcode: PASS });
  check('sign-up makes the account (open sign-ups off)', r.status === 200 && r.body?.ok === true, brief(r));
  if (r.status !== 200) return;
  r = await fn('sign-up', { email: EMAIL, passcode: PASS });
  check('sign-up refuses the same email again', r.status === 409 && r.body?.error === 'emailTaken', brief(r));
  const typed = ` ${EMAIL.toUpperCase().replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)))}‏`;
  r = await fn('sign-up', { email: typed, passcode: PASS });
  check('…also typed in capitals with Arabic digits', r.status === 409 && r.body?.error === 'emailTaken', brief(r));

  // C. Sign in with the same pair.
  r = await call('POST', '/auth/v1/token?grant_type=password', { body: { email: EMAIL, password: PASS } });
  const token = r.body?.access_token;
  check('sign-in with email + passcode', r.status === 200 && !!token, brief(r));
  if (!token) return;

  try {
    // D. No profile yet: no ranked play.
    r = await fn('issue-run', { mode: 'normal' }, token);
    check('issue-run without a profile is 403 needsProfile', r.status === 403 && r.body?.error === 'needsProfile', brief(r));
    r = await rpc('get_me', {}, token);
    check('get_me: year from the email, profile incomplete', r.status === 200 && r.body?.enrolYear === 2026 && r.body?.profileComplete === false && r.body?.name === null, r.body);

    // E. Profile and name.
    r = await rpc('save_profile', { p_college: 'BUS', p_major: 'ENG-SWE', p_interlink: true, p_gender: 'm' }, token);
    check('save_profile refuses a major from another college', r.status === 400 && /badProfile/.test(JSON.stringify(r.body)), brief(r));
    r = await rpc('save_profile', { p_college: 'BUS', p_major: 'BUS-MIS', p_interlink: true, p_gender: 'm' }, token);
    check('save_profile', r.status === 200 && r.body?.ok === true, r.body);
    r = await rpc('claim_name', nameArgs(NAME_TAKEN), token);
    check('claim_name on a taken name is 409', r.status === 409, brief(r));
    r = await rpc('claim_name', nameArgs(NAME_A), token);
    check('claim_name', r.status === 200 && typeof r.body?.name === 'string', r.body);
    r = await rpc('claim_name', nameArgs(NAME_B), token);
    check('claim_name again (a rename)', r.status === 200, r.body);
    const me = await rpc('get_me', {}, token);
    check('get_me: complete, named, 4 renames left', me.status === 200 && me.body?.profileComplete === true && me.body?.name === r.body?.name && me.body?.renamesLeft === 4, me.body);
    const name = me.body?.name;

    // F. A ranked run reaches the board.
    r = await fn('issue-run', { mode: 'normal' }, token);
    check('issue-run with a complete profile', r.status === 200 && !!r.body?.ticketId, { status: r.status, mode: r.body?.mode, rulesetId: r.body?.rulesetId });
    const ticketId = r.body?.ticketId;
    if (ticketId) {
      await new Promise((ok) => setTimeout(ok, 2500)); // the run takes 74 ticks (1.2 s) to play
      r = await fn('submit-run', { ticketId, ...RUN, clientScore: 0 }, token);
      check('submit-run: verified by replay', r.status === 200 && r.body?.valid === true, r.body);
      r = await rpc('get_leaderboard', { p_mode: 'normal' }, null);
      check('get_leaderboard (guest) shows the generated name', r.status === 200 && Array.isArray(r.body) && r.body.some((row) => row.nickname === name), r.body);
      r = await rpc('get_my_best', { p_mode: 'normal' }, token);
      check('get_my_best', r.status === 200 && r.body?.[0]?.name === name, r.body);
    }

    // G. What a student must not reach.
    r = await rpc('winner_contacts', { p_mode: 'normal' }, token);
    check('winner_contacts is closed to students', r.status !== 200, brief(r));
    r = await call('GET', '/rest/v1/students?select=user_id,enrol_year', { token });
    check('students: only the own row', r.status === 200 && Array.isArray(r.body) && r.body.length === 1, { status: r.status, rows: Array.isArray(r.body) ? r.body.length : r.body });
    r = await call('GET', '/rest/v1/students?select=user_id', {});
    check('students: closed to guests', r.status !== 200 || (Array.isArray(r.body) && r.body.length === 0), brief(r));
  } finally {
    // H. Delete the account. Its run stays, without a user.
    r = await fn('delete-account', {}, token);
    check('delete-account', r.status === 200 && r.body?.ok === true, brief(r));
    r = await call('POST', '/auth/v1/token?grant_type=password', { body: { email: EMAIL, password: PASS } });
    check('the passcode no longer signs in', r.status === 400, brief(r));
  }
}

try {
  await main();
} finally {
  for (const t of strays) await fn('delete-account', {}, t).catch(() => {});
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
