import { type Config, DEFAULT_MODE, gapForScore, type Mode, speedForScore } from './config';
import { Fnv } from './hash';
import type { GameCommand } from './input';
import { ObstacleField, type Rng } from './obstacles';
import { type Body, flap, integrate } from './physics';
import { mixSeed, Prng } from './rng';
import { CHECKPOINT_TICKS, impactPoints, type Ruleset, VR1 } from './ruleset';
import type { EndReason, RunLog, RunResult } from './run';

export type GameState = 'attract' | 'ready' | 'playing' | 'gameOver' | 'paused';

/** Things the shell may react to (sound, haptics, animation). */
export type GameEvent =
  | 'flap'
  | 'score'
  | 'flower'
  | 'hit'
  | 'bounce'
  | 'newBest'
  | 'state'
  | 'mode';

export interface GameOptions {
  /** Seed (uint32) of the first round. Default 0. */
  seed?: number;
  /**
   * Seed source for every later round (the shells use crypto). Without it the next
   * seed is derived from the previous one.
   */
  nextSeed?: () => number;
  /** Rules (default vr-1). `cfg` must be one of its modes, or URL-tuned from one (VR). */
  ruleset?: Readonly<Ruleset>;
  /** Test hook: replaces the seeded generator. Runs played with it do not replay. */
  rng?: Rng;
  /** Best score so far today in this mode (from storage). */
  best?: number;
  /** Difficulty the config was built for. */
  mode?: Mode;
}

/**
 * State machine: attract → ready → playing → gameOver → ready …
 * `paused` can be entered from ready/playing and returns to where it was.
 * The simulation runs at a fixed step (cfg.step) with a clamp after hitches.
 * Time inside a round is the integer `tick`, which advances only in playing steps.
 */
export class Game {
  state: GameState = 'attract';
  /** State to return to when leaving `paused`. */
  resumeState: 'ready' | 'playing' = 'playing';
  /** Simulated seconds spent in the current state. */
  stateTime = 0;
  readonly bird: Body = { y: 0, vy: 0 };
  readonly field: ObstacleField;
  /** obstaclePoints + flowers. */
  score = 0;
  obstaclePoints = 0;
  flowers = 0;
  best: number;
  /** True when the last round set a new best. */
  newBest = false;
  /** Events since the shell last drained them. */
  readonly events: GameEvent[] = [];

  mode: Mode;
  readonly ruleset: Readonly<Ruleset>;
  /** Playing steps simulated this round. */
  tick = 0;
  /** Seed of the current round. */
  seed: number;
  /** Why the last round ended. */
  endReason: EndReason | null = null;
  /** The last finished round and its result (set at game over). */
  lastRun: RunLog | null = null;
  lastResult: RunResult | null = null;

  /** Flap ticks of the current round. */
  private readonly flaps: number[] = [];
  private readonly checkpoints: string[] = [];
  private acc = 0;
  private seedUsed = false;
  private readonly prng = new Prng();
  private readonly rng: Rng;
  private readonly nextSeed: (() => number) | undefined;
  private readonly injectedRng: boolean;
  private readonly fnv = new Fnv();
  private _cfg: Readonly<Config>;

  constructor(cfg: Readonly<Config>, opts: GameOptions = {}) {
    this._cfg = cfg;
    this.ruleset = opts.ruleset ?? VR1;
    this.seed = (opts.seed ?? 0) >>> 0;
    this.prng.seed(this.seed);
    this.nextSeed = opts.nextSeed;
    this.injectedRng = opts.rng !== undefined;
    const prng = this.prng;
    this.rng = opts.rng ?? (() => prng.next());
    this.best = opts.best ?? 0;
    this.mode = opts.mode ?? DEFAULT_MODE;
    this.field = new ObstacleField(cfg, this.ruleset, this.mode);
  }

  get cfg(): Readonly<Config> {
    return this._cfg;
  }

  /**
   * Switch difficulty. Only allowed on the attract screen (between rounds),
   * so a round never changes rules halfway. Returns false if refused.
   */
  configure(cfg: Readonly<Config>, mode: Mode, best: number): boolean {
    if (this.state !== 'attract') return false;
    this._cfg = cfg;
    this.mode = mode;
    this.best = best;
    this.field.setConfig(cfg, mode);
    this.resetRound();
    this.events.push('mode');
    return true;
  }

  /**
   * Use this seed for the next round (e.g. one issued by the server).
   * Refused while a round is in progress.
   */
  setSeed(seed: number): boolean {
    if (this.state === 'playing' || this.state === 'paused') return false;
    this.seed = seed >>> 0;
    this.seedUsed = false;
    this.prng.seed(this.seed);
    return true;
  }

  /** Speed and gap ramp with obstacles passed (equal to the score in vr-1). */
  get speed(): number {
    return speedForScore(this.field.passed, this.cfg);
  }

  get gap(): number {
    return gapForScore(this.field.passed, this.cfg);
  }

  /** True once a trigger press may restart after game over. */
  get canRestartWithTrigger(): boolean {
    return this.state === 'gameOver' && this.stateTime >= this.cfg.restartLockout;
  }

  handle(cmd: GameCommand): void {
    switch (this.state) {
      case 'attract':
        if (cmd === 'flap' || cmd === 'start' || cmd === 'restart') this.toReady();
        break;
      case 'ready':
        if (cmd === 'flap' || cmd === 'start') {
          this.setState('playing');
          this.seedUsed = true;
          this.doFlap();
        } else if (cmd === 'pause') {
          this.pause();
        }
        break;
      case 'playing':
        if (cmd === 'flap') this.doFlap();
        else if (cmd === 'pause') this.pause();
        break;
      case 'gameOver':
        if (cmd === 'restart') this.toReady();
        else if ((cmd === 'flap' || cmd === 'start') && this.canRestartWithTrigger) this.toReady();
        break;
      case 'paused':
        if (cmd === 'pause') {
          this.setState(this.resumeState);
        } else if (cmd === 'flap' || cmd === 'start') {
          const resumeTo = this.resumeState;
          this.setState(resumeTo);
          if (resumeTo === 'playing') this.doFlap();
        } else if (cmd === 'restart') {
          this.toReady();
        }
        break;
    }
  }

