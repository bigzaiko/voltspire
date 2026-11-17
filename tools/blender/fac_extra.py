"""BEATSPIRE factory buildings, ordnance group: the Cell Plant (cells), the Missile Works (missiles) and the
air-dropped Supply Crate (crate).

Conventions come from fac_common.py: one hex tile, everything within 0.92 of the axis, FRONT / OUTPUT = -Y,
materials hull/trim/paint/dark/glow_main/glow_work/glow_lamp, named nodes 'lamp' / 'spin' / 'work' with their
origins as pivots. The crate is not a building: it has no plinth and stands straight on the deck.
"""
import math
from vs_lib import *
from fac_common import fac_model, fac_base, status_lamp

H0 = 0.16          # top of the plinth (fac_base default)
G, W = 'glow_main', 'glow_work'


def at_xy(x, y, mats):
    """Frames `mats` (e.g. radial()) moved to stand around the vertical axis through (x, y)."""
    return [T(at=(x, y, 0)) @ r for r in mats]


def band(n, r, h, z, mat='trim', segs=10, xy=(0.0, 0.0)):
    n.cyl(r, h, mat, segs=segs, o='c', at=(xy[0], xy[1], z))


def flange(n, at, rot, r=0.09, glow=None):
    """Pipe flange on a pipe whose axis is local +Z of `rot`: a disc with a bolt circle."""
    with n.frames(T(at=at, rot=rot)):
        n.cyl(r, 0.045, 'trim', segs=10, o='c')
        n.cyl(r * 0.7, 0.08, 'hull', segs=8, o='c', at=(0, 0, -0.04))
        with n.frames(radial(4, radius=r * 0.8, start=45)):
            n.box((0.024, 0.024, 0.075), 'hull', bevel=0)
        if glow:
            n.cyl(r * 0.5, 0.05, glow, segs=8, o='c', at=(0, 0, 0.004))


def hazard(n, x0, x1, z0, z1, y, k=4, slant=0.05, depth=0.012):
    """Horizontal hazard band on a face that looks to -Y (front face at y): dark backing, k slanted stripes."""
    n.box((x1 - x0, depth, z1 - z0), 'dark', bevel=0, at=((x0 + x1) / 2, y + depth / 2, (z0 + z1) / 2))
    w = (x1 - x0 - slant) / (2 * k)
    for i in range(k):
        x = x0 + i * 2 * w
        n.prism([(x, z0), (x + w, z0), (x + w + slant, z1), (x + slant, z1)], depth, 'paint', plane='xz',
                at=(0, y + depth / 2 - 0.004, 0))


