// Autopilot for fixtures and tests. It reads core state and decides, between ticks,
// whether to flap, like a player would. Not used by the shells.

import type { Game } from './game';
import type { Obstacle } from './obstacles';

export interface BotStyle {
  /** Take a fork's risky gap. */
  risky: boolean;
  /** Seconds of look-ahead on the bird's vertical speed. */
  lead: number;
  /** Flap when the predicted height is this far below the target. */
  slack: number;
  /** Extra upward aim, as a fraction of the gap's free room (flower hunting). */
  aim: number;
}

export const DEFAULT_BOT: BotStyle = { risky: false, lead: 0.12, slack: 0.04, aim: 0 };

/** The obstacle the bird must clear next (its trailing edge not yet behind the whole bird). */
export function nextObstacle(game: Game): Obstacle | null {
  const half = game.cfg.pipeWidth / 2;
  const bx = game.cfg.birdX + game.cfg.birdRadius;
  let next: Obstacle | null = null;
  for (const o of game.field.pool) {
    if (!o.active || o.x - half > bx) continue;
    if (!next || o.x > next.x) next = o;
  }
  return next;
}

/** The obstacle after `o` (the next one further from the bird). */
function following(game: Game, o: Obstacle): Obstacle | null {
  let best: Obstacle | null = null;
  for (const p of game.field.pool) {
    if (!p.active || p.x >= o.x) continue;
    if (!best || p.x > best.x) best = p;
  }
  return best;
}

function aimOf(o: Obstacle, risky: boolean): { y: number; gap: number } {
  const useRisky = o.gap2 > 0 && risky;
  return { y: useRisky ? o.gap2Y : o.gapY, gap: useRisky ? o.gap2 : o.gap };
}

export function botWantsFlap(game: Game, style: BotStyle = DEFAULT_BOT): boolean {
  const cfg = game.cfg;
  const r = cfg.birdRadius;
  const b = game.bird;
  const o = nextObstacle(game);
  let target = 0;
  let ceiling = cfg.laneH / 2 - r - 0.02;
  let floor = -cfg.laneH / 2 + r + 0.02;
  if (o) {
    const cur = aimOf(o, style.risky);
    const free = cur.gap - 2 * r;
    target = cur.y + style.aim * free * 0.5;
    const half = cfg.pipeWidth / 2;
    // An updraft column in front of the gate counts as part of it.
    if (o.x + half + o.updraft >= cfg.birdX - r - 0.12) {
      // Near or inside the pipe: stay inside this gap, over its whole swing if it moves.
      let lo = cur.y;
      let hi = cur.y;
      if (o.moveAmp > 0) {
        const dt = game.ruleset.step;
        const until = (cfg.birdX + r - (o.x - half)) / game.speed;
        let my = o.moveY;
        let dir = o.moveDir;
        for (let t = 0; t < until; t += dt) {
          my += dir * game.ruleset.kinds.movingSpeed * dt;
          if (my > o.moveAmp) dir = -1;
          if (my < -o.moveAmp) dir = 1;
          lo = Math.min(lo, o.baseY + my);
          hi = Math.max(hi, o.baseY + my);
        }
        target = (lo + hi) / 2;
      }
      ceiling = lo + cur.gap / 2 - r - 0.005;
      floor = hi - cur.gap / 2 + r + 0.005;
      // Lean towards the next gap, staying in this one.
      const after = following(game, o);
      if (after && o.x + half >= cfg.birdX - r - 0.06) {
        const lean = free * 0.4;
        const nextY = aimOf(after, style.risky).y;
        if (nextY > target + lean) target += lean;
        else if (nextY < target - lean) target -= lean;
        else target = nextY;
      }
    }
  }
  // Highest point if we flap now, simulated forward: updraft columns slide towards the
  // bird with the obstacles and lower the effective gravity while it is inside one.
  const v0 = cfg.flapVelocity;
  const dt = game.ruleset.step;
  const speed = game.speed;
  let y = b.y;
  let vy = v0;
  let shift = 0;
  for (let i = 0; i < 120 && vy > 0; i++) {
    shift += speed * dt;
    vy += (cfg.gravity + game.field.liftAt(cfg.birdX - shift)) * dt;
    y += vy * dt;
  }
  if (y > ceiling) return false;
  const predicted = b.y + b.vy * style.lead;
  if (b.y < floor + 0.01 && b.vy < 0) return true;
  return predicted < target - style.slack && b.vy < v0 * 0.25;
}
