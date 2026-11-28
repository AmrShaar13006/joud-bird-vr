// Edge Function delete-account: POST {} by the signed-in student → their account is deleted.
// Everything personal goes; runs stay without a user. Logic: _shared/accounts.ts.
import { deleteAccount } from '../_shared/accounts.ts';
import { serveAccounts } from '../_shared/supabase.ts';

Deno.serve((req) => serveAccounts(req, true, (accounts, user) => deleteAccount(accounts, user!)));
