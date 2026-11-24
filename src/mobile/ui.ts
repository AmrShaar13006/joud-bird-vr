// DOM screens of the phone game: home, HUD, pause, game over, rotate. Arabic, RTL,
// Latin digits. Reads state; buttons call back into main.ts.

import { MODES, type Mode } from '../core/config';
import type { Game } from '../core/game';
import { M } from './strings';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

export interface UiHandlers {
  onMode(mode: Mode): void;
  onPractice(on: boolean): void;
  onPlay(): void;
  onPause(): void;
  onResume(): void;
  onAgain(): void;
  onHome(): void;
  onMute(): void;
  onBoard(): void;
  onNames(): void;
  onBack(): void;
  onPickName(nicknameId: number): void;
}

/** Where a finished ranked round stands with the server. */
export type OverStatus = 'verifying' | 'verified' | 'rejected' | 'queued' | null;
/** A screen shown over home or game over. */
export type Overlay = 'board' | 'names' | null;

export interface BoardView {
  rows: { rank: number; nickname: string; score: number }[];
  me: { rank: number; score: number } | null;
  total: number | null;
  offline: boolean;
}

export interface UiContext {
  mode: Mode;
  practice: boolean;
  muted: boolean;
  /** Best ranked score in this mode on this device. */
  best: number;
  /** The last round was a practice round. */
  lastPractice: boolean;
  multiplier: (m: Mode) => number;
  impact: number;
  landscape: boolean;
  /** Ranked play is possible (server configured): show the leaderboard and name buttons. */
  online: boolean;
  /** This round asked for ranked but had no ticket, so it is practice. */
  offlineRound: boolean;
  status: OverStatus;
  overlay: Overlay;
  /** «nickname tag», or null before one is picked. */
  nickname: string | null;
}

export class MobileUi {
  readonly frame = $('frame');
  readonly canvas = $<HTMLCanvasElement>('game');
  private readonly hud = $('hud');
  private readonly score = $('score');
  private readonly practiceBadge = $('practice-badge');
  private readonly tapHint = $('tap-hint');
  private readonly pop = $('pop');
  private readonly home = $('home');
  private readonly paused = $('paused');
  private readonly over = $('over');
  private readonly rotate = $('rotate');
  private readonly board = $('board');
  private readonly names = $('names');
  private readonly nameButtons: HTMLButtonElement[] = [];
  private readonly modeButtons = new Map<Mode, HTMLButtonElement>();
  private readonly practice = $<HTMLInputElement>('practice');
  readonly debug = $('debug');
  private lastScore = -1;

  constructor(private readonly h: UiHandlers, multiplier: (m: Mode) => number) {
    $('home-title').textContent = M.title;
    $('home-mascot').textContent = M.mascot;
    $('home-tagline').textContent = M.tagline;
    $('home-choose').textContent = M.chooseMode;
    $('practice-label').textContent = M.practice;
    $('play-btn').textContent = M.play;
    $('pause-btn').setAttribute('aria-label', M.pause);
    $('paused-title').textContent = M.paused;
    $('resume-btn').textContent = M.resume;
    $('paused-home-btn').textContent = M.home;
    $('over-title').textContent = M.roundOver;
    $('over-score-label').textContent = M.score;
    $('over-flowers-label').textContent = M.flowers;
    $('over-impact-label').textContent = M.impact;
    $('again-btn').textContent = M.again;
    $('over-home-btn').textContent = M.home;
    $('rotate-title').textContent = M.rotate;
    $('rotate-hint').textContent = M.rotateHint;
    this.tapHint.textContent = M.tapToFly;
    this.practiceBadge.textContent = M.practiceRound;
    $('board-btn').textContent = M.leaderboard;
    $('over-board-btn').textContent = M.leaderboard;
    $('board-title').textContent = M.leaderboard;
    $('board-back-btn').textContent = M.back;
    $('names-title').textContent = M.chooseName;
    $('names-hint').textContent = M.nameHint;
    $('names-back-btn').textContent = M.back;
    const grid = $('names-grid');
    M.nicknames.forEach((label, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => h.onPickName(i + 1));
      grid.appendChild(b);
      this.nameButtons.push(b);
    });

