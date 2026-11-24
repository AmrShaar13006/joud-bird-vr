// Edge Function issue-run: POST { mode } → a single-use ticket with a server-drawn seed.
// Logic: _shared/issue.ts. Deploy with _shared/. Docs: docs/server.md.
import { issueRun } from '../_shared/issue.ts';
import { serve } from '../_shared/supabase.ts';

Deno.serve((req) => serve(req, (db, user, body) => issueRun(db, user, body)));
