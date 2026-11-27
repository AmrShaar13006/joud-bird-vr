"""Joud v2 flap prototype: renders the current viewer flap (A) and a bird-like flap (B).

Run: blender -b joud-v2.blend -P flap_proto.py -- <variant A|B> <view game|front> <outdir> [frames]
Blender space: Z up, front = -Y, left wing along +X.
"""
import bpy, sys, math
from mathutils import Vector, Quaternion, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
VARIANT, VIEW, OUT = argv[0], argv[1], argv[2]
FRAMES = int(argv[3]) if len(argv) > 3 else 12
DEG = math.pi / 180
ZC = 0.476  # wing bone line height

scene = bpy.context.scene
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')

# ---------- render setup ----------
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 560
scene.render.resolution_y = 440
scene.render.film_transparent = False
world = scene.world or bpy.data.worlds.new('w')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
bg.inputs[0].default_value = (0.93, 0.95, 0.98, 1)
bg.inputs[1].default_value = 0.8
scene.view_settings.view_transform = 'Standard'
scene.view_settings.exposure = -0.25

sun_data = bpy.data.lights.new('sun', 'SUN')
sun_data.energy = 2.4
sun = bpy.data.objects.new('sun', sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = (55 * DEG, 0, -35 * DEG)

target = bpy.data.objects.new('target', None)
scene.collection.objects.link(target)
target.location = (0, 0, 0.35)
cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 3.9
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
az = -55 * DEG if VIEW == 'game' else 0.0
el = 10 * DEG
d = 10
cam.location = (math.sin(az) * d * math.cos(el), -math.cos(az) * d * math.cos(el), 0.35 + math.sin(el) * d)
con = cam.constraints.new('TRACK_TO')
con.target = target
con.track_axis = 'TRACK_NEGATIVE_Z'
con.up_axis = 'UP_Y'
scene.camera = cam

# ---------- variant B: turn the wings into real wings ----------
def reshape_wings():
    """Rotate each wing 90 deg about its long axis so the broad face lies flat (chord front-back,
    the green top edge becomes the leading edge), and widen the chord, more at the root."""
    for name in ('wing_L', 'wing_R', 'wing_tip_L', 'wing_tip_R'):
        ob = bpy.data.objects[name]
        mw, mwi = ob.matrix_world, ob.matrix_world.inverted()
        for v in ob.data.vertices:
            w = mw @ v.co
            y, z = w.y, w.z - ZC
            c, sn = math.cos(65 * DEG), math.sin(65 * DEG)
            ny, nz = y * c - z * sn, y * sn + z * c   # 65 deg about X: top edge turns toward the front
            ax = abs(w.x)
            k = min(1.0, max(0.0, (ax - 0.4) / 1.4))
            ny *= 2.1 + (1.35 - 2.1) * k
            nz *= 0.7
            w2 = Vector((w.x, ny, ZC + nz))
            v.co = mwi @ w2
        ob.data.update()

if VARIANT == 'B':
    reshape_wings()

# ---------- pose helpers ----------
def q(axis, deg):
    return Quaternion(Vector(axis).normalized(), deg * DEG)

def set_rot(bname, q_arm):
    pb = arm.pose.bones[bname]
    r = pb.bone.matrix_local.to_3x3().to_quaternion()
    pb.rotation_mode = 'QUATERNION'
    pb.rotation_quaternion = r.inverted() @ q_arm @ r

def set_loc(bname, v_arm):
    pb = arm.pose.bones[bname]
    r = pb.bone.matrix_local.to_3x3()
    pb.location = r.inverted() @ Vector(v_arm)

def reset():
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = Quaternion()
        pb.location = (0, 0, 0)

def ease(x):  # smoothstep
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)

# ---------- A: the current viewer flap (model-view.ts) ----------
def pose_A(t):
    ph = 2 * math.pi * t
    for side, s in ((1, 'L'), (-1, 'R')):
        for bone, amp, phase, off in (('wing_shoulder', 50, 0.0, 5), ('wing_mid', 14, 0.5, 0), ('wing_tip', 10, 0.9, 0)):
            a = amp * math.sin(ph - phase) + off
            set_rot(f'{bone}_{s}', q((0, -side, 0), a))

# ---------- B: a bird-like flap ----------
D = 0.42  # downstroke share of the beat: fast and strong down, slower folded recovery up
TOP, BOTTOM = 50.0, -44.0

def elev(t):
    t = t % 1.0
    if t < D:
        return TOP + (BOTTOM - TOP) * ease(t / D)
    return BOTTOM + (TOP - BOTTOM) * ease((t - D) / (1 - D))

def bump(t, a, b):  # 0..1..0 over [a, b]
    if t < a or t > b:
        return 0.0
    return math.sin(math.pi * (t - a) / (b - a))

def pose_B(t):
    t = t % 1.0
    down, up = bump(t, 0, D), bump(t, D, 1)
    e = elev(t)
    for side, s in ((1, 'L'), (-1, 'R')):
        twist = 24 * down - 30 * up          # leading edge down on the downstroke, up on the upstroke
        sweep = 9 * down - 14 * up           # forward on the way down, back on the way up: a figure 8
        set_rot(f'wing_shoulder_{s}', q((0, 0, -side), sweep) @ q((0, -side, 0), e) @ q((side, 0, 0), twist))
        # the outer wing lags and folds back on the upstroke, then whips open
        lag_mid = 0.30 * (elev(t - 0.06) - e)
        fold_mid = 48 * up
        set_rot(f'wing_mid_{s}', q((0, 0, side), fold_mid) @ q((0, -side, 0), lag_mid - 10 * up))
        lag_tip = 0.45 * (elev(t - 0.11) - e)
        fold_tip = 30 * up
        set_rot(f'wing_tip_{s}', q((0, 0, side), fold_tip) @ q((0, -side, 0), lag_tip))
        # legs tucked back in flight, swinging a little against the beat
        set_rot(f'leg_upper_{s}', q((1, 0, 0), 38 + 6 * up))
        set_rot(f'leg_lower_{s}', q((1, 0, 0), 22 + 8 * down))
    # body rises on the downstroke and sinks on the recovery; nose lifts a little with each push
    set_loc('body', (0, 0, 0.045 * down - 0.025 * up))
    set_rot('body', q((1, 0, 0), -4 * down + 2 * up))
    # the head stays steady: it cancels most of the body's pitch and lags a touch
    set_rot('head', q((1, 0, 0), 3.2 * down - 1.6 * up + 1.5 * bump((t - 0.08) % 1.0, 0, D)))

pose = pose_A if VARIANT == 'A' else pose_B
for i in range(FRAMES):
    t = i / FRAMES
    reset()
    pose(t)
    bpy.context.view_layer.update()
    scene.render.filepath = f'{OUT}/{VARIANT}_{VIEW}_{i:02d}.png'
    bpy.ops.render.render(write_still=True)
print('DONE', VARIANT, VIEW)
