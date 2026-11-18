"""BEATSPIRE factory piece: the Transfer Arm (arm), the robot arm that hands every item over.

A compact industrial arm on a turntable. It stands on a low hex pad (smaller than a building's plinth, so a row of
arms between two machines reads as the gaps in the line), takes from the tile behind it (+Y) and puts into the tile
in front of it (-Y, the model's FRONT, three.js +Z): the pad carries two lit chevrons pointing that way and the
rest pose leans over them.

The game (src/game/facview.ts, ArmRig) does not draw this hierarchy as it stands: it takes each node's geometry in
the node's own frame, instances it for every arm on the map and poses the chain itself with a two-link IK, reading
the joint offsets from the node positions. So the links are authored along their own +Z with the hinge on local X,
and the rest pose is only the nodes' rotations (it is what the previews and the placement ghost show).

Nodes, each with its origin at its joint:
  'base'    the pad, the slew bearing's fixed ring, the arrow plate, the lamp mast (does not move);
  'lamp'    the status lamp on its mast (glow_lamp: the game colours it per arm);
  'turn'    the turntable with the shoulder yoke and the drive, turns about Z (origin on the tile's axis);
  'upper'   the upper arm, hinged on X at the shoulder (child of turn), UPPER long;
  'fore'    the forearm, hinged on X at the elbow (child of upper, at z = UPPER), FORE long;
  'wrist'   the wrist with the palm rail, hinged on X (child of fore, at z = FORE): its +Z points down at work;
  'fingerL' / 'fingerR'  the two fingers, sliding along the wrist's X on the palm rail (the same part, the right
            one turned half round about Z); an item hangs between them with its foot GRIP below the wrist's axis.
Keep UPPER + FORE at 2.1 or more: the arm reaches the middle of the next tile (2.0 away) to take from a belt
that runs past it.
"""
import math
from vs_lib import *
from fac_common import fac_model, status_lamp, HEX

ACCENT = '#d9b25a'
UPPER, FORE, GRIP = 1.08, 1.06, 0.42
SHOULDER_Z = 0.62             # shoulder axis above the deck
TURN_Z = 0.13                 # the turntable's seat
REST = (10, 110, 60)          # rest pose: shoulder, elbow and wrist angles (each against its parent; they add up to 180: the hand hangs straight down)
RIGHT = (0, 90, 0)


def chevron(w, d, t):
    """A flat V in the xy plane pointing to -Y: half width w, depth d of each leg along y, t thick along y."""
    return [(-w, d / 2), (0, -d / 2), (w, d / 2), (w, d / 2 - t), (0, -d / 2 - t), (-w, d / 2 - t)]


