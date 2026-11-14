import type { CanvasPanel } from './canvas-panel';
import { hudArt } from './panel-art';

/** What the ?debug=1 HUD shows. Developer-only text (not in strings.ts). */
export interface HudInfo {
  shell: string;
  state: string;
  score: number;
  xr: string;
  profile: string;
  lastButton: number;
  lastCmd: string;
  calls: number;
  tris: number;
  model: string;
  mode: string;
  best: number;
  speed: number;
  gap: number;
  error: string;
}

/**
 * ?debug=1 HUD: a canvas panel in VR, a <pre id="hud"> on desktop.
 * Counts fps every frame; refreshes the text 4 times a second.
 */
export class DebugHud {
  private frames = 0;
  private fpsTime = 0;
  private fps = 0;
  private refresh = 0;
  private readonly lines: string[] = [];
  private readonly el: HTMLElement | null;

  constructor(private readonly panel: CanvasPanel) {
    this.el = document.getElementById('hud');
    if (this.el) this.el.hidden = false;
  }

  /** Call every frame. Returns true when the HUD wants fresh info. */
  tick(delta: number): boolean {
    this.frames++;
    this.fpsTime += delta;
    if (this.fpsTime >= 0.5) {
      this.fps = this.frames / this.fpsTime;
      this.frames = 0;
      this.fpsTime = 0;
    }
    this.refresh += delta;
    if (this.refresh < 0.25) return false;
    this.refresh = 0;
    return true;
  }

  show(i: HudInfo, immersive: boolean): void {
    const l = this.lines;
    l.length = 0;
    l.push(`${i.shell}  fps ${this.fps.toFixed(1)}  state ${i.state}  score ${i.score}`);
    l.push(`xr ${i.xr}`);
    l.push(`profile ${i.profile}`);
    l.push(`last button ${i.lastButton}   last cmd ${i.lastCmd}`);
    l.push(`calls ${i.calls}   tris ${i.tris}`);
    l.push(`bird placeholder (model=${i.model})`);
    l.push(`mode ${i.mode}  best ${i.best}  speed ${i.speed.toFixed(2)}  gap ${i.gap.toFixed(2)}`);
    l.push(`err ${i.error}`);
    if (immersive) {
      this.panel.visible = true;
      this.panel.redraw(hudArt(l));
    } else {
      this.panel.visible = false;
      if (this.el) this.el.textContent = l.join('\n');
    }
  }
}
