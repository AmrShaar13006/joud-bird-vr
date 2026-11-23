import type { Mode } from './config';

/** What a run is played with. The server will issue these in step 2. */
export interface RunSpec {
  rulesetId: string;
  mode: Mode;
  /** uint32 */
  seed: number;
}

/** A finished run: replaying it reproduces the result exactly. */
export interface RunLog extends RunSpec {
  /** Ticks of the flaps, ascending, no duplicates. Tick 0 is the flap that starts the round. */
  flaps: number[];
  /** Playing ticks simulated when the run ended. */
  endTick: number;
}

export type EndReason = 'hit' | 'floor' | 'ceiling' | 'maxTicks' | 'logEnd';

export interface RunResult {
  valid: boolean;
  /** Reason code when `valid` is false. */
  reason?: string;
  score: number;
  obstaclePoints: number;
  flowers: number;
  /** score × mode multiplier. */
  impact: number;
  endTick: number;
  endReason: EndReason;
  /** FNV-1a of the final state (8 hex digits). */
  hash: string;
  /** State hash every CHECKPOINT_TICKS ticks, to locate a divergence. */
  checkpoints: string[];
}
