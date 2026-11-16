import { type Config, DEFAULT_MODE, gapForScore, type Mode, speedForScore } from './config';
import type { GameCommand } from './input';
import { ObstacleField, type Rng } from './obstacles';
import { type Body, flap, integrate } from './physics';

export type GameState = 'attract' | 'ready' | 'playing' | 'gameOver' | 'paused';

/** Things the shell may react to (sound, haptics, animation). */
export type GameEvent = 'flap' | 'score' | 'hit' | 'bounce' | 'newBest' | 'state' | 'mode';

export interface GameOptions {
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
 */
export class Game {
  state: GameState = 'attract';
  /** State to return to when leaving `paused`. */
  resumeState: 'ready' | 'playing' = 'playing';
  /** Simulated seconds spent in the current state. */
  stateTime = 0;
  readonly bird: Body = { y: 0, vy: 0 };
  readonly field: ObstacleField;
  score = 0;
  best: number;
  /** True when the last round set a new best. */
  newBest = false;
  /** Events since the shell last drained them. */
  readonly events: GameEvent[] = [];

  mode: Mode;

  private acc = 0;
  private readonly rng: Rng;
  private _cfg: Readonly<Config>;

  constructor(cfg: Readonly<Config>, opts: GameOptions = {}) {
    this._cfg = cfg;
    this.rng = opts.rng ?? Math.random;
    this.best = opts.best ?? 0;
    this.mode = opts.mode ?? DEFAULT_MODE;
    this.field = new ObstacleField(cfg);
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
    this.field.setConfig(cfg);
    this.resetRound();
    this.events.push('mode');
    return true;
  }

  get speed(): number {
    return speedForScore(this.score, this.cfg);
  }

  get gap(): number {
    return gapForScore(this.score, this.cfg);
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
   * Advance by a real frame time. Runs whole fixed steps; leftover time
   * carries to the next frame. Returns the number of steps run.
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

  /** One fixed simulation step. */
  step(h: number): void {
    this.stateTime += h;
    if (this.state !== 'playing') return;

    integrate(this.bird, h, this.cfg);
    const points = this.field.update(h, this.speed, this.gap, this.rng);
    if (points > 0) {
      this.score += points;
      this.events.push('score');
    }

    const r = this.cfg.birdRadius;
    const half = this.cfg.laneH / 2;
    const b = this.bird;
    if (this.field.hits(this.cfg.birdX, b.y, r)) {
      this.gameOver();
      return;
    }
    if (b.y - r <= -half) {
      if (!this.cfg.softBounds) return this.gameOver();
      // Soft floor: put the bird back on it and pop it up gently.
      b.y = -half + r;
      b.vy = this.cfg.flapVelocity * 0.6;
      this.events.push('bounce');
    } else if (b.y + r >= half) {
      if (!this.cfg.softBounds) return this.gameOver();
      // Soft ceiling: stop the climb; gravity takes over.
      b.y = half - r;
      if (b.vy > 0) b.vy = 0;
      this.events.push('bounce');
    }
  }

  private doFlap(): void {
    flap(this.bird, this.cfg);
    this.events.push('flap');
  }

  private pause(): void {
    this.resumeState = this.state === 'ready' ? 'ready' : 'playing';
    this.setState('paused');
  }

  private gameOver(): void {
    this.events.push('hit');
    this.newBest = this.score > this.best;
    if (this.newBest) {
      this.best = this.score;
      this.events.push('newBest');
    }
    this.setState('gameOver');
  }

  private toReady(): void {
    this.resetRound();
    this.setState('ready');
  }

  private resetRound(): void {
    this.bird.y = 0;
    this.bird.vy = 0;
    this.score = 0;
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