# ================================================================== cell plant
def cells():
    m = fac_model('cells', '#7af0d8', work='#7af0d8')
    fac_base(m)
    b = m.node('body')
    Z = H0
    # skid frame under the plant
    b.box((1.30, 1.10, 0.04), 'hull', bevel=0, o='b', at=(0, 0, Z))
    for x in (-0.60, 0.60):
        b.box((0.06, 1.12, 0.07), 'trim', bevel=0, o='b', at=(x, 0, Z))
        b.box((0.012, 0.70, 0.022), G, bevel=0, at=(x + math.copysign(0.032, x), 0, Z + 0.04))

    # ---- back row: three charging columns, glowing electrolyte in a steel cage, linked by a bus bar on top
    cy, ch = 0.36, 1.18
    zb = Z + 0.04
    z0 = zb + 0.24
    z1 = z0 + ch
    xs = (-0.44, 0.0, 0.44)
    for x in xs:
        C = (x, cy)
        b.lathe([(0.18, zb), (0.18, zb + 0.15), (0.145, zb + 0.24), (0.0, zb + 0.24)], 'hull', segs=8, at=(x, cy, 0))
        band(b, 0.19, 0.045, zb + 0.05, 'trim', segs=8, xy=C)
        b.cyl(0.088, ch, W, segs=8, at=(x, cy, z0))
        for t in (0.2, 0.4, 0.6, 0.8):
            band(b, 0.128, 0.06, z0 + ch * t, 'hull', segs=8, xy=C)
        with b.frames(at_xy(x, cy, radial(4, start=45))):
            b.box((0.03, 0.045, ch), 'trim', bevel=0, at=(0.125, 0, z0 + ch / 2))
        b.lathe([(0.155, z1 - 0.03), (0.16, z1 + 0.03), (0.12, z1 + 0.10), (0.0, z1 + 0.11)], 'paint', segs=8,
                at=(x, cy, 0))
        # ribbed insulator and terminal
        b.cyl(0.03, 0.20, 'trim', segs=6, at=(x, cy, z1 + 0.09))
        for dz in (0.15, 0.21):
            band(b, 0.058, 0.025, z1 + dz, 'dark', segs=6, xy=C)
        # junction box at the back of the foot
        b.box((0.16, 0.06, 0.12), 'paint', bevel=0.012, at=(x, cy + 0.18, zb + 0.11))
        b.box((0.09, 0.012, 0.02), G, bevel=0, at=(x, cy + 0.212, zb + 0.12))
    zbus = z1 + 0.31
    b.box((1.02, 0.06, 0.045), 'trim', bevel=0.01, at=(0, cy, zbus))
    b.box((0.90, 0.012, 0.02), G, bevel=0, at=(0, cy - 0.032, zbus))
    # feed manifold along the front of the feet
    b.tube([(-0.50, cy - 0.21, zb + 0.14), (0.50, cy - 0.21, zb + 0.14)], 0.03, 'paint', segs=6)
    for x in xs:
        b.cyl(0.045, 0.03, 'trim', segs=6, o='c', rot=RIGHT, at=(x, cy - 0.21, zb + 0.14))

    # ---- transformer (front right): finned tank, two coils on top, lead up to the bus bar
    tx, ty = 0.38, -0.30
    tz = zb + 0.46
    b.box((0.44, 0.40, 0.46), 'hull', bevel=0.03, o='b', at=(tx, ty, zb))
    b.box((0.46, 0.42, 0.05), 'paint', bevel=0.012, o='b', at=(tx, ty, tz - 0.03))
    for i in range(5):
        b.box((0.05, 0.03, 0.32), 'trim', bevel=0, at=(tx + 0.235, ty - 0.14 + i * 0.07, zb + 0.22))
    b.box((0.30, 0.02, 0.20), 'dark', bevel=0, at=(tx, ty - 0.203, zb + 0.24))
    b.box((0.22, 0.012, 0.03), W, bevel=0, at=(tx, ty - 0.214, zb + 0.29))
    b.box((0.22, 0.012, 0.03), W, bevel=0, at=(tx, ty - 0.214, zb + 0.21))
    for cx in (tx - 0.10, tx + 0.10):
        b.cyl(0.045, 0.24, 'dark', segs=8, at=(cx, ty + 0.05, tz))
        for k in range(3):
            band(b, 0.072, 0.04, tz + 0.05 + k * 0.07, 'trim', segs=8, xy=(cx, ty + 0.05))
        b.cyl(0.03, 0.03, G, segs=6, at=(cx, ty + 0.05, tz + 0.24))
    b.tube([(tx + 0.10, ty + 0.05, tz + 0.26), (tx + 0.12, ty + 0.12, tz + 0.40), (0.60, cy - 0.10, zbus - 0.50),
            (0.60, cy, zbus - 0.12), (0.51, cy, zbus)], 0.018, 'dark', segs=5)

    # ---- mixing vat (front left): open tank of glowing electrolyte, the agitator on 'spin'
    vx, vy, vr = -0.36, -0.30, 0.27
    zl = zb + 0.40                       # liquid level
    b.lathe([(vr, zb), (vr, zb + 0.48), (vr - 0.02, zb + 0.50), (vr - 0.045, zb + 0.50), (vr - 0.045, zl), (0.0, zl)],
            'trim', segs=12, at=(vx, vy, 0))
    band(b, vr + 0.015, 0.06, zb + 0.03, 'hull', segs=12, xy=(vx, vy))
    band(b, vr + 0.01, 0.05, zb + 0.30, 'paint', segs=12, xy=(vx, vy))
    b.cyl(vr - 0.05, 0.012, W, segs=12, at=(vx, vy, zl))
    zbr = zb + 0.66                      # bridge
    for sx in (-1, 1):
        b.box((0.05, 0.07, zbr - zb), 'hull', bevel=0, o='b', at=(vx + sx * (vr + 0.035), vy, zb))
    b.box((2 * vr + 0.13, 0.08, 0.05), 'hull', bevel=0.012, at=(vx, vy, zbr))
    b.cyl(0.075, 0.13, 'paint', segs=8, bevel=0.015, at=(vx, vy, zbr + 0.02))
    b.cyl(0.085, 0.025, 'trim', segs=8, at=(vx, vy, zbr + 0.10))
    s = m.node('spin', at=(vx, vy, zl + 0.05))
    s.cyl(0.018, zbr - zl - 0.05, 'trim', segs=5)
    s.cyl(0.04, 0.05, 'hull', segs=6, o='c')
    with s.frames(radial(4)):
        s.box((0.17, 0.05, 0.012), 'hull', bevel=0, at=(0.115, 0, 0), rot=(28, 0, 0))

    # ---- crude inlet at the back, through the gap between the columns, into the vat
    b.tube([(-0.22, 0.79, Z + 0.17), (-0.22, 0.08, Z + 0.17), (-0.30, -0.06, Z + 0.17)], 0.034, 'trim', segs=6)
    flange(b, (-0.22, 0.81, Z + 0.17), BACK)

    # ---- FRONT: outfeed tray with finished cells
    b.box((0.32, 0.22, 0.07), 'hull', bevel=0.012, o='b', at=(0.0, -0.69, Z))
    b.box((0.24, 0.012, 0.02), G, bevel=0, at=(0.0, -0.80, Z + 0.04))
    for x in (-0.09, 0.0, 0.09):
        b.cyl(0.042, 0.15, W, segs=6, at=(x, -0.69, Z + 0.07))
        b.cyl(0.047, 0.03, 'trim', segs=6, at=(x, -0.69, Z + 0.07))
        b.cyl(0.047, 0.03, 'trim', segs=6, at=(x, -0.69, Z + 0.20))

    # ---- status lamp on a mast at the front corner of the transformer
    lx, ly = tx + 0.15, ty - 0.13
    b.rod((lx, ly, tz), (lx, ly, tz + 0.32), 0.02, 'trim', segs=6)
    b.box((0.09, 0.09, 0.04), 'hull', bevel=0, at=(lx, ly, tz + 0.03))
    status_lamp(m, (lx, ly, tz + 0.40))
    return m


