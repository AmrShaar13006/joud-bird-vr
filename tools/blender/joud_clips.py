"""Joud v2: the folded pose and the five animation clips, as numbers.

build_joud.py imports this file, bakes every clip at 24 fps and exports them inside
public/models/joud-v2.glb (named idle, flap, glide, fall, crash). The motion starts from
pose_B() in flap_proto.py (Amr's prototype) and follows his spec of 27 Nov 2026.

Rules
  - No clip keys the root bone: the game moves and tilts the model's root itself
    (src/scene/bird.ts). Clips move the body bone and everything below it.
  - Angles are degrees about the armature's axes (Blender: Z up, front = -Y, Joud's left = +X),
    as in the prototype: each bone's rotation is given as if its parents were at rest.
  - The two wings mirror each other. The prototype twisted the right wing the opposite way to
    the left (about (side, 0, 0)); a mirrored twist is the same turn about +X on both sides.
  - Clip lengths are whole frames at 24 fps: flap 10 (0.417 s), glide 29 (1.208 s),
    fall 7 (0.292 s), crash 14 (0.583 s), idle 144 (6 s).
  - flap starts with the wings raised and ends exactly in glide's first frame; a loop's last
    frame is its first.
"""

from __future__ import annotations

import math

import bpy
from mathutils import Quaternion, Vector

DEG = math.pi / 180
FPS = 24
# name -> (frames, loops)
CLIPS = {'idle': (144, True), 'flap': (10, False), 'glide': (29, True), 'fall': (7, True), 'crash': (14, False)}
SIDES = ((1, 'L'), (-1, 'R'))
TAU = 2 * math.pi


def q(axis, deg: float) -> Quaternion:
    return Quaternion(Vector(axis).normalized(), deg * DEG)


def ease(x: float) -> float:  # smoothstep
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def bump(t: float, a: float, b: float) -> float:  # 0..1..0 over [a, b]
    if t <= a or t >= b:
        return 0.0
    return math.sin(math.pi * (t - a) / (b - a))


def keys(f: float, table: list[tuple[float, float]]) -> float:
    """Value at frame f from (frame, value) keys, eased between neighbours."""
    if f <= table[0][0]:
        return table[0][1]
    for (f0, v0), (f1, v1) in zip(table, table[1:]):
        if f <= f1:
            return v0 + (v1 - v0) * ease((f - f0) / (f1 - f0))
    return table[-1][1]


class Pose:
    """Per bone: rotation and location in the armature's axes, scale along the armature's axes
    (x left-right, y front-back, z up; a wing fan: x along the wing, y across it)."""

    def __init__(self) -> None:
        self.rot: dict[str, Quaternion] = {}
        self.loc: dict[str, tuple[float, float, float]] = {}
        self.scale: dict[str, tuple[float, float, float]] = {}


# ----------------------------------------------------------------------------------------------
# wings
# ----------------------------------------------------------------------------------------------

def wing_pose(elev: float = 0.0, twist: float = 0.0, sweep: float = 0.0, back: float = 0.0,
              mid_fold: float = 0.0, mid_bend: float = 0.0, mid_twist: float = 0.0,
              tip_fold: float = 0.0, tip_bend: float = 0.0, tip_twist: float = 0.0,
              fan: float = 1.0, fan_bend: float = 0.0, fan_twist: float = 0.0) -> dict:
    """One wing, in degrees (the other mirrors it).
    elev      shoulder up (+) or down (-) from straight out to the side
    twist     about the wing's length: leading edge down (+) or up (-); mid_twist, tip_twist and
              fan_twist add to it further out
    sweep     the whole wing forwards (+) or back (-) about the vertical axis (prototype)
    back      the wing swung back within its own plane at the shoulder
    *_fold    the outer wing folded back within the wing's plane (mid joint, tip joint)
    *_bend    the outer wing bent up (+) or down (-) across its plane: lag, curl
    fan       the tip fan's spread: 1 as built, below 1 closed, above 1 spread
    fan_bend  the tip fan bent up (+) or down (-)
    """
    return dict(elev=elev, twist=twist, sweep=sweep, back=back,
                mid_fold=mid_fold, mid_bend=mid_bend, mid_twist=mid_twist,
                tip_fold=tip_fold, tip_bend=tip_bend, tip_twist=tip_twist,
                fan=fan, fan_bend=fan_bend, fan_twist=fan_twist)


