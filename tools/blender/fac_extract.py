"""BEATSPIRE factory buildings, extraction group: the mine (drilling rig on an ore deposit) and the pump
(a nodding-donkey pumpjack on an oil well). Conventions: see fac_common.py (front / output side = -Y)."""
import math
from fac_common import *

H0 = 0.16          # plinth top (fac_base default)


# ------------------------------------------------------------------ helpers
def girder(n, p0, p1, w, mat='hull', up=(0, 0, 1), bevel=0.0, **kw):
    """Square-section member between two points (faces aligned with `up`)."""
    n.add(cyl(w * 0.7071, dist(p0, p1), 4, bevel=bevel, phase=45), mat, m=aim(p0, p1, up), sharp=30, **kw)


def helicoid(ri, ro, h, turns, th=0.02, steps=None):
    """Auger flight: a helical blade between radius ri and ro, rising h over `turns` turns (z from 0)."""
    steps = steps or int(turns * 10)
    bm = bmesh.new()
    rows = []
    for i in range(steps + 1):
        a = 2 * PI * turns * i / steps
        z = h * i / steps
        c, s = math.cos(a), math.sin(a)
        rows.append((bm.verts.new((ri * c, ri * s, z)), bm.verts.new((ro * c, ro * s, z))))
    for (a0, a1), (b0, b1) in zip(rows, rows[1:]):
        bm.faces.new((a0, a1, b1, b0))
    return shell(bm, th)


def gear(n, r0, r1):
    """Toothed outline (n teeth, root radius r0, tip radius r1) for prism()."""
    pts = []
    for i in range(n):
        a = 2 * PI * i / n
        for da, r in ((-0.30, r0), (-0.17, r1), (0.17, r1), (0.30, r0)):
            pts.append((r * math.cos(a + da * 2 * PI / n), r * math.sin(a + da * 2 * PI / n)))
    return pts