# ================================================================== missile works
def missile(n, at, h=0.95, r=0.085, nose=True, rot=0.0):
    """An upright missile standing on its nozzle at `at`. Returns the height of the top of the body."""
    with n.frames(T(at=at, rot=(0, 0, rot))):
        n.cyl(r * 0.55, 0.06, 'dark', segs=8, r2=r * 0.8)
        n.cyl(r, h, 'trim', segs=8, at=(0, 0, 0.05))
        n.cyl(r + 0.005, 0.06, 'paint', segs=8, o='c', at=(0, 0, 0.05 + h * 0.36))
        n.cyl(r + 0.005, 0.03, G if nose else 'dark', segs=8, o='c', at=(0, 0, 0.05 + h * 0.86))
        with n.frames(radial(4, start=45)):
            n.prism([(r - 0.01, 0.07), (r + 0.09, 0.07), (r + 0.09, 0.14), (r - 0.01, 0.34)], 0.016, 'paint', plane='xz')
        if nose:
            nose_cone(n, (0, 0, 0.05 + h), r)
        else:
            n.cyl(r - 0.015, 0.012, 'dark', segs=8, at=(0, 0, 0.05 + h))
    return 0.05 + h


def nose_cone(n, at, r=0.085):
    n.lathe([(r, 0.0), (r * 0.86, 0.10), (r * 0.5, 0.20), (0.0, 0.26)], 'paint', segs=8, at=at)


