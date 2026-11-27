"""Joud hero model v2, built by script. The script is the source of truth.

Run from the repo root (Blender 4.2 LTS or newer, tested on 5.3):

    blender -b -P tools/blender/build_joud.py
    blender -b -P tools/blender/build_joud.py -- --no-blend      # skip saving the .blend
    blender -b -P tools/blender/build_joud.py -- --with-lenses   # also export see-through lenses

Writes
    public/models/joud-v2.glb    one skinned mesh, one material, 1024 webp atlas, armature,
                                 socket nodes, and the rest_folded pose in the armature's extras
    tools/blender/joud-v2.blend  the same model with every part as its own object (if < 5 MB)

Where things come from
    docs/joud-brief.json                      palette and the locked character decisions
    docs/references/joud_ref_round_front.png  proportions (measured below) and the vest, collar,
                                              flowers, buttons and emblem, projected from the art
    docs/references/joud_ref_flying_poster_crop.png  wing length and the spread pose
    docs/references/joud_ref_slim_side.png    legs, toes and the small tail (side view)

Axes: Blender is Z up and Joud faces -Y; +X is Joud's left. The glTF file is Y up and Joud
faces +Z (the exporter converts). One model unit = the old joud.glb's unit: the body is about
0.6 wide from the centre, so the game's 0.2 scale keeps the 0.12 m collision radius.

Assumptions, for Joud's approval (no reference shows these): the plain back of the vest and the
collar going round the neck; the small three-feather tail; the armhole trim as a ring round the
wing's root; the folded wing's length and hang (the poster's long wing reaches lower than the
round front art's); the lens tint painted on the face instead of see-through lenses.

The script only uses Blender's bundled Python (bpy, bmesh, mathutils, numpy). Nothing it needs
is installed into the game: Blender is a build tool, not a dependency of the web app.
"""

from __future__ import annotations

import json
import math
import os
import struct
import sys
import tempfile

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

# ----------------------------------------------------------------------------------------------
# paths and options
# ----------------------------------------------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
REF_FRONT = os.path.join(REPO, 'docs', 'references', 'joud_ref_round_front.png')
BRIEF = os.path.join(REPO, 'docs', 'joud-brief.json')
OUT_GLB = os.path.join(REPO, 'public', 'models', 'joud-v2.glb')
OUT_BLEND = os.path.join(HERE, 'joud-v2.blend')
OUT_ATLAS_PREVIEW = os.path.join(HERE, 'joud-v2-atlas.png')  # not committed (gitignored)

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SAVE_BLEND = '--no-blend' not in ARGS
WITH_LENSES = '--with-lenses' in ARGS

ATLAS = 1024
SIZE_LIMIT_KB = 600
BLEND_LIMIT_MB = 5

# ----------------------------------------------------------------------------------------------
# the front reference: pixel space -> model space
# ----------------------------------------------------------------------------------------------
# joud_ref_round_front.png is 596 x 544. The body's widest half-width is 189 px; that becomes
# 0.6 model units (the old model's body radius), so S = 0.6 / 189 units per pixel.
# CX is the body's centre line, CY the height that becomes the model's origin (body centre).

S = 0.6 / 189.0
CX = 301.0
CY = 340.0


def px_to_model(x_px: float, y_px: float) -> tuple[float, float]:
    """Front-reference pixel -> (X, Z) in model units."""
    return (x_px - CX) * S, (CY - y_px) * S


def model_to_px(x: float, z: float) -> tuple[float, float]:
    return x / S + CX, CY - z / S


def log(msg: str) -> None:
    print(f'[joud] {msg}', flush=True)


# ----------------------------------------------------------------------------------------------
# palette (docs/joud-brief.json, sampled from the character art). Amr chose the art's own
# colours over the campaign swatches on 27 Nov 2026, so the flat parts match the projected vest.
# ----------------------------------------------------------------------------------------------

with open(BRIEF, encoding='utf-8') as f:
    _brief = json.load(f)
PAL = {k: v for k, v in _brief['palette'].items()}


def hex_rgb(h: str) -> np.ndarray:
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)


# ----------------------------------------------------------------------------------------------
# image helpers (no PIL in Blender: load through bpy, work in numpy, rows top to bottom)
# ----------------------------------------------------------------------------------------------

def load_rgba(path: str) -> np.ndarray:
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)
    return buf.reshape(h, w, 4)[::-1].copy()


def sample_bilinear(img: np.ndarray, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    """Sample an (h, w, c) image at pixel-centre coordinates; outside -> 0."""
    h, w = img.shape[:2]
    x = xs - 0.5
    y = ys - 0.5
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]
    out = np.zeros(xs.shape + (img.shape[2],), dtype=np.float32)
    for dx, dy, wgt in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
        xi = x0 + dx
        yi = y0 + dy
        ok = (xi >= 0) & (xi < w) & (yi >= 0) & (yi < h)
        vals = np.zeros(xs.shape + (img.shape[2],), dtype=np.float32)
        vals[ok] = img[yi[ok], xi[ok]]
        out += vals * wgt
    return out


def smoothstep(e0: float, e1: float, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ----------------------------------------------------------------------------------------------
# 1. measure the front reference
# ----------------------------------------------------------------------------------------------

def fit_circle(xs: np.ndarray, ys: np.ndarray) -> tuple[float, float, float]:
    a = np.stack([xs, ys, np.ones_like(xs)], axis=1)
    b = xs * xs + ys * ys
    c, *_ = np.linalg.lstsq(a, b, rcond=None)
    cx, cy = c[0] / 2, c[1] / 2
    return float(cx), float(cy), float(math.sqrt(c[2] + cx * cx + cy * cy))


def measure_reference() -> dict:
    ref = load_rgba(REF_FRONT)
    h, w = ref.shape[:2]
    rgb = ref[..., :3]
    alpha = ref[..., 3]
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    yy, xx = np.mgrid[0:h, 0:w]
    opaque = alpha > 0.5

    m: dict = {'image': [w, h]}
    ys, xs = np.nonzero(opaque)
    m['alpha_bbox'] = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]

    # glasses frame: grey, unsaturated, mid-dark, in the top 110 rows
    frame = opaque & (sat < 0.08) & (lum > 0.26) & (lum < 0.5) & (yy < 105)
    lenses = []
    for side in (xx < 281, xx >= 281):
        sel = frame & side & (xx > 205) & (xx < 360)
        fx, fy = xx[sel].astype(float), yy[sel].astype(float)
        cx, cy, rad = fit_circle(fx, fy)
        for _ in range(3):  # refit on the ring only (drops the temples and the bridge)
            keep = np.abs(np.hypot(fx - cx, fy - cy) - rad) < 4.0
            cx, cy, rad = fit_circle(fx[keep], fy[keep])
        lenses.append((cx, cy, rad))
    m['lens_left_px'] = [round(v, 1) for v in lenses[0]]
    m['lens_right_px'] = [round(v, 1) for v in lenses[1]]

    # eyes: the darkest small blobs inside each lens
    eyes = []
    for cx, cy, rad in lenses:
        d = np.hypot(xx - cx, yy - cy)
        sel = opaque & (lum < 0.3) & (d < rad * 0.6)
        eyes.append((float(xx[sel].mean()), float(yy[sel].mean())))
    m['eye_left_px'] = [round(v, 1) for v in eyes[0]]
    m['eye_right_px'] = [round(v, 1) for v in eyes[1]]

    # cream: body, head and wings
    cream_ref = hex_rgb(PAL['body_cream'])
    d_cream = np.linalg.norm(rgb - cream_ref, axis=2)
    cream = opaque & (d_cream < 0.06)

    # head width, rows 100-140 (below the glasses, above the collar)
    widths = []
    for row in range(100, 141, 10):
        cols = np.nonzero(cream[row] | (opaque[row] & (sat[row] < 0.12) & (lum[row] > 0.85)))[0]
        cols = cols[(cols > 150) & (cols < 450)]
        widths.append((row, int(cols.min()), int(cols.max())))
    m['head_rows_px'] = widths
    hw = np.mean([(c1 - c0) / 2 for _, c0, c1 in widths])
    m['head_half_width_px'] = round(float(hw), 1)

    # head top: first cream row over the centre columns, between the two lenses
    col = cream[:, 270:300].any(axis=1)
    m['head_top_px'] = int(np.nonzero(col)[0].min())

    # body bottom: last opaque cream row over the centre columns
    col = (cream | (opaque & (lum > 0.85)))[:, 250:350].any(axis=1)
    m['body_bottom_px'] = int(np.nonzero(col)[0].max())

    # vest base colour and hem (lowest vest-coloured row near the centre)
    vest_ref = hex_rgb(PAL['vest'])
    vest = opaque & (np.linalg.norm(rgb - vest_ref, axis=2) < 0.07)
    m['vest_colour_art'] = '#%02X%02X%02X' % tuple(int(v * 255) for v in np.median(rgb[vest], axis=0))
    rows = np.nonzero(vest[:, 200:280].any(axis=1))[0]
    m['vest_hem_px'] = int(rows.max())

    # collar: green pixels, top and bottom of the first green run per column (x 170-430)
    green = opaque & (g > r + 0.15) & (g > b + 0.05)
    collar = {}
    for x in range(170, 431):
        ys_g = np.nonzero(green[130:240, x])[0]
        if len(ys_g) == 0:
            continue
        ys_g = ys_g + 130
        run_end = ys_g[0]
        for yv in ys_g[1:]:
            if yv - run_end > 2:
                break
            run_end = yv
        if run_end - ys_g[0] < 6 or run_end - ys_g[0] > 32:
            continue  # the vest's thin centre line, or the collar merging into it at the V
        collar[x] = (int(ys_g[0]), int(run_end))
    m['collar_columns'] = len(collar)
    near = [v[0] for x, v in collar.items() if abs(x - CX) < 25]
    m['collar_front_top_px'] = int(max(near))
    m['_collar'] = collar

    # colours sampled from the art for the flat parts
    peach = opaque & (r > 0.95) & (g > 0.7) & (g < 0.85) & (b > 0.5) & (b < 0.7) & (yy > 340)
    m['wing_tip_colour_art'] = '#%02X%02X%02X' % tuple(int(v * 255) for v in np.median(rgb[peach], axis=0))
    tips = []
    for side in (xx < CX, xx >= CX):
        sel = peach & side
        tips.append([int(xx[sel].min()), int(yy[sel].min()), int(xx[sel].max()), int(yy[sel].max())])
    m['wing_tip_left_bbox_px'], m['wing_tip_right_bbox_px'] = tips
    eye_dark = opaque & (lum < 0.3) & (yy < 80)
    m['eye_colour_art'] = '#%02X%02X%02X' % tuple(int(v * 255) for v in np.median(rgb[eye_dark], axis=0))
    m['frame_colour_art'] = '#%02X%02X%02X' % tuple(int(v * 255) for v in np.median(rgb[frame], axis=0))
    lens_in = opaque & (yy < 95) & (lum > 0.86) & (sat < 0.08) & ~cream
    m['lens_colour_art'] = '#%02X%02X%02X' % tuple(int(v * 255) for v in np.median(rgb[lens_in], axis=0))

    m['_ref'] = ref
    return m


