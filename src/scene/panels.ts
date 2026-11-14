import { MODES, type Mode } from '../core/config';
import type { Game, GameState } from '../core/game';
import type { Overlay } from './overlay';
import {
  attractArt,
  gameOverArt,
  type InputMode,
  modeButtonArt,
  pausedArt,
  readyArt,
  scoreArt,
} from './panel-art';
import type { PlayWindow } from './play-window';

export interface PanelOptions {
  /** Show the difficulty buttons on the attract screen. */
  picker: boolean;
  /** Show the recentre button on the attract screen in VR. */
  recentre: boolean;
}

/**
 * Copies game state to the canvas panels and the 2D overlay. Shared by the
 * IWSDK shell and the plain Three.js fallback. Redraws a canvas only when
 * something it shows has changed (each redraw is a texture upload).
 */
export class PanelController {
  private drawnState: GameState | '' = '';
  private drawnInput: InputMode | '' = '';
  private drawnScore = -1;
  private drawnRestart = false;
  private drawnBest = -1;
  private drawnMode: Mode | '' = '';

  constructor(
    private readonly view: PlayWindow,
    private readonly overlay: Overlay,
    private readonly opts: PanelOptions,
  ) {}

  update(game: Game, immersive: boolean): void {
    const v = this.view;
    const input: InputMode = immersive ? 'xr' : 'desktop';
    const st = game.state;
    const canRestart = game.canRestartWithTrigger;
    const changed =
      st !== this.drawnState || input !== this.drawnInput || game.mode !== this.drawnMode;

    if (
      changed ||
      (st === 'gameOver' && canRestart !== this.drawnRestart) ||
      game.best !== this.drawnBest
    ) {
      v.attract.visible = st === 'attract';
      v.ready.visible = st === 'ready';
      v.gameOver.visible = st === 'gameOver';
      v.paused.visible = st === 'paused';
      v.score.visible = st !== 'attract';
      v.recentre.visible = this.opts.recentre && st === 'attract' && immersive;
      this.overlay.setVisible(st === 'attract' && !immersive);
      for (const m of MODES) {
        const b = v.modeButtons[m];
        b.visible = this.opts.picker && st === 'attract';
        if (b.visible) b.redraw(modeButtonArt(m, m === game.mode, input));
      }
      if (st === 'attract') v.attract.redraw(attractArt(game.best, input, this.opts.picker));
      if (st === 'ready') v.ready.redraw(readyArt(input));
      if (st === 'gameOver') {
        v.gameOver.redraw(gameOverArt(game.score, game.best, game.newBest, canRestart, game.mode, input));
      }
      if (st === 'paused') v.paused.redraw(pausedArt(input));
      this.drawnState = st;
      this.drawnInput = input;
      this.drawnRestart = canRestart;
      this.drawnBest = game.best;
      this.drawnMode = game.mode;
    }
    if (game.score !== this.drawnScore) {
      v.score.redraw(scoreArt(game.score));
      this.drawnScore = game.score;
    }
  }
}
