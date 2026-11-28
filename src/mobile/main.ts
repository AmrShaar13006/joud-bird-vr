// Joud Bird on phones: a portrait, one-tap game on the same src/core as the VR pages.
// Plain three (the same super-three), no IWSDK, no WebXR. Docs: docs/mobile.md.

import './rig-gate'; // first: on ?debug=1&rig=1 it shows the rig prototype and the game never starts
import './mobile.css';
import { WebGLRenderer } from 'three';
import { isMode, type Mode, parseUrl } from '../core/config';
import { Game } from '../core/game';
import { type GameCommand, InputBus } from '../core/input';
import { impactPoints } from '../core/ruleset';
import type { Net } from './net';
import { Outbox, RetryLater, Tickets, type Transport } from './online';
import { getRunSpec, type MobileRunSpec, RULESET, recordRun } from './run-spec';
import { chooseTier, FrameWatchdog, lowerTier, parseTier, type Tier, TIER_SETTINGS } from './perf';
import { SoundEngine } from './sound/engine';
import { loadSoundSettings, saveSoundSetting } from './sound/settings';
import { M } from './strings';
import { type BoardView, MobileUi, type Overlay, type OverStatus } from './ui';
import { MobileView } from './view';

// ---------- settings ----------
const url = parseUrl(window.location.search); // flags and ?mode= only: ranked rules never take URL tuning
const STORE = 'joudbird.mobile';
const store = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(`${STORE}.${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(`${STORE}.${key}`, value);
    } catch {
      // storage blocked: settings just won't persist
    }
  },
};
const bestKey = (m: Mode) => `${RULESET.id}.best.${m}`;
const loadBest = (m: Mode) => {
  const n = Number(store.get(bestKey(m)));
  return Number.isInteger(n) && n > 0 ? n : 0;
};

const savedMode = store.get('mode');
let mode: Mode = url.applied.includes('mode') ? url.mode : isMode(savedMode) ? savedMode : url.mode;
let practice = store.get('practice') === '1';
let spec: MobileRunSpec = getRunSpec(mode, practice);

// ---------- core ----------
const game = new Game(RULESET.modes[mode], {
  ruleset: RULESET,
  mode,
  seed: spec.seed,
  best: loadBest(mode),
});
const bus = new InputBus();
// ?debug=1 only: the game on window.__joudGame, read by screenshot scripts (e.g. wait for a fork).
if (url.flags.debug) (window as unknown as { __joudGame?: Game }).__joudGame = game;
const sound = new SoundEngine(loadSoundSettings(store, url.flags.mute));
// ?debug=1&sounds=1: a panel that plays every sound (lazy, debug only).
if (url.flags.debug && new URLSearchParams(window.location.search).get('sounds') === '1') {
  void import('./sound/sampler').then((m) => m.mountSampler(sound));
}

// ---------- ranked play: server tickets and verified runs (step 2, docs/server.md) ----------
// Without VITE_SUPABASE_URL / _PUBLISHABLE_KEY (or without a ticket) every round is practice.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const online = !!(SUPABASE_URL && SUPABASE_KEY);
let netLoading: Promise<Net | null> | null = null;
/** net.ts (and supabase-js) load on first use, never before the first frame. */
function getNet(): Promise<Net | null> {
  if (!online) return Promise.resolve(null);
  netLoading ??= import('./net').then((m) => m.createNet(SUPABASE_URL!, SUPABASE_KEY!)).catch(() => null);
  return netLoading;
}
const transport: Transport = {
  async issue(m) {
    const n = await getNet();
    if (!n) throw new RetryLater('no server');
    return n.issue(m);
  },
  async submit(r) {
    const n = await getNet();
    if (!n) throw new RetryLater('no server');
    return n.submit(r);
  },
};
const tickets = new Tickets(transport, RULESET.id);
const outbox = new Outbox(transport, { get: () => store.get('outbox'), set: (v) => store.set('outbox', v) });
let overStatus: OverStatus = null;
let overlay: Overlay = null;
/** Signed in to the server: ranked play, the leaderboard and nicknames are available. */
let signedIn = false;
let nicknameId: number | null = null;
let nicknameTag: number | null = null;
/** «العب» was pressed before a nickname was picked: start once one is. */
let pendingStart = false;
const boardCache = new Map<Mode, { at: number; view: BoardView }>();

/** Sign in, learn the nickname, keep a ticket ready and send queued runs. */
function warmUp(): void {
  void getNet().then(async (n) => {
    if (!n || !(await n.signIn())) return;
    signedIn = true;
    const p = await n.profile();
    if (p) {
      nicknameId = p.nicknameId;
      nicknameTag = p.tag;
    }
    if (!practice) void tickets.prefetch(mode);
    void outbox.flush();
  });
}

async function openBoard(): Promise<void> {
  overlay = 'board';
  sound.tick();
  const cached = boardCache.get(mode);
  if (cached && performance.now() - cached.at < 60_000) return ui.showBoard(mode, cached.view);
  ui.showBoard(mode, { rows: [], me: null, total: null, offline: !navigator.onLine });
  const n = await getNet();
  if (!n) return;
  const forMode = mode;
  const [rows, me, total] = await Promise.all([
    n.leaderboard(forMode, RULESET.id),
    n.myBest(forMode, RULESET.id),
    n.impactTotal(),
  ]);
  const view: BoardView = { rows, me, total, offline: rows.length === 0 && total === null };
  if (total !== null) boardCache.set(forMode, { at: performance.now(), view });
  if (overlay === 'board' && mode === forMode) ui.showBoard(forMode, view);
}

/** Ranked play needs a nickname first (shown on the leaderboard). */
function needsName(): boolean {
  return signedIn && !practice && nicknameId === null;
}

// ---------- view ----------
const ui = new MobileUi(
  {
    onMode(m) {
      if (game.state !== 'attract') return;
      mode = m;
      store.set('mode', m);
      game.configure(RULESET.modes[m], m, loadBest(m));
      view.setConfig(game.cfg);
      sound.tick();
      if (!practice) void tickets.prefetch(m);
    },
    onPractice(on) {
      practice = on;
      store.set('practice', on ? '1' : '0');
      if (!on) void tickets.prefetch(mode);
    },
    onPlay() {
      if (needsName()) {
        pendingStart = true;
        overlay = 'names';
        ui.showNames(null);
        return;
      }
      bus.push('start');
    },
    onPause: () => bus.push('pause'),
    onResume: () => bus.push('pause'),
    onAgain: () => bus.push('restart'),
    onHome() {
      game.toAttract();
      game.best = loadBest(mode);
    },
    onSound(which) {
      sound.set(which, !sound.settings[which]);
      saveSoundSetting(store, which, sound.settings[which]);
      sound.tick();
    },
    onBoard: () => void openBoard(),
    onNames() {
      overlay = 'names';
      ui.showNames(nicknameId);
      sound.tick();
    },
    onBack() {
      overlay = null;
      pendingStart = false;
      sound.tick();
    },
    onPickName(id) {
      sound.tick();
      void getNet().then(async (n) => {
        const saved = !!n && (await n.setNickname(id));
        if (saved) {
          nicknameId = id;
          nicknameTag = (await n!.profile())?.tag ?? nicknameTag;
          boardCache.clear();
        }
        // Saved or not (offline), never leave the player stuck: start the round anyway.
        overlay = null;
        if (pendingStart) {
          pendingStart = false;
          bus.push(game.state === 'gameOver' ? 'restart' : 'start');
        }
      });
    },
  },
  (m) => RULESET.multipliers[m],
);

// ---------- render tier (rendering only; the sim is the same on every phone) ----------
const forcedTier = parseTier(new URLSearchParams(window.location.search).get('tier'));
let tier: Tier =
  forcedTier ??
  chooseTier({
    cores: navigator.hardwareConcurrency || 0,
    memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0,
    screenW: window.screen.width,
    screenH: window.screen.height,
    dpr: window.devicePixelRatio || 1,
  });
const startTier = TIER_SETTINGS[tier];
const watchdog = new FrameWatchdog();

const renderer = new WebGLRenderer({
  canvas: ui.canvas,
  antialias: startTier.antialias,
  powerPreference: 'high-performance',
});
const view = new MobileView(game.cfg, {
  model: url.flags.model === 'joud' && startTier.birdGlb,
  glbUrl: new URL('../models/joud.glb', window.location.href).href,
  fx: url.flags.fx && startTier.effects,
  scenery: startTier.scenery,
  atlasScale: tier === 'low' ? 0.5 : 1,
  points: RULESET.points,
});

/** Apply a tier's settings (antialias stays as created: a context can't change it). */
function applyTier(t: Tier): void {
  const s = TIER_SETTINGS[t];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, s.pixelRatio));
  view.setEffects(url.flags.fx && s.effects);
  view.setScenery(s.scenery);
  view.setBirdDetail(url.flags.model === 'joud' && s.birdGlb);
  resize();
}
game.beforeStep = () => {
  view.snapshot(game);
  if (autoplay) autopilotTick();
};

function resize(): void {
  const w = ui.frame.clientWidth;
  const h = ui.frame.clientHeight;
  renderer.setSize(w, h, false);
  view.resize(w, h);
}
new ResizeObserver(resize).observe(ui.frame);
applyTier(tier);

// ---------- rounds and seeds ----------
/** True if `cmd` will start a new round from the current state. */
function startsRound(cmd: GameCommand): boolean {
  switch (game.state) {
    case 'attract':
      return cmd === 'flap' || cmd === 'start' || cmd === 'restart';
    case 'gameOver':
      return cmd === 'restart' || ((cmd === 'flap' || cmd === 'start') && game.canRestartWithTrigger);
    case 'paused':
      return cmd === 'restart';
    default:
      return false;
  }
}

let roundPractice = practice;
function handle(cmd: GameCommand): void {
  if (startsRound(cmd)) {
    // One place decides a round's seed: getRunSpec (server-issued in step 2).
    // Ranked rounds use the ticket kept ready for this mode; without one the round is practice.
    spec = getRunSpec(mode, practice, practice ? null : tickets.take(mode));
    roundPractice = spec.practice;
    overStatus = null;
    if (!practice) void tickets.prefetch(mode);
    game.setSeed(spec.seed);
    game.best = roundPractice ? Number.MAX_SAFE_INTEGER : loadBest(mode);
  }
  const before = game.state;
  game.handle(cmd);
  if (before === 'paused' && game.state === 'playing') view.resetInterpolation(game);
}

// ---------- input ----------
let audioUnlocked = false;
function unlockAudio(): void {
  if (audioUnlocked && sound.unlocked) return;
  sound.unlock();
  audioUnlocked = true;
}

ui.frame.addEventListener('pointerdown', (e) => {
  unlockAudio();
  if ((e.target as Element).closest('button, input, label')) return;
  if (game.state === 'ready' || game.state === 'playing') {
    e.preventDefault();
    bus.push('flap');
  }
});
// iOS unlocks audio on touchend/click, not on touchstart.
window.addEventListener('pointerup', unlockAudio);
window.addEventListener('click', unlockAudio);
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  unlockAudio();
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    bus.push(game.state === 'attract' ? 'start' : 'flap');
  } else if (e.code === 'Enter' && (game.state === 'attract' || game.state === 'gameOver')) {
    bus.push(game.state === 'attract' ? 'start' : 'restart');
  } else if (e.code === 'Escape' || e.code === 'KeyP') {
    bus.push('pause');
  }
});
// No long-press menu, double-tap zoom, pinch or scroll.
for (const type of ['contextmenu', 'dblclick', 'gesturestart', 'selectstart'] as const) {
  window.addEventListener(type, (e) => e.preventDefault());
}
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

// ---------- debug autoplay (screenshots only) ----------
// ?debug=1&autoplay=1: the core's autopilot flies practice rounds. Never ranked, never
// logged: it forces practice and only exists behind the debug flag.
const autoplay = url.flags.debug && new URLSearchParams(window.location.search).get('autoplay') === '1';
let botWantsFlap: ((g: Game) => boolean) | null = null;
if (autoplay) {
  // Bots play practice, except on a staging build (VITE_STAGING=1) for the E2E test.
  if (import.meta.env.VITE_STAGING !== '1') practice = true;
  void import('../core/bot').then((m) => {
    botWantsFlap = (g) => m.botWantsFlap(g);
  });
}
/** Once per frame: start and restart rounds through the bus, like a player. */
function autopilot(): void {
  if (!botWantsFlap) return;
  if (game.state === 'attract') bus.push('start');
  else if (game.state === 'gameOver' && game.stateTime > 2) bus.push('restart');
  else if (game.state === 'ready') bus.push('flap');
}
/** Once per fixed step (from game.beforeStep), so it flies at any frame rate. */
function autopilotTick(): void {
  if (botWantsFlap && game.state === 'playing' && botWantsFlap(game)) game.handle('flap');
}

// ---------- lifecycle ----------
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    game.suspend();
    sound.suspend();
    return;
  }
  sound.resume();
  if (online) {
    if (!practice) void tickets.prefetch(mode);
    void outbox.flush();
  }
});
window.addEventListener('online', warmUp);
if (online) window.addEventListener('load', warmUp);
window.addEventListener('blur', () => game.suspend());
window.addEventListener('pagehide', () => {
  game.suspend();
  sound.suspend();
});

const landscapeQuery = window.matchMedia('(orientation: landscape)');
const touchQuery = window.matchMedia('(pointer: coarse)');
/** A phone held sideways: show «لف جوالك» and pause. */
function phoneLandscape(): boolean {
  return landscapeQuery.matches && touchQuery.matches && Math.min(window.innerWidth, window.innerHeight) < 600;
}

// ---------- loop ----------
let lastPoints = 0;
let lastFlowers = 0;
let last = performance.now();
let hudTimer = 0;
let frames = 0;
let fps = 0;

function frame(now: number): void {
  const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
  last = now;
  const landscape = phoneLandscape();
  if (landscape) game.suspend();

  if (autoplay) autopilot();
  bus.drain(handle);
  game.advance(dt);

  // Frame-time watchdog: one tier down after 3 s averaging over 20 ms. Never up.
  if (game.state === 'playing' && !forcedTier) {
    if (watchdog.frame(dt) && tier !== 'low') {
      tier = lowerTier(tier);
      applyTier(tier);
    }
  } else {
    watchdog.reset();
  }

  for (const e of game.events) {
    switch (e) {
      case 'flap':
        view.bird.onFlap();
        break;
      case 'score': {
        const d = game.obstaclePoints - lastPoints;
        ui.showPop(`+${d}`);
        view.onScore(game, d);
        break;
      }
      case 'flower':
        ui.showPop(`+${game.flowers - lastFlowers} ✿`);
        view.onFlower(game);
        break;
      case 'hit':
        view.bird.onHit();
        break;
      case 'state':
        if (game.state === 'ready') view.resetInterpolation(game);
        if (game.state === 'gameOver' && game.lastRun && game.lastResult) {
          recordRun({ ...spec, practice: roundPractice }, game.lastRun, game.lastResult, url.flags.debug);
          if (!roundPractice && spec.ticketId && spec.ticketExpiresAt) {
            // The server replays the flaps; its verdict is the score that counts.
            const ticketId = spec.ticketId;
            overStatus = 'verifying';
            void outbox
              .add({
                ticketId,
                mode: spec.mode,
                flaps: game.lastRun.flaps,
                endTick: game.lastRun.endTick,
                clientScore: game.lastResult.score,
                expiresAt: spec.ticketExpiresAt,
              })
              .then((v) => {
                if (spec.ticketId !== ticketId) return; // a new round has started
                overStatus = v === 'queued' ? 'queued' : v.valid ? 'verified' : 'rejected';
                if (v !== 'queued') boardCache.delete(spec.mode);
                if (url.flags.debug) console.log('[joud] verdict', v);
              });
          }
          if (!roundPractice && game.newBest) store.set(bestKey(mode), String(game.best));
        }
        break;
    }
  }
  sound.frame(game.events, game.obstaclePoints - lastPoints, game.field.passed, game.bird.y / (game.cfg.laneH / 2));
  game.events.length = 0;
  lastPoints = game.obstaclePoints;
  lastFlowers = game.flowers;

  view.sync(game, dt, now / 1000);
  view.render(renderer);
  ui.update(game, {
    mode,
    practice: game.state === 'attract' ? practice : roundPractice,
    sound: sound.settings,
    best: loadBestCached(),
    lastPractice: roundPractice,
    multiplier: (m) => RULESET.multipliers[m],
    impact: game.lastResult ? game.lastResult.impact : impactPoints(game.score, mode, RULESET),
    landscape,
    online: signedIn,
    offlineRound: game.state !== 'attract' && !!spec.offline,
    status: overStatus,
    overlay,
    nickname: nicknameId ? (M.nicknames[nicknameId - 1] + ' ' + (nicknameTag ?? '')).trim() : null,
  });

  if (url.flags.debug) {
    frames++;
    hudTimer += dt;
    if (hudTimer >= 0.25) {
      fps = Math.round(frames / hudTimer);
      frames = 0;
      hudTimer = 0;
      const info = renderer.info.render;
      ui.debug.hidden = false;
      ui.debug.textContent = [
        `fps ${fps}  calls ${info.calls}  tris ${info.triangles}`,
        `${game.state}  tick ${game.tick}  seed ${game.seed}`,
        `${RULESET.id} ${mode}${roundPractice ? ' practice' : ''}  bird ${view.bird.status}`,
        `tier ${tier}${forcedTier ? ' (?tier)' : ''}  dpr ${renderer.getPixelRatio()}  ${ui.frame.clientWidth}×${ui.frame.clientHeight}`,
      ].join('\n');
    }
  }
  requestAnimationFrame(frame);
}

let bestCache = { mode: '' as string, value: 0, at: 0 };
function loadBestCached(): number {
  const now = performance.now();
  if (bestCache.mode !== mode || now - bestCache.at > 1000) bestCache = { mode, value: loadBest(mode), at: now };
  return bestCache.value;
}

requestAnimationFrame(frame);

// ---------- offline ----------
// After the first load the page works offline: the service worker caches what it served.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then(async (reg) => {
        await navigator.serviceWorker.ready;
        // Hand over everything this first load fetched, so it is cached too.
        const urls = performance
          .getEntriesByType('resource')
          .map((r) => r.name)
          .filter((u) => u.startsWith(location.origin));
        (reg.active ?? navigator.serviceWorker.controller)?.postMessage({ type: 'cache', urls: [location.href, ...urls] });
      })
      .catch(() => {
        // no offline support on this browser: the game still works online
      });
  });
}
