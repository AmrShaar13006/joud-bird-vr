// Replay: re-run a RunLog through the same Game.step() the live game uses.
// Pure: used live on the phone and, in step 2, inside the Supabase Edge Function.

import { isMode } from './config';
import { Game } from './game';
import { isSeed } from './rng';
import { getRuleset } from './ruleset';
import type { RunLog, RunResult } from './run';

export interface ReplayOptions {
  /** Stop earlier than the ruleset's own limit. */
  maxTicks?: number;
}

function invalid(reason: string): RunResult {
  return {
    valid: false,
    reason,
    score: 0,
    obstaclePoints: 0,
    flowers: 0,
    impact: 0,
    endTick: 0,
    endReason: 'logEnd',
    hash: '',
    checkpoints: [],
  };
}

/** Reason code if the log is malformed, else null. Never throws. */
export function validateLog(log: unknown): string | null {
  if (!log || typeof log !== 'object') return 'badLog';
  const l = log as Partial<RunLog>;
  const rs = getRuleset(l.rulesetId);
  if (!rs) return 'unknownRuleset';
  if (!isMode(l.mode)) return 'badMode';
  if (!isSeed(l.seed)) return 'badSeed';
  if (typeof l.endTick !== 'number' || !Number.isInteger(l.endTick) || l.endTick < 1) {
    return 'badEndTick';
  }
  if (l.endTick > rs.maxTicks) return 'endTickTooLarge';
  const flaps = l.flaps;
  if (!Array.isArray(flaps) || flaps.length === 0) return 'noFlaps';
  for (let i = 0; i < flaps.length; i++) {
    const t = flaps[i];
    if (typeof t !== 'number' || !Number.isInteger(t) || t < 0) return 'badFlap';
    if (i > 0) {
      if (t === flaps[i - 1]) return 'duplicateFlap';
      if (t < flaps[i - 1]) return 'unsortedFlaps';
    }
  }
  if (flaps[0] !== 0) return 'firstFlapNotZero';
  if (flaps[flaps.length - 1] >= l.endTick) return 'flapAfterEnd';
  return null;
}

/**
 * Replay a run. Returns `valid: false` with a reason code for a malformed log, and
 * never throws. A valid log replays until the round ends ('hit', 'floor', 'ceiling',
 * 'maxTicks') or the log's endTick is reached while still flying ('logEnd'). The
 * caller compares `endTick` with the log's to see whether the run ended where it says.
 */
export function replay(log: RunLog, opts: ReplayOptions = {}): RunResult {
  try {
    const why = validateLog(log);
    if (why) return invalid(why);
    const rs = getRuleset(log.rulesetId)!;
    const cap =
      typeof opts.maxTicks === 'number' && opts.maxTicks < rs.maxTicks ? opts.maxTicks : rs.maxTicks;
    const game = new Game(rs.modes[log.mode], { ruleset: rs, mode: log.mode, seed: log.seed });
    const h = rs.step;
    const flaps = log.flaps;
    game.handle('start');
    game.handle('flap'); // tick 0
    let i = 1;
    while (game.state === 'playing') {
      if (game.tick >= log.endTick) return game.result('logEnd');
      if (game.tick >= cap) return game.result('maxTicks');
      game.step(h);
      if (game.state !== 'playing') break;
      if (i < flaps.length && flaps[i] === game.tick) {
        game.handle('flap');
        i++;
      }
    }
    return game.lastResult ?? invalid('internal');
  } catch {
    return invalid('internal');
  }
}