def mix(a: dict, b: dict, k: float) -> dict:
    return {key: a[key] + (b[key] - a[key]) * k for key in a}


def set_wing(p: Pose, side: int, w: dict) -> None:
    s = 'L' if side > 0 else 'R'
    p.rot[f'wing_shoulder_{s}'] = (q((0, 0, -side), w['sweep']) @ q((0, -side, 0), w['elev'])
                                   @ q((0, 0, side), w['back']) @ q((1, 0, 0), w['twist']))
    p.rot[f'wing_mid_{s}'] = (q((0, 0, side), w['mid_fold']) @ q((0, -side, 0), w['mid_bend'])
                              @ q((1, 0, 0), w['mid_twist']))
    p.rot[f'wing_tip_{s}'] = (q((0, 0, side), w['tip_fold']) @ q((0, -side, 0), w['tip_bend'])
                              @ q((1, 0, 0), w['tip_twist']))
    p.rot[f'wing_fan_{s}'] = q((0, -side, 0), w['fan_bend']) @ q((1, 0, 0), w['fan_twist'])
    p.scale[f'wing_fan_{s}'] = (1.0, w['fan'], 1.0)


def set_wings(p: Pose, left: dict, right: dict | None = None) -> None:
    set_wing(p, 1, left)
    set_wing(p, -1, right or left)


def set_legs(p: Pose, upper: float, lower: float) -> None:
    """Both legs swung back (+) or forwards (-); lower is the knee, on top of the upper leg."""
    for _side, s in SIDES:
        p.rot[f'leg_upper_{s}'] = q((1, 0, 0), upper)
        p.rot[f'leg_lower_{s}'] = q((1, 0, 0), lower)


# The wings at rest: down along the body's side, broad face out, wrapped a little round the
# belly (36 degrees of curl, shared by the mid and tip joints), the tip fan closed and turned
# to show its top to the front, as the art's "hands" do. (Turned the other way, -40 degrees,
# the fan showed its underside to the camera, which the game's light leaves brown.) Set by
# hand; build_joud.py measures it on every build (fold_report) and `--tune-fold` prints a
# candidate from a search.
FOLD = wing_pose(elev=-60.0, twist=-8.0, back=16.0, mid_bend=-22.0,
                 tip_fold=6.0, tip_bend=-14.0, fan=0.75, fan_bend=4.0, fan_twist=90.0)
LEG_BACK = (38.0, 22.0)  # legs tucked back in flight (prototype)


def folded() -> Pose:
    p = Pose()
    set_wings(p, FOLD)
    return p


# ----------------------------------------------------------------------------------------------
# glide: wings open a little above level, a slow flutter at the tips, a 1 degree body sway
# ----------------------------------------------------------------------------------------------

GLIDE_ELEV = 12.0


def glide_wing(t: float) -> dict:
    w = TAU * t
    return wing_pose(elev=GLIDE_ELEV + 0.8 * math.sin(w),
                     mid_bend=1.2 * math.sin(2 * w - 0.8),
                     tip_bend=3.0 * math.sin(2 * w - 1.7),          # the 3 degree flutter, 2 per loop
                     fan=1.06 + 0.03 * math.sin(2 * w - 2.4), fan_bend=1.5 * math.sin(2 * w - 2.4))


def glide_rest(t: float) -> dict:
    """Body, head and legs in glide, as numbers (flap ends on these)."""
    w = TAU * t
    return dict(sway=1.0 * math.sin(w), head_roll=-0.7 * math.sin(w - 0.5),
                leg_upper=LEG_BACK[0] + 1.5 * math.sin(w - 1.0), leg_lower=LEG_BACK[1] + 2.0 * math.sin(w - 1.6))


def glide(t: float) -> Pose:
    p = Pose()
    set_wings(p, glide_wing(t))
    r = glide_rest(t)
    p.rot['body'] = q((0, 1, 0), r['sway'])
    p.rot['head'] = q((0, 1, 0), r['head_roll'])
    set_legs(p, r['leg_upper'], r['leg_lower'])
    return p


# ----------------------------------------------------------------------------------------------
# flap: one stroke per tap. Two frames of anticipation, a fast eased downstroke (42 % of the
# clip), then a folded recovery that whips open into glide's first frame.
# ----------------------------------------------------------------------------------------------

FLAP_A = 0.2                 # anticipation: 2 of the 10 frames
FLAP_D = 0.42                # the downstroke's share of the clip
FLAP_START, FLAP_TOP, FLAP_BOTTOM = 44.0, 50.0, -44.0


