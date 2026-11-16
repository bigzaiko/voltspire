"""BEATSPIRE factory buildings, power group: the coal-fired generator and the power pole.

Conventions: see fac_common.py. Front / output = Blender -Y.
  generator: the power wires meet the top of the insulator stack on the axis, (0, 0, 1.60).
  pole:      the wires meet the tops of the two crossarm insulators, (+-0.40, 0, 3.10): high enough that a span sags
             over the factory buildings (smelter stack 2.4, pumpjack 2.3) instead of through them.
"""
import math
from vs_lib import *
from fac_common import *

GEN_ACCENT = '#6fe0c8'
POLE_ACCENT = '#9ccf6a'
SQ = dict(segs=4, phase=45, sharp=30)      # square sections for lathe()


def insulator(n, x, y, z0, z1, sheds=3, r=0.07, rc=0.028, segs=8, band=True):
    """Ceramic insulator: a core with `sheds` petticoat discs and a terminal cap, standing on (x, y, z0) with
    the top of its terminal exactly at z1. One lathe, so it stays cheap."""
    cap = 0.05
    s = (z1 - z0 - cap) / sheds
    prof = [(rc * 1.25, z0)]
    for i in range(sheds):
        z = z0 + i * s
        prof += [(rc, z + 0.15 * s), (r, z + 0.5 * s), (rc, z + 0.9 * s)]
    zt = z1 - cap
    prof += [(rc * 1.5, zt + 0.004), (rc * 1.5, zt + cap * 0.6), (rc * 0.8, z1), (0.0, z1)]
    n.lathe(prof, 'trim', segs=segs, sharp=35, at=(x, y, 0))
    if band:
        n.ring(rc * 1.55, 0.008, 0.012, 'glow_main', segs=segs, at=(x, y, zt + cap * 0.3))


def lit_ring(n, R, z, segs, mat='glow_main', w=0.016, h=0.02, **kw):
    n.ring(R, w, h, mat, segs=segs, at=kw.pop('at', (0, 0, z)), **kw)


