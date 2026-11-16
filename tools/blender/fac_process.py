"""BEATSPIRE factory buildings, processing group: the smelter (blast furnace) and the refinery.

Both follow fac_common: hex plinth from fac_base(), FRONT / output side = Blender -Y, materials
hull/trim/paint/dark/glow_main/glow_work/glow_lamp, the status lamp node 'lamp' placed where it reads from above.
"""
import math
from vs_lib import *
from fac_common import fac_model, fac_base, status_lamp


def arch(w, h, n=6):
    """(x, z) outline of a round-topped arch, w wide and h tall, bottom on z=0 (counter-clockwise)."""
    r = w / 2
    pts = [(-r, 0.0), (r, 0.0)]
    for i in range(n + 1):
        a = math.pi * i / n
        pts.append((r * math.cos(a), h - r + r * math.sin(a)))
    return pts


def at_xy(x, y, mats):
    """Frames `mats` (e.g. radial()) moved to stand around the vertical axis through (x, y)."""
    return [T(at=(x, y, 0)) @ r for r in mats]


def band(n, r, h, z, mat='trim', segs=12, xy=(0.0, 0.0)):
    """A collar round a vertical shell: a plain cylinder a little wider than the shell (half the cost of a ring)."""
    n.cyl(r, h, mat, segs=segs, o='c', at=(xy[0], xy[1], z))


def rivet(n, at, rot, s=0.024):
    n.box((s, s, s * 0.6), 'trim', bevel=0, at=at, rot=rot)


def flange(n, at, rot, r=0.09, glow=None):
    """Pipe flange on a pipe whose axis is local +Z of `rot`: a disc with a bolt circle."""
    with n.frames(T(at=at, rot=rot)):
        n.cyl(r, 0.045, 'trim', segs=10, o='c')
        n.cyl(r * 0.7, 0.08, 'hull', segs=8, o='c', at=(0, 0, -0.04))
        with n.frames(radial(4, radius=r * 0.8, start=45)):
            n.box((0.024, 0.024, 0.075), 'hull', bevel=0)
        if glow:
            n.cyl(r * 0.5, 0.05, glow, segs=8, o='c', at=(0, 0, 0.004))


def handwheel(n, at, rot, r=0.065):
    """Gate valve: body block plus a handwheel on a stem along local +Z of `rot`."""
    with n.frames(T(at=at, rot=rot)):
        n.box((0.09, 0.09, 0.07), 'hull', bevel=0.015)
        n.cyl(0.012, 0.11, 'trim', segs=4)
        n.torus(r, 0.013, 'paint', segs=8, rsegs=3, at=(0, 0, 0.11))
        n.box((r * 2, 0.018, 0.014), 'paint', bevel=0, at=(0, 0, 0.11))
        n.box((0.018, r * 2, 0.014), 'paint', bevel=0, at=(0, 0, 0.11))