def missiles():
    m = fac_model('missiles', '#c9824a')
    b = fac_base(m)
    Z = H0 + 0.03
    b.cyl(0.80 / 0.8660254, 0.03, 'dark', segs=6, phase=30, at=(0, 0, H0))        # steel yard deck
    sx0, sy0 = 0.0, -0.12                # the turntable axis

    # ---- turntable pit: kerb ring with hazard blocks
    b.ring(0.51, 0.07, 0.05, 'hull', segs=16, at=(sx0, sy0, Z + 0.025))
    with b.frames(at_xy(sx0, sy0, radial(8, start=22.5))):
        b.box((0.075, 0.15, 0.012), 'paint', bevel=0, at=(0.51, 0, Z + 0.052))

    # ---- the turntable ('spin') with three missiles in their cradles, one still without its nose
    s = m.node('spin', at=(sx0, sy0, Z))
    s.cyl(0.46, 0.06, 'trim', segs=16, bevel=0.012)
    s.cyl(0.13, 0.03, 'paint', segs=8, at=(0, 0, 0.06))
    for i, a in enumerate((30, 150, 270)):
        with s.frames(rotz(a)):
            s.box((0.26, 0.03, 0.012), G, bevel=0, at=(0.23, 0, 0.062))
            s.cyl(0.125, 0.05, 'hull', segs=8, at=(0.25, 0, 0.06))
            missile(s, (0.25, 0, 0.09), nose=(i != 2), rot=-a)
    ztop = Z + 0.09 + 1.0                # top of a missile body (world)

    # ---- crane mast at the back: two posts, braces, a jib over the turntable, stays from the mast head
    my, mx = 0.60, 0.15
    zj, zh = 2.00, 2.22
    for sx in (-1, 1):
        b.box((0.13, 0.15, 0.05), 'trim', bevel=0, o='b', at=(sx * mx, my, Z))
        b.box((0.07, 0.07, zh - Z), 'hull', bevel=0.012, o='b', at=(sx * mx, my, Z))
        b.box((0.075, 0.075, 0.20), 'paint', bevel=0, o='b', at=(sx * mx, my, Z + 0.06))
        b.box((0.025, 0.012, 0.36), G, bevel=0, at=(sx * mx, my - 0.038, 1.72))
    zs = [Z + 0.34, 0.95, 1.50, zj]
    for z in zs:
        b.box((2 * mx, 0.05, 0.05), 'hull', bevel=0, at=(0, my, z))
    for i, (za, zc) in enumerate(zip(zs, zs[1:])):
        sg = 1 if i % 2 else -1
        b.rod((sg * mx, my, za), (-sg * mx, my, zc), 0.014, 'trim', segs=4)
    b.box((2 * mx + 0.10, 0.09, 0.07), 'paint', bevel=0.012, at=(0, my, zh))
    b.box((0.20, 0.012, 0.022), G, bevel=0, at=(0, my - 0.047, zh))
    jy0, jy1 = my + 0.10, -0.50
    b.box((0.10, jy0 - jy1, 0.09), 'hull', bevel=0.015, at=(0, (jy0 + jy1) / 2, zj))
    b.box((0.105, jy0 - jy1 - 0.10, 0.02), 'paint', bevel=0, at=(0, (jy0 + jy1) / 2, zj + 0.05))
    for sx in (-1, 1):
        b.box((0.012, jy0 - jy1 - 0.30, 0.02), G, bevel=0, at=(sx * 0.052, (jy0 + jy1) / 2 - 0.05, zj))
        b.rod((sx * mx, my, zh), (sx * 0.03, jy1 + 0.06, zj + 0.05), 0.009, 'trim', segs=3)
    # work lights under the jib and on the mast
    for y in (-0.05, 0.28):
        b.box((0.16, 0.07, 0.03), 'hull', bevel=0, at=(0, y, zj - 0.06))
        b.box((0.13, 0.05, 0.012), W, bevel=0, at=(0, y, zj - 0.08))
    b.box((2 * mx - 0.08, 0.03, 0.06), W, bevel=0, at=(0, my - 0.035, 1.50))
    # access platform on the mast with a rail
    b.box((0.46, 0.20, 0.025), 'dark', bevel=0, at=(0, my - 0.12, 0.95))
    for x in (-0.22, 0.22):
        b.rod((x, my - 0.21, 0.95), (x, my - 0.21, 1.11), 0.009, 'trim', segs=3)
    b.rod((-0.22, my - 0.21, 1.11), (0.22, my - 0.21, 1.11), 0.009, 'trim', segs=3)
    # trolley and the hoisted nose cone ('work' bobs)
    hy = sy0 - 0.25
    b.box((0.14, 0.14, 0.06), 'trim', bevel=0.012, at=(0, hy, zj - 0.07))
    w = m.node('work', at=(0, hy, zj - 0.10))
    zn = ztop + 0.24 - (zj - 0.10)       # bottom of the hoisted nose, in the node
    for x in (-0.02, 0.02):
        w.rod((x, 0, 0), (x, 0, zn + 0.30), 0.007, 'dark', segs=3)
    w.box((0.07, 0.05, 0.06), 'hull', bevel=0.01, at=(0, 0, zn + 0.29))
    nose_cone(w, (0, 0, zn))
    w.cyl(0.092, 0.03, 'trim', segs=8, at=(0, 0, zn + 0.01))

    # ---- fuel tank (left) with the fuelling arm reaching to the turntable, fuel inlet at the back
    fx, fy, fr = -0.57, 0.30, 0.15
    for a in (45, 135, 225, 315):
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        b.box((0.04, 0.04, 0.12), 'trim', bevel=0, o='b', at=(fx + ca * 0.11, fy + sa * 0.11, Z))
    b.lathe([(0.0, Z + 0.07), (fr - 0.04, Z + 0.08), (fr, Z + 0.14), (fr, Z + 0.62), (fr - 0.05, Z + 0.70),
             (0.0, Z + 0.72)], 'paint', segs=10, at=(fx, fy, 0))
    band(b, fr + 0.01, 0.07, Z + 0.40, 'dark', xy=(fx, fy))
    band(b, fr + 0.014, 0.022, Z + 0.40, G, xy=(fx, fy))
    band(b, fr + 0.012, 0.03, Z + 0.20, 'trim', xy=(fx, fy))
    arm = [(fx, fy, Z + 0.70), (fx, fy, 1.16), (fx + 0.06, fy - 0.08, 1.22), (-0.40, 0.02, 1.02), (-0.355, -0.01, 0.92)]
    b.tube(arm, 0.024, 'trim', segs=6)
    b.cyl(0.04, 0.05, 'hull', segs=6, o='c', at=(fx, fy, 1.00))
    b.cyl(0.036, 0.06, 'hull', segs=6, o='c', m=aim(arm[3], arm[4]), at=(0, 0, 0.07))
    b.cyl(0.026, 0.03, W, segs=6, o='c', m=aim(arm[3], arm[4]), at=(0, 0, 0.115))
    b.rod((fx + 0.02, fy - 0.03, 1.18), (-0.42, 0.04, 1.30), 0.012, 'hull', segs=4)       # arm support strut
    b.rod((-0.42, 0.04, 1.30), (-0.40, 0.02, 1.04), 0.008, 'dark', segs=3)
    b.tube([(fx, fy + 0.12, Z + 0.17), (fx, 0.57, Z + 0.17)], 0.034, 'trim', segs=6)
    flange(b, (fx, 0.59, Z + 0.17), BACK)

    # ---- parts rack (right): spare nose cones and fin sets on a bench
    rx, ry = 0.58, 0.30
    b.box((0.28, 0.38, 0.26), 'hull', bevel=0.02, o='b', at=(rx, ry, Z))
    b.box((0.30, 0.40, 0.035), 'paint', bevel=0, o='b', at=(rx, ry, Z + 0.24))
    b.box((0.012, 0.26, 0.022), G, bevel=0, at=(rx - 0.146, ry, Z + 0.15))
    b.box((0.05, 0.16, 0.05), 'hull', bevel=0, at=(rx + 0.11, ry, Z + 0.30))            # floodlight on the bench
    b.box((0.012, 0.13, 0.035), W, bevel=0, at=(rx + 0.082, ry, Z + 0.30))
    for y in (-0.09, 0.09):
        nose_cone(b, (rx - 0.03, ry + y, Z + 0.275))
        b.cyl(0.092, 0.02, 'trim', segs=8, at=(rx - 0.03, ry + y, Z + 0.275))

    # ---- control console (front right) with the status lamp mast
    kx, ky = 0.55, -0.46
    b.box((0.20, 0.20, 0.30), 'hull', bevel=0.02, o='b', at=(kx, ky, Z))
    b.box((0.21, 0.21, 0.03), 'paint', bevel=0, o='b', at=(kx, ky, Z + 0.28))
    b.box((0.012, 0.13, 0.08), W, bevel=0, at=(kx - 0.104, ky, Z + 0.19))
    b.rod((kx, ky, Z + 0.30), (kx, ky, 0.70), 0.02, 'trim', segs=6)
    status_lamp(m, (kx, ky, 0.78))

    # ---- blast screen (front left), hazard striped
    with b.frames(T(at=(-0.52, -0.52, 0), rot=(0, 0, -32))):
        b.box((0.40, 0.05, 0.30), 'trim', bevel=0.012, o='b', at=(0, 0, Z))
        hazard(b, -0.18, 0.18, Z + 0.16, Z + 0.26, -0.025 - 0.012)
        for x in (-0.16, 0.16):
            b.prism([(0.0, Z), (0.14, Z), (0.0, Z + 0.20)], 0.03, 'trim', plane='yz', at=(x, 0.025, 0))

    # ---- FRONT: loading lane to the plinth edge
    b.prism([(-0.88, H0), (-0.64, H0), (-0.64, Z + 0.03), (-0.83, Z + 0.03)], 0.40, 'trim', plane='yz')
    for x in (-0.15, 0.15):
        b.box((0.015, 0.16, 0.012), G, bevel=0, at=(x, -0.74, Z + 0.033))
    hazard(b, -0.20, 0.20, H0 + 0.0, H0 + 0.05, -0.88 - 0.012, k=4, slant=0.03)
    return m


