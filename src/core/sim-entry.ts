// Entry of the sim bundle (`npm run build:sim` → supabase/functions/_shared/joud-sim.js).
// Deno cannot import src/core directly (its imports have no file extensions).

export { MODES, type Mode } from './config';
export { checkFixtures, type CheckReport, diffResults, type FixtureFile } from './fixture-check';
export { replay, validateLog } from './replay';
export {
  getRuleset,
  impactPoints,
  MAX_TICKS,
  RULESET_IDS,
  type Ruleset,
  rulesetHash,
} from './ruleset';
export type { EndReason, RunLog, RunResult, RunSpec } from './run';