    const modes = $('modes');
    for (const m of MODES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = M.modeButton(m, multiplier(m));
      b.addEventListener('click', () => h.onMode(m));
      modes.appendChild(b);
      this.modeButtons.set(m, b);
    }
    this.practice.addEventListener('change', () => h.onPractice(this.practice.checked));
    $('play-btn').addEventListener('click', () => h.onPlay());
    $('pause-btn').addEventListener('click', () => h.onPause());
    $('resume-btn').addEventListener('click', () => h.onResume());
    $('paused-home-btn').addEventListener('click', () => h.onHome());
    $('again-btn').addEventListener('click', () => h.onAgain());
    $('over-home-btn').addEventListener('click', () => h.onHome());
    $('mute-btn').addEventListener('click', () => h.onMute());
    $('board-btn').addEventListener('click', () => h.onBoard());
    $('over-board-btn').addEventListener('click', () => h.onBoard());
    $('name-btn').addEventListener('click', () => h.onNames());
    $('board-back-btn').addEventListener('click', () => h.onBack());
    $('names-back-btn').addEventListener('click', () => h.onBack());
  }

  /** Fill the leaderboard screen. Names are text nodes: never parsed as HTML. */
  showBoard(mode: Mode, view: BoardView): void {
    $('board-mode').textContent = M.modeName[mode];
    const list = $('board-list');
    list.replaceChildren();
    for (const r of view.rows) {
      const li = document.createElement('li');
      if (r.rank <= 3) li.className = 'top';
      const who = document.createElement('span');
      who.textContent = `${r.rank}. ${r.nickname}`;
      const score = document.createElement('span');
      score.className = 'num';
      score.textContent = String(r.score);
      li.append(who, score);
      list.appendChild(li);
    }
    if (view.rows.length === 0) {
      const li = document.createElement('li');
      li.textContent = view.offline ? M.boardOffline : M.boardEmpty;
      list.appendChild(li);
    }
    $('board-me').textContent = view.me ? M.myRank(view.me.rank, view.me.score) : '';
    $('board-total').textContent = view.total === null ? '' : `${M.impactTotal}: ${view.total}`;
  }

  /** Mark the current nickname in the picker. */
  showNames(selected: number | null): void {
    this.nameButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i + 1 === selected)));
  }

  /** Short "+N" above the score. */
  showPop(text: string): void {
    this.pop.textContent = text;
    this.pop.classList.remove('show');
    void this.pop.offsetWidth; // restart the animation
    this.pop.classList.add('show');
  }

  update(game: Game, ctx: UiContext): void {
    const s = game.state;
    const shown = ctx.landscape ? 'rotate' : ctx.overlay && (s === 'attract' || s === 'gameOver') ? ctx.overlay : s;
    this.rotate.hidden = !ctx.landscape;
    this.board.hidden = shown !== 'board';
    this.names.hidden = shown !== 'names';
    this.home.hidden = shown !== 'attract';
    this.paused.hidden = shown !== 'paused';
    this.over.hidden = shown !== 'gameOver';
    this.hud.hidden = !(shown === 'ready' || shown === 'playing');
    this.tapHint.hidden = shown !== 'ready';
    this.practiceBadge.hidden = !(ctx.practice && (shown === 'ready' || shown === 'playing'));
    this.practiceBadge.textContent = ctx.offlineRound ? M.offlinePractice : M.practiceRound;

    if (game.score !== this.lastScore) {
      this.lastScore = game.score;
      this.score.textContent = String(game.score);
    }

    if (shown === 'attract') {
      for (const [m, b] of this.modeButtons) b.setAttribute('aria-pressed', String(m === ctx.mode));
      this.practice.checked = ctx.practice;
      $('home-best').textContent = ctx.practice ? M.practiceHint : M.best(ctx.best);
      $('mute-btn').textContent = ctx.muted ? M.soundOff : M.soundOn;
      $('board-btn').hidden = !ctx.online;
      const nameBtn = $('name-btn');
      nameBtn.hidden = !ctx.online;
      nameBtn.textContent = ctx.nickname ? M.myName(ctx.nickname) : M.chooseName;
    } else if (shown === 'gameOver') {
      $('over-score').textContent = String(game.score);
      $('over-flowers').textContent = String(game.flowers);
      $('over-impact').textContent = ctx.lastPractice ? '—' : String(ctx.impact);
      $('over-title').textContent = ctx.lastPractice ? M.practiceRound : M.roundOver;
      $('over-board-btn').hidden = !ctx.online;
      const status = $('over-status');
      status.hidden = ctx.status === null;
      status.className = ctx.status === 'verified' ? 'status ok' : 'status';
      status.textContent =
        ctx.status === 'verifying'
          ? M.verifying
          : ctx.status === 'verified'
            ? M.verified
            : ctx.status === 'rejected'
              ? M.rejected
              : ctx.status === 'queued'
                ? M.queued
                : '';
      $('over-line').textContent = ctx.lastPractice
        ? M.practiceHint
        : game.newBest
          ? M.newBest
          : game.score >= 10
            ? M.goodScore
            : M.anyScore;
    }
  }
}