  /** Lifecycle pause (headset blurred, tab hidden). Idempotent, not a toggle. */
  suspend(): void {
    if (this.state === 'ready' || this.state === 'playing') this.pause();
  }

  /** Back to the attract screen (session ended, new visitor). */
  toAttract(): void {
    this.resetRound();
    this.setState('attract');
  }

  /**
   * Advance by a real frame time. Runs whole fixed steps; leftover time carries to
   * the next frame. Returns the number of steps run. Frame timing only decides how
   * many ticks run per frame; it never changes a result.
   */
  advance(frameDt: number): number {
    if (!(frameDt > 0)) return 0;
    this.acc += Math.min(frameDt, this.cfg.maxFrame);
    let steps = 0;
    while (this.acc >= this.cfg.step) {
      this.acc -= this.cfg.step;
      this.step(this.cfg.step);
      steps++;
    }
    return steps;
  }

  /** One fixed simulation step. Live play and replay both run exactly this. */
  step(h: number): void {
    this.stateTime += h;
    if (this.state !== 'playing') return;

    const cfg = this.cfg;
    const b = this.bird;
    integrate(b, h, cfg, this.field.liftAt(cfg.birdX));
    const points = this.field.update(h, this.speed, this.gap, this.rng, b.y);
    const got = this.field.flowersGot;
    if (points > 0) {
      this.obstaclePoints += points;
      this.events.push('score');
    }
    if (got > 0) {
      this.flowers += got * this.ruleset.points.flower;
      this.events.push('flower');
    }
    this.score = this.obstaclePoints + this.flowers;

    const r = cfg.birdRadius;
    const half = cfg.laneH / 2;
    let end: EndReason | null = null;
    if (this.field.hits(cfg.birdX, b.y, r)) {
      end = 'hit';
    } else if (b.y - r <= -half) {
      if (!cfg.softBounds) end = 'floor';
      else {
        // Soft floor: put the bird back on it and pop it up gently.
        b.y = -half + r;
        b.vy = cfg.flapVelocity * 0.6;
        this.events.push('bounce');
      }
    } else if (b.y + r >= half) {
      if (!cfg.softBounds) end = 'ceiling';
      else {
        // Soft ceiling: stop the climb; gravity takes over.
        b.y = half - r;
        if (b.vy > 0) b.vy = 0;
        this.events.push('bounce');
      }
    }

    this.tick++;
    if (end) return this.gameOver(end);
    if (this.tick >= this.ruleset.maxTicks) return this.gameOver('maxTicks');
    if (this.tick % CHECKPOINT_TICKS === 0) this.checkpoints.push(this.stateHash());
  }

  /** FNV-1a of the bird, the counters, the generator and every obstacle field. */
  stateHash(): string {
    const h = this.fnv.reset();
    h.f64(this.bird.y).f64(this.bird.vy);
    h.f64(this.tick).f64(this.obstaclePoints).f64(this.flowers).f64(this.score);
    h.f64(this.injectedRng ? 0 : this.prng.state);
    this.field.hashInto(h);
    return h.hex();
  }

  /** The result of the current round as it stands. */
  result(endReason: RunResult['endReason']): RunResult {
    return {
      valid: true,
      score: this.score,
      obstaclePoints: this.obstaclePoints,
      flowers: this.flowers,
      impact: impactPoints(this.score, this.mode, this.ruleset),
      endTick: this.tick,
      endReason,
      hash: this.stateHash(),
      checkpoints: this.checkpoints.slice(),
    };
  }

  private doFlap(): void {
    flap(this.bird, this.cfg);
    this.events.push('flap');
    // Record each tick once: several flaps between two steps act as one.
    const n = this.flaps.length;
    if (n === 0 || this.flaps[n - 1] !== this.tick) this.flaps.push(this.tick);
  }

  private pause(): void {
    this.resumeState = this.state === 'ready' ? 'ready' : 'playing';
    this.setState('paused');
  }

  private gameOver(reason: EndReason): void {
    this.endReason = reason;
    if (reason !== 'maxTicks') this.events.push('hit');
    this.newBest = this.score > this.best;
    if (this.newBest) {
      this.best = this.score;
      this.events.push('newBest');
    }
    this.lastRun = {
      rulesetId: this.ruleset.id,
      mode: this.mode,
      seed: this.seed,
      flaps: this.flaps.slice(),
      endTick: this.tick,
    };
    this.lastResult = this.result(reason);
    this.setState('gameOver');
  }

  private toReady(): void {
    this.resetRound();
    this.setState('ready');
  }

  private resetRound(): void {
    if (this.seedUsed) {
      this.seed = (this.nextSeed ? this.nextSeed() : mixSeed(this.seed)) >>> 0;
      this.seedUsed = false;
    }
    this.prng.seed(this.seed);
    this.bird.y = 0;
    this.bird.vy = 0;
    this.score = 0;
    this.obstaclePoints = 0;
    this.flowers = 0;
    this.tick = 0;
    this.flaps.length = 0;
    this.checkpoints.length = 0;
    this.endReason = null;
    this.newBest = false;
    this.acc = 0;
    this.field.reset();
  }

  private setState(s: GameState): void {
    this.state = s;
    this.stateTime = 0;
    this.events.push('state');
  }
}