# ----------------------------------------------------------------------------------------------
# 2. shape of the body and head (a lathe with an elliptical cross-section)
# ----------------------------------------------------------------------------------------------
# Half-width of the silhouette against the reference's pixel rows, read off the front art:
# the head (rows 26-150) is measured directly (head_rows_px); the body's sides are hidden
# behind the folded wings, so rows 160-430 follow the vest's outline plus the cream body
# visible between the wing tips, and rows 430-509 the visible belly.

PROFILE_PX = [
    (26, 0), (29, 34), (36, 60), (48, 79), (64, 92), (84, 99), (104, 101.5), (128, 102.5),
    (148, 106), (162, 117), (178, 133), (198, 149), (224, 162), (260, 172), (300, 181),
    (340, 187), (378, 189), (414, 186), (444, 176), (468, 159), (486, 134), (498, 104),
    (505, 66), (508, 30), (509, 0),
]
HEAD_DEPTH = 0.96  # head front-to-back / side-to-side (round head)
BODY_DEPTH = 0.86  # body: slightly flatter front to back (wider than deep, as in the side art)
NECK_PX = 160      # where the head mesh ends and the body mesh starts


def catmull(points: list[tuple[float, float]], n: int = 400) -> np.ndarray:
    p = np.array(points, dtype=np.float64)
    p = np.vstack([p[0], p, p[-1]])
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        for t in np.linspace(0, 1, max(2, n // (len(p) - 3)), endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(p[-2])
    return np.array(out)


_PROFILE = catmull([(y, hw) for y, hw in PROFILE_PX], 1200)  # columns: y_px, half-width px
_PROFILE = _PROFILE[np.argsort(_PROFILE[:, 0])]


def half_width_px(y_px):
    return np.interp(y_px, _PROFILE[:, 0], np.maximum(_PROFILE[:, 1], 0))


def depth_ratio(y_px):
    return HEAD_DEPTH + (BODY_DEPTH - HEAD_DEPTH) * smoothstep(150, 205, np.asarray(y_px, dtype=np.float64))


def radii_at_z(z: float) -> tuple[float, float]:
    """(half-width a, half-depth b) of the body/head surface at height z (model units)."""
    y_px = CY - z / S
    a = float(half_width_px(y_px)) * S
    return a, a * float(depth_ratio(y_px))


def surface_y(x: float, z: float, front: bool = True, offset: float = 0.0) -> float:
    """Y of the body/head surface at (x, z); front is -Y. offset pushes outwards."""
    a, b = radii_at_z(z)
    a += offset
    b += offset
    if a <= 1e-6:
        return 0.0
    q = max(0.0, 1.0 - (x / a) ** 2)
    yv = b * math.sqrt(q)
    return -yv if front else yv


def lathe_rings(n_rings: int) -> list[float]:
    """Pixel rows for n_rings rings, evenly spaced along the silhouette's arc length."""
    ys = np.linspace(PROFILE_PX[0][0], PROFILE_PX[-1][0], 2000)
    hws = half_width_px(ys)
    seg = np.hypot(np.diff(ys), np.diff(hws))
    arc = np.concatenate([[0], np.cumsum(seg)])
    targets = np.linspace(0, arc[-1], n_rings)
    return list(np.interp(targets, arc, ys))


# ----------------------------------------------------------------------------------------------
# mesh building helpers
# ----------------------------------------------------------------------------------------------

PARTS: list[bpy.types.Object] = []
PART_KIND: dict[str, str] = {}  # object name -> material kind for the texture pass


def new_object(name: str, bm: bmesh.types.BMesh, kind: str, coll) -> bpy.types.Object:
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, me)
    coll.objects.link(obj)
    PARTS.append(obj)
    PART_KIND[name] = kind
    return obj


def grid_bmesh(rings: list[list[Vector]], us: list[float], pole_start: Vector | None = None,
               pole_end: Vector | None = None, closed: bool = True) -> bmesh.types.BMesh:
    """Quads between consecutive rings (each a closed loop of the same length), optional
    triangle fans to a pole at either end. A 'param' UV layer gets (u along, v around)."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('param')
    n = len(rings[0])
    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    seg = n if closed else n - 1

    def set_uv(face, coords):
        for loop, c in zip(face.loops, coords):
            loop[uv].uv = c

    for i in range(len(rings) - 1):
        for j in range(seg):
            j1 = (j + 1) % n
            f = bm.faces.new((vr[i][j], vr[i][j1], vr[i + 1][j1], vr[i + 1][j]))
            v0, v1 = j / n, (j + 1) / n
            set_uv(f, [(us[i], v0), (us[i], v1), (us[i + 1], v1), (us[i + 1], v0)])
    if pole_start is not None:
        p = bm.verts.new(pole_start)
        for j in range(seg):
            j1 = (j + 1) % n
            f = bm.faces.new((p, vr[0][j1], vr[0][j]))
            set_uv(f, [(us[0] - 0.02, (j + 0.5) / n), (us[0], (j + 1) / n), (us[0], j / n)])
    if pole_end is not None:
        p = bm.verts.new(pole_end)
        for j in range(seg):
            j1 = (j + 1) % n
            f = bm.faces.new((vr[-1][j], vr[-1][j1], p))
            set_uv(f, [(us[-1], j / n), (us[-1], (j + 1) / n), (us[-1] + 0.02, (j + 0.5) / n)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def tube(points: list[Vector], radii: list[float], sides: int = 6, cap_start: bool = True,
         cap_end: bool = True) -> bmesh.types.BMesh:
    """A tube along a polyline (parallel-transport frames)."""
    pts = [Vector(p) for p in points]
    tangents = []
    for i in range(len(pts)):
        a = pts[max(0, i - 1)]
        b = pts[min(len(pts) - 1, i + 1)]
        tangents.append((b - a).normalized())
    ref = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
    nrm = tangents[0].cross(ref).normalized()
    rings = []
    for i, (p, t) in enumerate(zip(pts, tangents)):
        if i > 0:
            nrm = (nrm - t * nrm.dot(t)).normalized()
        bin_ = t.cross(nrm).normalized()
        ring = []
        for k in range(sides):
            ang = 2 * math.pi * k / sides
            ring.append(p + (nrm * math.cos(ang) + bin_ * math.sin(ang)) * radii[i])
        rings.append(ring)
    us = list(np.linspace(0, 1, len(pts)))
    ps = pts[0] - tangents[0] * radii[0] * 0.6 if cap_start else None
    pe = pts[-1] + tangents[-1] * radii[-1] * 0.6 if cap_end else None
    return grid_bmesh(rings, us, ps, pe)


def merge_bm(dst: bmesh.types.BMesh, src: bmesh.types.BMesh) -> None:
    me = bpy.data.meshes.new('_tmp')
    src.to_mesh(me)
    src.free()
    dst.from_mesh(me)
    bpy.data.meshes.remove(me)


# ----------------------------------------------------------------------------------------------
# 3. the parts
# ----------------------------------------------------------------------------------------------

SEG = 36  # around the body, head and vest


def build_body_and_head(coll) -> tuple[bpy.types.Object, bpy.types.Object]:
    rows = lathe_rings(34)
    # snap the ring nearest the neck to NECK_PX so the two meshes share it exactly
    k = int(np.argmin([abs(r - NECK_PX) for r in rows]))
    rows[k] = NECK_PX
    rings = []
    for y_px in rows[1:-1]:
        z = (CY - y_px) * S
        a, b = radii_at_z(z)
        ring = []
        for j in range(SEG):
            phi = 2 * math.pi * j / SEG  # 0 = back (+Y), pi = front (-Y): the UV seam is at the back
            ring.append(Vector((a * math.sin(phi), b * math.cos(phi), z)))
        rings.append(ring)
    top = Vector((0, 0, (CY - rows[0]) * S))
    bottom = Vector((0, 0, (CY - rows[-1]) * S))
    us = list(np.linspace(0, 1, len(rings)))
    kk = k - 1  # index of the neck ring inside `rings`
    head = new_object('head', grid_bmesh(rings[:kk + 1], us[:kk + 1], pole_start=top), 'head', coll)
    body = new_object('body', grid_bmesh(rings[kk:], us[kk:], pole_end=bottom), 'body', coll)
    return head, body


def neckline_px(phi: float, m: dict) -> tuple[float, float]:
    """(collar top, collar bottom) pixel rows at angle phi around the body (pi = front).
    Front columns come from the green collar measured in the art; the back is assumed
    (no reference): the collar continues around at the side height (brief: vest_back)."""
    collar = m['_collar']
    keys = np.array(sorted(collar))
    tops = np.array([collar[k][0] for k in keys], dtype=np.float64)
    bots = np.array([collar[k][1] for k in keys], dtype=np.float64)
    back_top, back_w = 160.0, 22.0
    facing = -math.cos(phi)  # 1 at the front, -1 at the back
    z_guess = (CY - 165) * S
    for _ in range(3):
        a, _b = radii_at_z(z_guess)
        x_px = CX + a * math.sin(phi) / S
        top = float(np.interp(x_px, keys, tops))  # gaps (the V) interpolated, ends held
        bot = float(np.interp(x_px, keys, bots))
        z_guess = (CY - top) * S
    wgt = float(smoothstep(-0.05, 0.35, facing))
    t = top * wgt + back_top * (1 - wgt)
    bt = bot * wgt + (back_top + back_w) * (1 - wgt)
    return t, max(bt, t + 12)


def build_vest(m: dict, coll) -> bpy.types.Object:
    hem_px = m['vest_hem_px'] - 2
    off = 0.014
    n = 40
    rows = 13
    rings = []
    us = []
    for i in range(rows + 1):
        ring = []
        for j in range(n):
            phi = 2 * math.pi * j / n
            top_px, _ = neckline_px(phi, m)
            y_px = top_px + (hem_px - top_px) * (i / rows)
            z = (CY - y_px) * S
            a, b = radii_at_z(z)
            ring.append(Vector(((a + off) * math.sin(phi), (b + off) * math.cos(phi), z)))
        rings.append(ring)
        us.append(i / rows)
    # top lip: tuck into the body; hem lip: the cloth's thickness
    top_lip = []
    for p in rings[0]:
        a, b = radii_at_z(p.z)
        phi = math.atan2(p.x / max(a, 1e-6), p.y / max(b, 1e-6))
        top_lip.append(Vector(((a - 0.01) * math.sin(phi), (b - 0.01) * math.cos(phi), p.z + 0.004)))
    hem_lip = []
    for p in rings[-1]:
        a, b = radii_at_z(p.z - 0.006)
        phi = math.atan2(p.x / max(a, 1e-6), p.y / max(b, 1e-6))
        hem_lip.append(Vector(((a - 0.004) * math.sin(phi), (b - 0.004) * math.cos(phi), p.z - 0.006)))
    rings = [top_lip] + rings + [hem_lip]
    us = [-0.03] + us + [1.03]
    return new_object('vest', grid_bmesh(rings, us), 'vest', coll)


def build_collar(m: dict, coll) -> bpy.types.Object:
    n = 64
    rows = 4
    rings = []
    us = []
    for i in range(rows + 1):
        t = i / rows
        ring = []
        for j in range(n):
            phi = 2 * math.pi * j / n
            top_px, bot_px = neckline_px(phi, m)
            y_px = top_px + (bot_px - top_px) * t
            z = (CY - y_px) * S
            a, b = radii_at_z(z)
            off = 0.017 + 0.009 * t  # the collar flares out a little towards its lower edge
            ring.append(Vector(((a + off) * math.sin(phi), (b + off) * math.cos(phi), z)))
        rings.append(ring)
        us.append(t)
    # under-lip so the lower edge has thickness, and a top lip into the neck
    lower = []
    for p in rings[-1]:
        a, b = radii_at_z(p.z)
        phi = math.atan2(p.x / max(a, 1e-6), p.y / max(b, 1e-6))
        lower.append(Vector(((a + 0.012) * math.sin(phi), (b + 0.012) * math.cos(phi), p.z + 0.004)))
    upper = []
    for p in rings[0]:
        a, b = radii_at_z(p.z)
        phi = math.atan2(p.x / max(a, 1e-6), p.y / max(b, 1e-6))
        upper.append(Vector(((a - 0.006) * math.sin(phi), (b - 0.006) * math.cos(phi), p.z + 0.006)))
    rings = [upper] + rings + [lower]
    us = [-0.05] + us + [1.05]
    return new_object('collar', grid_bmesh(rings, us), 'collar', coll)


# --- wings -------------------------------------------------------------------------------------
# Long and slender like the flying poster, held straight out to the sides in the bind pose.
# The wing's broad face looks forward (the frontal plane), as in both the front art (wings
# hanging at the sides) and the poster (wings raised): flapping turns it within that plane.
# Leading edge = top in the bind pose = the outer edge when folded: the green line runs there.

SHOULDER_PX = 190.0  # the green line starts at the collar's corner (art)
WING_SHOULDER_X = 0.40           # inside the body: the root is hidden under the vest
# Poster: the wing reaches about 1.4 from the shoulder joint and is about 0.28 wide (measured
# against the body, half-width 0.6), so it is long and slender next to v1's stubby wings.
WING_LEN = 1.08                  # cream part, from the shoulder joint
FEATHER_BASE = 0.98              # feathers start here (overlapping the cream end)
FEATHER_LENS = [0.26, 0.30, 0.33, 0.30, 0.26]
FEATHER_FAN_DEG = [-34, -17, 0, 17, 34]
WING_BONES = [0.0, 0.42, 0.90, 1.40]   # shoulder, mid, tip joints along the wing (+ tip end)


def wing_frame(side: int) -> Matrix:
    """Wing space -> model space. Wing space: +X along the wing, +Z leading edge, +Y back."""
    z = (CY - SHOULDER_PX) * S
    mat = Matrix.Translation((side * WING_SHOULDER_X, 0, z))
    if side < 0:
        mat = mat @ Matrix.Scale(-1, 4, (1, 0, 0))
    return mat


def build_wing(side: int, coll) -> tuple[bpy.types.Object, bpy.types.Object]:
    name = 'L' if side > 0 else 'R'
    mat = wing_frame(side)
    ss = list(np.linspace(-0.10, WING_LEN, 15))
    n = 14

    def chord(s):  # half-chord (vertical, in the frontal plane)
        return float(np.interp(s, [-0.1, 0.0, 0.25, 0.6, 0.9, WING_LEN], [0.085, 0.11, 0.128, 0.136, 0.14, 0.134]))

    def thick(s):  # half-thickness (front to back)
        return float(np.interp(s, [-0.1, 0.4, WING_LEN], [0.052, 0.046, 0.034]))

    rings = []
    for s in ss:
        c, t = chord(s), thick(s)
        droop = -0.03 * (max(0.0, s) / WING_LEN) ** 2
        ring = []
        for j in range(n):
            psi = 2 * math.pi * j / n  # 0 = leading edge (top)
            ring.append(mat @ Vector((s, t * math.sin(psi), c * math.cos(psi) + droop)))
        rings.append(ring)
    us = [(s + 0.1) / (WING_LEN + 0.1) for s in ss]
    pole_s = mat @ Vector((-0.13, 0, 0))
    pole_e = mat @ Vector((WING_LEN + 0.03, 0, -0.02))
    bm = grid_bmesh(rings, us, pole_s, pole_e)  # grid_bmesh orients closed meshes outwards (mirrored too)
    wing = new_object(f'wing_{name}', bm, 'wing', coll)

    # feathers: five pointed blades fanned in the wing's plane
    fb = bmesh.new()
    for fan, length in zip(FEATHER_FAN_DEG, FEATHER_LENS):
        rot = Matrix.Rotation(math.radians(fan), 4, 'Y')
        base = Matrix.Translation((FEATHER_BASE, 0, -0.03))
        fmat = mat @ base @ rot
        rings_f = []
        us_f = []
        steps = 7
        for i in range(steps):
            u = i / (steps - 1)
            width = 0.058 * math.sin(math.pi * min(1.0, 0.18 + 0.82 * u)) ** 0.7 + 0.004
            th = 0.022 * (1 - 0.6 * u)
            ring = []
            for j in range(6):
                psi = 2 * math.pi * j / 6
                ring.append(fmat @ Vector((u * length * 0.94, th * math.sin(psi), width * math.cos(psi))))
            rings_f.append(ring)
            us_f.append(u)
        tip = fmat @ Vector((length, 0, 0))
        start = fmat @ Vector((-0.02, 0, 0))
        b1 = grid_bmesh(rings_f, us_f, start, tip)  # grid_bmesh orients closed meshes outwards (mirrored too)
        merge_bm(fb, b1)
    feathers = new_object(f'wing_tip_{name}', fb, 'feather', coll)
    return wing, feathers


def build_tail(coll) -> bpy.types.Object:
    z = -0.30
    _a, b = radii_at_z(z)
    base = Vector((0, b - 0.05, z))
    bm = bmesh.new()
    for fan, length in ((-24, 0.13), (0, 0.16), (24, 0.13)):
        dirv = Matrix.Rotation(math.radians(fan), 3, 'Z') @ Vector((0, 1, -0.35)).normalized()
        side_v = dirv.cross(Vector((0, 0, 1))).normalized()
        up = side_v.cross(dirv).normalized()
        rings = []
        us = []
        for i in range(6):
            u = i / 5
            p = base + dirv * (u * length * 0.94)
            wdt = 0.036 * math.sin(math.pi * min(1.0, 0.2 + 0.8 * u)) ** 0.7 + 0.003
            th = 0.016 * (1 - 0.5 * u)
            rings.append([p + side_v * wdt * math.cos(2 * math.pi * j / 6) + up * th * math.sin(2 * math.pi * j / 6) for j in range(6)])
            us.append(u)
        merge_bm(bm, grid_bmesh(rings, us, base - dirv * 0.02, base + dirv * length))
    return new_object('tail', bm, 'feather', coll)


# --- legs --------------------------------------------------------------------------------------

LEG_X = 0.19
HIP_Z, KNEE_Z, ANKLE_Z = -0.42, -0.59, -0.70  # front art: about 0.17 of leg below the belly


def leg_points(side: int) -> tuple[Vector, Vector, Vector]:
    x = side * LEG_X
    return Vector((x, 0.0, HIP_Z)), Vector((x * 1.02, -0.025, KNEE_Z)), Vector((x * 1.04, 0.0, ANKLE_Z))


def build_leg(side: int, coll) -> bpy.types.Object:
    hip, knee, ankle = leg_points(side)
    pts = [hip, hip.lerp(knee, 0.5), knee, knee.lerp(ankle, 0.5), ankle]
    bm = tube(pts, [0.013] * 5, sides=6, cap_start=True, cap_end=True)
    # three toes: two forward, one back (side art)
    for yaw, length, down in ((-30, 0.105, 0.2), (30, 0.105, 0.2), (180, 0.06, 0.3)):
        d = Matrix.Rotation(math.radians(yaw), 3, 'Z') @ Vector((0, -1, 0))
        d = (d + Vector((0, 0, -down))).normalized()
        toe = [ankle, ankle + d * length * 0.5, ankle + d * length]
        merge_bm(bm, tube(toe, [0.0105, 0.008, 0.005], sides=5, cap_start=False, cap_end=True))
    return new_object(f'leg_{"L" if side > 0 else "R"}', bm, 'dark', coll)


# --- face --------------------------------------------------------------------------------------

def face_layout(m: dict) -> dict:
    """Symmetric face positions from the (slightly turned) art: spacing and sizes measured,
    centred on the body's centre line."""
    (lx, ly, lr), (rx, ry, rr) = m['lens_left_px'], m['lens_right_px']
    (elx, ely), (erx, ery) = m['eye_left_px'], m['eye_right_px']
    lens_dx = (rx - lx) / 2 * S
    lens_r = (lr + rr) / 2 * S
    lens_z = (CY - (ly + ry) / 2) * S
    eye_dx = (erx - elx) / 2 * S
    eye_z = (CY - (ely + ery) / 2) * S
    eye_mid_px = (ely + ery) / 2
    return {
        'lens_dx': lens_dx, 'lens_r': lens_r, 'lens_z': lens_z,
        'eye_dx': eye_dx, 'eye_z': eye_z,
        # cheeks: art (232, 96) and (350, 86), i.e. 59 px out and 32 px below the eye line
        'cheek_dx': 59 * S, 'cheek_z': (CY - (eye_mid_px + 32)) * S, 'cheek_r': 13 * S,
        # beak scribble centre: 28 px below the eye line
        'beak_z': (CY - (eye_mid_px + 28)) * S,
    }


FRAME_R = 0.0072   # wire radius (art stroke ~2.5 px = 0.008 thick; kept a touch thicker to read on a phone)
LENS_YAW = 16.0    # each lens turned outwards to follow the head's curve


def lens_frame(face: dict, side: int) -> Matrix:
    """Lens space -> model space. Lens space: XZ is the lens plane, -Y looks forward."""
    cx, cz, rad = side * face['lens_dx'], face['lens_z'], face['lens_r']
    rot = Matrix.Rotation(math.radians(side * LENS_YAW), 4, 'Z')
    # push forward until the whole ring clears the head surface by 6 mm (model 0.012)
    y = -0.1
    for _ in range(60):
        mat = Matrix.Translation((cx, y, cz)) @ rot
        worst = -1.0
        for k in range(48):
            ang = 2 * math.pi * k / 48
            p = mat @ Vector((rad * math.cos(ang), 0, rad * math.sin(ang)))
            a, _b = radii_at_z(p.z)
            if a <= 0 or abs(p.x) >= a:
                continue
            gap = surface_y(p.x, p.z) - p.y  # > 0: ring in front of the face
            worst = max(worst, 0.014 - gap)
        if worst <= 0:
            break
        y -= worst + 0.002
    return Matrix.Translation((cx, y, cz)) @ rot


def build_glasses(face: dict, coll) -> tuple[bpy.types.Object, list[bpy.types.Object]]:
    bm = bmesh.new()
    rad = face['lens_r']
    lens_objs = []
    for side in (1, -1):
        mat = lens_frame(face, side)
        pts = [mat @ Vector((rad * math.cos(a), 0, rad * math.sin(a))) for a in np.linspace(0, 2 * math.pi, 33)[:-1]]
        rings = []
        for i, p in enumerate(pts):
            t = (pts[(i + 1) % len(pts)] - pts[i - 1]).normalized()
            nrm = (p - mat.translation).normalized()
            bn = t.cross(nrm).normalized()
            rings.append([p + (nrm * math.cos(2 * math.pi * k / 6) + bn * math.sin(2 * math.pi * k / 6)) * FRAME_R for k in range(6)])
        rings.append(rings[0])
        merge_bm(bm, grid_bmesh(rings, list(np.linspace(0, 1, len(rings)))))
        # temple: from the ring's outer edge back along the side of the head
        a_out = math.radians(8 if side > 0 else 172)  # the ring's outer side
        start = mat @ Vector((rad * math.cos(a_out), 0, rad * math.sin(a_out)))
        tpts = [start]
        for t in (0.25, 0.5, 0.75, 1.0):
            z = start.z - 0.03 * t
            x = side * (abs(start.x) + 0.03 * t)
            yb = start.y + (0.0 - start.y) * t
            a, b = radii_at_z(z)
            # keep it just outside the head
            if abs(x) < a:
                q = max(0.0, 1 - (yb / (b + 0.012)) ** 2)
                x = side * max(abs(x), (a + 0.012) * math.sqrt(q))
            tpts.append(Vector((x, yb, z)))
        merge_bm(bm, tube(tpts, [FRAME_R * 0.9] * len(tpts), sides=5, cap_start=False, cap_end=True))
        # lens disc (kept in Blender; exported only with --with-lenses)
        lb = bmesh.new()
        ret = bmesh.ops.create_circle(lb, cap_ends=True, cap_tris=False, segments=32, radius=rad - FRAME_R * 0.5)
        bmesh.ops.rotate(lb, verts=lb.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'X'))
        bmesh.ops.transform(lb, matrix=mat, verts=lb.verts)
        lb.loops.layers.uv.new('param')
        lens = new_object(f'lens_{"L" if side > 0 else "R"}', lb, 'lens', coll)
        lens_objs.append(lens)
    # bridge between the two rings, a little above their centres
    ml, mr = lens_frame(face, 1), lens_frame(face, -1)
    a_l, a_r = math.radians(168), math.radians(12)  # each ring's inner side
    pl = ml @ Vector((rad * math.cos(a_l), 0, rad * math.sin(a_l)))
    pr = mr @ Vector((rad * math.cos(a_r), 0, rad * math.sin(a_r)))
    mid = (pl + pr) / 2 + Vector((0, -0.004, 0.012))
    merge_bm(bm, tube([pl, pl.lerp(mid, 0.6), mid, pr.lerp(mid, 0.6), pr], [FRAME_R * 0.9] * 5, sides=5, cap_start=False, cap_end=False))
    return new_object('glasses_frame', bm, 'frame', coll), lens_objs