def flap_elev(t: float) -> float:
    if t <= 0:
        return FLAP_START
    if t < FLAP_A:
        return FLAP_START + (FLAP_TOP - FLAP_START) * ease(t / FLAP_A)
    if t < FLAP_A + FLAP_D:
        return FLAP_TOP + (FLAP_BOTTOM - FLAP_TOP) * ease((t - FLAP_A) / FLAP_D)
    return FLAP_BOTTOM + (GLIDE_ELEV - FLAP_BOTTOM) * ease((t - FLAP_A - FLAP_D) / (1 - FLAP_A - FLAP_D))


def flap(t: float) -> Pose:
    g, gr = glide_wing(0.0), glide_rest(0.0)
    d0 = FLAP_A + FLAP_D
    down, up = bump(t, FLAP_A, d0), bump(t, d0, 1.0)
    e = flap_elev(t)
    settle = ease((t - d0) / (1 - d0))      # glide's own small offsets fade in over the recovery
    whip = 1 - ease((t - 0.85) / 0.15)      # the lag is spent by the last frame: the outer wing whips level
    lag_mid = 0.30 * (flap_elev(t - 0.06) - e) * whip
    lag_tip = 0.45 * (flap_elev(t - 0.11) - e) * whip
    p = Pose()
    set_wings(p, wing_pose(
        elev=e + (g['elev'] - GLIDE_ELEV) * settle,
        twist=24 * down - 30 * up,            # leading edge down on the way down, up on the way up
        sweep=9 * down - 14 * up,             # forwards on the way down, back on the way up: a figure 8
        mid_fold=48 * up, mid_bend=lag_mid - 10 * up + g['mid_bend'] * settle,
        tip_fold=30 * up, tip_bend=lag_tip + g['tip_bend'] * settle,
        fan=1.0 + 0.16 * down - 0.65 * up + (g['fan'] - 1.0) * settle,    # spread on the push, closed on the way up
        fan_bend=0.6 * lag_tip + g['fan_bend'] * settle,
        # On the way up the folded outer wing hangs down and back, its underside to the ground:
        # the fan went brown in the game's light and, seen from the front, read as a fist. So the
        # closed fan turns its top outwards while it trails, as it does when the wing is tucked.
        fan_twist=135 * up))
    # the body dips a touch before the push, rises on the downstroke and sinks on the recovery;
    # the nose lifts 4 degrees with the push
    p.loc['body'] = (0.0, 0.0, 0.045 * down - 0.025 * up - 0.008 * bump(t, 0.0, FLAP_A))
    p.rot['body'] = q((1, 0, 0), -4 * down + 2 * up) @ q((0, 1, 0), gr['sway'] * settle)
    # the head stays steady: it cancels most of the body's pitch and lags a touch
    p.rot['head'] = (q((1, 0, 0), 3.2 * down - 1.6 * up + 1.5 * bump(t - 0.08, FLAP_A, d0))
                     @ q((0, 1, 0), gr['head_roll'] * settle))
    set_legs(p, LEG_BACK[0] + (gr['leg_upper'] - LEG_BACK[0]) * settle + 6 * up,
             LEG_BACK[1] + (gr['leg_lower'] - LEG_BACK[1]) * settle + 8 * down)
    return p


# ----------------------------------------------------------------------------------------------
# fall: wings raised with a fast shallow flutter, legs dangling forwards, eyes wide
# ----------------------------------------------------------------------------------------------

def fall(t: float) -> Pose:
    w = TAU * t
    p = Pose()
    set_wings(p, wing_pose(elev=35 + 8 * math.sin(w), twist=-6 + 3 * math.sin(w - 0.6), back=6.0,
                           mid_fold=8.0, mid_bend=4 * math.sin(w - 1.1),
                           tip_fold=6.0, tip_bend=6 * math.sin(w - 2.0),
                           fan=1.15, fan_bend=4 * math.sin(w - 2.6)))
    p.rot['head'] = q((1, 0, 0), 4 + math.sin(w - 0.8))          # looking down
    p.scale['eye_ctrl'] = (1.0, 1.0, 1.35)                       # eyes wide
    for _side, s in SIDES:                                       # legs dangle forwards 15 degrees
        p.rot[f'leg_upper_{s}'] = q((1, 0, 0), -15 + 3 * math.sin(w + 0.5))
        p.rot[f'leg_lower_{s}'] = q((1, 0, 0), -6 + 4 * math.sin(w - 0.4))
    return p


