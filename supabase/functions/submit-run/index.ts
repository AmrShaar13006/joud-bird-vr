// Edge Function submit-run: POST { ticketId, flaps, endTick, clientScore } → the run replayed
// and stored by the server. Logic: _shared/submit.ts. Deploy with _shared/. Docs: docs/server.md.
import { submitRun } from '../_shared/submit.ts';
import { serve } from '../_shared/supabase.ts';

Deno.serve((req) => serve(req, (db, user, body) => submitRun(db, user, body)));