# ------------------------------------------------------------------ generator
def generator():
    m = fac_model('generator', GEN_ACCENT, work='#ffb050')
    fac_base(m)
    Z0 = 0.16
    b = m.node('body')

    # --- firebox (front left) with the glowing furnace mouth facing the front
    FX, FY = -0.39, -0.20
    b.box((0.54, 0.56, 0.62), 'hull', bevel=0.03, o='b', at=(FX, FY, Z0))
    b.box((0.58, 0.60, 0.05), 'trim', bevel=0.0, o='b', at=(FX, FY, Z0))
    b.box((0.57, 0.59, 0.035), 'trim', bevel=0.0, o='b', at=(FX, FY, Z0 + 0.585))
    with b.frames(T(at=(FX, FY - 0.28, 0))):
        b.box((0.36, 0.04, 0.28), 'trim', bevel=0, at=(0, -0.005, 0.47))          # mouth frame
        b.box((0.28, 0.04, 0.20), 'dark', bevel=0, at=(0, -0.012, 0.47))
        b.box((0.24, 0.03, 0.16), 'glow_work', bevel=0, at=(0, -0.022, 0.47))
        for x in (-0.08, 0.0, 0.08):
            b.box((0.026, 0.03, 0.20), 'hull', bevel=0, at=(x, -0.036, 0.47))           # grate bars
        b.box((0.30, 0.03, 0.09), 'paint', bevel=0, at=(0, -0.01, 0.27))               # ash door
        b.box((0.20, 0.02, 0.018), 'glow_work', bevel=0, at=(0, -0.026, 0.27))
        for x in (-0.225, 0.225):
            b.box((0.05, 0.03, 0.50), 'paint', bevel=0, at=(x, -0.005, 0.47))           # corner plates
    b.box((0.02, 0.36, 0.30), 'paint', bevel=0, at=(FX + 0.272, FY - 0.02, 0.48))      # right side panel
    for z in (0.42, 0.52):
        b.box((0.026, 0.28, 0.03), 'dark', bevel=0, at=(FX + 0.28, FY - 0.02, z))       # louvres

    # coal hopper on the firebox, heaped with coal
    HX, HY = FX + 0.03, FY - 0.02
    b.lathe([(0.16, Z0 + 0.62), (0.30, Z0 + 0.93), (0.30, Z0 + 0.96), (0.26, Z0 + 0.96), (0.2, Z0 + 0.88)], 'paint',
            at=(HX, HY, 0), **SQ)
    b.lathe([(0.21, Z0 + 0.88), (0.12, Z0 + 0.95), (0.0, Z0 + 0.985)], 'dark', segs=7, phase=10, sharp=80,
            at=(HX, HY, 0))
    for (x, y, s, a) in ((0.06, 0.03, 0.06, 20), (-0.07, 0.05, 0.05, 50), (0.02, -0.08, 0.055, 75),
):
        b.box((s, s * 0.8, s * 0.7), 'dark', bevel=0, at=(HX + x, HY + y, Z0 + 0.965), rot=(15, 25, a))

    # bucket elevator: the coal intake on the left flank, tipping into the hopper
    EX, EY = -0.73, -0.18
    b.box((0.20, 0.30, 0.20), 'hull', bevel=0, o='b', at=(EX, EY, Z0))                 # boot
    b.lathe([(0.09, 0.0), (0.13, 0.09), (0.11, 0.09), (0.07, 0.03)], 'trim', segs=4, phase=45, sharp=30,
            rot=LEFT, at=(EX - 0.05, EY, Z0 + 0.10))                                      # intake funnel
    b.box((0.12, 0.20, 1.10), 'hull', bevel=0, o='b', at=(EX, EY, Z0 + 0.18))
    b.box((0.13, 0.025, 1.0), 'paint', bevel=0, o='b', at=(EX, EY - 0.09, Z0 + 0.22))
    b.box((0.13, 0.025, 1.0), 'paint', bevel=0, o='b', at=(EX, EY + 0.09, Z0 + 0.22))
    for z in (0.55, 0.95):
        b.box((0.145, 0.225, 0.03), 'trim', bevel=0, at=(EX, EY, Z0 + z))
    b.box((0.012, 0.012, 0.80), 'glow_main', bevel=0, o='b', at=(EX - 0.064, EY, Z0 + 0.30))
    # head housing + spout down into the hopper
    b.prism([(-0.13, 0.0), (0.13, 0.0), (0.13, 0.11), (0.06, 0.17), (-0.13, 0.11)], 0.20, 'hull',
            plane='yz', at=(EX, EY, Z0 + 1.26))
    b.cyl(0.07, 0.24, 'trim', segs=8, o='c', rot=RIGHT, at=(EX, EY, Z0 + 1.355))
    p0, p1 = (EX + 0.06, EY, Z0 + 1.30), (HX - 0.12, HY + 0.02, Z0 + 1.04)
    b.prism([(-0.06, -0.035), (0.06, -0.035), (0.06, 0.035), (-0.06, 0.035)], dist(p0, p1), 'paint', plane='xy',
            m=aim(p0, p1, up=(0, 0, 1)), at=(0, 0, dist(p0, p1) / 2))

    # --- boiler drum across the back, smokebox on its left end, stack above
    BY, BZ, BR = 0.40, 0.68, 0.26
    b.lathe([(0.0, 0.0), (0.17, 0.015), (0.235, 0.06), (BR, 0.13), (BR, 0.50), (0.235, 0.57), (0.17, 0.615),
             (0.0, 0.63)], 'paint', segs=12, rot=RIGHT, at=(-0.45, BY, BZ))
    b.ring(BR + 0.008, 0.03, 0.035, 'trim', segs=12, rot=RIGHT, at=(-0.20, BY, BZ))
    for x in (-0.30, -0.02):                                                                # saddles
        b.prism([(-0.21, 0.0), (0.21, 0.0), (0.21, 0.05), (0.13, 0.12), (0.11, 0.30), (-0.11, 0.30), (-0.13, 0.12),
                 (-0.21, 0.05)], 0.09, 'hull', plane='yz', at=(x, BY, Z0))
    b.lathe([(BR + 0.03, 0.0), (BR + 0.03, 0.16), (0.0, 0.17)], 'hull',
            segs=12, sharp=30, rot=LEFT, at=(-0.43, BY, BZ))                                # smokebox
    b.lathe([(0.17, 0.0), (0.17, 0.02), (0.12, 0.04), (0.0, 0.045)], 'trim', segs=10, rot=LEFT, at=(-0.595, BY, BZ))
    # steam dome, safety valve, pressure gauge
    b.lathe([(0.10, 0.0), (0.10, 0.14), (0.12, 0.17), (0.0, 0.215)], 'hull',
            segs=10, at=(-0.10, BY, BZ + BR - 0.04))
    b.rod((0.07, BY + 0.05, BZ + BR - 0.03), (0.07, BY + 0.05, BZ + BR + 0.11), 0.028, 'trim', segs=6, r2=0.02)
    b.cyl(0.075, 0.035, 'trim', segs=8, rot=FWD, at=(-0.24, BY - BR + 0.03, BZ + 0.06))
    b.cyl(0.055, 0.01, 'glow_work', segs=8, rot=FWD, at=(-0.24, BY - BR - 0.005, BZ + 0.06))
    # exhaust stack
    SX, STZ = -0.53, BZ + BR + 0.02
    b.lathe([(0.15, STZ - 0.06), (0.15, STZ), (0.11, STZ + 0.06), (0.10, 1.28), (0.122, 1.29), (0.122, 1.34),
             (0.097, 1.35), (0.085, 1.85), (0.12, 1.89), (0.125, 1.98), (0.10, 2.0), (0.08, 1.95), (0.0, 1.95)],
            'hull', segs=10, sharp=40, at=(SX, BY, 0))
    b.cyl(0.075, 0.01, 'glow_work', segs=10, at=(SX, BY, 1.955))                              # embers in the throat
    b.tube([(SX + 0.05, BY + 0.07, 1.62), (-0.24, 0.80, Z0 + 0.05)], 0.008, 'trim', segs=4)  # guy wire
    b.box((0.07, 0.07, 0.05), 'trim', bevel=0, at=(-0.24, 0.80, Z0 + 0.02), rot=(0, 0, 30))
    # flue from the firebox into the smokebox
    b.box((0.30, 0.14, 0.30), 'hull', bevel=0, at=(FX - 0.08, 0.11, 0.60))

    # --- turbine (back right), its casing flares to the low-pressure end at the back
    TX, TZ = 0.47, 0.50
    b.lathe([(0.0, 0.0), (0.14, 0.0), (0.14, 0.09), (0.18, 0.12), (0.22, 0.36), (0.235, 0.36), (0.235, 0.43)], 'hull', segs=12, sharp=40, rot=BACK, at=(TX, 0.08, TZ))
    b.lathe([(0.10, 0.0), (0.05, 0.05), (0.0, 0.06)], 'trim', segs=8, rot=BACK, at=(TX, 0.505, TZ))
    b.ring(0.195, 0.02, 0.02, 'glow_main', segs=10, rot=BACK, at=(TX, 0.505, TZ))
    for y in (0.18, 0.42):
        b.prism([(-0.19, 0.0), (0.19, 0.0), (0.19, 0.04), (0.11, 0.10), (0.09, 0.20), (-0.09, 0.20), (-0.11, 0.10),
                 (-0.19, 0.04)], 0.07, 'paint', plane='xz', at=(TX, y, Z0))
    # steam main from the dome to the turbine inlet
    steam = [(-0.10, BY, BZ + BR + 0.12), (0.0, BY - 0.01, BZ + BR + 0.19), (0.22, 0.32, 1.10), (0.40, 0.22, 1.02),
             (TX, 0.17, 0.92), (TX, 0.17, TZ + 0.15)]
    b.tube(steam, 0.034, 'trim', segs=5)
    b.cyl(0.065, 0.05, 'hull', segs=8, at=(TX, 0.17, TZ + 0.12))
    b.torus(0.07, 0.012, 'paint', segs=8, rsegs=3, m=aim((0.22, 0.32, 1.10), (0.22, 0.32, 1.30)), at=(0, 0, 0.06))      # steam valve wheel

    # --- alternator (front right): finned drum with the cooling fan on top
    AX, AY = 0.45, -0.24
    b.lathe([(0.30, Z0), (0.31, Z0 + 0.10), (0.26, Z0 + 0.15), (0.26, 0.86), (0.29, 0.88), (0.29, 0.97),
             (0.22, 0.97)], 'hull', segs=12, sharp=40, at=(AX, AY, 0))
    AT = Matrix.Translation((AX, AY, 0))
    with b.frames([AT @ f for f in radial(8, start=22.5)]):
        b.box((0.075, 0.03, 0.56), 'paint', bevel=0, at=(0.285, 0, 0.58))
    with b.frames([AT @ f for f in radial(4, start=-22.5)]):
        b.box((0.014, 0.05, 0.44), 'glow_main', bevel=0, at=(0.262, 0, 0.58))
    b.ring(0.255, 0.07, 0.10, 'trim', segs=12, at=(AX, AY, 1.01))                         # fan shroud
    b.cyl(0.225, 0.02, 'glow_work', segs=12, at=(AX, AY, 0.955))                            # hot radiator core
    with b.frames([AT @ f for f in radial(3, start=90)]):                                   # guard spider
        b.box((0.20, 0.018, 0.018), 'hull', bevel=0, at=(0.13, 0, 1.075))
    # coupling between turbine and alternator
    b.cyl(0.055, 0.16, 'trim', segs=8, rot=BACK, at=(TX, -0.02, TZ))
    b.cyl(0.09, 0.04, 'hull', segs=8, rot=BACK, at=(TX, 0.03, TZ))

    s = m.node('spin', at=(AX, AY, 1.0))
    s.lathe([(0.05, -0.02), (0.05, 0.03), (0.0, 0.06)], 'trim', segs=8)
    with s.frames(radial(5)):
        s.prism([(0.04, -0.035), (0.215, -0.055), (0.215, 0.04), (0.04, 0.03)], 0.012, 'hull',
                at=(0, 0, 0.02), rot=(22, 0, 0))

    # --- switchgear cabinet between them; the insulated wire terminal stands on it (top at z = 1.6)
    b.box((0.21, 0.30, 0.74), 'hull', bevel=0.02, o='b', at=(0.0, -0.07, Z0))
    b.box((0.17, 0.02, 0.48), 'paint', bevel=0, at=(0.0, -0.225, 0.52))
    b.box((0.12, 0.012, 0.03), 'glow_main', bevel=0, at=(0.0, -0.237, 0.68))
    b.box((0.12, 0.012, 0.015), 'glow_main', bevel=0, at=(0.0, -0.237, 0.63))
    for x in (-0.035, 0.035):
        b.box((0.04, 0.012, 0.04), 'glow_work', bevel=0, at=(x, -0.237, 0.46))
    b.box((0.24, 0.34, 0.035), 'trim', bevel=0, at=(0.0, -0.07, Z0 + 0.755))
    b.box((0.13, 0.13, 0.04), 'hull', bevel=0.01, at=(0, 0, Z0 + 0.79))
    insulator(b, 0, 0, Z0 + 0.81, 1.60, sheds=4, r=0.08, segs=8, band=False)
    b.tube([(0.17, -0.20, 0.74), (0.10, -0.17, 0.82), (0.07, -0.12, 0.86)], 0.022, 'dark', segs=5)   # main cable
    b.tube([(0.17, -0.12, 0.60), (0.10, -0.08, 0.66)], 0.018, 'dark', segs=5)

    # status lamp on top of the elevator head (front left, high: reads from every angle)
    b.cyl(0.02, 0.10, 'trim', segs=6, at=(EX, EY + 0.02, Z0 + 1.42))
    status_lamp(m, at=(EX, EY + 0.02, Z0 + 1.55))
    return m


