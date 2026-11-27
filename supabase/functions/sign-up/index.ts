// Edge Function sign-up: POST { email, passcode } → a confirmed student account. The only way an
// account is made: the open sign-up endpoint is switched off. Deploy with verify_jwt off (a guest
// has no session) and with _shared/. Logic: _shared/accounts.ts. Docs: docs/server.md.
import { signUp } from '../_shared/accounts.ts';
import { serveAccounts } from '../_shared/supabase.ts';

Deno.serve((req) => serveAccounts(req, false, (accounts, _user, body) => signUp(accounts, body)));