# ----------------------------------------------------------------------------------------------
# idle: wings folded, three 2 s breaths, one head turn and three blinks per 6 s loop
# ----------------------------------------------------------------------------------------------

IDLE_SECONDS = 6.0
BLINKS = (1.0, 2.45, 4.9)   # seconds; the middle one starts the head turn


def blink(sec: float, at: float) -> float:
    """0 open .. 1 closed: shut in one frame, held two, open again over two."""
    d = (sec - at) * FPS
    if d <= 0 or d >= 5:
        return 0.0
    return d if d < 1 else 1.0 if d <= 3 else (5 - d) / 2


def idle(t: float) -> Pose:
    sec = IDLE_SECONDS * t
    breath = math.sin(TAU * sec / 2.0)
    p = Pose()
    w = dict(FOLD)
    w['elev'] += 0.8 * breath        # the wings lift a touch as the chest fills
    set_wings(p, w)
    p.loc['body'] = (0.0, 0.0, 0.01 * breath)                     # the breathing bob
    p.scale['body'] = (1 + 0.008 * breath, 1 + 0.008 * breath, 1.0)
    turn = ease((sec - 2.4) / 0.45) - ease((sec - 3.9) / 0.5)     # a look to Joud's left, held 1 s
    p.rot['head'] = q((0, 0, 1), 16 * turn) @ q((0, 1, 0), -4 * turn) @ q((1, 0, 0), -1.0 * breath)
    closed = max(blink(sec, at) for at in BLINKS)
    p.scale['eye_ctrl'] = (1.0, 1.0, 1 - 0.9 * closed)
    return p


# ----------------------------------------------------------------------------------------------
# crash: a 15 % squash along the body's front-back axis on contact, the wings fling up, the
# glasses tip (never more than about 6 degrees: the lens tint is painted on the face), then
# the bird settles dizzy with its wings drooping. Not looped: the last frame is held.
# ----------------------------------------------------------------------------------------------

GLASSES_MAX_TILT = 6.0


def crash_wing(f: float, lazy: float) -> dict:
    """lazy: frames this wing runs behind, and how much lower it ends (the two differ a little)."""
    f = f - lazy
    return wing_pose(
        elev=keys(f, [(0, 20), (1, 10), (3.5, 64), (6, 52), (9, 5), (11.5, -30 - 10 * lazy), (14, -24 - 10 * lazy)]),
        twist=keys(f, [(0, 0), (3, -20), (8, -8), (14, 6)]),
        mid_fold=keys(f, [(0, 0), (9, 0), (14, 14)]),
        # the outer wing lags on the way up, then overshoots a little; any further and the tips curl
        # in over the head like fists, their tops turned to the ground's light
        mid_bend=keys(f, [(0, 0), (1.5, -18), (3.5, 2), (5, 8), (8, 5), (11, -12), (14, -8)]),
        tip_fold=keys(f, [(0, 0), (9, 0), (14, 10)]),
        tip_bend=keys(f, [(0, 0), (2, -25), (4.5, 3), (6, 10), (9, 6), (12, -18), (14, -12)]),
        fan=keys(f, [(0, 1.0), (3, 1.3), (9, 1.0), (14, 0.85)]),
        fan_bend=keys(f, [(0, 0), (2.5, -15), (6.5, 5), (10, 3), (14, -8)]),
        # the drooping fans turn their tops to the front, the lazy wing's further: their undersides
        # face the ground there and would go brown
        fan_twist=keys(f, [(0, 0), (9, 0), (14, 45 + 80 * lazy)]))