# ------------------------------------------------------------------ pole
# how much taller than the first cut (insulators at 2.50) the mast is, so spans clear the buildings
LIFT = 0.60


def pole():
    m = fac_model('pole', POLE_ACCENT)
    b = m.node('base')
    # compact footing: a chamfered concrete pad with anchor bolts
    b.lathe([(0.26, 0.0), (0.26, 0.05), (0.20, 0.12), (0.0, 0.12)], 'hull', segs=4, phase=45, sharp=30)
    b.box((0.30, 0.30, 0.03), 'trim', bevel=0.0, at=(0, 0, 0.135))
    with b.frames([T(at=(sx * 0.11, sy * 0.11, 0.15)) for sx in (-1, 1) for sy in (-1, 1)]):
        b.box((0.035, 0.035, 0.03), 'trim', bevel=0)
    b.box((0.012, 0.18, 0.02), 'glow_main', bevel=0, at=(0, -0.235, 0.06), rot=(0, 0, 90))

    # tapered lattice mast: four angle legs, horizontals and zig-zag diagonals
    # (the mast was 2.32 to the crossarm; it is stretched by LIFT so the wires clear the buildings they cross)
    zs = [0.15 + (z - 0.15) * (2.32 + LIFT - 0.15) / (2.32 - 0.15) for z in (0.15, 0.55, 0.92, 1.26, 1.57, 1.85, 2.10, 2.32)]
    z0, z1, w0, w1 = zs[0], zs[-1], 0.125, 0.05

    def half(z):
        return w0 + (w1 - w0) * (z - z0) / (z1 - z0)

    corners = [(1, 1), (-1, 1), (-1, -1), (1, -1)]
    for sx, sy in corners:
        b.rod((sx * w0, sy * w0, z0), (sx * w1, sy * w1, z1 + 0.04), 0.022, 'hull', segs=4, r2=0.016)
    for z in zs[2::2] + [z1]:
        h = half(z)
        for k in range(4):
            a, c = corners[k], corners[(k + 1) % 4]
            b.rod((a[0] * h, a[1] * h, z), (c[0] * h, c[1] * h, z), 0.011, 'trim', segs=3)
    for i in range(len(zs) - 1):
        za, zb = zs[i], zs[i + 1]
        ha, hb = half(za), half(zb)
        for k in range(4):
            a, c = corners[k], corners[(k + 1) % 4]
            if i % 2:
                a, c = c, a
            b.rod((a[0] * ha, a[1] * ha, za), (c[0] * hb, c[1] * hb, zb), 0.009, 'trim', segs=3)
    # accent band + warning plate
    b.box((0.30, 0.30, 0.09), 'paint', bevel=0, at=(0, 0, 0.215))                     # accent collar
    b.box((0.10, 0.012, 0.14), 'paint', bevel=0, at=(0, -half(1.25) - 0.012, 1.25))
    b.box((0.06, 0.008, 0.02), 'glow_main', bevel=0, at=(0, -half(1.25) - 0.02, 1.28))

    # crossarm with its two insulators (tops at x = +-0.40, z = 2.50 + LIFT)
    L = LIFT
    b.box((1.00, 0.08, 0.06), 'hull', bevel=0.015, at=(0, 0, 2.33 + L))
    b.box((1.02, 0.03, 0.02), 'paint', bevel=0, at=(0, -0.045, 2.33 + L))
    with b.sym():
        b.rod((0.04, 0.0, 2.02 + L), (0.30, 0.0, 2.30 + L), 0.014, 'hull', segs=4)
        b.box((0.08, 0.10, 0.02), 'trim', bevel=0, at=(0.40, 0, 2.37 + L))
    for x in (-0.40, 0.40):
        insulator(b, x, 0, 2.38 + L, 2.50 + L, sheds=2, r=0.058, rc=0.02, segs=6, band=False)
    # mast head: glow band and the status lamp on the very top
    b.cyl(0.05, 0.30, 'hull', segs=8, r2=0.04, at=(0, 0, 2.34 + L))
    b.ring(0.05, 0.015, 0.04, 'glow_main', segs=8, at=(0, 0, 2.47 + L))
    b.cyl(0.06, 0.03, 'trim', segs=8, at=(0, 0, 2.62 + L))
    status_lamp(m, at=(0, 0, 2.72 + L))
    return m


MODELS = [generator, pole]