def build_eyes(face: dict, coll) -> bpy.types.Object:
    bm = bmesh.new()
    for side in (1, -1):
        x, z = side * face['eye_dx'], face['eye_z']
        y = surface_y(x, z)
        e = bmesh.new()
        bmesh.ops.create_uvsphere(e, u_segments=10, v_segments=6, radius=1.0)
        a, _b = radii_at_z(z)
        nrm = Vector((x / max(a, 1e-6) * 0.6, -1, 0)).normalized()
        rot = Vector((0, -1, 0)).rotation_difference(nrm).to_matrix().to_4x4()
        mat = Matrix.Translation((x, y + 0.002, z)) @ rot @ Matrix.Diagonal((0.0165, 0.007, 0.0165, 1))
        bmesh.ops.transform(e, matrix=mat, verts=e.verts)
        e.loops.layers.uv.new('param')
        merge_bm(bm, e)
    return new_object('eyes', bm, 'eye', coll)


# the beak scribble, traced from the art (pixels relative to its centre (300, 87)); the art's
# face is turned a little, so the scribble is re-centred on the model's centre line
BEAK_STROKES_PX = [
    [(-19, 0), (-14, -5), (-8, -5), (-4, -1), (0, -4), (5, -7), (13, -6), (18, -3), (7, 0)],
    [(-10, 6), (-5, 3), (-1, 5), (3, 2), (10, 1)],
]