def crash(t: float) -> Pose:
    f = t * CLIPS['crash'][0]
    p = Pose()
    set_wings(p, crash_wing(f, 0.0), crash_wing(f, 0.6))
    squash = keys(f, [(0, 1.0), (1.5, 0.85), (4, 1.05), (7, 0.98), (10, 1.0)])   # front-back
    bulge = 1 + (1 - squash) * 0.5
    p.scale['body'] = (bulge, squash, bulge)
    p.rot['body'] = q((1, 0, 0), keys(f, [(0, 0), (2, 6), (5, -4), (9, 2), (14, 0)]))
    p.rot['head'] = (q((1, 0, 0), keys(f, [(0, 0), (1.5, 14), (4, -8), (7, 5), (10, -2), (14, 3)]))
                     @ q((0, 1, 0), keys(f, [(0, 0), (4, 0), (7, 9), (10, -5), (12.5, 8), (14, 6)])))
    tilt = keys(f, [(0, 0), (2, 2), (4, 6), (7, 4.5), (10, 6), (14, 5.5)])
    p.rot['glasses'] = q((0, 1, 0), min(GLASSES_MAX_TILT, tilt))
    eye = keys(f, [(0, 1.0), (1, 1.4), (4, 1.4), (7, 0.5), (14, 0.45)])           # wide, then half shut
    p.scale['eye_ctrl'] = (1.0, 1.0, eye)
    for _side, s in SIDES:
        p.rot[f'leg_upper_{s}'] = q((1, 0, 0), keys(f, [(0, LEG_BACK[0]), (3, -30), (7, 10), (14, -5)]))
        p.rot[f'leg_lower_{s}'] = q((1, 0, 0), keys(f, [(0, LEG_BACK[1]), (3, -10), (8, 25), (14, 12)]))
    return p


POSE_FN = {'idle': idle, 'flap': flap, 'glide': glide, 'fall': fall, 'crash': crash}


# ----------------------------------------------------------------------------------------------
# Blender side: put a pose on the armature, bake the clips
# ----------------------------------------------------------------------------------------------

def apply(arm: bpy.types.Object, p: Pose | None) -> None:
    """Set every pose bone from p (None: the bind pose)."""
    for pb in arm.pose.bones:
        rest = pb.bone.matrix_local.to_3x3()
        rq = rest.to_quaternion()
        pb.rotation_mode = 'QUATERNION'
        qa = p.rot.get(pb.name) if p else None
        pb.rotation_quaternion = (rq.inverted() @ qa @ rq) if qa is not None else Quaternion()
        la = p.loc.get(pb.name) if p else None
        pb.location = (rest.inverted() @ Vector(la)) if la is not None else (0.0, 0.0, 0.0)
        sa = p.scale.get(pb.name) if p else None
        if sa is None:
            pb.scale = (1.0, 1.0, 1.0)
        else:  # each of the bone's own axes takes the factor of the armature axis it lies along
            pb.scale = [sa[max(range(3), key=lambda j: abs(rest.col[i][j]))] for i in range(3)]
    bpy.context.view_layer.update()


def clip_poses(name: str) -> list[Pose]:
    frames, loops = CLIPS[name]
    fn = POSE_FN[name]
    return [fn(f / frames) for f in range(frames)] + [fn(0.0 if loops else 1.0)]


def bake(arm: bpy.types.Object) -> dict[str, dict]:
    """One action per clip, a key on every frame, each stashed on its own (muted) NLA track so
    the glTF exporter writes it as a named animation. Only channels that move are keyed, and
    never the root's. Returns {clip: {'frames', 'loops', 'bones': [keyed bones]}}."""
    scene = bpy.context.scene
    scene.render.fps = FPS
    bpy.context.view_layer.objects.active = arm
    ad = arm.animation_data_create()
    report = {}
    for name, (frames, loops) in CLIPS.items():
        poses = clip_poses(name)
        moving = {  # property -> bones that leave the bind value somewhere in the clip
            'rotation_quaternion': {b for p in poses for b, v in p.rot.items() if abs(v.angle) > 1e-5},
            'location': {b for p in poses for b, v in p.loc.items() if max(abs(c) for c in v) > 1e-6},
            'scale': {b for p in poses for b, v in p.scale.items() if max(abs(c - 1) for c in v) > 1e-5},
        }
        for bones in moving.values():
            if 'root' in bones:
                raise RuntimeError(f'clip {name} keys the root bone')
        act = bpy.data.actions.new(name)
        ad.action = act
        last: dict[str, Quaternion] = {}
        for f, p in enumerate(poses):
            apply(arm, p)
            for prop, bones in moving.items():
                for b in sorted(bones):
                    pb = arm.pose.bones[b]
                    if prop == 'rotation_quaternion':
                        cur = pb.rotation_quaternion.copy()
                        if b in last and last[b].dot(cur) < 0:  # same hemisphere: no long way round
                            cur.negate()
                            pb.rotation_quaternion = cur
                        last[b] = cur
                    pb.keyframe_insert(prop, frame=f)
        track = ad.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 0, act)
        strip.name = name
        track.mute = True
        ad.action = None
        report[name] = {'frames': frames, 'loops': loops,
                        'bones': sorted(set().union(*moving.values()))}
    apply(arm, None)
    return report