def lerp3(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


# ------------------------------------------------------------------ mine
def mine():
    """Drilling rig over the ore deposit: a four-legged headframe with a crown, a top-drive gear and kelly
    that turn the auger (node 'spin'), an incline screw conveyor lifting the spoil into an ore hopper over a
    chute at the FRONT (-Y), a power pack at the back, hydraulic struts on both sides."""
    m = fac_model('mine', '#9d8a6a')
    b = fac_base(m)

    # --- drill pad and the bore pit
    b.lathe([(0.44, H0), (0.44, 0.22), (0.40, 0.26), (0.26, 0.26), (0.24, 0.235), (0.0, 0.235)], 'hull',
            segs=8, phase=22.5, sharp=30)
    b.ring(0.33, 0.10, 0.02, 'trim', segs=8, phase=22.5, at=(0, 0, 0.262))
    b.cyl(0.22, 0.01, 'dark', segs=12, at=(0, 0, 0.236))
    b.torus(0.205, 0.014, 'glow_work', segs=8, rsegs=3, at=(0, 0, 0.245))
    # casing collar around the auger
    b.lathe([(0.20, 0.235), (0.20, 0.34), (0.17, 0.36), (0.165, 0.34), (0.165, 0.236)], 'trim', segs=8, phase=22.5)

    # --- headframe: four legs leaning in to a crown at z 1.46
    ZC = 1.46
    feet = [(sx * 0.52, y, H0) for sx in (-1, 1) for y in (-0.36, 0.42)]
    tops = [(sx * 0.22, y, ZC) for sx in (-1, 1) for y in (-0.16, 0.22)]
    for f, t in zip(feet, tops):
        girder(b, f, t, 0.08, 'paint', up=(0, 0, 1))
        b.box((0.17, 0.17, 0.05), 'trim', bevel=0, at=(f[0], f[1], H0 + 0.025))
    legs = list(zip(feet, tops))      # order: (-x front), (-x back), (+x front), (+x back)

    def leg_at(i, z):
        f, t = legs[i]
        return lerp3(f, t, (z - H0) / (ZC - H0))
    for z in (0.66, 1.10):
        for i, j in ((0, 1), (2, 3), (1, 3), (0, 2)):
            girder(b, leg_at(i, z), leg_at(j, z), 0.05, 'hull')
    # X-bracing on the sides and the back
    for i, j in ((0, 1), (2, 3), (1, 3)):
        for z0, z1 in ((0.30, 0.66), (0.66, 1.10)):
            b.rod(leg_at(i, z0), leg_at(j, z1), 0.016, 'trim', segs=4)
            b.rod(leg_at(j, z0), leg_at(i, z1), 0.016, 'trim', segs=4)

    # crown: deck plate with rails and a gear guard ring
    b.box((0.62, 0.56, 0.07), 'hull', bevel=0.02, at=(0, 0.03, ZC + 0.02))
    b.box((0.66, 0.60, 0.03), 'trim', bevel=0.01, at=(0, 0.03, ZC - 0.02))
    b.box((0.54, 0.48, 0.012), 'paint', bevel=0, at=(0, 0.03, ZC + 0.058))
    with b.sym():
        b.box((0.02, 0.50, 0.02), 'glow_main', bevel=0, at=(0.332, 0.03, ZC + 0.02))
    # top-drive motor beside the gear (on +X) with its cooling fins
    b.cyl(0.10, 0.30, 'paint', segs=10, o='c', rot=FWD, at=(0.24, 0.10, ZC + 0.16))
    for y in (0.0, 0.10, 0.20):
        b.cyl(0.112, 0.022, 'hull', segs=8, o='c', rot=FWD, at=(0.24, y, ZC + 0.16))
    b.cyl(0.07, 0.06, 'trim', segs=8, bevel=0.01, o='c', rot=FWD, at=(0.24, -0.08, ZC + 0.16))
    b.box((0.10, 0.08, 0.06), 'hull', bevel=0.012, at=(0.24, 0.27, ZC + 0.16))
    b.box((0.02, 0.05, 0.03), 'glow_work', bevel=0, at=(0.24, 0.312, ZC + 0.17))
    # status lamp on a mast at the back-left corner of the crown
    b.rod((-0.24, 0.24, ZC + 0.05), (-0.24, 0.24, ZC + 0.34), 0.018, 'trim', segs=6)
    status_lamp(m, (-0.24, 0.24, ZC + 0.42))

    # floodlights under the crown, aimed at the bore
    for sx in (-1, 1):
        p = (sx * 0.20, -0.20, ZC - 0.07)
        b.box((0.10, 0.06, 0.06), 'hull', bevel=0, at=p, rot=(35, 0, 0))
        b.box((0.08, 0.012, 0.045), 'glow_work', bevel=0, at=(p[0], p[1] - 0.03, p[2] - 0.02), rot=(35, 0, 0))

    # --- hydraulic struts bracing the frame from the plinth (both sides)
    with b.sym():
        lo, hi = (0.74, 0.03, H0 + 0.06), (0.37, 0.03, 1.02)
        b.box((0.12, 0.14, 0.06), 'trim', bevel=0, at=(0.74, 0.03, H0 + 0.03))
        mid = lerp3(lo, hi, 0.55)
        b.rod(lo, mid, 0.045, 'paint', segs=8)
        b.rod(lerp3(lo, hi, 0.5), hi, 0.022, 'trim', segs=8)
        b.rod(lerp3(lo, hi, 0.53), lerp3(lo, hi, 0.57), 0.052, 'hull', segs=8)
        b.rod((0.735, 0.03, H0 + 0.12), (0.62, 0.03, 0.62), 0.008, 'dark', segs=4)   # hose

    # --- incline screw conveyor from the collar up to the hopper at the front
    c0, c1 = (0.0, -0.15, 0.32), (0.0, -0.40, 1.10)
    b.rod(c0, c1, 0.065, 'trim', segs=8)
    for t in (0.08, 0.40, 0.72):
        b.rod(lerp3(c0, c1, t), lerp3(c0, c1, t + 0.03), 0.078, 'hull', segs=8)
    b.box((0.17, 0.20, 0.12), 'hull', bevel=0.02, at=(0, -0.43, 1.13), rot=(-12, 0, 0))   # discharge head
    b.box((0.10, 0.10, 0.08), 'trim', bevel=0, at=(0, -0.38, 1.22))                     # drive motor
    b.box((0.12, 0.012, 0.025), 'glow_work', bevel=0, at=(0, -0.535, 1.14), rot=(-12, 0, 0))

    # --- ore hopper over the front chute
    HY = -0.53
    b.lathe([(0.10, 0.62), (0.29, 0.98), (0.29, 1.03), (0.255, 1.03), (0.24, 0.97), (0.0, 0.97)], 'paint',
            segs=4, phase=45, sharp=30, at=(0, HY, 0))
    b.ring(0.272, 0.04, 0.03, 'hull', segs=4, phase=45, at=(0, HY, 1.035))
    b.box((0.30, 0.012, 0.025), 'glow_work', bevel=0, at=(0, HY - 0.207, 0.99))
    for (x, y, s) in ((0.07, -0.50, 0.075), (-0.07, -0.58, 0.065), (0.03, -0.64, 0.055)):
        b.sphere(s, 'paint', segs=5, rings=3, at=(x, y, 0.985), scale=(1, 1, 0.6))
    with b.frames([T(at=(sx * 0.15, HY + sy * 0.15, 0)) for sx in (-1, 1) for sy in (-1, 1)]):
        b.cyl(0.024, 0.62 - H0 + 0.08, 'hull', segs=4, at=(0, 0, H0))
    # chute: a U-channel from the hopper mouth down and out to the front edge
    U = [(-0.13, 0.0), (0.13, 0.0), (0.13, 0.10), (0.105, 0.10), (0.105, 0.025), (-0.105, 0.025),
         (-0.105, 0.10), (-0.13, 0.10)]
    p0, p1 = (0, HY - 0.04, 0.56), (0, -0.85, 0.355)
    L = dist(p0, p1)
    ang = math.degrees(math.atan2(p0[2] - p1[2], p0[1] - p1[1]))
    b.prism(U, L, 'trim', bevel=0.006, plane='xz', at=lerp3(p0, p1, 0.5), rot=(ang, 0, 0))
    b.box((0.12, 0.12, 0.12), 'hull', bevel=0.015, at=(0, HY, 0.60))           # gate
    b.box((0.24, 0.015, 0.02), 'glow_work', bevel=0, at=(0, -0.868, 0.392))    # spout lip light
    b.sphere(0.05, 'paint', segs=5, rings=3, at=(0.03, -0.74, 0.44), scale=(1, 1, 0.6))
    b.sphere(0.04, 'paint', segs=5, rings=3, at=(-0.04, -0.66, 0.48), scale=(1, 1, 0.6))
    with b.sym():
        b.rod((0.10, -0.78, H0), (0.10, -0.78, 0.38), 0.02, 'hull', segs=4)

    # --- power pack at the back: engine block, radiator, exhaust, cable to the top drive
    b.box((0.58, 0.26, 0.30), 'hull', bevel=0.03, o='b', at=(0, 0.66, H0))
    b.box((0.50, 0.20, 0.04), 'paint', bevel=0.012, o='b', at=(0, 0.66, H0 + 0.30))
    for x in (-0.18, -0.09, 0.0, 0.09, 0.18):
        b.box((0.04, 0.18, 0.025), 'dark', bevel=0, o='b', at=(x, 0.66, H0 + 0.34))
    b.box((0.40, 0.012, 0.025), 'glow_work', bevel=0, at=(0, 0.794, H0 + 0.20))
    b.rod((0.22, 0.70, H0 + 0.30), (0.22, 0.70, 0.86), 0.035, 'trim', segs=8)
    b.cyl(0.045, 0.05, 'hull', segs=8, at=(0.22, 0.70, 0.84))
    b.tube([(-0.20, 0.53, H0 + 0.20), (-0.30, 0.44, 0.40), (-0.32, 0.36, 0.80), (-0.25, 0.25, 1.30),
            (-0.10, 0.15, ZC - 0.01)], 0.018, 'dark', segs=5)

    # --- the turning drill string (node 'spin', pivot on the axis at the plinth top)
    s = m.node('spin', at=(0, 0, H0))
    zt = ZC + 0.07 - H0
    # top drive gear on the crown, with a painted bar so the turn reads from above
    s.prism(gear(12, 0.17, 0.225), 0.06, 'hull', at=(0, 0, zt + 0.03), sharp=30)
    s.box((0.30, 0.07, 0.025), 'trim', bevel=0.008, at=(0, 0, zt + 0.07))
    s.cyl(0.07, 0.07, 'paint', segs=8, at=(0, 0, zt + 0.05))
    s.cyl(0.035, 0.02, 'glow_main', segs=8, at=(0, 0, zt + 0.115))
    # kelly bar and swivel
    s.cyl(0.05, zt - 0.62, 'hull', segs=4, phase=45, at=(0, 0, 0.62), sharp=30)
    s.cyl(0.075, 0.08, 'paint', segs=8, at=(0, 0, 0.94))
    s.cyl(0.075, 0.06, 'trim', segs=8, at=(0, 0, 0.58))
    # auger: core shaft with three turns of flight, cutter head in the pit
    s.cyl(0.045, 0.56, 'trim', segs=8, at=(0, 0, 0.04))
    s.add(helicoid(0.04, 0.16, 0.48, 2.5, th=0.018, steps=20), 'paint', at=(0, 0, 0.08))
    s.lathe([(0.0, 0.0), (0.16, 0.06), (0.16, 0.09), (0.05, 0.10)], 'hull', segs=8)
    with s.frames(radial(4)):
        s.box((0.05, 0.03, 0.04), 'trim', bevel=0, at=(0.15, 0, 0.06))
    return m


# ------------------------------------------------------------------ pump
def pump():
    """Pumpjack: Samson-post A-frame carrying the walking beam (node 'arm', pivot on the saddle bearing,
    rocks about X; the beam runs along Y), horse head over the wellhead at the FRONT (-Y), gear reducer
    with crank arms and counterweights and a belt-driven motor at the back, crude outlet stub at the front.

    Optional extra rig (the game may ignore it; with arm alone the model still reads right at rest):
      'pitman' (child of 'arm', origin on the equalizer bearing) = equalizer bar + the two pitman arms,
      'crank' (origin on the crank shaft) = crank arms, counterweights and crank pins; both turn about X.
    For beam angle t: E = pivot + Rx(t)(0, EY, EZ); pick crank angle p (crank pin at C + r(cos p, sin p)
    in (y, z)) with |pin - E| = L; pitman.rotation.x = atan2(pin.y - E.y, E.z - pin.z) - t."""
    m = fac_model('pump', '#7a5fa0')
    b = fac_base(m)
    PZ, PY = 1.95, 0.0          # beam pivot (saddle bearing)
    R = 0.72                    # horse head arc radius (centred on the pivot)
    WY = -0.735                 # well axis: the bridle hangs here, tangent to the arc at pivot height
    C = (0.48, 0.80)            # crank shaft (y, z)
    CR = 0.18                   # crank pin radius; at rest the pin points to +Y
    EY, EZ = C[0] + CR, -0.04   # equalizer bearing in arm space, plumb above the crank pin
    XA, XW, XP = 0.285, 0.335, 0.245     # crank arm, counterweight and pitman planes (x)

    # --- skid: two rails along Y and three cross members
    with b.sym():
        b.box((0.08, 1.40, 0.08), 'hull', bevel=0, o='b', at=(0.24, 0.08, H0))
        b.box((0.09, 1.40, 0.012), 'trim', bevel=0, o='b', at=(0.24, 0.08, H0 + 0.08))
    for y in (-0.52, 0.0, 0.46):
        b.box((0.40, 0.08, 0.05), 'hull', bevel=0, o='b', at=(0, y, H0))
    ZS = H0 + 0.09              # skid top

    # --- Samson post A-frame
    feet = {(sx, sy): (sx * 0.24, (0.30 if sy > 0 else -0.36), ZS) for sx in (-1, 1) for sy in (-1, 1)}
    apex = {sx: (sx * 0.09, PY, PZ - 0.10) for sx in (-1, 1)}

    def leg(sx, sy, z):
        f, t = feet[(sx, sy)], apex[sx]
        return lerp3(f, t, (z - ZS) / (t[2] - ZS))
    for (sx, sy), f in feet.items():
        girder(b, f, apex[sx], 0.08, 'hull')
        b.box((0.13, 0.13, 0.03), 'trim', bevel=0, at=(f[0], f[1], ZS + 0.015))
    for sx in (-1, 1):
        for z in (0.75, 1.35):
            girder(b, leg(sx, -1, z), leg(sx, 1, z), 0.04, 'paint')
        b.rod(leg(sx, -1, 0.30), leg(sx, 1, 0.75), 0.016, 'trim', segs=4)
        b.rod(leg(sx, 1, 0.30), leg(sx, -1, 0.75), 0.016, 'trim', segs=4)
    girder(b, leg(-1, -1, 0.75), leg(1, -1, 0.75), 0.04, 'paint')
    # ladder: rungs between the two back legs
    for k in range(7):
        z = 0.42 + k * 0.19
        b.rod(leg(-1, 1, z), leg(1, 1, z), 0.009, 'trim', segs=4)
    # saddle bearing on the apex
    b.box((0.30, 0.18, 0.08), 'paint', bevel=0.015, at=(0, PY, PZ - 0.10))
    with b.sym():
        b.box((0.035, 0.12, 0.11), 'hull', bevel=0, at=(0.125, PY, PZ - 0.035))
        b.cyl(0.05, 0.04, 'trim', segs=6, o='c', rot=RIGHT, at=(0.145, PY, PZ))

    # --- wellhead at the front: casing head, flow tee, stuffing box; outlet stub at the front edge
    b.lathe([(0.15, H0), (0.15, 0.21), (0.12, 0.23), (0.08, 0.25), (0.08, 0.36), (0.11, 0.37), (0.11, 0.40),
             (0.0, 0.40)], 'hull', segs=8, phase=22.5, at=(0, WY, 0))
    b.cyl(0.065, 0.06, 'trim', segs=8, at=(0, WY, 0.40))
    b.cyl(0.075, 0.22, 'paint', segs=8, bevel=0.012, o='c', rot=FWD, at=(0, WY + 0.03, 0.50))   # flow tee
    b.cyl(0.09, 0.03, 'trim', segs=8, o='c', rot=FWD, at=(0, WY + 0.14, 0.50))                 # blind flange
    b.cyl(0.06, 0.12, 'hull', segs=8, at=(0, WY, 0.53))                                       # stuffing box
    b.cyl(0.075, 0.03, 'trim', segs=8, at=(0, WY, 0.65))
    b.box((0.13, 0.07, 0.14), 'hull', bevel=0.015, at=(0, -0.835, 0.50))                      # gate valve
    b.cyl(0.018, 0.12, 'trim', segs=5, at=(0, -0.835, 0.56))
    b.torus(0.055, 0.011, 'trim', segs=8, rsegs=3, at=(0, -0.835, 0.68))
    b.cyl(0.075, 0.035, 'trim', segs=8, o='c', rot=FWD, at=(0, -0.89, 0.50))
    b.cyl(0.04, 0.012, 'glow_work', segs=8, o='c', rot=FWD, at=(0, -0.912, 0.50))
    b.rod((0, -0.86, H0), (0, -0.86, 0.45), 0.025, 'hull', segs=4)
    b.cyl(0.035, 0.03, 'hull', segs=8, o='c', rot=RIGHT, at=(0.10, WY + 0.06, 0.55))         # gauge
    b.cyl(0.027, 0.01, 'glow_work', segs=8, o='c', rot=RIGHT, at=(0.118, WY + 0.06, 0.55))
    # polished rod, carrier bar and bridle (static: the bridle always meets the arc at pivot height)
    b.cyl(0.018, 1.30 - 0.68, 'trim', segs=6, at=(0, WY, 0.68))
    b.box((0.18, 0.06, 0.04), 'hull', bevel=0, at=(0, WY, 1.30))
    b.cyl(0.03, 0.05, 'trim', segs=6, at=(0, WY, 1.32))
    with b.sym():
        b.rod((0.06, WY, 1.30), (0.06, WY, PZ + 0.02), 0.011, 'dark', segs=4)

    # --- gear reducer on its pedestal
    b.box((0.24, 0.40, 0.24), 'hull', bevel=0.02, o='b', at=(0, C[0] + 0.06, ZS))
    b.box((0.26, 0.42, 0.02), 'trim', bevel=0, o='b', at=(0, C[0] + 0.06, ZS + 0.24))
    b.lathe([(0.0, -0.12), (0.16, -0.12), (0.19, -0.09), (0.19, 0.09), (0.16, 0.12), (0.0, 0.12)], 'paint',
            segs=12, m=T(at=(0, C[0], C[1] - 0.03), rot=RIGHT))
    b.lathe([(0.0, -0.11), (0.09, -0.11), (0.11, -0.09), (0.11, 0.09), (0.09, 0.11), (0.0, 0.11)], 'paint',
            segs=8, m=T(at=(0, C[0] + 0.19, 0.58), rot=RIGHT))
    with b.sym():
        b.box((0.012, 0.30, 0.02), 'glow_main', bevel=0, at=(0.122, C[0] + 0.06, ZS + 0.17))
        b.cyl(0.06, 0.03, 'trim', segs=8, o='c', rot=RIGHT, at=(0.135, C[0], C[1]))
    b.cyl(0.032, 2 * XW + 0.02, 'trim', segs=8, o='c', rot=RIGHT, at=(0, C[0], C[1]))
    # prime mover behind the reducer, V-belt guard between reducer and crank
    MY, MZ = 0.80, 0.36
    b.box((0.24, 0.16, 0.06), 'hull', bevel=0, o='b', at=(0, MY, ZS))
    b.cyl(0.09, 0.24, 'hull', segs=10, o='c', rot=RIGHT, at=(-0.02, MY, MZ))
    for xx in (-0.08, 0.02):
        b.cyl(0.10, 0.02, 'trim', segs=8, o='c', rot=RIGHT, at=(xx, MY, MZ))
    b.box((0.05, 0.10, 0.03), 'glow_work', bevel=0, at=(-0.02, MY, MZ + 0.093))
    belt = []
    for k in range(6):
        aa = math.radians(65 + 230 * k / 5)
        belt.append((C[0] + 0.19 + 0.10 * math.cos(aa), 0.58 + 0.10 * math.sin(aa)))
    for k in range(6):
        aa = math.radians(245 + 230 * k / 5)
        belt.append((MY + 0.08 * math.cos(aa), MZ + 0.08 * math.sin(aa)))
    b.prism(belt, 0.04, 'paint', plane='yz', at=(0.185, 0, 0), sharp=30)

    # --- crank (node 'crank', origin on the shaft): two arms, counterweights, pins
    k = m.node('crank', at=(0, C[0], C[1]))
    with k.sym():
        k.prism([(-0.07, -0.05), (-0.09, 0.0), (-0.07, 0.05), (0.33, 0.04), (0.33, -0.04)], 0.035, 'hull',
                plane='yz', sharp=30, at=(XA, 0, 0))
        k.add(ring(0.27, 0.14, 0.075, segs=4, bevel=0.012, phase=50, arc=80), 'paint', sharp=30,
              m=T(at=(XW, 0, 0), rot=RIGHT))
        k.box((0.012, 0.012, 0.17), 'glow_main', bevel=0, at=(XW + 0.039, 0.325, 0.0))
        k.cyl(0.055, 0.07, 'trim', segs=6, o='c', rot=RIGHT, at=(XA + 0.01, 0, 0))
        k.cyl(0.03, 0.08, 'trim', segs=6, o='c', rot=RIGHT, at=(XP + 0.02, CR, 0))

    # --- control cabinet with the status lamp, out on the +X side where it reads from above
    CX, CY = 0.58, -0.22
    b.box((0.16, 0.22, 0.36), 'hull', bevel=0.02, o='b', at=(CX, CY, H0))
    b.box((0.012, 0.14, 0.12), 'glow_work', bevel=0, at=(CX + 0.082, CY, H0 + 0.24))
    b.box((0.012, 0.14, 0.03), 'paint', bevel=0, at=(CX + 0.082, CY, H0 + 0.12))
    b.box((0.20, 0.26, 0.03), 'paint', bevel=0.008, o='b', at=(CX, CY, H0 + 0.36))
    b.rod((CX, CY + 0.06, H0 + 0.39), (CX, CY + 0.06, 0.92), 0.016, 'trim', segs=6)
    status_lamp(m, (CX, CY + 0.06, 1.00))
    b.tube([(CX - 0.08, CY + 0.08, H0 + 0.05), (0.42, 0.30, H0 + 0.04), (0.20, 0.62, H0 + 0.04),
            (0.10, MY, MZ - 0.06)], 0.014, 'dark', segs=4)
    # chemical injection tank on the -X side, piped to the wellhead
    TX, TY = -0.56, 0.06
    b.lathe([(0.0, H0), (0.13, H0), (0.13, 0.50), (0.10, 0.55), (0.0, 0.56)], 'paint', segs=8, phase=22.5,
            at=(TX, TY, 0))
    b.ring(0.132, 0.012, 0.02, 'glow_main', segs=8, phase=22.5, at=(TX, TY, 0.40))
    b.cyl(0.035, 0.05, 'trim', segs=6, at=(TX, TY, 0.55))
    b.tube([(TX + 0.06, TY - 0.11, 0.30), (-0.40, -0.40, 0.30), (-0.20, WY + 0.02, 0.30), (-0.07, WY + 0.02, 0.30)],
           0.016, 'trim', segs=4)

    # --- walking beam (node 'arm', origin = saddle pivot; rocks about its own X axis, beam along Y)
    a = m.node('arm', at=(0, PY, PZ))
    by0, by1 = -0.46, EY + 0.08
    L = by1 - by0
    yc = (by0 + by1) / 2
    a.box((0.045, L, 0.16), 'paint', bevel=0.008, at=(0, yc, 0.12))
    a.box((0.17, L, 0.03), 'paint', bevel=0.008, at=(0, yc, 0.20))
    a.box((0.06, L - 0.10, 0.012), 'trim', bevel=0, at=(0, yc + 0.02, 0.218))
    a.box((0.17, L, 0.03), 'hull', bevel=0, at=(0, yc, 0.04))
    with a.sym():
        a.box((0.012, L - 0.34, 0.025), 'glow_main', bevel=0, at=(0.03, yc + 0.02, 0.12))
    a.cyl(0.045, 0.24, 'trim', segs=8, o='c', rot=RIGHT)                             # saddle pin
    a.box((0.18, 0.16, 0.05), 'hull', bevel=0, at=(0, 0, 0.0))
    # horse head: front face is an arc centred on the pivot, so the bridle stays plumb over the well
    z0, z1 = -0.40, 0.36
    zs = [z0 + (z1 - z0) * q / 8 for q in range(9)]
    arc = [(-math.sqrt(R * R - z * z), z) for z in zs]
    head = arc + [(-0.50, 0.32), (-0.40, 0.21), (-0.40, 0.02), (-0.50, -0.22)]
    a.prism(head, 0.22, 'paint', bevel=0.02, plane='yz')
    arc2 = [(-math.sqrt((R + 0.012) ** 2 - z * z), z) for z in zs]
    a.prism(arc2 + [(p[0] + 0.05, p[1]) for p in arc2[::-1]], 0.13, 'trim', plane='yz')
    with a.sym():
        a.prism([(p[0] + 0.04, p[1]) for p in arc[1:-1]] + [(-0.49, 0.25), (-0.47, -0.24)], 0.012, 'hull',
                plane='yz', at=(0.115, 0, 0))
        a.box((0.012, 0.012, 0.44), 'glow_main', bevel=0, at=(0.124, -0.62, -0.02))
    # tail bearing bracket for the equalizer
    a.box((0.20, 0.10, 0.06), 'hull', bevel=0, at=(0, EY, 0.0))

    # --- equalizer + pitman arms (node 'pitman', origin on the equalizer bearing, child of the beam)
    q = m.node('pitman', at=(0, EY, EZ), parent=a)
    PL = (PZ + EZ) - C[1]       # pitman length, plumb at rest
    q.box((2 * XP + 0.06, 0.08, 0.07), 'hull', bevel=0.012)
    q.cyl(0.035, 0.22, 'trim', segs=8, o='c', rot=RIGHT)
    with q.sym():
        girder(q, (XP, 0, 0), (XP, 0, -PL), 0.05, 'hull', up=(0, 1, 0))
        girder(q, (XP, 0, -0.12), (XP, 0, -PL + 0.14), 0.062, 'paint', up=(0, 1, 0))
        q.box((0.05, 0.09, 0.10), 'trim', bevel=0, at=(XP, 0, -PL))
        q.box((0.05, 0.08, 0.08), 'trim', bevel=0, at=(XP, 0, 0))
    return m


MODELS = [mine, pump]