def build_beak(face: dict, coll) -> bpy.types.Object:
    bm = bmesh.new()
    for stroke in BEAK_STROKES_PX:
        pts = []
        for dx, dy in stroke:
            x = dx * S
            z = face['beak_z'] - dy * S
            pts.append(Vector((x, surface_y(x, z) - 0.006, z)))
        merge_bm(bm, tube(pts, [0.0052] * len(pts), sides=5))
    return new_object('beak', bm, 'dark', coll)


# ----------------------------------------------------------------------------------------------
# 4. armature, weights, sockets
# ----------------------------------------------------------------------------------------------

NECK_Z = (CY - NECK_PX) * S


def build_armature(face: dict, coll) -> bpy.types.Object:
    arm_data = bpy.data.armatures.new('Joud_Armature')
    arm = bpy.data.objects.new('Joud_Armature', arm_data)
    coll.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm_data.edit_bones

    def bone(name, head, tail, parent=None, connect=False, roll=0.0):
        b = eb.new(name)
        b.head = head
        b.tail = tail
        b.roll = roll
        if parent:
            b.parent = eb[parent]
            b.use_connect = connect
        return b

    head_top = (CY - PROFILE_PX[0][0]) * S
    bone('root', (0, 0, 0), (0, 0, 0.12))
    bone('body', (0, 0, 0), (0, 0, NECK_Z), 'root')
    bone('head', (0, 0, NECK_Z), (0, 0, head_top), 'body', connect=True)
    ez = face['eye_z']
    bone('eye_ctrl', (0, surface_y(0, ez) + 0.1, ez), (0, surface_y(0, ez) - 0.02, ez), 'head')
    for side, sfx in ((1, 'L'), (-1, 'R')):
        mat = wing_frame(side)
        names = ['wing_shoulder', 'wing_mid', 'wing_tip']
        for i, nm in enumerate(names):
            h = mat @ Vector((WING_BONES[i], 0, 0))
            t = mat @ Vector((WING_BONES[i + 1], 0, 0))
            bone(f'{nm}_{sfx}', h, t, 'body' if i == 0 else f'{names[i - 1]}_{sfx}', connect=i > 0)
        hip, knee, ankle = leg_points(side)
        bone(f'leg_upper_{sfx}', hip, knee, 'body')
        bone(f'leg_lower_{sfx}', knee, ankle, f'leg_upper_{sfx}', connect=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    arm_data.display_type = 'STICK'
    return arm


def assign_weights(obj: bpy.types.Object, fn) -> None:
    """fn(world position, part name) -> {bone: weight}."""
    groups = {}
    for v in obj.data.vertices:
        for bname, w in fn(obj.matrix_world @ v.co, obj.name).items():
            if w <= 1e-4:
                continue
            if bname not in groups:
                groups[bname] = obj.vertex_groups.get(bname) or obj.vertex_groups.new(name=bname)
            groups[bname].add([v.index], float(w), 'REPLACE')


def weight_fn(p: Vector, part: str) -> dict:
    if part in ('head', 'glasses_frame', 'beak', 'lens_L', 'lens_R'):
        if part == 'head':
            w = float(smoothstep(NECK_Z - 0.02, NECK_Z + 0.05, p.z))
            return {'head': w, 'body': 1 - w}
        return {'head': 1.0}
    if part == 'eyes':
        return {'eye_ctrl': 1.0}
    if part == 'body':
        w = float(smoothstep(NECK_Z - 0.02, NECK_Z + 0.05, p.z))
        return {'head': w, 'body': 1 - w}
    if part in ('vest', 'collar', 'tail'):
        return {'body': 1.0}
    if part.startswith('wing'):
        sfx = part[-1]
        side = 1 if sfx == 'L' else -1
        s = (p.x * side) - WING_SHOULDER_X
        if part.startswith('wing_tip'):
            return {f'wing_tip_{sfx}': 1.0}
        j1, j2 = WING_BONES[1], WING_BONES[2]
        d = 0.07
        w_mid = float(smoothstep(j1 - d, j1 + d, s))
        w_tip = float(smoothstep(j2 - d, j2 + d, s))
        return {f'wing_shoulder_{sfx}': 1 - w_mid, f'wing_mid_{sfx}': w_mid - w_tip, f'wing_tip_{sfx}': w_tip}
    if part.startswith('leg'):
        sfx = part[-1]
        w = float(smoothstep(KNEE_Z + 0.03, KNEE_Z - 0.03, p.z))
        return {f'leg_upper_{sfx}': 1 - w, f'leg_lower_{sfx}': w}
    return {'body': 1.0}


def add_socket(name: str, pos: Vector, arm: bpy.types.Object, bone_name: str, coll) -> bpy.types.Object:
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'ARROWS'
    e.empty_display_size = 0.08
    coll.objects.link(e)
    e.parent = arm
    e.parent_type = 'BONE'
    e.parent_bone = bone_name
    bpy.context.view_layer.update()
    e.matrix_world = Matrix.Translation(pos)
    return e


# ----------------------------------------------------------------------------------------------
# 5. the rest_folded pose (wings down along the sides, as in the front art)
# ----------------------------------------------------------------------------------------------

def set_wing_pose(arm, shoulder_deg: float, mid_deg: float, tip_deg: float, forward_deg: float,
                  twist_deg: float = 0.0) -> None:
    """Angles in the bind (wings spread) frame. The shoulder first twists the wing about its
    long axis (negative: leading edge backwards, so the broad front face turns outwards and
    shows in the front, three-quarter and side views), then turns it down about the front-back
    axis, then swings it forwards. mid and tip fold the wing within its own plane (positive:
    towards the trailing edge, which is forwards once twisted)."""
    for side, sfx in ((1, 'L'), (-1, 'R')):
        for bname, ang in ((f'wing_shoulder_{sfx}', shoulder_deg), (f'wing_mid_{sfx}', mid_deg), (f'wing_tip_{sfx}', tip_deg)):
            pb = arm.pose.bones[bname]
            rest = pb.bone.matrix_local.to_3x3()
            rw = Matrix.Rotation(math.radians(side * ang), 3, 'Y')
            if bname.startswith('wing_shoulder'):
                rw = (Matrix.Rotation(math.radians(-forward_deg), 3, 'X') @ rw
                      @ Matrix.Rotation(math.radians(twist_deg), 3, 'X'))
            pb.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion = (rest.inverted() @ rw @ rest).to_quaternion()
    bpy.context.view_layer.update()


def clear_pose(arm) -> None:
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = Quaternion()
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def penetration(objs: list[bpy.types.Object]) -> tuple[int, float, float]:
    """Wing vertices (deformed) inside the body. Returns (outer-half vertices inside, deepest
    outer, deepest overall). The outer half is the leading edge, where the green line runs:
    it must stay outside (past the root, which starts inside the body under the vest). The inner half may sink into the body's side, as in the front art,
    where the wing's inner edge is hidden behind the body."""
    deps = bpy.context.evaluated_depsgraph_get()
    z_outer = (CY - SHOULDER_PX) * S + 0.035  # the top third of the chord: the green line
    count, deep_outer, deep_all = 0, 0.0, 0.0
    for obj in objs:
        rest = obj.data.vertices
        ev = obj.evaluated_get(deps)
        me = ev.to_mesh()
        for v, v0 in zip(me.vertices, rest):
            p = ev.matrix_world @ v.co
            a, b = radii_at_z(p.z)
            if a <= 0:
                continue
            a += 0.02
            b += 0.02
            q = (p.x / a) ** 2 + (p.y / b) ** 2
            p0 = obj.matrix_world @ v0.co
            if q < 1.0 and abs(p0.x) > WING_SHOULDER_X + 0.2:  # the root sits under the vest
                d = (1 - math.sqrt(q)) * a
                deep_all = max(deep_all, d)
                if p0.z > z_outer:
                    count += 1
                    deep_outer = max(deep_outer, d)
        ev.to_mesh_clear()
    return count, deep_outer, deep_all


# Front art: the feather tips' centre hangs beside the belly at about (0.69, -0.24) (wing-tip
# bounds measured in measure_reference); the side art has them lower, near the feet, with the
# wing hanging almost straight down and its broad face along the body's side. The poster-length
# wing cannot match both: the target sits between them, with a light backwards fold and twist.
FOLD_TIP_TARGET = (0.70, -0.40)


def tip_centre(obj: bpy.types.Object) -> Vector:
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    c = Vector()
    for v in me.vertices:
        c += ev.matrix_world @ v.co
    c /= max(1, len(me.vertices))
    ev.to_mesh_clear()
    return c


def tune_folded_pose(arm, wing_objs) -> dict:
    """Search the fold whose feather tips sit where the front art has them, with the wing's
    outer edge out of the body and the inner edge sunk no deeper than 0.12."""
    tip_l = next(o for o in wing_objs if o.name == 'wing_tip_L')
    tx, tz = FOLD_TIP_TARGET
    best = None
    for twist in (-40.0, -55.0, -70.0):
        for sh in range(42, 80, 4):
            for mid in (-30.0, -20.0, -10.0, 0.0, 10.0):
                for tip in (-30.0, -15.0, 0.0, 15.0):
                    set_wing_pose(arm, sh, mid, tip, 0.0, twist)
                    n, _d_out, d_all = penetration(wing_objs)
                    c = tip_centre(tip_l)
                    miss = math.hypot(c.x - tx, c.z - tz)
                    # feathers far behind the body hide the peach fan the front art shows
                    score = (n * 10 + max(0.0, d_all - 0.12) * 300 + miss * 25
                             + max(0.0, -0.05 - c.y) * 15 + max(0.0, c.y - 0.15) * 8
                             + abs(twist + 55.0) * 0.05)
                    if best is None or score < best[0]:
                        best = (score, sh, mid, tip, twist, n, d_all, c.copy())
    _score, sh, mid, tip, twist, n, d_all, c = best
    set_wing_pose(arm, sh, mid, tip, 0.0, twist)
    log(f'rest_folded: wing twisted {twist:.0f} deg, shoulder {sh} deg down, folded back {mid:.0f}, '
        f'tip {tip:.0f}; feather centre at x {c.x:.2f} z {c.z:.2f} y {c.y:.2f} '
        f'(target: x {tx} z {tz}); outer-edge vertices inside the body: {n}; inner edge sinks {d_all:.3f} (hidden)')
    return {'shoulder_down_deg': sh, 'twist_deg': twist, 'fold_back_deg': mid, 'tip_deg': tip,
            'outer_vertices_inside': n, 'inner_depth': round(d_all, 3),
            'feather_centre': [round(c.x, 3), round(c.y, 3), round(c.z, 3)]}


# ----------------------------------------------------------------------------------------------
# 6. UVs and the texture atlas
# ----------------------------------------------------------------------------------------------

TEXEL_WEIGHT = {  # relative texel density per part kind (the vest art gets the most)
    'vest': 2.3, 'collar': 2.0, 'head': 1.5, 'body': 0.85, 'wing': 0.8, 'feather': 0.8, 'lens': 0.1,
}
# Flat-coloured parts (legs, beak, eyes, glasses) are too small for islands of their own: every
# UV of theirs points at one solid swatch in a strip along the atlas's top edge.
FLAT_KINDS = ('dark', 'eye', 'frame')
ATLAS_FIT = 0.965  # the packed islands are scaled into 0..ATLAS_FIT, leaving the swatch strip


def swatch_uv(kind: str) -> tuple[float, float]:
    i = FLAT_KINDS.index(kind)
    return (i + 0.5) * 0.04, (ATLAS_FIT + 1.0) / 2


def unwrap_atlas(objs: list[bpy.types.Object]) -> None:
    for o in objs:
        uvs = o.data.uv_layers
        if 'atlas' not in uvs:
            uvs.new(name='atlas')
        uvs.active = uvs['atlas']
        uvs['atlas'].active_render = True
    flat = [o for o in objs if PART_KIND[o.name] in FLAT_KINDS]
    objs = [o for o in objs if o not in flat]
    for o in flat:
        uv = o.data.uv_layers['atlas'].data
        su, sv = swatch_uv(PART_KIND[o.name])
        uv.foreach_set('uv', np.tile(np.array([su, sv], dtype=np.float32), len(uv)))
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in objs:
        k = TEXEL_WEIGHT[PART_KIND[o.name]]
        uv = o.data.uv_layers['atlas'].data
        co = np.empty(len(uv) * 2, dtype=np.float32)
        uv.foreach_get('uv', co)
        # divided by the largest weight so every island stays in the 0-1 tile: pack_islands
        # packs into the closest UDIM tile, and islands in other tiles would wrap onto it
        uv.foreach_set('uv', co * (k / max(TEXEL_WEIGHT.values())))
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method='FRACTION', margin=0.006, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')
    lo, hi = 1.0, 0.0
    for o in objs:
        uv = o.data.uv_layers['atlas'].data
        co = np.empty(len(uv) * 2, dtype=np.float32)
        uv.foreach_get('uv', co)
        lo, hi = min(lo, float(co.min())), max(hi, float(co.max()))
        uv.foreach_set('uv', co * ATLAS_FIT)
    if lo < -1e-4 or hi > 1 + 1e-4:
        raise RuntimeError(f'atlas UVs outside 0-1 after packing: {lo:.3f}..{hi:.3f}')


def hash3(ix, iy, iz, seed):
    h = (ix.astype(np.uint32) * np.uint32(73856093)) ^ (iy.astype(np.uint32) * np.uint32(19349663)) ^ (iz.astype(np.uint32) * np.uint32(83492791)) ^ np.uint32(seed)
    h ^= h >> np.uint32(13)
    h *= np.uint32(0x5BD1E995)
    h ^= h >> np.uint32(15)
    return (h & np.uint32(0xFFFFFF)).astype(np.float32) / float(0xFFFFFF)


def value_noise(p: np.ndarray, freq: float, seed: int) -> np.ndarray:
    q = p * freq + 1000.0
    i = np.floor(q).astype(np.int64)
    f = q - i
    f = f * f * (3 - 2 * f)
    out = np.zeros(len(p), dtype=np.float32)
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                wgt = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                out += wgt * hash3(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out


def rasterize(objs: list[bpy.types.Object]) -> dict:
    """Per texel of the atlas: part id, model position, normal and the part's param UV."""
    n = ATLAS
    part = np.zeros((n, n), dtype=np.int32)
    pos = np.zeros((n, n, 3), dtype=np.float32)
    nrm = np.zeros((n, n, 3), dtype=np.float32)
    prm = np.zeros((n, n, 2), dtype=np.float32)
    for pid, o in enumerate(objs, start=1):
        me = o.data
        me.calc_loop_triangles()
        cn = np.empty(len(me.loops) * 3, dtype=np.float32)
        me.corner_normals.foreach_get('vector', cn) if hasattr(me, 'corner_normals') else None
        cn = cn.reshape(-1, 3)
        vco = np.empty(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get('co', vco)
        vco = vco.reshape(-1, 3)
        lv = np.empty(len(me.loops), dtype=np.int64)
        me.loops.foreach_get('vertex_index', lv)
        uva = np.empty(len(me.loops) * 2, dtype=np.float32)
        me.uv_layers['atlas'].data.foreach_get('uv', uva)
        uva = uva.reshape(-1, 2) * n
        if 'param' in me.uv_layers:
            uvp = np.empty(len(me.loops) * 2, dtype=np.float32)
            me.uv_layers['param'].data.foreach_get('uv', uvp)
            uvp = uvp.reshape(-1, 2)
        else:
            uvp = np.zeros((len(me.loops), 2), dtype=np.float32)
        tris = np.empty(len(me.loop_triangles) * 3, dtype=np.int64)
        me.loop_triangles.foreach_get('loops', tris)
        tris = tris.reshape(-1, 3)
        for t in tris:
            a, b, c = uva[t[0]], uva[t[1]], uva[t[2]]
            x0 = max(int(math.floor(min(a[0], b[0], c[0]) - 1)), 0)
            x1 = min(int(math.ceil(max(a[0], b[0], c[0]) + 1)), n - 1)
            y0 = max(int(math.floor(min(a[1], b[1], c[1]) - 1)), 0)
            y1 = min(int(math.ceil(max(a[1], b[1], c[1]) + 1)), n - 1)
            if x1 < x0 or y1 < y0:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(den) < 1e-12:
                continue
            w0 = ((b[1] - c[1]) * (gx - c[0]) + (c[0] - b[0]) * (gy - c[1])) / den
            w1 = ((c[1] - a[1]) * (gx - c[0]) + (a[0] - c[0]) * (gy - c[1])) / den
            w2 = 1 - w0 - w1
            eps = -0.02
            inside = (w0 >= eps) & (w1 >= eps) & (w2 >= eps)
            if not inside.any():
                continue
            iy = gy[inside].astype(np.int64)
            ix = gx[inside].astype(np.int64)
            W = np.stack([w0[inside], w1[inside], w2[inside]], axis=1)
            part[iy, ix] = pid
            pos[iy, ix] = W @ vco[lv[t]]
            nn = W @ cn[t]
            nrm[iy, ix] = nn / np.maximum(np.linalg.norm(nn, axis=1, keepdims=True), 1e-6)
            prm[iy, ix] = W @ uvp[t]
    return {'part': part, 'pos': pos, 'nrm': nrm, 'prm': prm}


def dilate(img: np.ndarray, filled: np.ndarray, steps: int) -> np.ndarray:
    img = img.copy()
    filled = filled.copy()
    for _ in range(steps):
        acc = np.zeros_like(img)
        cnt = np.zeros(filled.shape, dtype=np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            sh_f = np.roll(np.roll(filled, dy, 0), dx, 1)
            sh_i = np.roll(np.roll(img, dy, 0), dx, 1)
            acc += sh_i * sh_f[..., None]
            cnt += sh_f
        grow = (~filled) & (cnt > 0)
        img[grow] = acc[grow] / cnt[grow][:, None]
        filled = filled | grow
    return img


def vest_masks(m: dict) -> tuple[np.ndarray, np.ndarray]:
    """Where the projected art is used: the vest (not the cream body or wings around it), and
    the green collar. Clipped to a generous outline so the wings' green lines stay out."""
    ref = m['_ref']
    h, w = ref.shape[:2]
    rgb = ref[..., :3]
    opaque = ref[..., 3] > 0.5
    cream = hex_rgb(PAL['body_cream'])
    d = np.linalg.norm(rgb - cream, axis=2)
    key = np.clip((d - 0.035) / 0.05, 0, 1) * opaque
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # the vest's outline, inside the two armhole trims and above the hem (pixels)
    hem = m['vest_hem_px'] + 4
    left = np.interp(yy, [140, 170, 265, 300, 345, 380, hem], [178, 150, 146, 128, 108, 116, 190])
    right = np.interp(yy, [140, 170, 265, 300, 345, 380, hem], [425, 448, 452, 466, 484, 478, 410])
    inside = (xx > left) & (xx < right) & (yy > 135) & (yy < hem)
    vest = key * inside
    g = rgb[..., 1]
    green = (g > rgb[..., 0] + 0.12) & opaque & (yy < 240) & inside
    return vest.astype(np.float32), green.astype(np.float32)


def paint_atlas(objs: list[bpy.types.Object], m: dict, face: dict) -> np.ndarray:
    R = rasterize(objs)
    part, pos, nrm, prm = R['part'], R['pos'], R['nrm'], R['prm']
    n = ATLAS
    kinds = np.array([''] + [PART_KIND[o.name] for o in objs])
    kind = kinds[part]
    out = np.zeros((n, n, 3), dtype=np.float32)
    filled = part > 0

    cream = hex_rgb(PAL['body_cream'])
    vest_c = hex_rgb(m['vest_colour_art'])
    green = hex_rgb(PAL['green'])
    dark_green = hex_rgb(PAL['dark_green'])
    peach_tip = hex_rgb(m['wing_tip_colour_art'])
    blush = hex_rgb(PAL['peach'])
    trim = hex_rgb(PAL['orange_trim'])
    stroke = hex_rgb('#2A1D17')
    lens_tint = hex_rgb('#DCEAF3')

    # art lookups in projector space (front view)
    ref = m['_ref']
    vest_mask, collar_mask = vest_masks(m)
    px_x = pos[..., 0] / S + CX
    px_y = CY - pos[..., 2] / S
    art = sample_bilinear(ref[..., :3], px_x, px_y)
    vm = sample_bilinear(vest_mask[..., None], px_x, px_y)[..., 0]
    cm = sample_bilinear(collar_mask[..., None], px_x, px_y)[..., 0]
    facing = -nrm[..., 1]  # 1 = looking straight at the front art
    face_w = smoothstep(0.12, 0.42, facing)

    # body, head, wings: cream
    for k in ('body', 'head', 'wing'):
        out[kind == k] = cream

    # vest: the art where it shows the vest, flat vest colour elsewhere (back, sides)
    sel = kind == 'vest'
    wv = (vm * face_w)[sel][:, None]
    out[sel] = vest_c * (1 - wv) + art[sel] * wv
    # armholes: an orange trim ring around each wing's root, all the way round (the art shows
    # the front half; the back is assumed the same)
    zs = (CY - SHOULDER_PX) * S
    for side in (1, -1):
        dyz = np.hypot(pos[..., 1] / 0.95, pos[..., 2] - zs)
        on_side = (pos[..., 0] * side) > 0.2
        ring = sel & on_side & (dyz > 0.105) & (dyz < 0.127) & ((pos[..., 0] * side) > 0.30)
        hole = sel & on_side & (dyz <= 0.105) & ((pos[..., 0] * side) > 0.30)
        out[ring] = out[ring] * (1 - 0.9) + trim * 0.9
        out[hole] = cream

    # collar: the art's green where measured, flat green with dark edges elsewhere
    sel = kind == 'collar'
    v = prm[..., 0]
    edge = (np.abs(v - 0.0) < 0.08) | (np.abs(v - 1.0) < 0.12) | (v < 0) | (v > 1)
    base = np.where(edge[..., None], dark_green, green)
    wc = (cm * face_w)[sel][:, None]
    out[sel] = base[sel] * (1 - wc) + art[sel] * wc

    # head: cheeks and the lens tint, positioned in front projection
    sel = kind == 'head'
    for side in (1, -1):
        cx, cz = side * face['cheek_dx'], face['cheek_z']
        dist = np.hypot(pos[..., 0] - cx, pos[..., 2] - cz)
        wc = (1 - smoothstep(face['cheek_r'] * 0.3, face['cheek_r'] * 1.25, dist)) * face_w * 0.85
        out[sel] = out[sel] * (1 - wc[sel][:, None]) + blush * wc[sel][:, None]
        lx, lz, lr = side * face['lens_dx'], face['lens_z'], face['lens_r']
        dist = np.hypot(pos[..., 0] - lx, pos[..., 2] - lz)
        wt = (1 - smoothstep(lr * 0.86, lr * 0.97, dist)) * face_w * 0.75
        out[sel] = out[sel] * (1 - wt[sel][:, None]) + lens_tint * wt[sel][:, None]
        # the white glint arcs drawn on the art's lenses (lower left of each lens)
        ang = np.degrees(np.arctan2(pos[..., 2] - lz, pos[..., 0] - lx)) % 360
        glint = sel & (np.abs(dist - lr * 0.78) < lr * 0.035) & (ang > 200) & (ang < 245) & (face_w > 0.5)
        out[glint] = out[glint] * 0.3 + np.array([1, 1, 1], dtype=np.float32) * 0.7

    # wings: the green line along the leading (outer) edge
    sel = kind == 'wing'
    vv = prm[..., 1]
    vv = np.minimum(vv, 1 - vv)  # distance around from the leading edge (0..0.5)
    u = prm[..., 0]
    line = sel & (vv < 0.055) & (u > 0.08) & (u < 0.95)
    out[line] = green

    # feathers (wing tips, tail): peach with short dark strokes, as in the art
    sel = kind == 'feather'
    out[sel] = peach_tip
    vfa = prm[..., 1]
    strokes = sel & (u > 0.5) & (u < 0.9) & ((np.abs(vfa - 0.25) < 0.035) | (np.abs(vfa - 0.75) < 0.035))
    out[strokes] = out[strokes] * 0.15 + stroke * 0.85

    out[kind == 'lens'] = lens_tint
    flat_colour = {'dark': hex_rgb(PAL['legs']), 'eye': hex_rgb(m['eye_colour_art']),
                   'frame': hex_rgb(PAL['glasses_frame'])}
    for k in FLAT_KINDS:
        su, sv = swatch_uv(k)
        r0, r1 = int((sv - 0.012) * n), int((sv + 0.012) * n)
        c0, c1 = int((su - 0.016) * n), int((su + 0.016) * n)
        out[r0:r1, c0:c1] = flat_colour[k]
        filled[r0:r1, c0:c1] = True

    # paper grain: two octaves of 3D value noise in model space plus a fine speckle, about +-3 %
    soft = (part > 0) & (kind != 'lens')
    p = pos[soft]
    grain = 0.6 * value_noise(p, 38.0, 11) + 0.4 * value_noise(p, 120.0, 23)
    rng = np.random.default_rng(2026)
    speckle = rng.random(len(p)).astype(np.float32)
    fac = 1.0 + 0.055 * (grain - 0.5) + 0.03 * (speckle - 0.5)
    out[soft] = np.clip(out[soft] * fac[:, None], 0, 1)

    out = dilate(out, filled, 10)
    out[~dilate(filled[..., None].astype(np.float32), filled, 10)[..., 0].astype(bool)] = cream
    log(f'atlas: {filled.mean() * 100:.0f} % of the texels are used')
    return out


def save_atlas(rgb: np.ndarray, path: str) -> bpy.types.Image:
    img = bpy.data.images.new('joud_atlas', ATLAS, ATLAS, alpha=False)
    rgba = np.concatenate([rgb, np.ones(rgb.shape[:2] + (1,), dtype=np.float32)], axis=2)
    img.pixels.foreach_set(rgba.reshape(-1).astype(np.float32))  # row 0 = v 0, as Blender stores it
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return img


def atlas_material(img: bpy.types.Image, name: str = 'joud') -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(nd for nd in nt.nodes if nd.type == 'BSDF_PRINCIPLED')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Linear'
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Metallic'].default_value = 0.0
    mat.use_backface_culling = True  # exported as single-sided: every part is a closed or lipped shell
    return mat


def lens_material() -> bpy.types.Material:
    mat = bpy.data.materials.new('joud_lens')
    mat.use_nodes = True
    bsdf = next(nd for nd in mat.node_tree.nodes if nd.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (0.72, 0.82, 0.9, 1)
    bsdf.inputs['Alpha'].default_value = 0.22
    bsdf.inputs['Roughness'].default_value = 0.2
    if hasattr(mat, 'surface_render_method'):
        mat.surface_render_method = 'BLENDED'
    elif hasattr(mat, 'blend_method'):
        mat.blend_method = 'BLEND'
    return mat


# ----------------------------------------------------------------------------------------------
# 7. export and glb post-processing
# ----------------------------------------------------------------------------------------------

def read_glb(path: str) -> tuple[dict, bytes]:
    with open(path, 'rb') as f:
        data = f.read()
    magic, _ver, _length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67, 'not a glb'
    off = 12
    js, binb = None, b''
    while off < len(data):
        clen, ctype = struct.unpack_from('<II', data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942:
            binb = chunk
        off += 8 + clen
    return js, binb


def write_glb(path: str, js: dict, binb: bytes) -> None:
    jb = json.dumps(js, separators=(',', ':')).encode('utf-8')
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    bb = binb + b'\0' * ((4 - len(binb) % 4) % 4)
    total = 12 + 8 + len(jb) + (8 + len(bb) if bb else 0)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A))
        f.write(jb)
        if bb:
            f.write(struct.pack('<II', len(bb), 0x004E4942))
            f.write(bb)


def export_glb(path: str, objs: list[bpy.types.Object], rest_position: bool) -> None:
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_image_format='WEBP',
        export_image_quality=82,
        export_skins=True,
        export_all_influences=False,
        export_animations=False,
        export_morph=False,
        export_extras=False,
        export_cameras=False,
        export_lights=False,
        export_rest_position_armature=rest_position,
        export_def_bones=False,
    )


def node_world(js: dict) -> dict[int, np.ndarray]:
    nodes = js['nodes']
    parent = {}
    for i, nd in enumerate(nodes):
        for c in nd.get('children', []):
            parent[c] = i

    def local(nd):
        t = np.array(nd.get('translation', [0, 0, 0]), dtype=np.float64)
        x, y, z, w = nd.get('rotation', [0, 0, 0, 1])
        s = np.array(nd.get('scale', [1, 1, 1]), dtype=np.float64)
        rot = np.array([
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ])
        mat = np.eye(4)
        mat[:3, :3] = rot * s
        mat[:3, 3] = t
        return mat

    cache: dict[int, np.ndarray] = {}

    def world(i):
        if i not in cache:
            cache[i] = (world(parent[i]) @ local(nodes[i])) if i in parent else local(nodes[i])
        return cache[i]

    return {i: world(i) for i in range(len(nodes))}


# ----------------------------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------------------------

def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'

    # --- measurements --------------------------------------------------------------------------
    m = measure_reference()
    face = face_layout(m)
    log(f'Blender {bpy.app.version_string}; reference {m["image"][0]} x {m["image"][1]} px, '
        f'scale {S:.6f} units/px (body half-width 189 px = 0.6), origin at px ({CX:.0f}, {CY:.0f})')
    rows = [
        ('alpha bounds (px)', m['alpha_bbox'], ''),
        ('head top (px row)', m['head_top_px'], f'z {(CY - m["head_top_px"]) * S:.3f}'),
        ('head half-width (px)', m['head_half_width_px'], f'{m["head_half_width_px"] * S:.3f}'),
        ('body bottom (px row)', m['body_bottom_px'], f'z {(CY - m["body_bottom_px"]) * S:.3f}'),
        ('vest hem (px row)', m['vest_hem_px'], f'z {(CY - m["vest_hem_px"]) * S:.3f}'),
        ('collar, front top (px row)', m['collar_front_top_px'], f'z {(CY - m["collar_front_top_px"]) * S:.3f}'),
        ('lens L / R centre, radius (px)', (m['lens_left_px'], m['lens_right_px']),
         f'model: x +-{face["lens_dx"]:.3f}, z {face["lens_z"]:.3f}, r {face["lens_r"]:.3f}'),
        ('eye L / R (px)', (m['eye_left_px'], m['eye_right_px']), f'model: x +-{face["eye_dx"]:.3f}, z {face["eye_z"]:.3f}'),
        ('wing tip L / R bounds (px)', (m['wing_tip_left_bbox_px'], m['wing_tip_right_bbox_px']), ''),
        ('colours from the art', {k: m[k] for k in ('vest_colour_art', 'wing_tip_colour_art', 'eye_colour_art', 'frame_colour_art', 'lens_colour_art')}, ''),
    ]
    log('measurements from docs/references/joud_ref_round_front.png:')
    for label, val, model in rows:
        print(f'    {label:34s} {val}  {model}')
    head_top_z = (CY - PROFILE_PX[0][0]) * S
    bottom_z = (CY - PROFILE_PX[-1][0]) * S
    log(f'model: height {head_top_z - bottom_z:.3f} (head top {head_top_z:.3f}, body bottom {bottom_z:.3f}), '
        f'body half-width 0.600, head {(head_top_z - NECK_Z) / (head_top_z - bottom_z) * 100:.0f} % of the height '
        f'(brief: 33 %), wing {WING_LEN + FEATHER_BASE * 0 + max(FEATHER_LENS) - (WING_LEN - FEATHER_BASE):.2f} from the shoulder joint')

    # --- parts -----------------------------------------------------------------------------------
    parts_coll = bpy.data.collections.new('Joud_parts')
    rig_coll = bpy.data.collections.new('Joud_rig')
    extra_coll = bpy.data.collections.new('Blender_only')
    for c in (parts_coll, rig_coll, extra_coll):
        scene.collection.children.link(c)

    head, body = build_body_and_head(parts_coll)
    vest = build_vest(m, parts_coll)
    collar = build_collar(m, parts_coll)
    wings = []
    for side in (1, -1):
        wings.extend(build_wing(side, parts_coll))
    tail = build_tail(parts_coll)
    legs = [build_leg(1, parts_coll), build_leg(-1, parts_coll)]
    frame, lenses = build_glasses(face, parts_coll)
    eyes = build_eyes(face, parts_coll)
    beak = build_beak(face, parts_coll)
    for ln in lenses:
        parts_coll.objects.unlink(ln)
        extra_coll.objects.link(ln)
    textured = [o for o in PARTS if PART_KIND[o.name] != 'lens']
    log('parts: ' + ', '.join(f'{o.name} {len(o.data.polygons)}f' for o in PARTS))

    # --- UVs and texture ---------------------------------------------------------------------------
    unwrap_atlas(textured)
    for ln in lenses:
        ln.data.uv_layers.new(name='atlas')
    atlas_rgb = paint_atlas(textured, m, face)
    tmpdir = tempfile.mkdtemp(prefix='joud_')
    atlas_path = os.path.join(tmpdir, 'joud_atlas.png')
    img = save_atlas(atlas_rgb, atlas_path)
    img.pack()
    try:
        save_atlas(atlas_rgb, OUT_ATLAS_PREVIEW)
    except Exception as exc:  # preview only
        log(f'atlas preview not written: {exc}')
    mat = atlas_material(img)
    for o in textured:
        o.data.materials.append(mat)
    lmat = lens_material()
    for ln in lenses:
        ln.data.materials.append(lmat)

    # --- rig --------------------------------------------------------------------------------------
    arm = build_armature(face, rig_coll)
    for o in PARTS:
        assign_weights(o, weight_fn)
        mod = o.modifiers.new('Armature', 'ARMATURE')
        mod.object = arm
        o.parent = arm
    sockets = {
        'socket_head_top': (Vector((0, 0, head_top_z)), 'head'),
        'socket_eyes': (Vector((0, lens_frame(face, 1).translation.y, face['lens_z'])), 'head'),
        'socket_neck': (Vector((0, surface_y(0, (CY - m['collar_front_top_px'] - 8) * S, offset=0.035), (CY - m['collar_front_top_px'] - 8) * S)), 'body'),
        'socket_chest': (Vector((0, surface_y(0, (CY - 290) * S, offset=0.016), (CY - 290) * S)), 'body'),
        'socket_back': (Vector((0, surface_y(0, (CY - 260) * S, front=False, offset=0.016), (CY - 260) * S)), 'body'),
        'socket_feet': (Vector((0, 0, ANKLE_Z)), 'root'),
    }
    socket_objs = [add_socket(nm, pos, arm, bn, rig_coll) for nm, (pos, bn) in sockets.items()]

    # --- reference image in the .blend (front view) -------------------------------------------------
    ref_img = bpy.data.images.load(REF_FRONT)
    ref_img.pack()
    ref_empty = bpy.data.objects.new('ref_front_art', None)
    ref_empty.empty_display_type = 'IMAGE'
    ref_empty.data = ref_img
    w_px, h_px = m['image']
    ref_empty.empty_display_size = w_px * S
    ref_empty.empty_image_offset = (0, 0)
    x0, z1 = px_to_model(0, 0)
    ref_empty.location = (x0, 1.2, z1 - h_px * S)
    ref_empty.rotation_euler = (math.radians(90), 0, 0)
    ref_empty.empty_image_side = 'FRONT'
    extra_coll.objects.link(ref_empty)

    # --- folded pose ------------------------------------------------------------------------------
    fold = tune_folded_pose(arm, [o for o in wings])

    # --- export: join a copy of the parts (one mesh, one material) ------------------------------------
    clear_pose(arm)
    exp_parts = [o for o in textured] + (lenses if WITH_LENSES else [])
    copies = []
    for o in exp_parts:
        c = o.copy()
        c.data = o.data.copy()
        parts_coll.objects.link(c)
        copies.append(c)
    bpy.ops.object.select_all(action='DESELECT')
    opaque = [c for c in copies if PART_KIND.get(c.name.split('.')[0]) != 'lens']
    for c in opaque:
        c.select_set(True)
    bpy.context.view_layer.objects.active = opaque[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = 'Joud'
    joined.data.name = 'Joud'
    # weld the head-body seam
    bm = bmesh.new()
    bm.from_mesh(joined.data)
    na, nb = radii_at_z(NECK_Z)
    seam = [v for v in bm.verts if abs(v.co.z - NECK_Z) < 1e-5 and abs((v.co.x / na) ** 2 + (v.co.y / nb) ** 2 - 1) < 1e-3]
    bmesh.ops.remove_doubles(bm, verts=seam, dist=1e-5)
    bm.to_mesh(joined.data)
    bm.free()
    if 'param' in joined.data.uv_layers:
        joined.data.uv_layers.remove(joined.data.uv_layers['param'])
    lens_copies = [c for c in copies if c not in opaque]
    export_objs = [arm, joined] + lens_copies + socket_objs

    tmp_fold = os.path.join(tmpdir, 'fold.glb')
    set_wing_pose(arm, fold['shoulder_down_deg'], fold['fold_back_deg'], fold['tip_deg'], 0.0, fold['twist_deg'])
    export_glb(tmp_fold, export_objs, rest_position=False)
    clear_pose(arm)
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    export_glb(OUT_GLB, export_objs, rest_position=True)

    # --- post-process: rest_folded pose and metadata into the armature node's extras -------------------
    js, binb = read_glb(OUT_GLB)
    fjs, _ = read_glb(tmp_fold)
    names = [nd.get('name') for nd in js['nodes']]
    skin = js['skins'][0]
    joints = [names[j] for j in skin['joints']]
    folded = {}
    for nd in fjs['nodes']:
        if nd.get('name', '').startswith('wing_'):
            q = nd.get('rotation', [0, 0, 0, 1])
            folded[nd['name']] = [round(v, 6) for v in q]
    worlds = node_world(js)
    eye_i = names.index('eye_ctrl')
    ew = worlds[eye_i][:3, :3]
    axis = int(np.argmax(np.abs(ew[1, :])))  # which local axis points up (glTF +Y)
    arm_i = names.index('Joud_Armature')
    tris = 0
    for mesh in js['meshes']:
        for prim in mesh['primitives']:
            tris += js['accessors'][prim['indices']]['count'] // 3
    verts = sum(js['accessors'][p['attributes']['POSITION']]['count'] for mm in js['meshes'] for p in mm['primitives'])
    js['nodes'][arm_i].setdefault('extras', {})['joud'] = {
        'model': 'joud-v2',
        'source': 'tools/blender/build_joud.py',
        'units': 'model units; body half-width 0.6; game scale 0.2',
        'facing': '+Z front, +X Joud\'s left, +Y up',
        'bind_pose': 'wings straight out to the sides',
        'poses': {'rest_folded': folded},
        'rest_folded_search': fold,
        'blink': {'bone': 'eye_ctrl', 'local_axis': 'xyz'[axis], 'closed_scale': 0.1},
        'sockets': {nm: bn for nm, (_p, bn) in sockets.items()},
        'joints': joints,
        'palette': {k: PAL[k] for k in ('body_cream', 'vest', 'green', 'dark_green', 'peach', 'orange_trim', 'glasses_frame', 'legs')},
    }
    js['asset']['extras'] = {'title': 'Joud Bird (joud-v2)', 'source': 'tools/blender/build_joud.py'}
    write_glb(OUT_GLB, js, binb)
    size_kb = os.path.getsize(OUT_GLB) / 1024
    images = [(im.get('mimeType'), js['bufferViews'][im['bufferView']]['byteLength'] // 1024) for im in js.get('images', [])]
    log(f'wrote {os.path.relpath(OUT_GLB, REPO)}: {size_kb:.0f} KB, {len(js["meshes"])} mesh(es), '
        f'{len(js.get("materials", []))} material(s), {tris} triangles, {verts} vertices, {len(joints)} joints, '
        f'images {images}, blink axis {"xyz"[axis]}')
    log('joints: ' + ', '.join(joints))
    log('sockets: ' + ', '.join(sockets))
    if size_kb > SIZE_LIMIT_KB:
        log(f'WARNING: over the {SIZE_LIMIT_KB} KB budget')

    # --- the .blend: parts separate, no joined copy ------------------------------------------------------
    for c in [joined] + lens_copies:
        bpy.data.objects.remove(c, do_unlink=True)
    if SAVE_BLEND:
        set_wing_pose(arm, fold['shoulder_down_deg'], fold['fold_back_deg'], fold['tip_deg'], 0.0, fold['twist_deg'])
        # keep the folded pose as a pose-library-free custom property too
        arm['rest_folded'] = json.dumps(fold)
        clear_pose(arm)
        bpy.context.preferences.filepaths.save_version = 0  # no joud-v2.blend1 backup
        bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, compress=True)
        mb = os.path.getsize(OUT_BLEND) / 1e6
        log(f'wrote {os.path.relpath(OUT_BLEND, REPO)}: {mb:.2f} MB')
        if mb > BLEND_LIMIT_MB:
            os.remove(OUT_BLEND)
            log(f'.blend over {BLEND_LIMIT_MB} MB: removed (the script rebuilds it)')


if __name__ == '__main__':
    main()