# ------------------------------------------------------------------ smelter
def smelter():
    m = fac_model('smelter', '#ce6b44', work='#ff8a3c')
    fac_base(m)
    b = m.node('body')
    Z = 0.16

    # --- foundry block: the heavy riveted hearth the furnace stands on
    bw, bd, bh = 1.10, 0.78, 0.50
    by = -0.04
    zb = Z + bh
    fy = by - bd / 2                                   # front face
    b.box((bw, bd, bh), 'hull', bevel=0.04, o='b', at=(0, by, Z))
    b.box((bw + 0.04, bd + 0.04, 0.07), 'trim', bevel=0.015, o='b', at=(0, by, Z))           # foot band
    b.box((bw + 0.03, bd + 0.03, 0.06), 'paint', bevel=0.015, o='b', at=(0, by, zb - 0.06))   # top band
    with b.frames([T(at=(sx * bw / 2, by + sy * bd / 2, 0)) for sx in (-1, 1) for sy in (-1, 1)]):
        b.box((0.11, 0.11, bh + 0.05), 'trim', bevel=0.02, o='b', at=(0, 0, Z))
    for sx in (-1, 1):                                 # lit strip on both flanks, rivets under it
        b.box((0.02, 0.46, 0.035), 'glow_main', bevel=0, at=(sx * (bw / 2 + 0.008), by + 0.08, Z + 0.33))
        for y in (-0.20, 0.0, 0.20):
            rivet(b, (sx * (bw / 2 + 0.006), by + y, Z + 0.21), (0, 90, 0))
    # heat-blackened front plates round the furnace mouth, riveted
    b.box((0.84, 0.03, 0.40), 'dark', bevel=0.01, o='b', at=(0, fy - 0.008, Z + 0.06))
    for x in (-0.36, 0.36):
        for z in (0.14, 0.30):
            rivet(b, (x, fy - 0.026, Z + z), FWD)
    # the mouth: arched steel frame, glowing fire door behind two bars
    b.prism(arch(0.46, 0.40, 6), 0.06, 'trim', bevel=0.012, plane='xz', at=(0, fy - 0.03, Z + 0.06))
    b.prism(arch(0.33, 0.315, 6), 0.02, 'glow_work', plane='xz', at=(0, fy - 0.052, Z + 0.10))
    b.box((0.40, 0.05, 0.05), 'dark', bevel=0.01, at=(0, fy - 0.05, Z + 0.075))            # sill
    # tap spout: a steel trough from the mouth to the front edge carrying the molten stream
    trough = [(-0.10, 0.0), (0.10, 0.0), (0.10, 0.075), (0.072, 0.075), (0.072, 0.028), (-0.072, 0.028),
              (-0.072, 0.075), (-0.10, 0.075)]
    tilt = (-7, 0, 0)
    b.prism(trough, 0.34, 'trim', bevel=0.008, plane='xz', at=(0, fy - 0.20, Z + 0.07), rot=tilt)
    b.box((0.144, 0.33, 0.012), 'glow_work', bevel=0, at=(0, fy - 0.20, Z + 0.103), rot=tilt)
    b.box((0.17, 0.05, 0.08), 'hull', bevel=0.012, at=(0, fy - 0.12, Z + 0.04))
    # ingot mould under the lip
    b.box((0.28, 0.17, 0.065), 'dark', bevel=0.015, o='b', at=(0, fy - 0.43, Z))
    b.box((0.21, 0.11, 0.01), 'glow_work', bevel=0, at=(0, fy - 0.43, Z + 0.064))

    # --- furnace stack: tapered shell in the accent paint, steel hoops, blackened belly
    sx0, sy0 = 0.0, 0.07
    H = 0.84
    zt = zb + H
    b.lathe([(0.47, zb), (0.48, zb + 0.07), (0.44, zb + 0.30), (0.375, zb + 0.66), (0.31, zt), (0.0, zt)],
            'paint', segs=12, at=(sx0, sy0, 0))
    band(b, 0.492, 0.15, zb + 0.08, 'dark', xy=(sx0, sy0))
    for z, r in ((zb + 0.33, 0.455), (zb + 0.60, 0.405)):
        band(b, r, 0.05, z, 'hull', xy=(sx0, sy0))
    with b.frames(at_xy(sx0, sy0, radial(8, start=22.5))):
        b.box((0.024, 0.024, 0.015), 'trim', bevel=0, at=(0.428, 0, zb + 0.46), rot=(0, 90 - 10, 0))
    # bustle pipe ringing the belly, feeding six tuyeres (each with a glowing peep sight)
    b.torus(0.58, 0.036, 'trim', segs=12, rsegs=4, at=(sx0, sy0, zb + 0.30))
    with b.frames(at_xy(sx0, sy0, radial(6, start=0))):
        b.tube([(0.58, 0, zb + 0.29), (0.565, 0, zb + 0.19), (0.50, 0, zb + 0.15)], 0.02, 'trim', segs=5)
        b.box((0.03, 0.065, 0.035), 'glow_work', bevel=0, at=(0.50, 0, zb + 0.12))
    # charging top: deck, throat and the open ore hopper with a heap of ore in it
    b.cyl(0.36, 0.05, 'dark', segs=12, at=(sx0, sy0, zt - 0.02))
    b.cyl(0.13, 0.10, 'hull', segs=8, at=(sx0, sy0, zt + 0.03))
    b.box((0.25, 0.25, 0.24), 'hull', bevel=0.015, taper=(1.68, 1.68), o='b', at=(sx0, sy0, zt + 0.10))
    with b.frames(at_xy(sx0, sy0, radial(4))):
        b.box((0.04, 0.46, 0.045), 'trim', bevel=0, at=(0.21, 0, zt + 0.355))
    for i, (x, y, r) in enumerate(((0.05, 0.04, 0.085), (-0.07, -0.05, 0.08), (-0.04, 0.10, 0.07),
                                   (0.09, -0.08, 0.07), (0.0, -0.01, 0.075))):
        b.sphere(r, 'paint' if i % 2 else 'dark', segs=5, rings=3, at=(sx0 + x, sy0 + y, zt + 0.31 + (0.03 if i == 4 else 0)))

    # --- skip hoist: inclined track up the +X flank to the hopper, skip car half way up, sheave on top
    p0 = Vector((0.74, -0.10, Z + 0.02))
    p1 = Vector((0.27, sy0, zt + 0.42))
    d = p1 - p0
    side = Vector((-d.y, d.x, 0)).normalized() * 0.075
    for s in (-1, 1):
        b.rod(p0 + side * s, p1 + side * s, 0.017, 'trim', segs=5)
    for t in (0.18, 0.5, 0.82):
        q = p0.lerp(p1, t)
        b.rod(q - side * 1.15, q + side * 1.15, 0.012, 'hull', segs=4)
    q = p0.lerp(p1, 0.42)
    b.box((0.06, 0.06, q.z - zb + 0.02), 'hull', bevel=0.01, o='b', at=(q.x, q.y, zb - 0.02))
    nrm = d.cross(side).normalized()
    if nrm.z < 0:
        nrm = -nrm
    c = p0.lerp(p1, 0.62) + nrm * 0.08
    F = aim(c, c + d, up=nrm)
    k = m.joint('work', mat=F)                       # the skip car: the game bobs it while charging
    k.box((0.17, 0.15, 0.14), 'paint', bevel=0.02, m=F)
    k.box((0.18, 0.16, 0.03), 'trim', bevel=0, m=F, at=(0, 0.07, 0))
    b.cyl(0.07, 0.04, 'trim', segs=8, o='c', m=aim(p1, p1 + side))

    # --- coal bunker on the -X flank: open bin heaped with coal, chute into the hearth
    cx, cw, cdp, ch = -0.66, 0.32, 0.60, 0.44
    b.box((cw, cdp, ch), 'hull', bevel=0.03, o='b', at=(cx, 0.0, Z))
    with b.frames([T(at=(cx, sy * (cdp / 2 + 0.005), 0)) for sy in (-1, 1)]):
        b.box((cw + 0.02, 0.03, ch - 0.06), 'paint', bevel=0, o='b', at=(0, 0, Z + 0.04))
    with b.frames([T(at=(cx + sx * (cw / 2), 0, 0)) for sx in (-1, 1)]):
        b.box((0.04, cdp + 0.03, 0.045), 'trim', bevel=0, at=(0, 0, Z + ch))
    with b.frames([T(at=(cx, sy * (cdp / 2), 0)) for sy in (-1, 1)]):
        b.box((cw + 0.03, 0.04, 0.045), 'trim', bevel=0, at=(0, 0, Z + ch))
    b.box((0.025, 0.40, 0.03), 'glow_main', bevel=0, at=(cx - cw / 2 - 0.008, 0.0, Z + 0.30))
    for (x, y, r) in ((0.0, -0.16, 0.10), (-0.05, 0.02, 0.11), (0.05, 0.17, 0.09), (0.07, -0.02, 0.08),
                      (-0.06, -0.20, 0.07), (-0.04, 0.20, 0.07)):
        b.sphere(r, 'dark', segs=5, rings=3, at=(cx + x, y, Z + ch - 0.02))
    b.box((0.12, 0.20, 0.10), 'trim', bevel=0.015, at=(cx + 0.19, 0.0, Z + 0.28), rot=(0, 30, 0))

    # --- chimney offset to the back: banded, sooty crown with a faint ember glow, flue from the stack top
    hx, hy = -0.36, 0.55
    b.box((0.34, 0.30, 0.24), 'hull', bevel=0.025, o='b', at=(hx, hy, Z))
    b.box((0.36, 0.32, 0.05), 'trim', bevel=0.01, o='b', at=(hx, hy, Z + 0.22))
    b.lathe([(0.15, Z + 0.26), (0.14, Z + 0.40), (0.115, 2.24), (0.0, 2.24)], 'hull', segs=10, at=(hx, hy, 0))
    for z in (0.80, 1.35, 1.90):
        band(b, 0.157 - (z - 0.4) * 0.0135, 0.05, z, 'trim', segs=10, xy=(hx, hy))
    band(b, 0.142, 0.03, 1.62, 'glow_main', segs=10, xy=(hx, hy))
    b.lathe([(0.10, 2.20), (0.15, 2.24), (0.15, 2.34), (0.13, 2.40), (0.09, 2.40), (0.09, 2.30)], 'dark', segs=10,
            at=(hx, hy, 0))
    b.cyl(0.09, 0.01, 'glow_work', segs=8, at=(hx, hy, 2.31))
    flue = [(sx0 - 0.08, sy0 + 0.12, zt - 0.06), (sx0 - 0.14, sy0 + 0.30, zt + 0.12), (hx + 0.10, hy - 0.04, zt + 0.16)]
    b.tube(flue, 0.068, 'hull', segs=8)
    b.cyl(0.082, 0.05, 'trim', segs=8, o='c', m=aim(flue[1], flue[2]), at=(0, 0, 0.12))

    # --- status lamp on a short mast at the front-right corner of the hearth, clear of the stack
    b.box((0.13, 0.13, 0.04), 'hull', bevel=0.01, at=(0.47, -0.33, zb + 0.01))
    b.rod((0.47, -0.33, zb), (0.47, -0.33, zb + 0.20), 0.02, 'trim', segs=6)
    status_lamp(m, (0.47, -0.33, zb + 0.28))
    return m