# ================================================================== supply crate
def round_shell(n, at, rot=FWD, s=1.0):
    """A shell lying with its nose to local +Z of `rot`."""
    with n.frames(T(at=at, rot=rot, scale=s)):
        n.cyl(0.044, 0.14, 'paint', segs=6)
        n.lathe([(0.044, 0.14), (0.032, 0.19), (0.0, 0.22)], 'trim', segs=6)


def crate():
    m = fac_model('crate', '#e3dc92')
    b = m.node('body')
    S = 0.50                              # half size of the container body
    ZS, ZT = 0.08, 0.78                   # top of the skids, top of the lid
    # ---- pallet skids and floor frame
    for x in (-0.38, 0.0, 0.38):
        b.box((0.13, 1.02, ZS), 'hull', bevel=0, o='b', at=(x, 0, 0))
    b.box((1.08, 1.08, 0.06), 'hull', bevel=0, o='b', at=(0, 0, ZS - 0.01))
    # ---- body, lid, corner posts with corner castings
    b.box((2 * S, 2 * S, 0.60), 'paint', bevel=0.02, o='b', at=(0, 0, ZS + 0.04))
    b.box((2 * S + 0.05, 2 * S + 0.05, 0.07), 'paint', bevel=0.02, o='b', at=(0, 0, ZT - 0.07))
    with b.frames([T(at=(sx * S, sy * S, 0)) for sx in (-1, 1) for sy in (-1, 1)]):
        b.box((0.10, 0.10, ZT - ZS + 0.01), 'hull', bevel=0.02, o='b', at=(0, 0, ZS))
        b.box((0.125, 0.125, 0.07), 'trim', bevel=0.012, o='b', at=(0, 0, ZT - 0.05))
        b.box((0.125, 0.125, 0.07), 'trim', bevel=0, o='b', at=(0, 0, ZS - 0.01))
    # ---- sides and back: ribs, a raised stencil panel, a lit strip
    for sx in (-1, 1):
        x = sx * (S + 0.006)
        for y in (-0.36, -0.30, 0.30, 0.36):
            b.box((0.02, 0.035, 0.50), 'paint', bevel=0, at=(x, y, ZS + 0.33))
        b.box((0.02, 0.42, 0.24), 'hull', bevel=0, at=(x, 0, ZS + 0.36))
        for i, (y, wd) in enumerate(((-0.12, 0.10), (0.0, 0.10), (0.12, 0.10))):
            b.box((0.012, wd - 0.03, 0.10), 'trim', bevel=0, at=(sx * (S + 0.018), y, ZS + 0.40))
        b.box((0.012, 0.34, 0.025), 'trim', bevel=0, at=(sx * (S + 0.018), 0, ZS + 0.29))
        b.box((0.012, 0.50, 0.025), G, bevel=0, at=(sx * (S + 0.012), 0, ZS + 0.15))
    for x in (-0.33, -0.11, 0.11, 0.33):
        b.box((0.035, 0.02, 0.50), 'paint', bevel=0, at=(x, S + 0.006, ZS + 0.33))
    b.box((0.50, 0.012, 0.025), G, bevel=0, at=(0, S + 0.012, ZS + 0.15))
    # ---- strap bands over the top and down both sides, ratchets on the lid
    for y in (-0.22, 0.30):
        b.box((2 * S + 0.075, 0.07, ZT - ZS - 0.01), 'dark', bevel=0, o='b', at=(0, y, ZS + 0.03))
        b.box((0.10, 0.09, 0.03), 'trim', bevel=0, at=(0.30, y, ZT + 0.025))

    # ---- top: the folded drop parachute pack, risers to four lifting lugs
    px, py = 0.0, 0.05
    b.loft([(0.0, 0.26, 0.22), (0.05, 0.30, 0.25), (0.12, 0.28, 0.23), (0.17, 0.19, 0.15)], 'paint', segs=8, power=4.0,
           phase=22.5, at=(px, py, ZT + 0.01))
    for x in (-0.11, 0.11):
        b.box((0.05, 0.50, 0.17), 'dark', bevel=0, o='b', at=(px + x, py, ZT + 0.015))
    b.box((0.14, 0.10, 0.03), 'trim', bevel=0, at=(px, py, ZT + 0.185))
    for sx in (-1, 1):
        for sy in (-1, 1):
            lx, ly = sx * 0.37, sy * 0.37
            b.torus(0.04, 0.013, 'trim', segs=6, rsegs=3, rot=(90, 0, 45 * sx * sy), at=(lx, ly, ZT + 0.04))
            b.rod((lx, ly, ZT + 0.07), (px + sx * 0.16, py + sy * 0.12, ZT + 0.14), 0.007, 'dark', segs=3)

    # ---- FRONT (-Y): open hatch, the door let down as a chute, shells in the dispenser
    hw, hz0, hz1 = 0.30, ZS + 0.07, ZS + 0.44       # half width, bottom, top of the opening
    yf = -S
    b.box((2 * hw, 0.03, hz1 - hz0), 'dark', bevel=0, at=(0, yf - 0.003, (hz0 + hz1) / 2))
    b.box((2 * hw + 0.12, 0.05, 0.06), 'trim', bevel=0.012, at=(0, yf - 0.02, hz1 + 0.03))
    b.box((2 * hw - 0.06, 0.012, 0.022), G, bevel=0, at=(0, yf - 0.046, hz1 + 0.03))
    for sx in (-1, 1):
        b.box((0.06, 0.05, hz1 - hz0), 'trim', bevel=0, at=(sx * (hw + 0.03), yf - 0.02, (hz0 + hz1) / 2))
    b.box((2 * hw, 0.10, 0.03), 'hull', bevel=0, at=(0, yf - 0.03, hz0 + 0.10))       # dispenser shelf
    for x in (-0.18, -0.06, 0.06, 0.18):
        round_shell(b, (x, yf + 0.06, hz0 + 0.165))
    # the door, hinged at the sill, lying down to the deck
    y1, zt = yf - 0.31, 0.02
    b.prism(slab([(yf - 0.03, hz0), (y1, zt)], 0.03), 2 * hw - 0.02, 'paint', plane='yz')
    ang = math.degrees(math.atan2(hz0 - zt, 0.28))
    with b.frames(T(at=(0, (yf - 0.03 + y1) / 2, (hz0 + zt) / 2 + 0.018), rot=(ang, 0, 0))):
        for sx in (-1, 1):
            b.box((0.03, 0.31, 0.035), 'trim', bevel=0, at=(sx * (hw - 0.03), 0, 0.012))
        b.box((0.30, 0.20, 0.008), 'hull', bevel=0, at=(0, 0, 0.0))
    round_shell(b, (0.08, y1 + 0.16, zt + 0.11), rot=(90 + ang, 0, 0))
    # stencil plate above the hatch
    b.box((0.30, 0.012, 0.07), 'hull', bevel=0, at=(0.12, yf - 0.006, hz1 + 0.12))
    for x in (0.02, 0.09, 0.16, 0.23):
        b.box((0.04, 0.012, 0.04), 'trim', bevel=0, at=(x, yf - 0.012, hz1 + 0.12))

    # ---- status lamp on a short mast at the front-left corner of the lid
    lx, ly = -0.37, -0.37
    b.box((0.10, 0.10, 0.04), 'hull', bevel=0, at=(lx, ly + 0.10, ZT + 0.02))
    b.rod((lx, ly + 0.10, ZT), (lx, ly + 0.10, ZT + 0.26), 0.018, 'trim', segs=6)
    status_lamp(m, (lx, ly + 0.10, ZT + 0.33))
    return m


MODELS = [cells, missiles, crate]
