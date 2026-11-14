import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';

export type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/**
 * A flat, opaque plane textured with a 2D canvas. Text (including Arabic,
 * which the canvas shapes and lays out right-to-left natively) is drawn with
 * the 2D API and uploaded only when `redraw` is called.
 */
export class CanvasPanel {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: CanvasTexture;
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;

  constructor(widthM: number, heightM: number, px: number, py: number, name: string) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = px;
    this.canvas.height = py;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not available');
    this.ctx = ctx;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = LinearFilter;
    this.texture.anisotropy = 4;
    this.mesh = new Mesh(
      new PlaneGeometry(widthM, heightM),
      new MeshBasicMaterial({ map: this.texture, toneMapped: false }),
    );
    this.mesh.name = name;
  }

  redraw(draw: DrawFn): void {
    const { ctx, canvas } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    draw(ctx, canvas.width, canvas.height);
    this.texture.needsUpdate = true;
  }

  set visible(v: boolean) {
    this.mesh.visible = v;
  }

  get visible(): boolean {
    return this.mesh.visible;
  }
}