# ------------------------------------------------------------------ refinery
def refinery():
    m = fac_model('refinery', '#ffb02e', work='#ffa62b')
    fac_base(m)
    b = m.node('body')
    Z = 0.16

    # skid frame under the plant
    b.box((1.28, 1.08, 0.04), 'hull', bevel=0, o='b', at=(0, 0.02, Z))
    for x in (-0.58, 0.58):
        b.box((0.06, 1.10, 0.07), 'trim', bevel=0, o='b', at=(x, 0.02, Z))

    # --- distillation column (back left)
    cx, cy, cr = -0.21, 0.22, 0.19
    C = (cx, cy)
    top = 2.20
    b.lathe([(0.25, Z + 0.04), (0.25, Z + 0.22), (cr + 0.01, Z + 0.28), (cr, top), (cr - 0.03, top + 0.07),
             (0.09, top + 0.115), (0.0, top + 0.125)], 'paint', segs=12, at=(cx, cy, 0))
    for z in (0.92, 1.62):
        band(b, cr + 0.016, 0.035, z, 'hull', xy=C)
    # reboiler sight band near the foot, between two steel collars
    band(b, cr + 0.012, 0.10, 0.56, 'glow_work', xy=C)
    band(b, cr + 0.03, 0.03, 0.495, 'trim', xy=C)
    band(b, cr + 0.03, 0.03, 0.625, 'trim', xy=C)
    # ring platforms (dark grating, steel handrail on posts)
    for z in (1.18, 2.08):
        b.cyl(0.38, 0.025, 'dark', segs=12, o='c', at=(cx, cy, z))
        with b.frames(at_xy(cx, cy, radial(6, start=0))):
            b.rod((0.365, 0, z), (0.365, 0, z + 0.16), 0.009, 'trim', segs=3)
        b.torus(0.365, 0.011, 'trim', segs=12, rsegs=3, at=(cx, cy, z + 0.16))
    # crown nozzle
    b.cyl(0.045, 0.12, 'trim', segs=8, at=(cx, cy, top + 0.10))
    b.cyl(0.06, 0.04, 'hull', segs=8, at=(cx, cy, top + 0.20))
    # ladder up the front-right flank
    la = math.radians(-60)
    u = Vector((math.cos(la), math.sin(la), 0))
    tdir = Vector((-u.y, u.x, 0))
    lp = Vector((cx, cy, 0)) + u * 0.245
    for s in (-0.075, 0.075):
        q = lp + tdir * s
        b.rod((q.x, q.y, Z + 0.06), (q.x, q.y, 2.26), 0.011, 'trim', segs=4)
    z = Z + 0.20
    while z < 2.05:
        q0, q1 = lp - tdir * 0.075, lp + tdir * 0.075
        b.rod((q0.x, q0.y, z), (q1.x, q1.y, z), 0.008, 'trim', segs=3)
        z += 0.16

    # --- overhead vapour line: column crown -> fin-fan condenser (back right) -> accumulator drum under it
    vap = [(cx, cy, top + 0.22), (cx, cy, top + 0.30), (cx + 0.07, cy + 0.06, top + 0.34), (0.10, 0.46, top + 0.12),
           (0.11, 0.48, 1.10), (0.15, 0.48, 1.00)]
    b.tube(vap, 0.032, 'trim', segs=6)
    b.cyl(0.042, 0.05, 'hull', segs=6, o='c', m=aim(vap[3], vap[4]), at=(0, 0, 0.30))
    b.cyl(0.042, 0.05, 'hull', segs=6, o='c', m=aim(vap[3], vap[4]), at=(0, 0, 0.75))
    # fin-fan condenser: louvred box on four legs, fan shroud on top, the fan itself spins while working
    kx, ky, kz = 0.36, 0.48, 0.92
    b.box((0.44, 0.32, 0.14), 'hull', bevel=0.02, o='b', at=(kx, ky, kz))
    b.box((0.46, 0.34, 0.03), 'paint', bevel=0, o='b', at=(kx, ky, kz + 0.13))
    for x in (-0.12, 0.0, 0.12):
        b.box((0.035, 0.33, 0.08), 'dark', bevel=0, at=(kx + x, ky, kz + 0.07))
    b.box((0.40, 0.012, 0.025), 'glow_main', bevel=0, at=(kx, ky - 0.166, kz + 0.07))
    with b.frames([T(at=(kx + sx * 0.19, ky + sy * 0.13, 0)) for sx in (-1, 1) for sy in (-1, 1)]):
        b.box((0.035, 0.035, kz - Z), 'trim', bevel=0, o='b', at=(0, 0, Z))
    b.torus(0.13, 0.016, 'trim', segs=12, rsegs=3, at=(kx, ky, kz + 0.175))
    b.cyl(0.125, 0.012, 'dark', segs=12, at=(kx, ky, kz + 0.15))
    f = m.node('spin', at=(kx, ky, kz + 0.19))
    f.cyl(0.035, 0.05, 'hull', segs=8, o='c')
    with f.frames(radial(4)):
        f.box((0.11, 0.045, 0.008), 'trim', bevel=0, at=(0.075, 0, 0), rot=(22, 0, 0))
    # accumulator: horizontal bullet tank on saddles under the condenser, fed by its drop leg
    ax, ay, az = 0.36, 0.48, Z + 0.20
    b.loft([(-0.28, 0.0, 0.0), (-0.265, 0.09, 0.09), (-0.22, 0.135, 0.135), (0.22, 0.135, 0.135),
            (0.265, 0.09, 0.09), (0.28, 0.0, 0.0)], 'paint', segs=10, rot=RIGHT, at=(ax, ay, az))
    for x in (-0.13, 0.13):
        b.box((0.06, 0.22, 0.10), 'hull', bevel=0, o='b', at=(ax + x, ay, Z))
        b.cyl(0.142, 0.03, 'trim', segs=10, o='c', rot=RIGHT, at=(ax + x, ay, az))
    b.rod((ax, ay, kz), (ax, ay, az + 0.12), 0.025, 'trim', segs=6)

    # --- fired heater (front left): squat box furnace with glowing sight windows and its own stack
    hx, hy = -0.42, -0.30
    b.box((0.40, 0.34, 0.42), 'hull', bevel=0.03, o='b', at=(hx, hy, Z))
    b.box((0.42, 0.36, 0.06), 'paint', bevel=0, o='b', at=(hx, hy, Z + 0.40))
    b.box((0.30, 0.03, 0.05), 'glow_work', bevel=0, at=(hx, hy - 0.172, Z + 0.15))
    b.box((0.30, 0.03, 0.05), 'glow_work', bevel=0, at=(hx, hy - 0.172, Z + 0.27))
    b.box((0.34, 0.04, 0.02), 'trim', bevel=0, at=(hx, hy - 0.175, Z + 0.21))
    b.box((0.03, 0.22, 0.20), 'glow_work', bevel=0, at=(hx - 0.202, hy, Z + 0.22))
    b.cyl(0.07, 0.62, 'hull', segs=8, r2=0.055, at=(hx + 0.06, hy + 0.06, Z + 0.46))
    b.cyl(0.072, 0.05, 'trim', segs=8, at=(hx + 0.06, hy + 0.06, Z + 0.80))
    b.cyl(0.062, 0.03, 'dark', segs=8, at=(hx + 0.06, hy + 0.06, Z + 1.06))
    b.tube([(hx + 0.12, hy + 0.17, Z + 0.30), (hx + 0.12, cy - 0.20, Z + 0.30), (cx, cy - 0.20, Z + 0.30)],
           0.03, 'trim', segs=6)

    # --- product tank (front right), sight glass, status lamp on its dome
    tx, ty, tr, th = 0.36, -0.20, 0.27, 0.50
    b.lathe([(tr, Z + 0.06), (tr, Z + th), (tr - 0.07, Z + th + 0.08), (0.10, Z + th + 0.13), (0.0, Z + th + 0.14)],
            'trim', segs=12, at=(tx, ty, 0))
    b.cyl(tr + 0.02, 0.07, 'hull', segs=12, at=(tx, ty, Z + 0.02))
    band(b, tr + 0.012, 0.045, Z + 0.30, 'paint', segs=12, xy=(tx, ty))
    ga = math.radians(-125)
    g = Vector((tx + math.cos(ga) * (tr + 0.01), ty + math.sin(ga) * (tr + 0.01), 0))
    rz = math.degrees(ga) + 90
    b.box((0.065, 0.035, 0.40), 'hull', bevel=0.01, o='b', at=(g.x, g.y, Z + 0.09), rot=(0, 0, rz))
    b.box((0.03, 0.03, 0.34), 'glow_work', bevel=0, o='b', at=(g.x + math.cos(ga) * 0.012, g.y + math.sin(ga) * 0.012,
                                                               Z + 0.12), rot=(0, 0, rz))
    # rundown line from the column to the tank roof
    b.tube([(cx + 0.17, cy - 0.10, 1.45), (0.20, -0.08, 1.45), (0.30, -0.16, Z + th + 0.30), (0.30, -0.16, Z + th + 0.10)],
           0.026, 'trim', segs=6)
    handwheel(b, (0.07, -0.02, 1.45), (0, 0, 0))

    # --- flare stack (right): slim mast, windshield tip, pilot flame in the work glow
    fx, fy = 0.73, 0.06
    b.box((0.18, 0.18, 0.08), 'hull', bevel=0.015, o='b', at=(fx, fy, Z))
    b.cyl(0.04, 2.24, 'trim', segs=8, r2=0.03, at=(fx, fy, Z + 0.06))
    band(b, 0.05, 0.035, 1.30, 'hull', segs=8, xy=(fx, fy))
    b.lathe([(0.035, 2.42), (0.06, 2.46), (0.065, 2.54), (0.05, 2.54)], 'hull', segs=8, at=(fx, fy, 0))
    b.lathe([(0.045, 2.53), (0.05, 2.57), (0.0, 2.70)], 'glow_work', segs=8, at=(fx, fy, 0))
    b.tube([(fx, fy - 0.08, Z + 0.06), (fx - 0.02, fy - 0.03, 0.9)], 0.012, 'hull', segs=4)

    # --- petrol out at the front, crude in at the back
    out = [(tx - 0.10, ty - 0.24, Z + 0.17), (0.18, -0.52, Z + 0.17), (0.04, -0.60, Z + 0.17), (0.0, -0.66, Z + 0.17),
           (0.0, -0.82, Z + 0.17)]
    b.tube(out, 0.036, 'trim', segs=6)
    handwheel(b, (0.0, -0.70, Z + 0.17), (0, 0, 0), r=0.055)
    flange(b, (0.0, -0.84, Z + 0.17), FWD, glow='glow_main')
    b.tube([(0.0, 0.83, Z + 0.17), (0.0, 0.50, Z + 0.17), (cx + 0.18, cy + 0.10, Z + 0.17)], 0.036, 'trim', segs=6)
    flange(b, (0.0, 0.85, Z + 0.17), BACK)

    status_lamp(m, (tx, ty, Z + th + 0.24))
    return m


MODELS = [smelter, refinery]
