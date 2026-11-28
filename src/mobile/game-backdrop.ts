// What the game draws around the lane, in lane units: the sky, the event plaza, the ground and
// the flower strip (addGameBackdrop), and the camera's frame (laneFrame). view.ts builds the
// game with them, and the model viewer (?debug=1&rig=1&model=v2&bg=game) draws Joud in front of
// the same backdrop.
//
// A module of its own, not part of view.ts, because the viewer cannot import from the play/
// entry's chunk (see model-gate.ts): model-gate.ts imports this module and hands it to the viewer.

import { Color, Float32BufferAttribute, Mesh, MeshBasicMaterial, type Object3D, PlaneGeometry } from 'three';
import { BRAND, buildFlowerStrip } from '../scene/scenery';
import { buildFacade, buildPlazaRow, FAR_METRE, NEAR_METRE } from './backdrop';

/** Ground and flowers visible under the lane. */
const GROUND_MARGIN = 0.22;

/** Vertical gradient plane (sky). */
function gradientPlane(w: number, h: number, top: Color, bottom: Color): Mesh {
  const g = new PlaneGeometry(w, h, 1, 1);
  const col: number[] = [];
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const c = pos.getY(i) > 0 ? top : bottom;
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return new Mesh(g, new MeshBasicMaterial({ vertexColors: true }));
}

/** The colour around the lane's sky (the scene background). */
export function gameBackground(): Color {
  return new Color(BRAND.sky).lerp(new Color('#ffffff'), 0.55);
}

export interface GameBackdrop {
  facade: Mesh;
  plaza: Mesh;
  strip: Mesh;
}

/**
 * Everything behind the lane, in lane units (the lane is centred on 0, `laneH` tall): the sky,
 * the event plaza's façade and booths, the ground and the flower strip under the lane. Shared
 * with the model viewer (`?debug=1&rig=1&model=v2&bg=game`), which draws Joud in front of it.
 */
export function addGameBackdrop(parent: Object3D, laneH: number, scenery: boolean): GameBackdrop {
  const skyTop = new Color(BRAND.sky).lerp(new Color('#ffffff'), 0.45);
  const skyBottom = new Color(BRAND.butter).lerp(new Color('#ffffff'), 0.25);
  const sky = gradientPlane(8, laneH + 0.02, skyTop, skyBottom);
  sky.position.z = -2;
  parent.add(sky);

  // The event plaza (src/mobile/backdrop.ts): façade far back, booths and palms nearer.
  const layerMat = new MeshBasicMaterial({ vertexColors: true });
  const facade = new Mesh(buildFacade(), layerMat);
  facade.scale.set(FAR_METRE, FAR_METRE, 1);
  facade.position.set(0, -laneH / 2, -1.9);
  const plaza = new Mesh(buildPlazaRow(), layerMat);
  plaza.scale.set(NEAR_METRE, NEAR_METRE, 1);
  plaza.position.set(0, -laneH / 2, -1.7);
  plaza.visible = scenery;
  parent.add(facade, plaza);

  const ground = new Mesh(new PlaneGeometry(8, 3), new MeshBasicMaterial({ color: BRAND.leafGreen }));
  ground.position.set(0, -laneH / 2 - 1.5, -1.5);
  parent.add(ground);

  // The VR strip is 0.3 tall at its own scale; here it fills the ground margin.
  const strip = new Mesh(buildFlowerStrip(2.4 / 0.45, 0.3), new MeshBasicMaterial({ vertexColors: true }));
  const k = (GROUND_MARGIN * 0.8) / 0.3;
  strip.scale.set(0.45 * k * 0.5, k * 0.5, 0.01);
  strip.position.set(0, -laneH / 2 - GROUND_MARGIN * 0.75, -1);
  strip.visible = scenery;
  parent.add(strip);
  return { facade, plaza, strip };
}

/**
 * The game camera's frame for a w × h canvas, in lane units: the lane and the ground under it
 * fit inside (contain), centred on x 0 and on y `cy`.
 */
export function laneFrame(laneW: number, laneH: number, w: number, h: number): { halfW: number; halfH: number; cy: number } {
  const aspect = w / Math.max(1, h);
  const needW = laneW;
  const needH = laneH + GROUND_MARGIN;
  let halfW: number;
  let halfH: number;
  if (aspect > needW / needH) {
    halfH = needH / 2;
    halfW = halfH * aspect;
  } else {
    halfW = needW / 2;
    halfH = halfW / aspect;
  }
  return { halfW, halfH, cy: -GROUND_MARGIN / 2 };
}

/** `?debug=1&birdScale=`: a size between 0.5 and 2 for the drawn bird; anything else is 1. */
export function parseBirdScale(value: string | null): number {
  const n = Number(value);
  if (value === null || value.trim() === '' || !Number.isFinite(n) || n <= 0) return 1;
  return Math.max(0.5, Math.min(2, n));
}