def arm():
    m = fac_model('arm', ACCENT)
    G = 'glow_main'

    # ------------------------------------------------------------------ the pad
    b = m.node('base')
    R = 0.80                                  # corner radius (0.69 to the flats: a building's plinth is 0.88)
    H = 0.07
    b.lathe([(R, 0.0), (R + 0.01, 0.015), (R + 0.01, H - 0.03), (R - 0.03, H), (0.0, H)], 'hull', **HEX)
    b.ring(R - 0.075, 0.03, 0.016, 'trim', segs=6, phase=30, at=(0, 0, H))
    with b.frames(radial(6, start=30)):       # anchor blocks on the corners, a bolt head on each
        b.box((0.13, 0.15, 0.05), 'trim', bevel=0, at=(R - 0.09, 0, H + 0.012))
        b.cyl(0.026, 0.02, 'hull', segs=6, at=(R - 0.09, 0, H + 0.035))
    # the slew bearing's fixed ring, with a toothed rim the drive pinion runs on
    b.ring(0.37, 0.07, TURN_Z - H + 0.01, 'trim', segs=16, bevel=0.01, at=(0, 0, (H + TURN_Z) / 2))
    with b.frames(radial(12, radius=0.405)):
        b.box((0.03, 0.07, 0.03), 'hull', bevel=0, at=(0, 0, H + 0.03))
    # the arrow plate: a dark tread plate toward the front with two lit chevrons (the way items go)
    b.box((0.44, 0.24, 0.016), 'hull', bevel=0.006, at=(0, -0.555, H + 0.006))
    for y in (-0.50, -0.60):
        b.prism(chevron(0.15, 0.075, 0.05), 0.014, G, at=(0, y, H + 0.018))
    for sx in (-1, 1):                        # hazard blocks either side of the plate
        b.box((0.05, 0.20, 0.02), 'paint', bevel=0, at=(sx * 0.255, -0.555, H + 0.008))
    # the back: a painted "take" bracket (no light: only the front glows, so the way reads at a glance)
    for sx in (-1, 1):
        b.box((0.045, 0.16, 0.02), 'paint', bevel=0, at=(sx * 0.20, 0.57, H + 0.008))
    b.box((0.445, 0.045, 0.02), 'paint', bevel=0, at=(0, 0.63, H + 0.008))
    # the lamp mast on a back corner, with its junction box and the conduit to the drive
    mx, my = 0.50, 0.42
    b.box((0.10, 0.10, 0.09), 'hull', bevel=0.015, o='b', at=(mx, my, H))
    b.cyl(0.022, 0.40, 'trim', segs=6, at=(mx, my, H + 0.09))
    b.cyl(0.034, 0.03, 'trim', segs=8, at=(mx, my, H + 0.47))
    b.tube([(mx - 0.05, my, H + 0.035), (0.36, 0.30, H + 0.03), (0.30, 0.22, H + 0.03)], 0.018, 'hull', segs=5)
    status_lamp(m, (mx, my, H + 0.56), parent=b)

    # ------------------------------------------------------------------ the turntable
    t = m.node('turn', at=(0, 0, TURN_Z))
    t.cyl(0.33, 0.055, 'hull', segs=16, bevel=0.012)
    with t.frames(radial(6, radius=0.285, start=30)):
        t.cyl(0.018, 0.012, 'trim', segs=5, at=(0, 0, 0.055))
    t.cyl(0.235, 0.20, 'hull', segs=12, r2=0.19, bevel=0.015, at=(0, 0, 0.05))        # pedestal
    t.ring(0.215, 0.03, 0.03, 'trim', segs=12, at=(0, 0, 0.145))
    sz = SHOULDER_Z - TURN_Z
    cheek = [(-0.155, 0.06), (0.165, 0.06), (0.165, sz - 0.14), (0.075, sz + 0.10), (-0.075, sz + 0.10), (-0.155, sz - 0.14)]
    for sx in (-1, 1):
        t.prism(cheek, 0.045, 'paint', bevel=0.012, plane='yz', at=(sx * 0.135, 0, 0), sharp=30)
        t.cyl(0.078, 0.03, 'trim', segs=10, rot=RIGHT, o='c', at=(sx * 0.17, 0, sz))            # axle caps
        t.cyl(0.03, 0.02, 'hull', segs=6, rot=RIGHT, o='c', at=(sx * 0.19, 0, sz))
        t.box((0.012, 0.12, 0.03), 'hull', bevel=0, at=(sx * 0.16, 0.02, 0.17))                 # a dark slot in each cheek
    # the drive behind the yoke: motor block with fins, and the counterweight low at the back
    t.box((0.20, 0.17, 0.19), 'hull', bevel=0.025, o='b', at=(0, 0.235, 0.055))
    for z in (0.10, 0.14, 0.18):
        t.box((0.215, 0.18, 0.012), 'trim', bevel=0, at=(0, 0.24, z + 0.02))
    t.cyl(0.055, 0.10, 'trim', segs=8, rot=RIGHT, o='c', at=(0.215, 0, sz), bevel=0.01)          # shoulder motor on one side
    t.cyl(0.062, 0.02, 'hull', segs=8, rot=RIGHT, o='c', at=(0.27, 0, sz))
    t.tube([(0.215, 0.05, sz - 0.03), (0.215, 0.16, sz - 0.14), (0.12, 0.25, 0.25)], 0.014, 'hull', segs=5)

    # ------------------------------------------------------------------ the upper arm
    u = m.node('upper', at=(0, 0, sz), rot=(REST[0], 0, 0), parent=t)
    u.cyl(0.12, 0.215, 'trim', segs=12, rot=RIGHT, o='c', bevel=0.012)                        # shoulder hub
    u.box((0.19, 0.155, UPPER - 0.16), 'paint', bevel=0.026, taper=(0.74, 0.8), o='b', at=(0, 0, 0.06))
    for sx in (-1, 1):                        # a long lightening slot on either flank, and rib plates across it
        u.box((0.012, 0.07, 0.50), 'hull', bevel=0, at=(sx * 0.083, 0, 0.50))
        for z in (0.36, 0.50, 0.64):
            u.box((0.02, 0.085, 0.014), 'trim', bevel=0, at=(sx * 0.085, 0, z))
    # the lift cylinder on the back of the beam (the side away from the reach)
    u.rod((0, 0.105, 0.13), (0, 0.095, 0.50), 0.038, 'hull', segs=8, bevel=0.006)
    u.rod((0, 0.095, 0.50), (0, 0.078, 0.82), 0.019, 'trim', segs=6)
    u.box((0.06, 0.06, 0.055), 'trim', bevel=0.008, at=(0, 0.09, 0.13))
    u.box((0.055, 0.05, 0.05), 'trim', bevel=0.008, at=(0, 0.07, 0.83))
    u.box((0.16, 0.135, 0.035), 'trim', bevel=0.006, at=(0, 0, UPPER - 0.17))                 # band under the elbow
    u.cyl(0.10, 0.20, 'trim', segs=12, rot=RIGHT, o='c', bevel=0.01, at=(0, 0, UPPER))         # elbow hub
    for sx in (-1, 1):
        u.cyl(0.036, 0.02, 'hull', segs=6, rot=RIGHT, o='c', at=(sx * 0.10, 0, UPPER))

    # ------------------------------------------------------------------ the forearm
    f = m.node('fore', at=(0, 0, UPPER), rot=(REST[1], 0, 0), parent=u)
    f.box((0.15, 0.13, 0.22), 'hull', bevel=0.02, o='b', at=(0, 0.012, 0.045))                 # elbow actuator
    f.box((0.14, 0.11, FORE - 0.30), 'paint', bevel=0.02, taper=(0.72, 0.8), o='b', at=(0, 0, 0.22))
    # the light strip along its top (local +Y is up when it reaches out): the arm reads as a line pointing at its target
    f.box((0.05, 0.012, 0.52), G, bevel=0, at=(0, 0.058, 0.56))
    f.box((0.07, 0.02, 0.56), 'trim', bevel=0, at=(0, 0.049, 0.56))
    for sx in (-1, 1):
        f.box((0.012, 0.05, 0.36), 'hull', bevel=0, at=(sx * 0.061, 0, 0.56))
    # the gripper's cable along the underside, clipped twice
    f.tube([(0, -0.085, 0.10), (0, -0.075, 0.40), (0, -0.064, 0.75), (0, -0.055, FORE - 0.10)], 0.013, 'hull', segs=5)
    for z in (0.40, 0.75):
        f.box((0.05, 0.03, 0.022), 'trim', bevel=0, at=(0, -0.066, z))
    f.cyl(0.072, 0.15, 'trim', segs=10, rot=RIGHT, o='c', bevel=0.008, at=(0, 0, FORE))        # wrist hub
    f.box((0.11, 0.09, 0.03), 'trim', bevel=0, at=(0, 0, FORE - 0.10))

    # ------------------------------------------------------------------ the wrist and the palm rail
    w = m.node('wrist', at=(0, 0, FORE), rot=(REST[2], 0, 0), parent=f)
    for sx in (-1, 1):                         # the fork that carries the hand on the wrist hub
        w.box((0.022, 0.085, 0.10), 'hull', bevel=0.006, at=(sx * 0.087, 0, 0.03))
    w.cyl(0.05, 0.05, 'hull', segs=10, bevel=0.008, at=(0, 0, 0.05))
    w.ring(0.058, 0.02, 0.022, 'trim', segs=10, at=(0, 0, 0.065))
    w.box((0.60, 0.11, 0.055), 'hull', bevel=0.012, at=(0, 0, 0.115))                          # palm rail
    w.box((0.50, 0.03, 0.012), 'trim', bevel=0, at=(0, 0, 0.146))                              # the slide the fingers run on
    for sx in (-1, 1):
        w.box((0.03, 0.105, 0.062), 'trim', bevel=0.006, at=(sx * 0.30, 0, 0.115))            # end stops
    w.box((0.10, 0.012, 0.022), G, bevel=0, at=(0, -0.05, 0.115))                              # a small light on the hand's front

    # ------------------------------------------------------------------ the fingers
    for name, x, rz in (('fingerL', 0.17, 0), ('fingerR', -0.17, 180)):
        g = m.node(name, at=(x, 0, 0.14), rot=(0, 0, rz), parent=w)
        g.box((0.075, 0.115, 0.05), 'trim', bevel=0.01, o='b', at=(0, 0, -0.012))             # carriage
        g.box((0.042, 0.10, 0.25), 'trim', bevel=0.008, o='b', at=(0.008, 0, 0.03))          # blade
        g.box((0.012, 0.07, 0.15), 'hull', bevel=0, o='b', at=(-0.014, 0, 0.11))              # grip pad on the inside
        g.box((0.07, 0.10, 0.03), 'trim', bevel=0, at=(-0.014, 0, 0.278))              # the hook under the item
    return m


MODELS = [arm]
