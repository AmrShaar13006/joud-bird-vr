"""Joud hero model v2, built by script. The script is the source of truth.

Run from the repo root (Blender 4.2 LTS or newer, tested on 5.3):

    blender -b -P tools/blender/build_joud.py
    blender -b -P tools/blender/build_joud.py -- --no-blend      # skip saving the .blend
    blender -b -P tools/blender/build_joud.py -- --with-lenses   # also export see-through lenses

Options for trying other numbers (they change what is written, so build again without them):
    --wing-scale=1.0                    the wing at the poster's full length (built 10 % shorter)
    --fold=elev=-60,twist=-10           other numbers for the folded pose (joud_clips.FOLD)
    --tune-fold                         search for a folded pose and print it
    --shade=fan.top=22:-40,wing.weight=0.7   other painted shading directions for the wing (SHADE)

Writes
    public/models/joud-v2.glb    one skinned mesh, one material, 1024 webp atlas, armature,
                                 socket nodes, the five animation clips (idle, flap, glide, fall,
                                 crash) and the rest_folded pose in the armature's extras.
                                 Building again writes the same bytes (checked on Blender 5.3).
    tools/blender/joud-v2.blend  the same model with every part as its own object (if < 5 MB)

Where things come from
    docs/joud-brief.json                      palette and the locked character decisions
    docs/references/joud_ref_round_front.png  proportions (measured below) and the vest, collar,
                                              flowers, buttons and emblem, projected from the art
    docs/references/joud_ref_flying_poster_crop.png  wing length and the spread pose
    docs/references/joud_ref_slim_side.png    legs, toes and the small tail (side view)
    tools/blender/flap_proto.py               Amr's prototype: the wing's roll, chord and thickness
                                              (reshape_wings) and the flap's numbers (pose_B)
    tools/blender/joud_clips.py               the folded pose and the clips, as numbers

Axes: Blender is Z up and Joud faces -Y; +X is Joud's left. The glTF file is Y up and Joud
faces +Z (the exporter converts). One model unit = the old joud.glb's unit: the body is about
0.6 wide from the centre, so the game's 0.2 scale keeps the 0.12 m collision radius.

Assumptions, for Joud's approval (no reference shows these): the plain back of the vest and the
collar going round the neck; the small three-feather tail; the armhole trim as a ring round the
wing's root; the folded wing's length and hang (the poster's long wing reaches lower than the
round front art's, so the wing is built 10 % shorter than the poster's); the lens tint painted
on the face instead of see-through lenses.

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

sys.dont_write_bytecode = True  # no tools/blender/__pycache__
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import joud_clips  # noqa: E402  (the folded pose and the animation clips, next to this file)

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
TUNE_FOLD = '--tune-fold' in ARGS  # search for a better folded pose and print its numbers

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
# v2.1: rebuilt from Amr's prototype (tools/blender/flap_proto.py, reshape_wings()).
# v2.0's wing was a plank in the frontal plane (broad face forwards), so a flap turned it like a
# windscreen wiper. The prototype rolls that plank 65 degrees about the wing's long axis - the
# model's X axis for BOTH wings, so the green top edge becomes the leading edge (-Y, forwards) on
# the left and on the right - then widens the chord 2.1x at the root to 1.35x at the tip and
# thins it to 0.7x. proto_section() gives that section's chord, thickness and incidence. On top
# of it this build adds a slight camber (curved top, flat underside), a root narrow enough for
# the vest's armhole, a rounded end, a row of rounded secondary feathers along the trailing edge
# and a soft fan of tip feathers that a bone of its own (wing_fan) closes and spreads.
# Wing space: +X along the wing from the shoulder joint, +Y back (the trailing edge), +Z up.
# The right wing is the left one mirrored in X only, so both leading edges face -Y.

SHOULDER_PX = 190.0  # the green line starts at the collar's corner (art)
WING_SHOULDER_X = 0.40           # inside the body: the root is hidden under the vest
# Poster: the wing reaches about 1.3 from the shoulder joint; the round front art's folded wing
# only about 1.0. At the poster's length the tucked wing either hangs to the feet or needs a 31
# degree kink at the mid joint to bring its tip up beside the lower belly, so the wing is built
# 10 % shorter along its length instead (Amr, 27 Nov: shorten by up to 10 % rather than bend the
# joints further). `--wing-scale=1.0` builds the full length for comparison.
WING_SCALE = float(next((a.split('=')[1] for a in ARGS if a.startswith('--wing-scale=')), 0.9))
WING_LEN = 1.00                  # the cream part's end, from the shoulder joint (before WING_SCALE)
FAN_PIVOT = 0.84                 # the rounded end starts here; the tip fan turns about this point
WING_BONES = [0.0, 0.42, 0.84, 1.30]   # shoulder, mid, tip joints along the wing (+ tip end)
ROLL_DEG, CHORD_ROOT, CHORD_TIP, THIN = 65.0, 2.1, 1.35, 0.7   # flap_proto.py, reshape_wings()
CAMBER = 0.06                    # height of the mean line at mid chord, as a part of the chord
BLADE = 0.70                     # the cream blade covers this much of the chord, from the leading edge;
                                 # the secondaries make up the rest
SEC_COUNT = 7                    # secondary feathers along the trailing edge
FAN_DEG = [-34, -20.4, -6.8, 6.8, 20.4, 34]    # tip feathers, from the leading side to the trailing
FAN_VISIBLE = [0.24, 0.28, 0.30, 0.30, 0.28, 0.24]  # how far each reaches past the cream end
FEATHER_ROUND = [(0.0, 0.50), (0.30, 0.82), (0.58, 1.0), (0.80, 0.92), (0.93, 0.66), (0.985, 0.34)]  # (along, width)
SEC_ROUND = [(0.0, 0.60), (0.45, 0.96), (0.75, 1.0), (0.93, 0.62)]
RIGID_S: dict[str, list[float]] = {}  # object name -> per vertex, the station its feather is rooted at


def wing_frame(side: int) -> Matrix:
    """Wing space -> model space."""
    z = (CY - SHOULDER_PX) * S
    mat = Matrix.Translation((side * WING_SHOULDER_X, 0, z))
    return mat @ Matrix.Diagonal((side * WING_SCALE, 1, 1, 1))


def proto_section(s: float) -> tuple[float, float, float]:
    """(half chord, half thickness, incidence in radians: leading edge up) of the prototype's
    wing at station s: v2.0's plank (half-chord c, vertical; half-thickness t) rolled ROLL_DEG
    about the wing's long axis, then scaled CHORD_ROOT..CHORD_TIP front to back and THIN up-down,
    exactly as reshape_wings() does. An ellipse stays an ellipse: these are its axes."""
    c = float(np.interp(s, [-0.1, 0.0, 0.25, 0.6, 0.9, 1.08], [0.085, 0.11, 0.128, 0.136, 0.14, 0.134]))
    t = float(np.interp(s, [-0.1, 0.4, 1.08], [0.052, 0.046, 0.034]))
    f = CHORD_ROOT + (CHORD_TIP - CHORD_ROOT) * min(1.0, max(0.0, s / 1.4))
    cr, sr = math.cos(math.radians(ROLL_DEG)), math.sin(math.radians(ROLL_DEG))
    m = np.array([[f * cr * t, -f * sr * c], [THIN * sr * t, THIN * cr * c]])  # (y, z) of the two axes
    u, sv, _vt = np.linalg.svd(m)
    major = u[:, 0] if u[0, 0] < 0 else -u[:, 0]  # towards the leading edge (-Y)
    return float(sv[0]), float(sv[1]), math.atan2(major[1], -major[0])


def wing_section(s: float) -> dict:
    """The wing's cross-section at station s (wing space, before WING_SCALE): 'a' is half the
    whole chord (blade and secondaries), centred on (y, z); 'blade_a' and 'blade_y' the same for
    the cream blade alone, which shares the leading edge."""
    sp = min(s, FAN_PIVOT)
    a_p, b_p, inc = proto_section(max(sp, 0.0))
    r = float(smoothstep(-0.06, 0.24, sp))  # the root is narrower (it enters the vest's armhole)
    a = 0.105 + (a_p - 0.105) * r
    top = 0.050 + (1.28 * b_p - 0.050) * r    # curved top ...
    bot = 0.050 + (0.72 * b_p - 0.050) * r    # ... flatter underside; top + bot = the prototype's thickness
    out = max(0.0, sp) / WING_LEN
    y = 0.2 * a * r + 0.05 * out * out        # the bones run nearer the leading edge; tip swept back a little
    cover = 1.0 + (BLADE - 1.0) * float(smoothstep(0.02, 0.20, sp))  # the root is all blade
    sec = {
        'a': a, 'y': y, 'z': -0.012 * out * out, 'inc': inc, 'top': top, 'bot': bot,
        'blade_a': a * cover, 'blade_y': y - a * (1 - cover) * math.cos(inc),
        'blade_z': -0.012 * out * out + a * (1 - cover) * math.sin(inc),
    }
    sec['camber'] = CAMBER * 2 * sec['blade_a'] * r
    if s > FAN_PIVOT:  # the rounded end: half an ellipse centred on the fan's pivot
        e = min(0.999, (s - FAN_PIVOT) / (WING_LEN - FAN_PIVOT))
        k = math.sqrt(1 - e * e)
        sec.update(blade_a=sec['blade_a'] * k, top=top * k ** 0.6, bot=bot * k ** 0.6, camber=sec['camber'] * k * k)
    return sec


def section_axes(inc: float) -> tuple[Vector, Vector]:
    """(towards the trailing edge, the top surface's normal) for a section tilted by inc."""
    return Vector((0, math.cos(inc), -math.sin(inc))), Vector((0, math.sin(inc), math.cos(inc)))


def feather_bm(origin: Vector, along: Vector, across: Vector, normal: Vector, length: float,
               half_width: float, half_thick: float, profile: list[tuple[float, float]],
               sides: int, roll_deg: float = 0.0) -> bmesh.types.BMesh:
    """One soft, round-ended feather: a flat closed shell from origin along `along`. `across` and
    `normal` span its cross-section; roll_deg tips it about its length so neighbours overlap like
    shingles. Param UV: u along, v around (0 = one edge, 0.25 = the top's centre line)."""
    rr = math.radians(roll_deg)
    w = across * math.cos(rr) + normal * math.sin(rr)
    nrm = normal * math.cos(rr) - across * math.sin(rr)
    rings, us = [], []
    for u, wf in profile:
        p = origin + along * (u * length)
        th = half_thick * (1 - 0.5 * u)
        rings.append([p + w * (half_width * wf * math.cos(2 * math.pi * j / sides))
                      + nrm * (th * math.sin(2 * math.pi * j / sides)) for j in range(sides)])
        us.append(u)
    bm = grid_bmesh(rings, us, origin - along * 0.01, origin + along * length)
    for e in bm.edges:  # the rim is a sharp edge: each face then shades flat, like a feather, not a tube
        if all(abs((v.co - origin).dot(nrm)) < 1e-6 for v in e.verts):
            e.smooth = False
    return bm


# Shading normals of the wing. Each face starts from a painted direction instead of its own
# normal: (lean, span) in degrees, lean from straight up towards the leading edge, span towards
# the wing's tip (negative: towards its root); `weight` mixes it with the face's own normal
# (1 = the painted direction alone). One pair for the faces of the top, one for the underside
# ('under' at the root, 'under_tip' at the blade's end where it differs).
# The numbers come from a search over every clip's key poses as the game shows them (the bird
# turned -55 degrees and tilted with its speed, the game's sky and sun) and from the front: the
# light on each visible face, kept as high and as even as one direction per face allows.
SHADE = {
    'wing': {'top': (45.0, -15.0), 'under': (65.0, 10.0), 'under_tip': (85.0, 10.0), 'weight': 0.85},  # blade, secondaries
    'fan': {'top': (30.0, -30.0), 'under': (60.0, 10.0), 'weight': 1.0},
}
for _arg in ARGS:  # --shade=fan.top=22:-40,wing.weight=0.7 : try other numbers
    if _arg.startswith('--shade='):
        for _kv in _arg[8:].split(','):
            _key, _val = _kv.split('=')
            _part, _what = _key.split('.')
            SHADE[_part][_what] = float(_val) if _what == 'weight' else tuple(float(v) for v in _val.split(':'))


def card_normals(obj: bpy.types.Object, side: int, shade: dict) -> None:
    """Paint the wing's shading normals so it reads as flat colour, as in the art: cream on both
    faces, with the peach tip fan staying peach.

    The game lights Joud with a white sky over a green ground and one sun, and no fill. With
    true normals every underside turned dark olive, so a flap strobed cream and olive, and the
    peach fan went brown whenever it was seen from below. So each face starts from a painted
    direction (SHADE): the top from one that leans a little forwards, the underside from one
    that leans further forwards - not downwards. The camera and the sun are always in front of
    Joud, and "forwards" does not change when the wing is raised, lowered or folded, so the
    colour holds through a flap. The wing still moves with its bones and the normals turn with
    it, so a raised wing is a little darker underneath than a level one; it just starts from a
    kinder direction. Round the blade's edges the two directions blend. The price: seen from
    behind, the wing is darker than the body."""
    me = obj.data

    def painted(pair: tuple[float, float]) -> Vector:
        le, sp = math.radians(pair[0]), math.radians(pair[1])
        return Vector((math.sin(sp) * side, -math.sin(le) * math.cos(sp), math.cos(le) * math.cos(sp)))

    top, under = painted(shade['top']), painted(shade['under'])
    under_tip = painted(shade.get('under_tip', shade['under']))
    weight = shade['weight']
    out = []
    for loop, cn in zip(me.loops, me.corner_normals):
        n = Vector(cn.vector)
        s = ((me.vertices[loop.vertex_index].co.x * side) - WING_SHOULDER_X) / WING_SCALE
        s = min(max(s, 0.0), FAN_PIVOT)
        up = section_axes(wing_section(s)['inc'])[1]
        d = n.dot(up)
        k = float(smoothstep(-0.35, 0.35, d))      # 0 on the underside, 1 on the top
        if d < 0:
            n = n - 2 * d * up                     # the underside's own normal, mirrored to look up
        below = under.lerp(under_tip, s / FAN_PIVOT)
        towards = (below * (1 - k) + top * k).normalized()
        out.append(tuple((n * (1 - weight) + towards * weight).normalized()))
    me.normals_split_custom_set(out)


def build_wing(side: int, coll) -> tuple[bpy.types.Object, bpy.types.Object, bpy.types.Object]:
    name = 'L' if side > 0 else 'R'
    mat = wing_frame(side)

    def place(bm: bmesh.types.BMesh) -> bmesh.types.BMesh:
        bmesh.ops.transform(bm, matrix=mat, verts=bm.verts)
        if side < 0:  # the mirror turned the faces inside out
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
        return bm

    # --- the cream blade ---------------------------------------------------------------------
    end = WING_LEN - FAN_PIVOT
    ss = [-0.10, 0.0, 0.10, 0.21, 0.32, 0.40, 0.48, 0.60, 0.72, FAN_PIVOT] + [
        FAN_PIVOT + end * math.sin(math.radians(d)) for d in (35, 62, 80)]
    n = 12
    rings = []
    for s in ss:
        sec = wing_section(s)
        tr, nrm = section_axes(sec['inc'])
        centre = Vector((s, sec['blade_y'], sec['blade_z']))
        ring = []
        for j in range(n):
            psi = 2 * math.pi * j / n  # 0 = the leading edge, then over the top to the trailing edge
            xi, zeta = math.cos(psi), math.sin(psi)
            h = sec['camber'] * (1 - xi * xi) + (sec['top'] if zeta >= 0 else sec['bot']) * zeta
            ring.append(centre - tr * (sec['blade_a'] * xi) + nrm * h)
        rings.append(ring)
    us = [(s + 0.1) / (WING_LEN + 0.1) for s in ss]
    first, last = wing_section(ss[0]), wing_section(FAN_PIVOT)
    pole_s = Vector((-0.13, first['blade_y'], first['blade_z']))
    pole_e = Vector((WING_LEN + 0.004, last['blade_y'], last['blade_z']))
    wing = new_object(f'wing_{name}', place(grid_bmesh(rings, us, pole_s, pole_e)), 'wing', coll)

    # --- secondaries: a row of rounded feathers that make up the rear of the chord ---------------
    sb = bmesh.new()
    rigid: list[float] = []
    for i in range(SEC_COUNT):
        f = i / (SEC_COUNT - 1)
        s0 = 0.17 + (0.78 - 0.17) * f
        sec = wing_section(s0)
        tr, nrm = section_axes(sec['inc'])
        lean = math.radians(4 + 34 * f * f)  # from straight back to leaning towards the tip
        along = (tr * math.cos(lean) + Vector((1, 0, 0)) * math.sin(lean)).normalized()
        across = along.cross(nrm).normalized()
        root = Vector((s0, sec['y'], sec['z'])) - nrm * 0.006   # under the blade, at mid chord
        length = (sec['a'] + 0.02) / math.cos(lean) * (1.0 - 0.10 * f)
        b1 = feather_bm(root, along, across, nrm, length, 0.082, 0.010, SEC_ROUND, 4, roll_deg=-6)
        rigid += [s0] * len(b1.verts)
        merge_bm(sb, b1)
    sec_obj = new_object(f'wing_sec_{name}', place(sb), 'wingfeather', coll)
    RIGID_S[sec_obj.name] = rigid

    # --- the tip fan: soft, round, wide feathers round the cream end --------------------------------
    fb = bmesh.new()
    sec = wing_section(FAN_PIVOT)
    tr, nrm = section_axes(sec['inc'])
    pivot = Vector((FAN_PIVOT, sec['blade_y'], sec['blade_z']))
    for k, (deg, vis) in enumerate(zip(FAN_DEG, FAN_VISIBLE)):
        th = math.radians(deg)
        along = (Vector((1, 0, 0)) * math.cos(th) + tr * math.sin(th)).normalized()
        across = along.cross(nrm).normalized()
        cap = 1 / math.sqrt((math.cos(th) / end) ** 2 + (math.sin(th) / sec['blade_a']) ** 2)  # the cream end's edge
        start = pivot + along * (cap - 0.07) + nrm * ((2.5 - k) * 0.004)
        merge_bm(fb, feather_bm(start, along, across, nrm, vis + 0.07, 0.080, 0.012, FEATHER_ROUND, 6, roll_deg=-8))
    fan = new_object(f'wing_fan_{name}', place(fb), 'feather', coll)
    card_normals(wing, side, SHADE['wing'])
    card_normals(sec_obj, side, SHADE['wing'])
    card_normals(fan, side, SHADE['fan'])
    return wing, sec_obj, fan


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
        # create_uvsphere leaves its faces in an order that changes from run to run (the same
        # triangles, shuffled): sort them, so the same script always writes the same GLB
        e.faces.index_update()
        by_centre = sorted(e.faces, key=lambda f: tuple(round(c, 5) for c in f.calc_center_median()))
        rank = {f.index: i for i, f in enumerate(by_centre)}
        e.faces.sort(key=lambda f: rank[f.index])
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
    # the glasses: a bone along the line of sight through the bridge, so turning it about its
    # own length tips the frame sideways (the crash clip)
    gy = lens_frame(face, 1).translation.y
    bone('glasses', (0, gy + 0.12, face['lens_z']), (0, gy, face['lens_z']), 'head')
    for side, sfx in ((1, 'L'), (-1, 'R')):
        mat = wing_frame(side)
        names = ['wing_shoulder', 'wing_mid', 'wing_tip']
        for i, nm in enumerate(names):
            h = mat @ Vector((WING_BONES[i], 0, 0))
            t = mat @ Vector((WING_BONES[i + 1], 0, 0))
            bone(f'{nm}_{sfx}', h, t, 'body' if i == 0 else f'{names[i - 1]}_{sfx}', connect=i > 0)
        # the tip fan turns about the centre of the wing's rounded end. Its local Z is the wing's
        # normal, so its local X is the chord: scaling X closes or spreads the fan.
        sec = wing_section(FAN_PIVOT)
        fan = bone(f'wing_fan_{sfx}', mat @ Vector((FAN_PIVOT, sec['blade_y'], sec['blade_z'])),
                   mat @ Vector((WING_BONES[3], sec['blade_y'], sec['blade_z'])), f'wing_tip_{sfx}')
        fan.align_roll(section_axes(sec['inc'])[1])
        hip, knee, ankle = leg_points(side)
        bone(f'leg_upper_{sfx}', hip, knee, 'body')
        bone(f'leg_lower_{sfx}', knee, ankle, f'leg_upper_{sfx}', connect=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    arm_data.display_type = 'STICK'
    return arm


def assign_weights(obj: bpy.types.Object, fn) -> None:
    """fn(world position, part name, vertex index) -> {bone: weight}."""
    groups = {}
    for v in obj.data.vertices:
        for bname, w in fn(obj.matrix_world @ v.co, obj.name, v.index).items():
            if w <= 1e-4:
                continue
            if bname not in groups:
                groups[bname] = obj.vertex_groups.get(bname) or obj.vertex_groups.new(name=bname)
            groups[bname].add([v.index], float(w), 'REPLACE')


WING_BLEND = (0.16, 0.12)  # half-width of the zone where two wing bones share a vertex: mid joint, tip joint.
# Wide, so a bend or a fold at a joint spreads into an arc instead of a kink.
ROOT_BLEND = (-0.04, 0.08)  # stations over which the wing's root passes from the body to the shoulder bone.
# The root (inside the body, under the vest) stays with the body: after the roll a root that
# turned with the shoulder swung out through the collar whenever the wing was lowered or raised.


def wing_weights(s: float, sfx: str) -> dict:
    """Body, shoulder, mid and tip weights for a point at station s along the wing."""
    w_root = float(smoothstep(ROOT_BLEND[0], ROOT_BLEND[1], s))
    w_mid = float(smoothstep(WING_BONES[1] - WING_BLEND[0], WING_BONES[1] + WING_BLEND[0], s))
    w_tip = float(smoothstep(WING_BONES[2] - WING_BLEND[1], WING_BONES[2] + WING_BLEND[1], s))
    return {'body': 1 - w_root, f'wing_shoulder_{sfx}': w_root - w_mid, f'wing_mid_{sfx}': w_mid - w_tip,
            f'wing_tip_{sfx}': w_tip}


def weight_fn(p: Vector, part: str, index: int = 0) -> dict:
    if part in ('glasses_frame', 'lens_L', 'lens_R'):
        return {'glasses': 1.0}
    if part in ('head', 'beak'):
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
        if part.startswith('wing_fan'):
            return {f'wing_fan_{sfx}': 1.0}
        if part.startswith('wing_sec'):  # each secondary moves as one piece, with the wing at its root
            return wing_weights(RIGID_S[part][index], sfx)
        return wing_weights(((p.x * side) - WING_SHOULDER_X) / WING_SCALE, sfx)
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
# 5. the rest_folded pose (wings down along the body's side, as in the front and side art)
# ----------------------------------------------------------------------------------------------
# The pose's numbers live in joud_clips.py (FOLD): the idle and crash clips use them too.
# fold_report() measures the pose against the body on every build; `--tune-fold` searches for
# better numbers and prints them (it does not change joud_clips.py).

FOLD_FAN_TARGET = (0.66, -0.42)  # (x, z) of the tip fan's centre: beside the lower belly


def body_distance(pts: np.ndarray) -> np.ndarray:
    """How far each point (n, 3) is outside the body and vest, along the ray from the body's
    axis; negative inside. Below the body's bottom or above its top: the distance to that end."""
    y_px = CY - pts[:, 2] / S
    a = np.maximum(half_width_px(y_px) * S, 1e-4) + 0.016
    b = a * depth_ratio(y_px)
    r = np.hypot(pts[:, 0], pts[:, 1])
    qq = np.sqrt((pts[:, 0] / a) ** 2 + (pts[:, 1] / b) ** 2)
    d = r * (1 - 1 / np.maximum(qq, 1e-6))
    top, bottom = (CY - PROFILE_PX[0][0]) * S, (CY - PROFILE_PX[-1][0]) * S
    d = np.where(pts[:, 2] < bottom, np.hypot(r, bottom - pts[:, 2]), d)
    return np.where(pts[:, 2] > top, np.hypot(r, pts[:, 2] - top), d)


class WingSkin:
    """The left wing's vertices and weights as arrays, so a pose can be measured without
    Blender re-evaluating the meshes (linear blend skinning, as the armature modifier does)."""

    def __init__(self, arm, objs: list[bpy.types.Object]) -> None:
        self.arm = arm
        self.bones = ['body'] + [f'wing_{n}_L' for n in ('shoulder', 'mid', 'tip', 'fan')]
        rest, wts, part, stn = [], [], [], []
        for o in objs:
            groups = {g.index: g.name for g in o.vertex_groups}
            for v in o.data.vertices:
                p0 = o.matrix_world @ v.co
                w = [0.0] * len(self.bones)
                for g in v.groups:
                    if groups[g.group] in self.bones:
                        w[self.bones.index(groups[g.group])] = g.weight
                rest.append(p0)
                wts.append(w)
                part.append(o.name)
                stn.append((p0.x - WING_SHOULDER_X) / WING_SCALE)
        self.rest = np.array([[p.x, p.y, p.z, 1.0] for p in rest])
        self.wts = np.array(wts)
        self.wts /= self.wts.sum(axis=1, keepdims=True)
        self.part = np.array(part)
        self.station = np.array(stn)

    def deform(self) -> np.ndarray:
        """Vertex positions (n, 3) for the armature's current pose."""
        out = np.zeros((len(self.rest), 3))
        for i, name in enumerate(self.bones):
            pb = self.arm.pose.bones[name]
            m = np.array(pb.matrix @ pb.bone.matrix_local.inverted())
            out += (self.rest @ m.T)[:, :3] * self.wts[:, i:i + 1]
        return out


def fold_measure(skin: WingSkin, wing: dict) -> dict:
    p = joud_clips.Pose()
    joud_clips.set_wings(p, wing)
    joud_clips.apply(skin.arm, p)
    pts = skin.deform()
    d = body_distance(pts)
    out = skin.station > 0.34            # past the root, which starts inside the body under the vest
    blade = (skin.part == 'wing_L') & (skin.station > 0.36) & (skin.station < 1.04)
    fan = skin.part == 'wing_fan_L'
    c = pts[fan].mean(axis=0)
    # the blade's top face at mid-wing: which way does it look?
    pb = skin.arm.pose.bones['wing_mid_L']
    nrm = (pb.matrix.to_3x3() @ pb.bone.matrix_local.to_3x3().inverted()) @ Vector((0, 0, 1))
    return {
        'inside': int((d[out] < 0).sum()), 'deepest': float(max(0.0, -d[out].min())),
        'gap': float(np.clip(d[blade], 0, None).mean()), 'fan_centre': [float(v) for v in c],
        'lowest': float(pts[:, 2].min()), 'outermost': float(pts[:, 0].max()),
        'face_out': float(nrm.x), 'face_front': float(-nrm.y),
        '_cost_inside': float((np.clip(0.006 - d[out], 0, None) ** 2).sum()),
    }


def fold_cost(m: dict, wing: dict) -> float:
    tx, tz = FOLD_FAN_TARGET
    cx, cy, cz = m['fan_centre']
    bends = sum((wing[k] / 40.0) ** 2 for k in ('mid_fold', 'mid_bend', 'tip_fold', 'tip_bend', 'fan_bend'))
    return (m['_cost_inside'] * 6000 + m['gap'] * 12 + ((cx - tx) ** 2 + (cz - tz) ** 2) * 30
            + max(0.0, -cy) ** 2 * 20 + max(0.0, cy - 0.30) ** 2 * 20
            + max(0.0, 0.70 - m['face_out']) ** 2 * 6 + bends * 0.35)


def tune_fold(skin: WingSkin, start: dict) -> dict:
    """Pattern search from `start` over the fold's angles (the fan's spread stays as given)."""
    names = ['elev', 'twist', 'back', 'mid_fold', 'mid_bend', 'tip_fold', 'tip_bend', 'fan_bend']
    best = dict(start)
    best_cost = fold_cost(fold_measure(skin, best), best)
    for step in (8.0, 4.0, 2.0, 1.0):
        improved = True
        while improved:
            improved = False
            for nm in names:
                for sign in (1, -1):
                    trial = dict(best)
                    trial[nm] += sign * step
                    if abs(trial[nm]) > (95 if nm == 'elev' else 40):
                        continue
                    cost = fold_cost(fold_measure(skin, trial), trial)
                    if cost < best_cost - 1e-6:
                        best, best_cost, improved = trial, cost, True
    return best


def fold_report(arm, wing_objs: list[bpy.types.Object]) -> dict:
    skin = WingSkin(arm, [o for o in wing_objs if o.name.endswith('_L')])
    wing = dict(joud_clips.FOLD)
    for arg in ARGS:  # --fold=elev=-60,twist=-10: try other numbers without editing joud_clips.py
        if arg.startswith('--fold='):
            wing.update({k: float(v) for k, v in (kv.split('=') for kv in arg[7:].split(','))})
            joud_clips.FOLD.update(wing)
    if TUNE_FOLD:
        tuned = tune_fold(skin, wing)
        joud_clips.FOLD.update(tuned)
        log('--tune-fold: FOLD = wing_pose(' + ', '.join(f'{k}={v:.1f}' for k, v in tuned.items() if v) + ')')
        wing = tuned
    m = fold_measure(skin, wing)
    joud_clips.apply(arm, None)
    cx, cy, cz = m['fan_centre']
    log(f'rest_folded: shoulder {wing["elev"]:.0f} deg, twist {wing["twist"]:.0f}, back {wing["back"]:.0f}; '
        f'mid fold {wing["mid_fold"]:.0f} bend {wing["mid_bend"]:.0f}; tip fold {wing["tip_fold"]:.0f} '
        f'bend {wing["tip_bend"]:.0f}; fan centre x {cx:.2f} y {cy:.2f} z {cz:.2f} '
        f'(target x {FOLD_FAN_TARGET[0]} z {FOLD_FAN_TARGET[1]}); lowest point z {m["lowest"]:.2f}; '
        f'vertices inside the body: {m["inside"]} (deepest {m["deepest"]:.3f}); mean gap to the body '
        f'{m["gap"]:.3f}; top face looks {m["face_out"]:.2f} out, {m["face_front"]:.2f} forwards; '
        f'wing length x{WING_SCALE:.2f}')
    report = {k: (round(v, 3) if isinstance(v, float) else v) for k, v in m.items() if not k.startswith('_')}
    report['fan_centre'] = [round(v, 3) for v in m['fan_centre']]
    report['wing'] = {k: round(v, 2) for k, v in wing.items()}
    report['wing_scale'] = WING_SCALE
    if TUNE_FOLD:
        report['_tuned'] = wing
    return report


# ----------------------------------------------------------------------------------------------
# 6. UVs and the texture atlas
# ----------------------------------------------------------------------------------------------

TEXEL_WEIGHT = {  # relative texel density per part kind (the vest art gets the most)
    'vest': 2.3, 'collar': 2.0, 'head': 1.5, 'body': 0.85, 'wing': 0.8, 'wingfeather': 0.7, 'feather': 1.9,
    'lens': 0.1,
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


def paint_atlas(objs: list[bpy.types.Object], m: dict, face: dict) -> tuple[np.ndarray, dict]:
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
    for k in ('body', 'head', 'wing', 'wingfeather'):
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
    # coverage, not a threshold: the line's edge runs diagonally across the atlas's texels, and
    # a hard edge there showed as a staircase along the whole leading edge
    step = np.zeros_like(vv)
    for axis in (0, 1):
        for shift in (1, -1):
            same = np.roll(part, shift, axis) == part
            step = np.maximum(step, np.where(same, np.abs(np.roll(vv, shift, axis) - vv), 0.0))
    cover = np.clip(0.5 + (0.07 - vv) / np.maximum(step, 1e-4), 0, 1)
    cover = cover * smoothstep(0.08, 0.10, u) * (1 - smoothstep(0.93, 0.95, u))
    cover = np.where(sel, cover, 0.0)
    out = out * (1 - cover[..., None]) + green * cover[..., None]
    line = cover > 0.5
    # Amr, 27 Nov: after the roll the green edge must face forwards (-Y) on BOTH wings.
    green_edge = {}
    for pid, o in enumerate(objs, start=1):
        if o.name in ('wing_L', 'wing_R'):
            on = line & (part == pid)
            lead = float(pos[..., 1][on].mean())                       # where the green line is
            rest = float(pos[..., 1][(part == pid) & ~line].mean())     # the rest of that wing
            green_edge[o.name[-1]] = {'y_blender': round(lead, 3), 'wing_y_blender': round(rest, 3),
                                      'faces': 'front' if lead < rest - 0.05 else 'BACK'}
    if any(v['faces'] != 'front' for v in green_edge.values()) or len(green_edge) != 2:
        raise RuntimeError(f'the green edge must lead on both wings: {green_edge}')

    # feathers (wing tips, tail): peach with short dark strokes, as in the art
    sel = kind == 'feather'
    out[sel] = peach_tip
    vfa = prm[..., 1]
    across = np.minimum(np.abs(vfa - 0.25), np.abs(vfa - 0.75))   # from the centre line of either face
    ink = (1 - smoothstep(0.010, 0.026, across)) * smoothstep(0.58, 0.64, u) * (1 - smoothstep(0.86, 0.92, u)) * 0.8
    ink = np.where(sel, ink, 0.0)[..., None]
    out = out * (1 - ink) + stroke * ink

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
    log(f'green leading edge (Blender Y, front is -Y): left {green_edge["L"]["y_blender"]}, right '
        f'{green_edge["R"]["y_blender"]}; rest of each wing {green_edge["L"]["wing_y_blender"]}, '
        f'{green_edge["R"]["wing_y_blender"]}: both lead')
    return out, green_edge


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


def export_glb(path: str, objs: list[bpy.types.Object], rest_position: bool, animations: bool = False) -> None:
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    anim = {}
    if animations:  # every action stashed on the armature's NLA tracks, sampled on each frame
        anim = dict(export_animation_mode='ACTIONS', export_force_sampling=True, export_frame_range=False,
                    export_anim_slide_to_zero=True, export_optimize_animation_size=True,
                    export_reset_pose_bones=True)
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
        export_animations=animations,
        export_morph=False,
        export_extras=False,
        export_cameras=False,
        export_lights=False,
        export_rest_position_armature=rest_position,
        export_def_bones=False,
        **anim,
    )


# --- animations in the exported glb ---------------------------------------------------------------

_COMPONENTS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
_REST = {'translation': [0, 0, 0], 'rotation': [0, 0, 0, 1], 'scale': [1, 1, 1]}


def accessor_array(js: dict, binb: bytes, index: int) -> np.ndarray:
    """A float accessor's values, (count, components). Animation data is never interleaved."""
    acc = js['accessors'][index]
    assert acc['componentType'] == 5126, 'float accessors only'
    view = js['bufferViews'][acc['bufferView']]
    n = _COMPONENTS[acc['type']]
    off = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    return np.frombuffer(binb, dtype='<f4', count=acc['count'] * n, offset=off).reshape(acc['count'], n)


def clean_animations(js: dict, binb: bytes) -> dict:
    """Drop every channel on the root bone (the game owns the root), and every channel that
    only repeats its bone's bind value (three.js falls back to the bind pose for a bone a clip
    does not move, and blends from it correctly). Returns {clip: {...}} for the log."""
    names = [nd.get('name') for nd in js['nodes']]
    report = {}
    for a in js.get('animations', []):
        keep, dropped_root, dropped_rest = [], 0, 0
        for ch in a['channels']:
            node = js['nodes'][ch['target']['node']]
            path = ch['target']['path']
            if node.get('name') == 'root':
                dropped_root += 1
                continue
            vals = accessor_array(js, binb, a['samplers'][ch['sampler']]['output'])
            rest = np.array(node.get(path, _REST[path]), dtype=np.float64)
            still = np.abs(vals - rest).max() < 1e-5
            if path == 'rotation':
                still = still or np.abs(vals + rest).max() < 1e-5
            if still:
                dropped_rest += 1
                continue
            keep.append(ch)
        used = sorted({ch['sampler'] for ch in keep})
        remap = {old: new for new, old in enumerate(used)}
        a['samplers'] = [a['samplers'][i] for i in used]
        for ch in keep:
            ch['sampler'] = remap[ch['sampler']]
        a['channels'] = keep
        times = [accessor_array(js, binb, smp['input']) for smp in a['samplers']]
        report[a['name']] = {
            'channels': len(keep), 'dropped_root': dropped_root, 'dropped_at_rest': dropped_rest,
            'duration': float(max(t.max() for t in times)) if times else 0.0,
            'bones': sorted({names[ch['target']['node']] for ch in keep}),
        }
    return report


def compact_glb(js: dict, binb: bytes) -> bytes:
    """Rebuild the binary chunk with only the data still in use; animation accessors with the
    same content (the clips' time lines, mostly) are stored once."""
    used: set[int] = set()
    for mesh in js['meshes']:
        for prim in mesh['primitives']:
            used.update(prim['attributes'].values())
            if 'indices' in prim:
                used.add(prim['indices'])
    for skin in js.get('skins', []):
        used.add(skin['inverseBindMatrices'])
    canon: dict[tuple, int] = {}
    for a in js.get('animations', []):
        for smp in a['samplers']:
            for key in ('input', 'output'):
                acc = js['accessors'][smp[key]]
                ident = (acc['componentType'], acc['type'], acc['count'], accessor_array(js, binb, smp[key]).tobytes())
                smp[key] = canon.setdefault(ident, smp[key])
                used.add(smp[key])
    views = {js['accessors'][i]['bufferView'] for i in used}
    views |= {im['bufferView'] for im in js.get('images', []) if 'bufferView' in im}
    out = bytearray()
    view_map, new_views = {}, []
    for i, view in enumerate(js['bufferViews']):
        if i not in views:
            continue
        out += b'\0' * ((4 - len(out) % 4) % 4)
        start = view.get('byteOffset', 0)
        nv = dict(view, byteOffset=len(out))
        out += binb[start:start + view['byteLength']]
        view_map[i] = len(new_views)
        new_views.append(nv)
    acc_map, new_accs = {}, []
    for i, acc in enumerate(js['accessors']):
        if i in used:
            acc_map[i] = len(new_accs)
            new_accs.append(dict(acc, bufferView=view_map[acc['bufferView']]))
    for mesh in js['meshes']:
        for prim in mesh['primitives']:
            prim['attributes'] = {k: acc_map[v] for k, v in prim['attributes'].items()}
            if 'indices' in prim:
                prim['indices'] = acc_map[prim['indices']]
    for skin in js.get('skins', []):
        skin['inverseBindMatrices'] = acc_map[skin['inverseBindMatrices']]
    for a in js.get('animations', []):
        for smp in a['samplers']:
            smp['input'], smp['output'] = acc_map[smp['input']], acc_map[smp['output']]
    for im in js.get('images', []):
        if 'bufferView' in im:
            im['bufferView'] = view_map[im['bufferView']]
    js['accessors'], js['bufferViews'] = new_accs, new_views
    js['buffers'][0]['byteLength'] = len(out)
    return bytes(out)


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
        f'(brief: 33 %), wing {(WING_LEN + max(FAN_VISIBLE)) * WING_SCALE:.2f} from the shoulder joint')

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
    atlas_rgb, green_edge = paint_atlas(textured, m, face)
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

    # --- folded pose and clips ---------------------------------------------------------------------
    fold = fold_report(arm, wings)
    fold_wing = fold.pop('_tuned', None) or dict(joud_clips.FOLD)
    clips = joud_clips.bake(arm)
    log('clips baked at %d fps: ' % joud_clips.FPS + ', '.join(
        f'{nm} {c["frames"]} frames{" (loop)" if c["loops"] else ""}' for nm, c in clips.items()))

    # --- export: join a copy of the parts (one mesh, one material) ------------------------------------
    joud_clips.apply(arm, None)
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
    pose = joud_clips.Pose()
    joud_clips.set_wings(pose, fold_wing)
    joud_clips.apply(arm, pose)
    export_glb(tmp_fold, export_objs, rest_position=False)
    joud_clips.apply(arm, None)
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    export_glb(OUT_GLB, export_objs, rest_position=True, animations=True)

    # --- post-process: clips cleaned, rest_folded pose and metadata into the armature node's extras ---
    js, binb = read_glb(OUT_GLB)
    fjs, _ = read_glb(tmp_fold)
    names = [nd.get('name') for nd in js['nodes']]
    skin = js['skins'][0]
    joints = [names[j] for j in skin['joints']]
    anim = clean_animations(js, binb)
    binb = compact_glb(js, binb)
    order = list(joud_clips.CLIPS)
    js['animations'] = sorted(js.get('animations', []), key=lambda a: order.index(a['name']))
    if [a['name'] for a in js['animations']] != order:
        raise RuntimeError(f'expected the clips {order}, the exporter wrote {[a["name"] for a in js["animations"]]}')
    for nm, (frames, _loops) in joud_clips.CLIPS.items():
        if abs(anim[nm]['duration'] - frames / joud_clips.FPS) > 1e-3:
            raise RuntimeError(f'clip {nm}: {anim[nm]["duration"]:.4f} s, expected {frames / joud_clips.FPS:.4f}')
    folded, folded_scale = {}, {}
    for nd in fjs['nodes']:
        if nd.get('name', '').startswith('wing_'):
            folded[nd['name']] = [round(v, 6) for v in nd.get('rotation', [0, 0, 0, 1])]
            if 'scale' in nd and max(abs(v - 1) for v in nd['scale']) > 1e-4:
                folded_scale[nd['name']] = [round(v, 5) for v in nd['scale']]
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
        'bind_pose': 'wings straight out to the sides, leading (green) edge forwards',
        'poses': {'rest_folded': folded},
        'poses_scale': {'rest_folded': folded_scale},
        'rest_folded_report': fold,
        'clips': {nm: {'frames': c['frames'], 'fps': joud_clips.FPS, 'loop': c['loops']} for nm, c in clips.items()},
        'green_edge': green_edge,
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
    for nm in order:
        c = anim[nm]
        log(f'clip {nm:5s} {c["duration"]:.3f} s, {c["channels"]} channels on {len(c["bones"])} bones '
            f'(dropped: {c["dropped_root"]} on the root, {c["dropped_at_rest"]} at rest)')
    if size_kb > SIZE_LIMIT_KB:
        log(f'WARNING: over the {SIZE_LIMIT_KB} KB budget')
    if tris > 8000:
        log('WARNING: over the brief\'s 8000 triangles')

    # --- the .blend: parts separate, no joined copy ------------------------------------------------------
    for c in [joined] + lens_copies:
        bpy.data.objects.remove(c, do_unlink=True)
    if SAVE_BLEND:
        arm['rest_folded'] = json.dumps(fold)
        joud_clips.apply(arm, None)
        bpy.context.preferences.filepaths.save_version = 0  # no joud-v2.blend1 backup
        bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, compress=True)
        mb = os.path.getsize(OUT_BLEND) / 1e6
        log(f'wrote {os.path.relpath(OUT_BLEND, REPO)}: {mb:.2f} MB')
        if mb > BLEND_LIMIT_MB:
            os.remove(OUT_BLEND)
            log(f'.blend over {BLEND_LIMIT_MB} MB: removed (the script rebuilds it)')


if __name__ == '__main__':
    main()
