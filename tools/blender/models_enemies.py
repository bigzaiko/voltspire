"""BEATSPIRE enemies - "the Static": cold machines. Dark slate hulls, gunmetal-violet plating, blue-white glows.
Brute and boss carry weak points: nodes weak_<n> with material glow_weak, placed where the game's hit test expects them."""
import math
from vs_lib import *


def enemy_model(name):
    return Model(name, {'hull': ('#171a22', 0.6, 0.45), 'paint': ('#3d3958', 0.35, 0.55), 'trim': ('#5d6470', 0.65, 0.42),
                        'glow_main': '#8fd0ff', 'glow_weak': '#8a7dff'})


def weak_point(m, name, at, r, parent):
    """Weak point: a faceted core centred exactly on `at` (model space)."""
    w = m.joint(name, at, parent=parent)
    w.sphere(r, 'glow_weak', segs=10, rings=6, at=at)
    return w


SIDES = ((1, 'l', Matrix.Identity(4)), (-1, 'r', MIRROR_X))     # +X is the machine's LEFT


def sx(p, s):
    return (p[0] * s, p[1], p[2])


# ------------------------------------------------------------------ 7. grunt
def enemy_grunt():
    """Hunched bipedal combat drone: low sensor head slung under a layered carapace, digitigrade
    legs, twin forearm guns. Reads from above as overlapping violet back plates.
    Rig: body > torso > head, arm_[lr]_upper > arm_[lr]_lower, body > leg_[lr]_upper > _lower > _foot > _toe."""
    m = enemy_model('enemy_grunt')
    body = m.joint('body', (0, 0.06, 0.64))
    b = m.joint('torso', (0, 0.0, 0.68), parent=body)
    head = m.joint('head', (0, -0.36, 0.76), parent=b)
    # pelvis
    body.box((0.25, 0.17, 0.13), 'hull', bevel=0.03, at=(0, 0.06, 0.60))
    body.box((0.12, 0.05, 0.08), 'trim', bevel=0.015, at=(0, -0.02, 0.535))
    # core hull (profile in the YZ plane, front = -Y) and neck
    b.prism([(0.16, 0.58), (0.23, 0.74), (0.13, 0.95), (-0.10, 1.03), (-0.29, 0.92), (-0.33, 0.78), (-0.20, 0.66),
             (-0.02, 0.56)], 0.28, 'hull', bevel=0.035, plane='yz')
    b.rod((0, -0.26, 0.80), (0, -0.40, 0.74), 0.05, 'trim', segs=6)
    # layered carapace, each plate overlapping the next one back
    b.prism(slab([(-0.36, 0.875), (-0.29, 0.995), (-0.09, 1.095), (0.03, 1.08)], 0.045), 0.40, 'paint', bevel=0.014,
            plane='yz')
    b.prism(slab([(-0.37, 0.885), (-0.295, 1.01), (-0.09, 1.112), (0.05, 1.092)], 0.03), 0.075, 'hull', plane='yz')
    with b.sym():
        b.prism(slab([(-0.33, 0.945), (-0.285, 1.008), (-0.09, 1.104), (0.0, 1.092)], 0.012), 0.012, 'glow_main',
                plane='yz', at=(0.05, 0, 0))
    b.prism(slab([(-0.05, 1.065), (0.10, 1.035), (0.215, 0.93)], 0.04), 0.35, 'paint', bevel=0.012, plane='yz')
    b.prism(slab([(0.17, 0.945), (0.265, 0.83), (0.275, 0.69)], 0.04), 0.29, 'paint', bevel=0.012, plane='yz')
    b.box((0.36, 0.03, 0.025), 'trim', bevel=0.006, at=(0, -0.35, 0.882), rot=(58, 0, 0))     # worn leading edge
    # head: narrow wedge with a brow plate and a slanted eye slit
    head.prism([(-0.61, 0.68), (-0.55, 0.81), (-0.38, 0.84), (-0.30, 0.70), (-0.36, 0.62), (-0.52, 0.60)], 0.20, 'hull',
               bevel=0.025, plane='yz')
    head.prism(slab([(-0.575, 0.815), (-0.52, 0.85), (-0.36, 0.875)], 0.03), 0.24, 'paint', bevel=0.01, plane='yz')
    with head.sym():
        head.box((0.082, 0.02, 0.03), 'glow_main', bevel=0, at=(0.052, -0.585, 0.745), rot=(-25, -18, 0))
        head.prism([(-0.66, 0.55), (-0.57, 0.63), (-0.46, 0.61), (-0.53, 0.57)], 0.025, 'trim', plane='yz',
                   at=(0.07, 0, 0))                                                            # mandible
    with b.sym():
        # flank plates
        b.prism([(-0.25, 0.80), (-0.13, 0.95), (0.10, 0.91), (0.17, 0.74), (0.02, 0.64), (-0.17, 0.68)], 0.03,
                'paint', plane='yz', at=(0.15, 0, 0))
        b.box((0.012, 0.10, 0.03), 'glow_main', bevel=0, at=(0.168, 0.02, 0.76), rot=(-18, 0, 0))
        # exhaust stacks + rear vents
        b.cyl(0.03, 0.17, 'trim', segs=6, bevel=0.006, at=(0.09, 0.15, 0.96), rot=(-30, 0, 0))
        b.box((0.07, 0.02, 0.03), 'glow_main', bevel=0, at=(0.065, 0.20, 0.65), rot=(-20, 0, 0))
    b.rod((-0.11, 0.10, 1.02), (-0.14, 0.20, 1.20), 0.009, 'trim', segs=4, r2=0.004)
    # digitigrade legs: hip -> forward knee -> raised hock -> clawed foot
    X = 0.21
    H, K, A, F = (X, 0.06, 0.64), (X, -0.15, 0.42), (X, 0.13, 0.25), (X, -0.02, 0.07)
    S, E = (0.275, -0.10, 0.89), (0.31, -0.03, 0.68)
    for s, tag, M in SIDES:
        up = m.bone(f'leg_{tag}_upper', sx(H, s), sx(K, s), parent=body)
        lo = m.bone(f'leg_{tag}_lower', sx(K, s), sx(A, s), parent=up)
        ft = m.bone(f'leg_{tag}_foot', sx(A, s), sx(F, s), parent=lo)
        toe = m.joint(f'leg_{tag}_toe', sx(F, s), parent=ft)
        au = m.joint(f'arm_{tag}_upper', sx(S, s), parent=b)
        al = m.joint(f'arm_{tag}_lower', sx(E, s), parent=au)
        with up.frames(M):
            up.cyl(0.085, 0.075, 'trim', segs=8, bevel=0.015, o='c', rot=RIGHT, at=(0.20, 0.06, 0.64))
            up.limb(H, K, 0.078, 0.056, 'hull', segs=6, power=3)
            up.box((0.035, 0.15, 0.25), 'paint', bevel=0.012, m=aim(H, K, (1, 0, 0)), at=(0, 0.062, 0.13), rot=(0, 0, 90))
            up.cyl(0.055, 0.11, 'trim', segs=7, bevel=0.012, o='c', rot=RIGHT, at=K)
            up.lathe([(0.035, 0.0), (0.0, 0.10)], 'paint', segs=4, m=aim(K, (X, -0.30, 0.47)))  # knee spike
        with lo.frames(M):
            lo.limb(K, A, 0.048, 0.036, 'hull', segs=6, power=3)
            lo.cyl(0.042, 0.09, 'trim', segs=6, o='c', rot=RIGHT, at=A)
            lo.lathe([(0.026, 0.0), (0.0, 0.10)], 'trim', segs=4, m=aim(A, (X, 0.27, 0.30)))
        with ft.frames(M):
            ft.limb(A, F, 0.036, 0.03, 'hull', segs=6)
        with toe.frames(M):
            toe.prism([(-0.17, 0.0), (-0.14, 0.055), (-0.02, 0.10), (0.06, 0.075), (0.08, 0.0)], 0.12, 'hull',
                      bevel=0.016, plane='yz', at=(X, 0, 0))
            for dx in (-0.036, 0.036):
                toe.prism([(-0.275, 0.0), (-0.22, 0.045), (-0.14, 0.06), (-0.15, 0.0)], 0.042, 'trim',
                          plane='yz', at=(X + dx, 0, 0), rot=(0, 0, dx * 300))
        # shoulders and forearm guns
        with au.frames(M):
            au.box((0.13, 0.20, 0.10), 'paint', bevel=0.03, taper=(0.7, 0.8), at=(0.275, -0.10, 0.93), rot=(0, 16, 0))
            au.limb(S, E, 0.05, 0.04, 'hull', segs=6, power=3)
        with al.frames(M @ T(at=E, rot=(9, 0, 0))):
            al.box((0.085, 0.28, 0.10), 'hull', bevel=0.02, at=(0, -0.10, 0.0))
            al.box((0.07, 0.17, 0.02), 'paint', bevel=0.006, at=(0, -0.10, 0.056))
            al.cyl(0.03, 0.20, 'trim', segs=7, rot=FWD, at=(0, -0.22, -0.005))
            al.cyl(0.042, 0.055, 'hull', segs=7, bevel=0.01, rot=FWD, at=(0, -0.385, -0.005))
            al.cyl(0.024, 0.012, 'glow_main', segs=6, rot=FWD, at=(0, -0.437, -0.005))
            al.box((0.05, 0.10, 0.05), 'trim', bevel=0.01, at=(0, 0.02, -0.065))                # magazine
    return m


def radial_leg(m, tag, parent, Fm, pts):
    """Leg in a vertical plane that points away from the body. Fm: leg-plane frame (local +X outward,
    +Z up); pts: hip, knee[, ankle], toe in that frame. Creates leg_<tag> (yaw root whose FRONT is the
    outward direction) > _upper > _lower [> _foot] > _toe and returns them."""
    w = [tuple(Fm @ Vector(p)) for p in pts]
    hinge = tuple(Fm.to_3x3() @ Vector((0, 1, 0)))
    root = m.joint(f'leg_{tag}', mat=Fm @ T(at=pts[0]) @ rotz(90), parent=parent)
    up = m.bone(f'leg_{tag}_upper', w[0], w[1], parent=root, hinge=hinge)
    lo = m.bone(f'leg_{tag}_lower', w[1], w[2], parent=up, hinge=hinge)
    out = [root, up, lo]
    last = lo
    if len(pts) == 4:
        last = m.bone(f'leg_{tag}_foot', w[2], w[3], parent=lo, hinge=hinge)
        out.append(last)
    out.append(m.joint(f'leg_{tag}_toe', mat=Fm @ T(at=pts[-1]) @ rotz(90), parent=last))
    return out


# ------------------------------------------------------------------ 8. runner
def enemy_runner():
    """Lean quadruped hunter-killer: long armoured spine, wedge head with a hinged jaw, four
    two-segment legs. Rig: body > head > jaw, body > leg_(fl|fr|hl|hr)_upper > _lower > _toe."""
    m = enemy_model('enemy_runner')
    b = m.joint('body', (0, 0.0, 0.38))
    head = m.joint('head', (0, -0.33, 0.34), parent=b)
    jaw = m.joint('jaw', (0, -0.40, 0.235), parent=head)
    # spine hull + overlapping back armour
    b.prism([(-0.40, 0.29), (-0.38, 0.40), (-0.07, 0.50), (0.26, 0.47), (0.41, 0.38), (0.37, 0.27), (-0.17, 0.235)],
            0.22, 'hull', bevel=0.03, plane='yz')
    b.prism(slab([(-0.385, 0.405), (-0.20, 0.485), (-0.05, 0.515)], 0.035), 0.19, 'paint', bevel=0.01, plane='yz')
    b.prism(slab([(-0.09, 0.525), (0.10, 0.515), (0.24, 0.49)], 0.03), 0.16, 'paint', bevel=0.01, plane='yz')
    b.prism(slab([(0.20, 0.505), (0.33, 0.465), (0.42, 0.385)], 0.03), 0.18, 'paint', bevel=0.01, plane='yz')
    b.prism(slab([(-0.36, 0.43), (-0.07, 0.545), (0.26, 0.515), (0.40, 0.42)], 0.02), 0.04, 'hull', plane='yz')
    b.box((0.10, 0.36, 0.07), 'hull', bevel=0.02, at=(0, 0.0, 0.245))                          # belly drive
    with b.sym():
        b.box((0.012, 0.30, 0.024), 'glow_main', bevel=0, at=(0.113, 0.04, 0.37), rot=(4, 0, 0))
        b.box((0.03, 0.26, 0.05), 'trim', bevel=0.01, at=(0.10, 0.02, 0.30))                  # side rails
        b.cyl(0.10, 0.07, 'hull', segs=8, bevel=0.018, o='c', rot=RIGHT, at=(0.15, -0.26, 0.36))    # shoulder housing
        b.cyl(0.11, 0.07, 'hull', segs=8, bevel=0.018, o='c', rot=RIGHT, at=(0.15, 0.26, 0.38))     # hip housing
        b.prism([(0.06, 0.50), (0.20, 0.50), (0.27, 0.60), (0.19, 0.555)], 0.02, 'trim', bevel=0.005, plane='yz',
                at=(0.05, 0, 0), rot=(0, 0, 0))                                                 # swept sensor vanes
    b.box((0.13, 0.02, 0.045), 'glow_main', bevel=0, at=(0, 0.392, 0.33), rot=(-20, 0, 0))
    b.rod((0, 0.36, 0.42), (0, 0.55, 0.62), 0.010, 'trim', segs=5, r2=0.004)
    b.sphere(0.016, 'glow_main', segs=6, rings=4, at=(0, 0.55, 0.62))
    b.rod((0, -0.30, 0.36), (0, -0.40, 0.33), 0.045, 'trim', segs=6)                          # neck
    # head wedge
    head.prism([(-0.60, 0.275), (-0.50, 0.40), (-0.34, 0.41), (-0.31, 0.27), (-0.40, 0.235)], 0.19, 'hull',
               bevel=0.022, plane='yz')
    head.prism(slab([(-0.585, 0.325), (-0.50, 0.42), (-0.33, 0.43)], 0.03), 0.15, 'paint', bevel=0.008, plane='yz')
    head.box((0.20, 0.04, 0.035), 'glow_main', bevel=0.008, at=(0, -0.553, 0.32), rot=(-50, 0, 0))
    with head.sym():
        head.box((0.02, 0.12, 0.05), 'trim', bevel=0.006, at=(0.098, -0.42, 0.31))
    # jaw
    jaw.prism([(-0.62, 0.205), (-0.56, 0.265), (-0.38, 0.265), (-0.38, 0.215), (-0.50, 0.185)], 0.14, 'hull',
              bevel=0.015, plane='yz')
    with jaw.sym():
        jaw.prism([(-0.67, 0.19), (-0.56, 0.27), (-0.47, 0.235)], 0.025, 'trim', bevel=0.005, plane='yz',
                  at=(0.068, 0, 0))
    # legs (front: shoulder, elbow back, paw; hind: hip, hock back, paw)
    X = 0.20
    LEGS = {'f': ((X, -0.26, 0.36), (X, -0.04, 0.16), (X, -0.28, 0.05)),
            'h': ((X, 0.26, 0.38), (X, 0.50, 0.20), (X, 0.30, 0.05))}
    for s, tag, M in SIDES:
        for fh, (S, E, P) in LEGS.items():
            big = 1.0 if fh == 'f' else 1.12
            up = m.bone(f'leg_{fh}{tag}_upper', sx(S, s), sx(E, s), parent=b)
            lo = m.bone(f'leg_{fh}{tag}_lower', sx(E, s), sx(P, s), parent=up)
            toe = m.joint(f'leg_{fh}{tag}_toe', sx(P, s), parent=lo)
            with up.frames(M):
                up.limb(S, E, 0.06 * big, 0.044 * big, 'hull', segs=6, power=3)
                up.box((0.03, 0.12, 0.19 * big), 'paint', bevel=0.012, m=aim(S, E, (1, 0, 0)), at=(0, 0.045, 0.10),
                       rot=(0, 0, 90))
                up.cyl(0.05, 0.085, 'trim', segs=7, bevel=0.012, o='c', rot=RIGHT, at=E)
            with lo.frames(M):
                lo.limb(E, P, 0.04, 0.026, 'trim', segs=6)
                lo.rod(lerp(E, P, 0.1), lerp(E, P, 0.75), 0.03, 'hull', segs=5, r2=0.022)
            with toe.frames(M):
                toe.prism([(-0.11, -0.05), (-0.08, 0.0), (0.02, 0.02), (0.045, -0.05)], 0.08, 'hull', bevel=0.012,
                          plane='yz', at=(P[0], P[1], P[2]))
                toe.prism([(-0.16, -0.05), (-0.11, -0.012), (-0.07, -0.05)], 0.03, 'trim', plane='yz',
                          at=(P[0], P[1], P[2]))
    return m


# ------------------------------------------------------------------ 9. drone (origin = its own centre)
def enemy_drone():
    """Ducted quad-rotor gunship: angular wedge fuselage, armoured shrouds, twin chin guns and a
    gimballed eye. Rig: body > spin_1..4, body > eye."""
    m = enemy_model('enemy_drone')
    b = m.joint('body', (0, 0, 0))
    # fuselage: narrow armoured wedge (profile in YZ, front = -Y)
    b.prism([(-0.34, -0.02), (-0.24, 0.07), (0.08, 0.11), (0.30, 0.06), (0.34, -0.02), (0.22, -0.10), (-0.20, -0.12)],
            0.22, 'hull', bevel=0.03, plane='yz')
    b.prism(slab([(-0.33, 0.005), (-0.235, 0.09), (0.08, 0.13), (0.24, 0.095)], 0.03), 0.17, 'paint', bevel=0.01,
            plane='yz')
    b.prism(slab([(-0.20, 0.118), (0.06, 0.15)], 0.02), 0.05, 'trim', plane='yz')
    b.box((0.30, 0.16, 0.06), 'hull', bevel=0.02, at=(0, 0.02, 0.0))                           # wing root block
    b.prism([(0.20, 0.06), (0.30, 0.06), (0.43, 0.20), (0.37, 0.19)], 0.02, 'paint', bevel=0.005, plane='yz')   # tail fin
    b.box((0.15, 0.02, 0.04), 'glow_main', bevel=0, at=(0, 0.335, 0.0))                        # exhaust
    R = 0.40
    with b.frames(radial(4, start=45)):
        b.box((0.26, 0.06, 0.045), 'hull', bevel=0.012, at=(0.22, 0, 0.02))
        b.box((0.13, 0.066, 0.02), 'paint', bevel=0.006, at=(0.21, 0, 0.048))
        b.cyl(0.045, 0.10, 'trim', segs=7, bevel=0.012, at=(R, 0, -0.035))
        b.ring(0.178, 0.022, 0.085, 'hull', segs=10, at=(R, 0, 0.065))             # duct shroud
        b.ring(0.19, 0.012, 0.03, 'paint', segs=10, arc=150, phase=-75, at=(R, 0, 0.085))
        b.box((0.33, 0.014, 0.012), 'trim', bevel=0, at=(R, 0, 0.03))                          # stator
        b.cyl(0.018, 0.02, 'glow_main', segs=6, at=(R, 0, -0.05))
    for i, ang in enumerate((45, 135, 225, 315)):
        a = math.radians(ang)
        s = m.node(f'spin_{i + 1}', at=(R * math.cos(a), R * math.sin(a), 0.075), parent=b)
        s.cyl(0.028, 0.04, 'trim', segs=6, bevel=0.008)
        with s.frames(radial(3)):
            s.box((0.125, 0.034, 0.008), 'trim', bevel=0, at=(0.088, 0, 0.022), rot=(14, 0, 0))
    with b.sym():   # chin guns + antennae
        b.box((0.05, 0.16, 0.05), 'hull', bevel=0.01, at=(0.105, -0.10, -0.10))
        b.cyl(0.018, 0.17, 'trim', segs=6, rot=FWD, at=(0.105, -0.17, -0.10))
        b.cyl(0.012, 0.012, 'glow_main', segs=6, rot=FWD, at=(0.105, -0.34, -0.10))
        b.rod((0.07, 0.24, 0.07), (0.11, 0.36, 0.25), 0.007, 'trim', segs=4, r2=0.003)
    # gimballed eye under the nose
    b.cyl(0.07, 0.05, 'trim', segs=8, bevel=0.012, at=(0, -0.12, -0.165))
    e = m.joint('eye', (0, -0.12, -0.20), parent=b)
    e.sphere(0.085, 'hull', segs=10, rings=6, at=(0, -0.12, -0.20))
    e.torus(0.06, 0.016, 'paint', segs=10, rsegs=4, rot=FWD, at=(0, -0.185, -0.215))
    e.sphere(0.052, 'glow_main', segs=10, rings=5, at=(0, -0.172, -0.213), scale=(1, 0.7, 1))
    return m


# ------------------------------------------------------------------ 10. brute
def enemy_brute():
    """Siege walker: hunched slab-armoured chest with a recessed reactor grille, visor head sunk
    between the shoulders, piston legs and gauntlet arms.
    Rig: body > torso > head, torso > arm_[lr]_upper > arm_[lr]_lower, body > leg_[lr]_upper > _lower > _toe."""
    m = enemy_model('enemy_brute')
    body = m.joint('body', (0, 0.02, 0.80))
    b = m.joint('torso', (0, 0.04, 0.94), parent=body)
    head = m.joint('head', (0, -0.14, 1.66), parent=b)
    # pelvis
    body.box((0.52, 0.38, 0.26), 'hull', bevel=0.05, taper=(1.15, 1.05), at=(0, 0.02, 0.80))
    body.prism([(-0.14, 0.62), (-0.2, 0.86), (0.2, 0.86), (0.14, 0.62)], 0.06, 'paint', bevel=0.015, plane='xz',
               at=(0, -0.19, 0))
    body.cyl(0.19, 0.10, 'trim', segs=10, bevel=0.02, at=(0, 0.03, 0.90))                       # waist bearing
    # chest: hunched block (profile in YZ) with layered plates
    b.prism([(-0.30, 0.98), (-0.40, 1.30), (-0.30, 1.66), (0.02, 1.80), (0.34, 1.70), (0.40, 1.20), (0.28, 0.98)],
            0.96, 'hull', bevel=0.07, plane='yz')
    b.prism(slab([(-0.345, 1.02), (-0.455, 1.30), (-0.34, 1.68)], 0.06), 0.78, 'paint', bevel=0.02, plane='yz')
    b.prism(slab([(-0.33, 1.71), (0.02, 1.855), (0.30, 1.775)], 0.05), 0.70, 'paint', bevel=0.02, plane='yz')
    with b.sym():
        b.box((0.03, 0.02, 0.50), 'trim', bevel=0.006, at=(0.36, -0.425, 1.34), rot=(-17, 0, 0))   # worn plate edge
        b.box((0.07, 0.56, 0.52), 'paint', bevel=0.02, at=(0.495, 0.02, 1.36))                      # flank slab
        b.box((0.02, 0.30, 0.04), 'glow_main', bevel=0, at=(0.535, 0.04, 1.20))
        for z in (1.10, 1.58):
            b.cyl(0.022, 0.014, 'trim', segs=5, rot=FWD, at=(0.26, -0.40 + (0.07 if z > 1.4 else 0.0), z))
    # recessed reactor grille
    with b.frames(T(at=(0, -0.405, 1.33), rot=(73, 0, 0))):
        b.cyl(0.17, 0.05, 'trim', segs=8, bevel=0.016, phase=22.5)
        b.cyl(0.125, 0.03, 'glow_main', segs=8, at=(0, 0, 0.035), phase=22.5)
        for x in (-0.07, 0.0, 0.07):
            b.box((0.028, 0.30, 0.03), 'hull', bevel=0.006, at=(x, 0, 0.065))
    # power pack + exhaust stacks
    b.box((0.50, 0.20, 0.56), 'hull', bevel=0.05, at=(0, 0.47, 1.38))
    # back-mounted core in an open collar: weak_1, glTF (0, 1.3, -0.55)
    WK = (0, 0.55, 1.30)
    with b.frames(T(at=WK, rot=BACK)):
        b.ring(0.37, 0.07, 0.14, 'trim', segs=10, bevel=0.015, at=(0, 0, 0.04))
        with b.frames(radial(4, start=45)):
            b.prism([(0.33, -0.02), (0.46, -0.02), (0.46, 0.14), (0.40, 0.24), (0.345, 0.20)], 0.12, 'paint',
                    plane='xz')
    weak_point(m, 'weak_1', WK, 0.32, b)
    with b.sym():
        b.cyl(0.07, 0.40, 'trim', segs=8, bevel=0.012, at=(0.19, 0.44, 1.62), rot=(-10, 0, 0))
        b.cyl(0.05, 0.02, 'glow_main', segs=8, at=(0.19, 0.51, 2.012), rot=(-10, 0, 0))
    # head: visor block sunk between the shoulders
    head.box((0.26, 0.28, 0.22), 'hull', bevel=0.04, taper=(0.82, 0.85), at=(0, -0.20, 1.80))
    head.prism(slab([(-0.36, 1.85), (-0.22, 1.935), (-0.06, 1.925)], 0.035), 0.24, 'paint', bevel=0.01, plane='yz')
    head.box((0.21, 0.03, 0.035), 'glow_main', bevel=0.006, at=(0, -0.342, 1.80))
    head.box((0.10, 0.05, 0.07), 'trim', bevel=0.012, at=(0, -0.33, 1.72))
    # deep-bent piston legs: long segments give the stomp a real stride
    H, K, A = (0.30, 0.02, 0.78), (0.30, -0.27, 0.46), (0.30, 0.05, 0.14)
    S, E, W = (0.66, 0.02, 1.50), (0.70, 0.04, 1.04), (0.67, -0.16, 0.66)
    for s, tag, M in SIDES:
        up = m.bone(f'leg_{tag}_upper', sx(H, s), sx(K, s), parent=body)
        lo = m.bone(f'leg_{tag}_lower', sx(K, s), sx(A, s), parent=up)
        toe = m.joint(f'leg_{tag}_toe', sx(A, s), parent=lo)
        au = m.joint(f'arm_{tag}_upper', sx(S, s), parent=b)
        al = m.joint(f'arm_{tag}_lower', sx(E, s), parent=au)
        with up.frames(M):
            up.cyl(0.16, 0.14, 'trim', segs=10, bevel=0.02, o='c', rot=RIGHT, at=(0.31, 0.02, 0.78))
            up.limb(H, K, 0.16, 0.13, 'hull', segs=8, power=3)
            up.box((0.26, 0.09, 0.30), 'paint', bevel=0.03, m=aim(H, K, (1, 0, 0)), at=(0, 0.13, 0.17), rot=(0, 0, 90))
            up.cyl(0.13, 0.24, 'trim', segs=8, bevel=0.02, o='c', rot=RIGHT, at=K)
        with lo.frames(M):
            lo.limb(K, A, 0.14, 0.13, 'hull', segs=8, power=3.5)
            lo.box((0.25, 0.08, 0.24), 'paint', bevel=0.025, m=aim(K, A, (1, 0, 0)), at=(0, 0.12, 0.16), rot=(0, 0, 90))
            lo.rod((0.30, -0.08, 0.52), (0.30, 0.14, 0.24), 0.035, 'trim', segs=6)            # calf piston
        with toe.frames(M):
            toe.prism([(-0.36, 0.0), (-0.32, 0.12), (-0.08, 0.22), (0.16, 0.20), (0.22, 0.0)], 0.32, 'hull', bevel=0.03,
                      plane='yz', at=(0.30, 0, 0))
            toe.prism([(-0.39, 0.0), (-0.35, 0.09), (-0.22, 0.145), (-0.24, 0.0)], 0.26, 'paint', bevel=0.012,
                      plane='yz', at=(0.30, 0, 0))
            toe.box((0.34, 0.05, 0.03), 'trim', bevel=0.008, at=(0.30, 0.20, 0.015))
        with au.frames(M):
            # slab pauldron: angular roof plate + hanging side skirt instead of a dome
            au.box((0.40, 0.56, 0.13), 'paint', bevel=0.035, taper=(0.72, 0.8), at=(0.71, 0.02, 1.74), rot=(0, 14, 0))
            au.box((0.07, 0.48, 0.30), 'paint', bevel=0.02, at=(0.905, 0.02, 1.565), rot=(0, 8, 0))
            au.box((0.03, 0.50, 0.03), 'trim', bevel=0.008, at=(0.925, 0.02, 1.42), rot=(0, 8, 0))
            au.box((0.02, 0.26, 0.04), 'glow_main', bevel=0, at=(0.948, 0.02, 1.58), rot=(0, 8, 0))
            au.cyl(0.17, 0.20, 'trim', segs=8, bevel=0.02, o='c', rot=RIGHT, at=(0.62, 0.02, 1.50))
            au.limb(S, E, 0.13, 0.11, 'hull', segs=8, power=3)
            au.cyl(0.12, 0.2, 'trim', segs=8, bevel=0.02, o='c', rot=RIGHT, at=E)
        with al.frames(M):
            al.limb(E, W, 0.14, 0.17, 'hull', segs=8, power=4, bulge=1.05)
            al.box((0.07, 0.26, 0.34), 'paint', bevel=0.02, m=aim(E, W, (1, 0, 0)), at=(0, 0.15, 0.24), rot=(0, 0, 90))
            al.box((0.02, 0.05, 0.24), 'glow_main', bevel=0, m=aim(E, W, (1, 0, 0)), at=(0, 0.188, 0.24), rot=(0, 0, 90))
            al.rod((0.70, 0.12, 1.0), (0.68, -0.02, 0.70), 0.03, 'trim', segs=6)
            al.box((0.30, 0.32, 0.28), 'hull', bevel=0.05, at=(0.67, -0.23, 0.49), rot=(25, 0, 0))
            al.box((0.32, 0.10, 0.12), 'trim', bevel=0.025, at=(0.67, -0.375, 0.405), rot=(25, 0, 0))   # knuckle bar
    return m


# ------------------------------------------------------------------ 11. shield unit
def enemy_shield():
    """Aegis tripod: faceted armoured pod on three piston legs carrying a spinning projector ring.
    Rig: body > head (sensor collar, yaws), body > spin_1, body > leg_1..3 > _upper > _lower > _toe."""
    m = enemy_model('enemy_shield')
    b = m.joint('body', (0, 0, 0.60))
    b.lathe([(0.0, 0.34), (0.20, 0.36), (0.36, 0.50), (0.38, 0.62), (0.31, 0.70)], 'hull', segs=6, sharp=30)
    b.lathe([(0.27, 0.80), (0.29, 0.83), (0.22, 0.92), (0.0, 0.93)], 'hull', segs=6, sharp=30)
    b.lathe([(0.30, 0.80), (0.33, 0.83), (0.27, 0.905), (0.20, 0.935), (0.18, 0.92)], 'paint', segs=6, sharp=30)
    b.ring(0.375, 0.03, 0.04, 'glow_main', segs=6, at=(0, 0, 0.60), sharp=30)
    b.cyl(0.27, 0.12, 'trim', segs=12, bevel=0.01, at=(0, 0, 0.69))                            # collar bearing
    with b.frames(radial(3, start=30)):   # armour skirts between the legs
        b.box((0.05, 0.30, 0.22), 'paint', bevel=0.02, at=(0.335, 0, 0.50), rot=(0, 14, 0))
        b.box((0.02, 0.16, 0.03), 'glow_main', bevel=0, at=(0.366, 0, 0.48), rot=(0, 14, 0))
        b.box((0.035, 0.31, 0.03), 'trim', bevel=0.008, at=(0.36, 0, 0.61), rot=(0, 14, 0))
    # sensor collar
    h = m.joint('head', (0, 0, 0.75), parent=b)
    h.ring(0.30, 0.06, 0.085, 'hull', segs=12, bevel=0.012, at=(0, 0, 0.75))
    h.box((0.20, 0.10, 0.12), 'hull', bevel=0.025, at=(0, -0.33, 0.75))
    h.box((0.22, 0.03, 0.03), 'paint', bevel=0.008, at=(0, -0.345, 0.82))
    h.cyl(0.05, 0.03, 'trim', segs=8, bevel=0.008, rot=FWD, at=(0, -0.37, 0.75))
    h.sphere(0.042, 'glow_main', segs=8, rings=5, at=(0, -0.395, 0.75))
    with h.sym():
        h.box((0.03, 0.015, 0.03), 'glow_main', bevel=0, at=(0.075, -0.383, 0.75))
    h.box((0.10, 0.08, 0.07), 'trim', bevel=0.015, at=(0, 0.32, 0.75))                         # counterweight
    # emitter column
    b.cyl(0.11, 0.24, 'trim', segs=8, bevel=0.015, at=(0, 0, 0.92))
    for z in (0.98, 1.05, 1.12):
        b.ring(0.115, 0.03, 0.03, 'glow_main', segs=8, at=(0, 0, z))
    b.cyl(0.15, 0.04, 'hull', segs=8, bevel=0.01, at=(0, 0, 1.15))
    # tripod legs
    for i, ang in enumerate((90, 210, 330)):
        Fm = rotz(ang)
        Hh, K, F = (0.30, 0, 0.56), (0.62, 0, 0.76), (0.74, 0, 0.07)
        root, up, lo, toe = radial_leg(m, str(i + 1), b, Fm, (Hh, K, F))
        with up.frames(Fm):
            up.cyl(0.10, 0.16, 'trim', segs=8, bevel=0.02, o='c', rot=(90, 0, 0), at=(0.31, 0, 0.56))
            up.limb(Hh, K, 0.075, 0.06, 'hull', segs=6, power=3, up=(0, 0, 1))
            up.prism(slab([(0.30, 0.66), (0.48, 0.78), (0.64, 0.86)], 0.04), 0.13, 'paint', bevel=0.012, plane='xz')
            up.cyl(0.08, 0.14, 'trim', segs=8, bevel=0.015, o='c', rot=(90, 0, 0), at=K)
        with lo.frames(Fm):
            lo.prism([(0.56, 0.80), (0.68, 0.78), (0.79, 0.14), (0.74, 0.05), (0.69, 0.07), (0.63, 0.42)], 0.09, 'hull',
                     bevel=0.018, plane='xz')
            lo.prism([(0.63, 0.86), (0.73, 0.79), (0.815, 0.36), (0.77, 0.36)], 0.12, 'paint', bevel=0.012, plane='xz')
            lo.box((0.015, 0.03, 0.26), 'glow_main', bevel=0, at=(0.80, 0, 0.54), rot=(0, 9, 0))
            lo.rod((0.60, 0, 0.70), (0.68, 0, 0.30), 0.022, 'trim', segs=5)
        with toe.frames(Fm):
            toe.prism([(0.62, 0.0), (0.66, 0.07), (0.82, 0.07), (0.90, 0.0)], 0.17, 'trim', bevel=0.012, plane='xz')
            toe.cyl(0.04, 0.12, 'hull', segs=6, o='c', rot=(90, 0, 0), at=(0.74, 0, 0.075))

    s = m.node('spin_1', at=(0, 0, 0.60), parent=b)
    s.cyl(0.10, 0.07, 'hull', segs=10, bevel=0.015)
    s.lathe([(0.06, 0.07), (0.03, 0.14), (0.0, 0.20)], 'glow_main', segs=8)
    s.ring(0.44, 0.07, 0.06, 'hull', segs=20, bevel=0.015, at=(0, 0, 0.04))
    s.ring(0.44, 0.03, 0.02, 'glow_main', segs=20, at=(0, 0, 0.075))
    with s.frames(radial(3, start=30)):
        s.box((0.36, 0.045, 0.03), 'trim', bevel=0.008, at=(0.25, 0, 0.04))
    with s.frames(radial(6)):
        s.box((0.10, 0.12, 0.10), 'paint', bevel=0.02, at=(0.455, 0, 0.04))
        s.prism([(0.0, 0.0), (0.05, 0.0), (0.03, 0.12), (0.0, 0.10)], 0.05, 'glow_main', bevel=0.006, plane='xz',
                at=(0.44, 0, 0.08))
    return m


# ------------------------------------------------------------------ 12. boss
def enemy_boss():
    """Colossus: four-legged siege walker. Rig: body > head (tracks), body > spin_1,
    body > leg_1..4 > _upper > _lower > _foot > _toe (1-2 = left front, rear; 3-4 = right front, rear).
    The legs reach along the road, not across it: the hips sit on the hull's corners and each leg plane points
    fore or aft with a slight splay, knees high."""
    m = enemy_model('enemy_boss')
    b = m.joint('body', (0, 0, 1.70))
    # main hull (elongated front-back)
    b.loft([(1.18, 0.0, 0.0), (1.22, 0.55, 0.75), (1.45, 1.04, 1.24), (1.72, 1.15, 1.36), (1.98, 1.04, 1.25),
            (2.14, 0.62, 0.92), (2.16, 0.0, 0.0)], 'hull', segs=12, power=2.6, sharp=40)
    b.loft([(1.69, 1.17, 1.38), (1.76, 1.18, 1.39), (1.83, 1.14, 1.34)], 'trim', segs=12, power=2.6)
    b.loft([(2.00, 0.90, 1.20), (2.16, 0.60, 0.90), (2.20, 0.40, 0.66), (2.20, 0.0, 0.0)], 'paint', segs=12, power=2.6,
           at=(0, 0, 0.012))
    # belly reactor vents + belly gun
    b.lathe([(0.30, 1.0), (0.34, 0.90), (0.24, 0.80), (0.0, 0.78)], 'trim', segs=10)
    b.ring(0.30, 0.05, 0.03, 'glow_main', segs=10, at=(0, 0, 0.88))
    with b.sym():
        b.box((0.03, 0.30, 0.05), 'glow_main', bevel=0, at=(1.11, 0.0, 1.58), rot=(0, -20, 0))
    # deeper belly keel + layered top deck round the reactor + riveted waist band
    b.loft([(0.94, 0.0, 0.0), (0.98, 0.44, 0.62), (1.10, 0.66, 0.90), (1.26, 0.72, 0.98)], 'hull', segs=12, power=2.6,
           sharp=40)
    with b.frames([rotz(a) for a in (-42, 42, 138, 222)]):
        b.prism(slab([(0.52, 2.235), (0.94, 2.13), (1.24, 1.84)], 0.07), 0.78, 'paint', bevel=0.02, plane='xz')
        b.prism(slab([(0.82, 2.215), (1.06, 2.10), (1.30, 1.86)], 0.035), 0.16, 'trim', plane='xz')
    with b.frames(radial(12, radius=1.0, start=15)):
        b.cyl(0.035, 0.03, 'trim', segs=5, rot=RIGHT, at=(0.155, 0, 1.76))
    # legs: armoured femur up to a high knee, long splayed tibia, short tarsus, clawed foot
    Hh, K, M, F = (1.30, 0, 1.70), (1.70, 0, 2.40), (2.22, 0, 1.04), (2.34, 0, 0.28)
    for i, (hip, ang) in enumerate(((-48, -78), (48, 78), (228, 258), (132, 102))):
        # hip on the hull corner (radius 1.10 at `hip` degrees), leg plane turned to `ang`
        hx, hy = 1.10 * math.cos(math.radians(hip)), 1.10 * math.sin(math.radians(hip))
        Fm = T(at=(hx, hy, 0)) @ rotz(ang) @ T(at=(-1.30, 0, 0))
        root, up, lo, ft, toe = radial_leg(m, str(i + 1), b, Fm, (Hh, K, M, F))
        with b.frames(Fm):
            b.sphere(0.25, 'trim', segs=8, rings=5, at=Hh)
        with up.frames(Fm):
            up.limb(Hh, K, 0.22, 0.19, 'hull', segs=6, power=3, up=(0, 0, 1))
            up.prism(slab([(1.10, 1.98), (1.50, 2.60), (1.80, 2.74)], 0.11), 0.42, 'paint', bevel=0.02, plane='xz')
            up.rod((0.95, 0, 2.02), (1.36, 0, 2.30), 0.05, 'trim', segs=6)
            up.cyl(0.25, 0.44, 'trim', segs=10, o='c', rot=(90, 0, 0), at=K)
            for y in (-0.225, 0.225):
                up.cyl(0.09, 0.02, 'glow_main', segs=6, o='c', rot=(90, 0, 0), at=(K[0], y, K[2]))
        with lo.frames(Fm):
            lo.prism([(1.58, 2.46), (1.90, 2.58), (2.40, 1.12), (2.32, 0.90), (2.08, 0.96), (1.74, 2.14)], 0.30, 'hull',
                     bevel=0.03, plane='xz')
            lo.prism(slab([(1.80, 2.76), (2.02, 2.60), (2.50, 1.30)], 0.09), 0.40, 'paint', bevel=0.02, plane='xz')
            lo.prism(slab([(2.03, 2.62), (2.30, 1.90)], 0.03), 0.10, 'trim', plane='xz', at=(0.022, 0, 0.008))
            lo.box((0.03, 0.06, 0.34), 'glow_main', bevel=0, at=(2.435, 0, 1.56), rot=(0, 20.3, 0))
            lo.rod((1.62, 0, 2.02), (2.02, 0, 1.52), 0.05, 'trim', segs=6)
            lo.cyl(0.17, 0.36, 'trim', segs=8, o='c', rot=(90, 0, 0), at=M)
        with ft.frames(Fm):
            ft.limb(M, F, 0.15, 0.12, 'hull', segs=6, power=3, up=(0, 0, 1))
            ft.box((0.07, 0.30, 0.42), 'paint', bevel=0.02, at=(2.40, 0, 0.66), rot=(0, 9, 0))
        with toe.frames(Fm):
            toe.prism([(2.12, 0.0), (2.16, 0.22), (2.34, 0.38), (2.52, 0.30), (2.66, 0.0)], 0.44, 'hull', bevel=0.03,
                      plane='xz')
            for y in (-0.14, 0.14):
                toe.prism([(2.56, 0.0), (2.60, 0.21), (2.92, 0.0)], 0.14, 'trim', plane='xz', at=(0, y, 0))
            toe.prism([(2.16, 0.0), (2.14, 0.16), (1.92, 0.0)], 0.14, 'trim', plane='xz')
    # reactor (rear top)
    RC = (0, 0.42, 2.52)
    b.lathe([(0.60, 2.10), (0.64, 2.16), (0.56, 2.26), (0.40, 2.30), (0.0, 2.30)], 'trim', segs=14, at=(0, 0.42, 0))
    b.sphere(0.40, 'paint', segs=12, rings=6, at=RC)
    b.torus(0.36, 0.03, 'glow_main', segs=14, rsegs=4, at=(0, 0.42, 2.70))
    b.lathe([(0.66, 2.14), (0.70, 2.22), (0.60, 2.36), (0.46, 2.40), (0.40, 2.34)], 'hull', segs=14, at=(0, 0.42, 0))
    with b.frames(T(at=RC) @ rotz(45)):
        with b.frames(radial(4)):
            b.prism([(0.42, -0.30), (0.58, -0.28), (0.66, 0.10), (0.52, 0.48), (0.20, 0.64), (0.16, 0.56),
                     (0.44, 0.40), (0.55, 0.08), (0.50, -0.20)], 0.09, 'hull', bevel=0.015, plane='xz')
    b.cyl(0.20, 0.10, 'hull', segs=10, bevel=0.02, at=(0, 0.42, 3.06))
    b.cyl(0.10, 0.03, 'glow_main', segs=10, at=(0, 0.42, 3.16))
    s = m.joint('spin_1', RC, parent=b)
    with s.frames(T(at=RC)):
        s.ring(0.80, 0.10, 0.12, 'hull', segs=24, bevel=0.025)
        s.ring(0.745, 0.02, 0.05, 'glow_main', segs=24)
        with s.frames(radial(4)):
            s.box((0.20, 0.22, 0.20), 'paint', bevel=0.035, at=(0.84, 0, 0))
            s.box((0.03, 0.12, 0.08), 'glow_main', bevel=0, at=(0.945, 0, 0))
            s.prism([(0.0, 0.08), (0.10, 0.08), (0.02, 0.34)], 0.05, 'trim', bevel=0.008, plane='xz', at=(0.78, 0, 0))
    # side armour + rear abdomen
    with b.frames([rotz(a) for a in (-25, 0, 25, 155, 180, 205)]):
        b.box((0.12, 0.50, 0.36), 'paint', bevel=0.04, at=(1.17, 0, 1.76), rot=(0, -6, 0))
        b.lathe([(0.07, 0.0), (0.0, 0.22)], 'trim', segs=6, rot=RIGHT, at=(1.2, 0, 1.80))
    b.sphere(1.0, 'hull', segs=12, rings=7, at=(0, 1.35, 1.72), scale=(0.66, 0.62, 0.50))
    # exposed reactor at the rear: weak_1, glTF (0, 2.1, -1.6)
    W1 = (0, 1.60, 2.10)
    with b.frames(T(at=W1, rot=(-38, 0, 0))):
        b.ring(0.57, 0.10, 0.16, 'trim', segs=12, at=(0, 0, -0.16))
        with b.frames(radial(4, start=45)):
            b.prism([(0.50, -0.30), (0.68, -0.26), (0.70, 0.04), (0.60, 0.30), (0.535, 0.26), (0.59, 0.04),
                     (0.56, -0.10)], 0.20, 'paint', plane='xz')
    weak_point(m, 'weak_1', W1, 0.50, b)
    # sensor on a boom over the head: weak_2, glTF (0, 2.9, 1.5). It is fixed to the hull so the head can turn under it.
    W2 = (0, -1.50, 2.90)
    with b.sym():
        b.tube([(0.80, -0.48, 2.02), (0.64, -0.80, 2.64), (0.34, -1.22, 2.90), (0.14, -1.40, 2.90)],
               [0.075, 0.065, 0.05, 0.045], 'hull', segs=6)
        b.box((0.20, 0.24, 0.16), 'paint', bevel=0, at=(0.78, -0.50, 2.10))
    b.ring(0.42, 0.08, 0.16, 'paint', segs=12, rot=FWD, at=(0, -1.40, 2.90))
    b.box((0.30, 0.10, 0.10), 'hull', bevel=0, at=(0, -1.32, 3.30))
    weak_point(m, 'weak_2', W2, 0.36, b)
    with b.sym():
        # rear pylons with glow tips (total height 3.4)
        b.prism([(1.00, 1.90), (1.30, 1.80), (1.50, 2.90), (1.44, 3.24), (1.36, 2.90), (1.14, 2.14)], 0.10, 'hull',
                bevel=0.02, plane='yz', at=(0.62, 0.15, 0))
        b.prism([(1.32, 1.84), (1.54, 2.90), (1.49, 2.94), (1.25, 1.90)], 0.14, 'paint', bevel=0.012, plane='yz',
                at=(0.62, 0.15, 0))
        b.box((0.26, 0.5, 0.3), 'hull', bevel=0.05, at=(0.62, 1.12, 1.82))
        b.rod((0.62, 1.59, 3.18), (0.62, 1.62, 3.38), 0.016, 'trim', segs=5, r2=0.008)
        b.sphere(0.035, 'glow_main', segs=6, rings=4, at=(0.62, 1.62, 3.38))
        b.box((0.20, 0.04, 0.10), 'glow_main', bevel=0, at=(0.24, 1.915, 1.70))
    b.cyl(0.42, 0.14, 'trim', segs=12, bevel=0.03, at=(0, -1.02, 1.86))                         # neck bearing
    # head (tracking turret): armoured wedge + heavy cannon
    h = m.joint('head', (0, -1.02, 1.90), parent=b)
    HC = T(at=(0, -1.5, 1.7)) @ T(scale=1.22) @ T(at=(0, 1.5, -1.7))
    h.stack.append([f @ HC for f in h.stack[-1]])
    head = [(-1.86, 1.50), (-1.92, 1.66), (-1.74, 1.92), (-1.20, 2.02), (-1.10, 1.40), (-1.50, 1.32)]
    h.prism(head, 0.80, 'hull', bevel=0.06, plane='yz')
    h.prism([(-1.93, 1.68), (-1.74, 1.95), (-1.22, 2.05), (-1.24, 1.97), (-1.70, 1.86), (-1.84, 1.68)], 0.66, 'paint',
            bevel=0.02, plane='yz')
    with h.sym():
        h.sphere(0.085, 'glow_main', segs=10, rings=5, at=(0.20, -1.86, 1.62), scale=(1.3, 0.6, 0.8))
        h.sphere(0.05, 'glow_main', segs=8, rings=4, at=(0.34, -1.80, 1.74), scale=(1.2, 0.6, 0.8))
        h.prism([(-2.14, 1.22), (-1.86, 1.50), (-1.60, 1.40), (-1.66, 1.30), (-1.84, 1.34)], 0.07, 'trim', bevel=0.012,
                plane='yz', at=(0.22, 0, 0))
        h.box((0.06, 0.40, 0.30), 'paint', bevel=0.02, at=(0.42, -1.48, 1.68), rot=(0, 0, 4))
    h.stack.pop()
    h.box((0.56, 0.70, 0.36), 'hull', bevel=0.07, at=(0, -1.10, 2.14))
    h.box((0.40, 0.50, 0.06), 'paint', bevel=0.02, at=(0, -1.08, 2.34))
    with h.frames(T(at=(0, -1.36, 2.16), rot=(93, 0, 0), scale=(1.3, 1.3, 1.0))):
        h.cyl(0.17, 0.40, 'trim', segs=12, bevel=0.03)
        h.cyl(0.12, 1.10, 'hull', segs=12)
        for z in (0.52, 0.66, 0.80):
            h.ring(0.125, 0.04, 0.05, 'glow_main', segs=12, at=(0, 0, z))
        h.lathe([(0.12, 1.02), (0.19, 1.06), (0.19, 1.24), (0.15, 1.26), (0.10, 1.26), (0.10, 1.18), (0.0, 1.18)],
                'trim', segs=12)
        h.cyl(0.10, 0.02, 'glow_main', segs=12, at=(0, 0, 1.185))
        with h.sym():
            h.box((0.05, 0.05, 0.60), 'paint', bevel=0.012, at=(0.15, 0, 0.64))
    return m


# ------------------------------------------------------------------ 13. gyre
def enemy_wheel():
    """Gyre: a hub machine riding inside one heavy armoured ring wheel. Origin = where the wheel meets the ground.
    Rig: rim (pivot = wheel centre; it rolls about its axle, the node's local X), body (the hub, pivot = wheel
    centre, stays upright) > head (sensor bar with an eye either side of the rim), body > spin_1, spin_2 (gyros).
    The light strips on the rim use glow_guard: the view dims them as the rim loses its spin."""
    m = Model('enemy_wheel', {'hull': ('#171a22', 0.6, 0.45), 'paint': ('#3d3958', 0.35, 0.55), 'trim': ('#5d6470', 0.65, 0.42),
                              'glow_main': '#8fd0ff', 'glow_guard': '#8fd0ff'})
    C = (0, 0, 1.10)
    AX = T(at=C, rot=RIGHT)         # primitives built round local Z end up round the axle
    # ---- rim: outer radius 1.10, a channel section that opens inward, 0.46 wide
    rim = m.joint('rim', C)
    with rim.frames(AX):
        rim.add(revolve([(0.80, -0.21), (0.98, -0.23), (1.03, -0.23), (1.06, -0.19), (1.06, 0.19), (1.03, 0.23),
                         (0.98, 0.23), (0.80, 0.21), (0.80, 0.15), (0.88, 0.13), (0.88, -0.13), (0.80, -0.15)],
                        segs=28), 'hull', sharp=35)
        rim.ring(0.868, 0.02, 0.12, 'trim', segs=28)                                           # drive rail in the channel
        # tread: sixteen plates with a cleat each, every fourth one plated pale (the eye can follow the roll)
        for i, F in enumerate(radial(16)):
            with rim.frames(F):
                mark = i % 4 == 0
                rim.box((0.05, 0.335, 0.52 if mark else 0.48), 'paint' if mark else 'hull', bevel=0.014, at=(1.063, 0, 0))
                rim.box((0.024, 0.07, 0.40), 'trim', bevel=0.006, at=(1.092, 0, 0))
        # side armour: eight segments a side, bolted at the gaps
        for s in (-1, 1):
            for k in range(8):
                rim.ring(0.925, 0.15, 0.03, 'trim' if k % 4 == 0 else 'paint', segs=3, arc=37, phase=k * 45 + 4,
                         at=(0, 0, s * 0.238))
            with rim.frames(radial(8)):
                rim.cyl(0.026, 0.03, 'trim', segs=5, o='c', at=(0.925, 0, s * 0.243))
            # light strips: on the inner lip (seen through the wheel) and on the edge of the side face
            for k in range(6):
                rim.ring(0.797, 0.02, 0.05, 'glow_guard', segs=4, arc=44, phase=k * 60 + 8, at=(0, 0, s * 0.18))
                rim.ring(0.835, 0.04, 0.016, 'glow_guard', segs=4, arc=44, phase=k * 60 + 8, at=(0, 0, s * 0.224))
    # ---- hub: hangs from the axle, heavy at the bottom
    b = m.joint('body', C)
    b.box((0.34, 0.58, 0.40), 'hull', bevel=0.05, at=(0, 0.04, 0.86))                            # engine block
    b.box((0.30, 0.44, 0.09), 'paint', bevel=0.02, at=(0, 0.02, 1.10))                           # cowl
    b.prism([(-0.30, 0.74), (0.34, 0.74), (0.26, 0.56), (-0.20, 0.56)], 0.22, 'trim', bevel=0.02, plane='yz')   # sump
    b.box((0.26, 0.03, 0.20), 'glow_main', bevel=0, at=(0, 0.335, 0.88))                         # exhaust grille
    for z in (0.80, 0.88, 0.96):
        b.box((0.30, 0.05, 0.022), 'hull', bevel=0, at=(0, 0.345, z))
    b.cyl(0.095, 0.80, 'trim', segs=10, o='c', rot=RIGHT, at=C)                                  # axle
    # bogies riding the rail: two below, one tensioner on a mast above
    for ang in (-34, 34):
        a = math.radians(ang)
        P = (0, 0.775 * math.sin(a), 1.10 - 0.775 * math.cos(a))
        b.rod((0, 0.42 * math.sin(a), 1.10 - 0.42 * math.cos(a)), P, 0.05, 'trim', segs=6)
        b.cyl(0.075, 0.20, 'hull', segs=8, o='c', rot=RIGHT, at=P)
        b.cyl(0.04, 0.23, 'trim', segs=6, o='c', rot=RIGHT, at=P)
    b.box((0.09, 0.12, 0.62), 'hull', bevel=0.02, at=(0, 0.04, 1.47))
    b.box((0.05, 0.14, 0.34), 'paint', bevel=0.012, at=(0, 0.04, 1.50))
    b.cyl(0.075, 0.20, 'hull', segs=8, o='c', rot=RIGHT, at=(0, 0.04, 1.875))
    b.cyl(0.04, 0.23, 'trim', segs=6, o='c', rot=RIGHT, at=(0, 0.04, 1.875))
    with b.sym():
        # hub caps outside the rim, each with a shield-shaped skirt that hangs below the axle
        b.cyl(0.29, 0.07, 'hull', segs=12, bevel=0.02, o='c', rot=RIGHT, at=(0.325, 0, 1.10))
        b.ring(0.20, 0.07, 0.03, 'paint', segs=12, rot=RIGHT, at=(0.365, 0, 1.10))
        b.cyl(0.085, 0.03, 'glow_main', segs=8, o='c', rot=RIGHT, at=(0.37, 0, 1.10))
        b.prism([(-0.25, 1.02), (0.27, 1.02), (0.33, 0.66), (0.12, 0.42), (-0.12, 0.42), (-0.30, 0.66)], 0.06, 'hull',
                bevel=0.02, plane='yz', at=(0.335, 0, 0))
        b.prism([(-0.20, 0.90), (0.21, 0.90), (0.25, 0.68), (0.09, 0.50), (-0.10, 0.50), (-0.24, 0.68)], 0.03, 'paint',
                bevel=0.01, plane='yz', at=(0.375, 0, 0))
        b.box((0.02, 0.26, 0.03), 'glow_main', bevel=0, at=(0.392, 0, 0.78))
        # stabiliser arms: a vane up and behind, a gyro pod low in front
        b.tube([(0.36, 0.08, 1.16), (0.46, 0.30, 1.36), (0.54, 0.46, 1.50)], [0.05, 0.04, 0.035], 'trim', segs=6)
        b.prism([(0.30, 1.40), (0.62, 1.52), (0.70, 1.74), (0.58, 1.72), (0.36, 1.56)], 0.035, 'paint', bevel=0.01,
                plane='yz', at=(0.55, 0, 0))
        b.box((0.03, 0.10, 0.03), 'glow_main', bevel=0, at=(0.55, 0.655, 1.70))
        b.tube([(0.36, -0.06, 1.02), (0.46, -0.24, 0.84), (0.52, -0.36, 0.72)], [0.05, 0.045, 0.04], 'trim', segs=6)
        b.cyl(0.125, 0.11, 'hull', segs=10, bevel=0.02, o='c', rot=RIGHT, at=(0.53, -0.38, 0.70))
        b.ring(0.125, 0.02, 0.03, 'paint', segs=10, rot=RIGHT, at=(0.53, -0.38, 0.70))
    for i, s in enumerate((1, -1)):
        P = (s * 0.60, -0.38, 0.70)
        g = m.joint(f'spin_{i + 1}', mat=T(at=P, rot=RIGHT), parent=b)
        with g.frames(T(at=P, rot=RIGHT)):
            g.cyl(0.10, 0.035, 'trim', segs=10, bevel=0.01, o='c')
            with g.frames(radial(3)):
                g.box((0.08, 0.035, 0.04), 'glow_main', bevel=0, at=(0.06, 0, 0))
    # ---- head: a sensor bar through the wheel, one eye either side of the rim
    h = m.joint('head', (0, -0.20, 1.20), parent=b)
    h.cyl(0.07, 0.12, 'trim', segs=8, bevel=0.015, at=(0, -0.20, 1.14))
    h.box((0.20, 0.24, 0.12), 'hull', bevel=0.03, at=(0, -0.26, 1.30))
    h.cyl(0.04, 0.86, 'trim', segs=6, o='c', rot=RIGHT, at=(0, -0.36, 1.33))
    with h.sym():
        h.box((0.15, 0.26, 0.15), 'hull', bevel=0.03, at=(0.42, -0.40, 1.33))
        h.box((0.17, 0.16, 0.04), 'paint', bevel=0.012, at=(0.42, -0.38, 1.415))
        h.sphere(0.058, 'glow_main', segs=8, rings=5, at=(0.42, -0.525, 1.33), scale=(1.0, 0.6, 1.0))
        h.rod((0.44, -0.30, 1.40), (0.47, -0.22, 1.62), 0.008, 'trim', segs=4, r2=0.004)
    return m


# ------------------------------------------------------------------ 14. broodcarrier
def enemy_brood():
    """Broodcarrier: a low, wide carrier on six short legs. Its back is a ribbed frame round six launch cells; the lids
    swing open when a swarm of mites leaves.
    Rig: body > head, body > cell_1..6 (lids, pivot on their outer edge; 1-3 left front to rear, 4-6 right),
    body > leg_1..6 > _upper > _lower > _toe (1-3 left front to rear, 4-6 right front to rear)."""
    m = enemy_model('enemy_brood')
    b = m.joint('body', (0, 0, 0.74))
    b.prism([(-1.22, 0.62), (-1.02, 0.90), (-0.60, 1.02), (0.95, 1.02), (1.30, 0.84), (1.24, 0.56), (0.70, 0.42),
             (-0.85, 0.42)], 1.40, 'hull', bevel=0.05, plane='yz')
    b.box((0.60, 1.30, 0.10), 'trim', bevel=0.03, at=(0, 0.0, 0.40))                              # belly drive
    with b.sym():
        # sponsons the legs hang from, a plated shoulder over them and a light strip along the flank
        b.box((0.30, 2.05, 0.30), 'hull', bevel=0.06, at=(0.80, 0.02, 0.64))
        b.prism(slab([(0.64, 0.94), (0.90, 0.86), (0.99, 0.66)], 0.05), 1.90, 'paint', bevel=0.015, plane='xz',
                at=(0, 0.02, 0))
        b.box((0.02, 1.50, 0.035), 'glow_main', bevel=0, at=(0.958, 0.02, 0.60))
        b.box((0.22, 0.03, 0.10), 'glow_main', bevel=0, at=(0.36, 1.285, 0.72), rot=(-12, 0, 0))    # exhaust
        b.box((0.08, 1.90, 0.10), 'trim', bevel=0.02, at=(0.68, 0.10, 1.07))                         # deck rail
    # the back: ribs across, a spine down the middle, a lit floor in every cell
    for y in (-0.82, -0.20, 0.40, 1.00):
        b.box((1.40, 0.09, 0.13), 'hull', bevel=0.025, at=(0, y, 1.085))
    b.box((0.11, 1.90, 0.13), 'hull', bevel=0.025, at=(0, 0.10, 1.085))
    k = 0
    for s in (1, -1):
        for y in (-0.51, 0.10, 0.70):
            k += 1
            b.box((0.46, 0.40, 0.02), 'glow_main', bevel=0, at=(s * 0.36, y, 1.03))
            b.box((0.50, 0.44, 0.06), 'hull', bevel=0, at=(s * 0.36, y, 0.99))
            c = m.joint(f'cell_{k}', (s * 0.63, y, 1.115), parent=b)
            c.box((0.52, 0.47, 0.05), 'paint', bevel=0.012, at=(s * 0.375, y, 1.115))
            c.box((0.07, 0.32, 0.03), 'trim', bevel=0.008, at=(s * 0.20, y, 1.15))
    # head: a low prow with a visor slit and two mandibles
    h = m.joint('head', (0, -1.10, 0.72), parent=b)
    h.prism([(-1.66, 0.58), (-1.56, 0.80), (-1.22, 0.92), (-1.08, 0.86), (-1.08, 0.50), (-1.36, 0.44)], 0.78, 'hull',
            bevel=0.04, plane='yz')
    h.prism(slab([(-1.06, 0.93), (-1.24, 0.955), (-1.64, 0.82)], 0.04), 0.66, 'paint', bevel=0.012, plane='yz')
    h.box((0.50, 0.03, 0.06), 'glow_main', bevel=0, at=(0, -1.628, 0.68), rot=(20, 0, 0))
    with h.sym():
        h.prism([(-1.84, 0.40), (-1.62, 0.56), (-1.40, 0.50), (-1.52, 0.42)], 0.05, 'trim', bevel=0.01, plane='yz',
                at=(0.27, 0, 0))
        h.sphere(0.04, 'glow_main', segs=6, rings=4, at=(0.33, -1.50, 0.80))
    b.rod((0.30, 1.05, 1.10), (0.36, 1.30, 1.42), 0.012, 'trim', segs=4, r2=0.005)
    # six short legs: hip under the sponson, a high knee, a blade shin
    Hh, K, F = (0.12, 0, 0.60), (0.52, 0, 0.98), (0.84, 0, 0.06)
    for i, (s, hy, ang) in enumerate(((1, -0.74, -32), (1, 0.02, 0), (1, 0.78, 32), (-1, -0.74, 212), (-1, 0.02, 180),
                                      (-1, 0.78, 148))):
        Fm = T(at=(s * 0.80, hy, 0)) @ rotz(ang)
        root, up, lo, toe = radial_leg(m, str(i + 1), b, Fm, (Hh, K, F))
        with up.frames(Fm):
            up.cyl(0.11, 0.16, 'trim', segs=8, bevel=0.02, o='c', rot=(90, 0, 0), at=Hh)
            up.limb(Hh, K, 0.085, 0.07, 'hull', segs=6, power=3, up=(0, 0, 1))
            up.prism(slab([(0.08, 0.76), (0.40, 1.04), (0.58, 1.09)], 0.04), 0.15, 'paint', bevel=0.012, plane='xz')
            up.cyl(0.085, 0.15, 'trim', segs=8, bevel=0.015, o='c', rot=(90, 0, 0), at=K)
        with lo.frames(Fm):
            lo.prism([(0.46, 1.02), (0.58, 1.02), (0.90, 0.16), (0.84, 0.05), (0.78, 0.09), (0.56, 0.62)], 0.10, 'hull',
                     bevel=0.018, plane='xz')
            lo.prism(slab([(0.60, 1.07), (0.68, 0.98), (0.935, 0.34)], 0.035), 0.13, 'paint', bevel=0.01, plane='xz')
            lo.prism(slab([(0.895, 0.46), (0.745, 0.84)], 0.012), 0.03, 'glow_main', plane='xz')
        with toe.frames(Fm):
            toe.prism([(0.72, 0.0), (0.76, 0.07), (0.92, 0.07), (1.00, 0.0)], 0.18, 'trim', bevel=0.012, plane='xz')
    return m


# ------------------------------------------------------------------ 15. mite
def enemy_mite():
    """Mite: a spider machine the size of a hand. Very few triangles: the view draws dozens at once, instanced.
    Nodes: body, eye (its lights), legs_a and legs_b (four legs each, pivot at the body centre: the view swings the two
    sets against each other)."""
    m = enemy_model('enemy_mite')
    C = (0, 0, 0.11)
    b = m.joint('body', C)
    b.sphere(0.5, 'hull', segs=6, rings=3, at=(0, 0.05, 0.125), scale=(0.25, 0.34, 0.17))
    b.box((0.15, 0.12, 0.075), 'paint', bevel=0, at=(0, -0.14, 0.10))
    e = m.joint('eye', C)
    e.box((0.10, 0.02, 0.03), 'glow_main', bevel=0, at=(0, -0.205, 0.105))
    e.box((0.05, 0.14, 0.015), 'glow_main', bevel=0, at=(0, 0.06, 0.212))
    angs = [a for a in (-52, -18, 18, 52)] + [180 - a for a in (-52, -18, 18, 52)]
    for name, idx in (('legs_a', (0, 2, 5, 7)), ('legs_b', (1, 3, 4, 6))):
        n = m.joint(name, C)
        for i in idx:
            with n.frames(rotz(angs[i])):
                n.rod((0.08, 0, 0.11), (0.21, 0, 0.215), 0.016, 'trim', segs=3)
                n.rod((0.21, 0, 0.215), (0.34, 0, 0.0), 0.014, 'trim', segs=3, r2=0.006)
    return m


# ------------------------------------------------------------------ 16. titan
def enemy_titan():
    """Titan: a strider fifteen units tall. A compact hull rides high on a yoke between two hip hubs; a fore and an aft leg
    leave each hub, reach out and up to a knee beside the hull and come down on a near-upright shin far outside the road
    (the knee never closes below a quarter turn in the walk, see titan_leg()). A segmented neck carries a
    long armoured head whose eye sits on the head's own pivot, so it stays put however the head turns.
    Weak points at the game's coordinates (glTF): weak_1 eye (0, 13.4, 2.2), weak_2 reactor on the tail (0, 10.2, -2.0),
    weak_3 / weak_4 the hip hubs (+-2.4, 6.4, 0).
    Rig: body > neck_1 > neck_2 > head, body > leg_1..4 > _upper > _lower > _foot > _toe (1-2 left front, rear;
    3-4 right front, rear)."""
    m = Model('enemy_titan', {'hull': ('#171a22', 0.6, 0.45), 'paint': ('#3d3958', 0.35, 0.55), 'trim': ('#5d6470', 0.65, 0.42),
                              'steel': ('#9aa6b8', 0.9, 0.28), 'glow_main': '#8fd0ff', 'glow_weak': '#8a7dff', 'glow_reactor': '#8a7dff'})
    HY = -0.25
    b = m.joint('body', (0, 0, 9.6))
    # hull
    b.loft([(8.15, 0.8, 1.2), (8.5, 1.45, 1.95), (9.3, 1.75, 2.25), (10.1, 1.7, 2.15), (10.7, 1.35, 1.7),
            (10.95, 0.8, 1.05)], 'hull', segs=14, power=3.0, sharp=40, at=(0, HY, 0))
    b.loft([(9.22, 1.78, 2.28), (9.38, 1.80, 2.30), (9.54, 1.78, 2.28)], 'trim', segs=14, power=3.0, at=(0, HY, 0))
    b.loft([(10.72, 1.37, 1.73), (10.98, 0.86, 1.12), (11.07, 0.5, 0.7), (11.07, 0.0, 0.0)], 'paint', segs=14, power=3.0,
           at=(0, HY, 0.03))
    with b.frames([T(at=(0, HY, 0)) @ rotz(a) for a in (-47, 47, 133, 227)]):
        b.prism(slab([(1.45, 10.82), (2.15, 10.25), (2.36, 9.35), (2.10, 8.55)], 0.14), 1.5, 'paint', bevel=0.03,
                plane='xz')
        b.prism(slab([(2.19, 10.2), (2.40, 9.36)], 0.03), 0.2, 'trim', plane='xz', at=(0.03, 0, 0))
    with b.frames(radial(14, radius=0.0, start=12)):
        b.cyl(0.06, 0.05, 'trim', segs=5, rot=RIGHT, at=(1.5, 0, 8.72))
    with b.sym():
        b.box((0.06, 1.6, 0.10), 'glow_main', bevel=0, at=(1.76, HY, 9.82))
        b.box((0.06, 1.0, 0.06), 'glow_main', bevel=0, at=(1.72, HY, 10.06))
        b.box((0.5, 0.06, 0.12), 'glow_main', bevel=0, at=(0.62, HY - 2.215, 9.55))
        # dorsal fins either side of the reactor
        b.prism([(0.5, 10.6), (1.4, 10.3), (2.5, 11.9), (2.36, 12.5), (2.0, 11.9), (1.1, 10.9)], 0.16, 'hull',
                bevel=0.03, plane='yz', at=(1.3, 0, 0))
        b.prism([(1.45, 10.38), (2.58, 11.95), (2.50, 12.0), (1.35, 10.45)], 0.24, 'paint', bevel=0.02, plane='yz',
                at=(1.3, 0, 0))
        b.sphere(0.07, 'glow_main', segs=6, rings=4, at=(1.3, 2.38, 12.56))
    # keel, belly vent and the yoke out to the hip hubs
    b.loft([(7.2, 0.5, 0.7), (7.6, 0.85, 1.1), (8.3, 1.0, 1.4)], 'hull', segs=10, power=3.0, sharp=40, at=(0, HY * 0.5, 0))
    b.lathe([(0.55, 7.25), (0.62, 7.1), (0.45, 6.95), (0.0, 6.9)], 'trim', segs=10, at=(0, HY * 0.5, 0))
    b.ring(0.5, 0.08, 0.05, 'glow_reactor', segs=10, at=(0, HY * 0.5, 7.08))
    with b.sym():
        b.limb((0.6, 0, 7.75), (2.1, 0, 7.15), 0.5, 0.38, 'hull', segs=6, power=3, up=(0, 0, 1))
        b.prism(slab([(0.7, 8.3), (1.7, 7.85), (2.5, 7.55)], 0.12), 0.9, 'paint', bevel=0.03, plane='xz')
        b.box((0.6, 0.7, 0.36), 'hull', bevel=0.08, at=(2.4, 0, 7.42))
        b.torus(0.92, 0.2, 'trim', segs=16, rsegs=6, rot=RIGHT, at=(2.4, 0, 6.4))
        b.torus(0.92, 0.06, 'glow_main', segs=16, rsegs=4, rot=RIGHT, at=(2.62, 0, 6.4))
    weak_big(m, 'weak_3', (2.4, 0, 6.4), 0.66, b)
    weak_big(m, 'weak_4', (-2.4, 0, 6.4), 0.66, b)
    # legs: see titan_leg()
    for i, (s, ang) in enumerate(((1, -55), (1, 55), (-1, 235), (-1, 125))):
        titan_leg(m, b, str(i + 1), T(at=(s * 2.4, 0, 0)) @ rotz(ang))
    # reactor on the tail: weak_2
    W2 = (0, 2.0, 10.2)
    with b.frames(T(at=W2, rot=(-50, 0, 0))):
        b.ring(1.12, 0.22, 0.3, 'trim', segs=14, at=(0, 0, -0.1))
        b.ring(1.04, 0.06, 0.08, 'glow_reactor', segs=14, at=(0, 0, 0.08))
        with b.frames(radial(4, start=45)):
            b.prism([(0.95, -0.5), (1.3, -0.45), (1.36, 0.1), (1.15, 0.62), (1.02, 0.55), (1.14, 0.1), (1.08, -0.2)],
                    0.36, 'paint', plane='xz')
    weak_big(m, 'weak_2', W2, 0.92, b)
    # neck: four armoured segments that climb forward to a socket right under the eye
    b.cyl(0.95, 0.3, 'trim', segs=12, bevel=0.05, at=(0, -1.72, 10.42), rot=(12, 0, 0))
    n1 = m.joint('neck_1', (0, -1.75, 10.55), parent=b)
    n2 = m.joint('neck_2', (0, -2.02, 11.70), parent=n1)
    NP = [(0, -1.75, 10.6), (0, -1.9, 11.15), (0, -2.02, 11.7), (0, -2.14, 12.2), (0, -2.2, 12.62)]
    NR = [0.74, 0.68, 0.62, 0.56, 0.52]
    for k in range(4):
        n = n1 if k < 2 else n2
        n.limb(NP[k], NP[k + 1], NR[k], NR[k + 1], 'hull', segs=8, power=2.6, up=(0, -1, 0))
        n.cyl(NR[k + 1] + 0.1, 0.16, 'trim', segs=10, bevel=0.03, o='c', m=aim(NP[k], NP[k + 1]),
              at=(0, 0, dist(NP[k], NP[k + 1])))
        n.box((0.3, 0.05, 0.22), 'glow_main', bevel=0, at=(0, NP[k][1] - NR[k] + 0.02 - 0.06, NP[k][2] + 0.3), rot=(-14, 0, 0))
    with n1.sym():
        n1.rod((0.78, -1.5, 10.5), (0.6, -1.95, 11.6), 0.07, 'trim', segs=5)
    n2.lathe([(0.5, 12.52), (0.64, 12.6), (0.58, 12.74), (0.3, 12.7), (0.0, 12.7)], 'trim', segs=10, at=(0, -2.2, 0))
    # head: pivot = the eye
    E = (0, -2.2, 13.4)
    h = m.joint('head', E, parent=n2)
    cowl = [(-0.5, 14.3), (-0.8, 14.72), (-2.6, 14.8), (-5.2, 14.25), (-6.1, 13.6), (-5.85, 13.42), (-4.7, 13.92),
            (-2.6, 14.3)]
    h.prism(cowl, 1.9, 'hull', bevel=0.08, plane='yz')
    h.prism(slab([(-0.8, 14.76), (-2.6, 14.84), (-5.2, 14.29), (-6.1, 13.64)], 0.1), 1.5, 'paint', bevel=0.03, plane='yz')
    h.prism([(-0.6, 14.7), (-0.2, 15.0), (-2.2, 14.98), (-3.4, 14.82)], 0.14, 'trim', bevel=0.02, plane='yz')
    h.prism([(-3.1, 12.75), (-3.0, 13.0), (-4.6, 13.15), (-5.6, 13.25), (-5.75, 13.1), (-4.4, 12.72)], 0.8, 'hull',
            bevel=0.05, plane='yz')
    h.box((0.5, 0.06, 0.12), 'glow_main', bevel=0, at=(0, -5.72, 13.3))
    h.rod((0, -3.05, 12.86), (0, -2.45, 12.8), 0.16, 'trim', segs=6)
    h.torus(0.88, 0.09, 'trim', segs=14, rsegs=5, at=E)
    with h.sym():
        h.prism([(-2.9, 14.3), (-5.3, 13.95), (-5.6, 13.5), (-3.4, 13.7)], 0.1, 'paint', bevel=0.02, plane='yz',
                at=(0.93, 0, 0))
        h.prism(slab([(-5.5, 13.52), (-3.45, 13.72)], 0.06), 0.06, 'glow_main', plane='yz', at=(0.97, 0, 0))
        h.rod((0.42, -3.3, 12.95), (0.8, -3.3, 14.1), 0.1, 'trim', segs=6)
        h.rod((0.88, -2.2, 13.4), (0.8, -2.2, 14.32), 0.08, 'trim', segs=5)
        h.rod((0.7, -0.9, 14.7), (0.85, -0.3, 15.0), 0.03, 'trim', segs=4, r2=0.012)
        h.sphere(0.09, 'glow_main', segs=6, rings=4, at=(0.6, -5.2, 14.12))
    weak_big(m, 'weak_1', E, 0.74, h)
    return m


def along(p0, p1):
    """Frame in a leg plane (x outward, z up, y = hinge): origin p0, local +X along p0 -> p1, local +Y the hinge,
    local +Z square to the segment in the plane (the thigh's top, the shin's outer face). Author with plane='xz'."""
    dx, dz = p1[0] - p0[0], p1[2] - p0[2]
    l = math.hypot(dx, dz)
    dx, dz = dx / l, dz / l
    mm = Matrix(((dx, 0, -dz, p0[0]), (0, 1, 0, p0[1]), (dz, 0, dx, p0[2]), (0, 0, 0, 1)))
    return mm


def seg_pt(J, a, s, t):
    """Point of a leg segment in the leg plane: the segment hangs on the pin J at the angle a (rad, 0 = straight down,
    positive outward); s along it, t square to it (the same axes as along())."""
    return (J[0] + s * math.sin(a) + t * math.cos(a), 0, J[2] - s * math.cos(a) + t * math.sin(a))


def piston(m, name, pa, pb, na, nb, Fm, hinge, rb=0.2, rr=0.1, rng=None):
    """Hydraulic cylinder between two parts of a leg. pa, pb: its two pins in the leg plane frame Fm. Creates the bones
    pist_<name>_a (barrel, child of na, pivot pa) and pist_<name>_b (rod, child of nb, pivot pb); the game aims each at
    the other's pin every frame, so the rod slides in and out of the barrel. rng: the shortest and the longest distance
    between the pins over everything the joint does in the game: barrel and rod are cut so that the rod never leaves the
    barrel at the longest and neither runs through the other's pin at the shortest."""
    rest = dist(pa, pb)
    lo, hi = rng or (rest * 0.85, rest * 1.15)
    fb, fr = (lo - 1.7 * rb) / rest, (lo - 0.6 * rb) / rest
    if (fb + fr) * rest < hi + 0.15 or lo > rest or hi < rest:
        print(f'[piston] {name}: rest {rest:.2f} range {lo:.2f}..{hi:.2f} barrel {fb * rest:.2f} rod {fr * rest:.2f}   <-- DOES NOT TELESCOPE')
    elif name[0] == '1':
        print(f'[piston] {name}: rest {rest:.2f} range {lo:.2f}..{hi:.2f} barrel {fb * rest:.2f} rod {fr * rest:.2f}')
    wa, wb = tuple(Fm @ Vector(pa)), tuple(Fm @ Vector(pb))
    a = m.bone(f'pist_{name}_a', wa, wb, parent=na, hinge=hinge)
    r = m.bone(f'pist_{name}_b', wb, wa, parent=nb, hinge=hinge)
    with a.frames(Fm):
        a.rod(pa, lerp(pa, pb, fb), rb, 'hull', segs=7)
        a.rod(lerp(pa, pb, fb - 0.1), lerp(pa, pb, fb + 0.015), rb * 1.22, 'trim', segs=7)
        a.cyl(rb * 1.25, rb * 2.6, 'trim', segs=6, o='c', rot=(90, 0, 0), at=pa)
    with r.frames(Fm):
        r.rod(pb, lerp(pb, pa, fr), rr, 'steel', segs=5)
        r.cyl(rb * 1.1, rb * 2.2, 'trim', segs=6, o='c', rot=(90, 0, 0), at=pb)
    return a, r


def titan_leg(m, b, tag, Fm):
    """One leg of the Titan in its leg plane Fm (origin = the hip hub on the ground plane, +X away from it, +Z up).
    The chain is a machine, every part hung on the pin it turns about:
      body          slew ring under the hip, on an arm from the hub
      leg_<n>       turntable (yaw) with the two cheeks that carry the hip pin
      _upper        thigh: box girder up to the knee fork, a hydraulic cylinder in the trough on its back, the lug of the
                    hip cylinder under it and an armoured kneecap over the outside of the joint
      _lower        shin: heavy at the knee and slim at the ankle, armoured on its outer face; its horn above the
                    knee is the crank the thigh's cylinder pulls on
      _foot         tarsus between the ankle pin and the ball the pad swivels on
      _toe          the pad: sole, three claws ahead, a spur behind (kept flat on the ground by the game)
    Three cylinders work the joints: hip (turntable > thigh, a boom cylinder under the thigh), knee (thigh > shin horn),
    ankle (shin > tarsus). Proportions: the thigh and the shin differ by less than half the thigh (4.9 against 7.3), so
    the game's leg solver stays clear of its folded end wherever the foot stands, and nothing has to slide."""
    Hh, K, A, F = (1.5, 0, 6.4), (5.7, 0, 9.0), (6.3, 0, 1.75), (6.5, 0, 0.42)
    hinge = tuple(Fm.to_3x3() @ Vector((0, 1, 0)))
    root, up, lo, ft, toe = radial_leg(m, tag, b, Fm, (Hh, K, A, F))
    L1, L2, L3 = dist(Hh, K), dist(K, A), dist(A, F)
    AU, AL, AF = along(Hh, K), along(K, A), along(A, F)
    Y = (90, 0, 0)
    PH, TH = (2.45, 0, 5.8), (3.6, -0.95)        # hip cylinder: its pin between the cheeks, its pin under the thigh (along, square)
    # --- body: the slew ring the leg turns on, and its arm from the hub
    with b.frames(Fm):
        b.prism([(0.05, 6.0), (0.05, 5.3), (0.8, 4.95), (1.6, 4.9), (1.6, 5.15), (0.9, 5.45), (0.45, 6.0)], 0.76, 'hull',
                bevel=0.05, plane='xz')
        b.prism(slab([(0.15, 6.08), (0.5, 6.08), (0.95, 5.53), (1.3, 5.38)], 0.1), 0.56, 'paint', bevel=0.02, plane='xz')
        b.cyl(0.95, 0.4, 'trim', segs=12, bevel=0.06, at=(Hh[0], 0, 4.98))
        b.ring(0.84, 0.08, 0.07, 'glow_main', segs=12, at=(Hh[0], 0, 5.41))
    # --- turntable + cheeks + hip pin (yaws with the leg)
    with root.frames(Fm):
        root.cyl(0.8, 0.26, 'paint', segs=12, bevel=0.04, at=(Hh[0], 0, 5.44))
        for y in (-0.56, 0.56):
            root.prism([(0.98, 5.68), (0.95, 6.45), (1.2, 6.95), (1.8, 6.95), (2.05, 6.5), (2.75, 5.95), (2.7, 5.68)], 0.18,
                       'hull', bevel=0.03, plane='xz', at=(0, y, 0))
            root.cyl(0.44, 0.08, 'trim', segs=8, o='c', rot=Y, at=(Hh[0], y * 1.2, Hh[2]))
            root.cyl(0.22, 0.05, 'glow_main', segs=8, o='c', rot=Y, at=(Hh[0], y * 1.3, Hh[2]))
        root.cyl(0.3, 1.3, 'trim', segs=8, o='c', rot=Y, at=Hh)
        root.box((0.5, 0.9, 0.3), 'hull', bevel=0.04, at=(1.05, 0, 5.85))
    # --- thigh
    with up.frames(Fm @ AU):
        up.cyl(0.5, 0.9, 'trim', segs=12, bevel=0.04, o='c', rot=Y)
        up.prism([(-0.25, -0.36), (0.35, -0.56), (L1 - 1.1, -0.5), (L1 - 0.35, -0.66), (L1 + 0.2, -0.3), (L1 + 0.1, 0.3),
                  (L1 - 0.7, 0.46), (0.5, 0.46), (-0.15, 0.3)], 0.62, 'hull', bevel=0.05, plane='xz')
        for y in (-0.35, 0.35):
            up.prism([(0.75, -0.4), (L1 - 1.35, -0.36), (L1 - 1.0, 0.28), (0.95, 0.34)], 0.1, 'paint', plane='xz', at=(0, y, 0))
            up.box((1.7, 0.03, 0.1), 'glow_main', bevel=0, at=(L1 * 0.46, y * 1.17, -0.04))
            # the two rails of the trough the knee cylinder lies in
            up.prism(slab([(0.25, 0.56), (0.9, 0.86), (L1 - 1.5, 0.86), (L1 - 0.5, 0.6)], 0.34), 0.22, 'paint', bevel=0.03,
                     plane='xz', at=(0, y * 1.2, 0))
            # knee fork
            up.cyl(0.74, 0.18, 'trim', segs=12, bevel=0.03, o='c', rot=Y, at=(L1, y * 1.6, 0))
            up.cyl(0.3, 0.05, 'glow_main', segs=8, o='c', rot=Y, at=(L1, y * 1.9, 0))
            up.prism([(L1 - 1.3, -0.5), (L1 - 0.2, -0.72), (L1 - 0.1, 0.4), (L1 - 1.2, 0.44)], 0.16, 'hull', plane='xz', at=(0, y * 1.6, 0))
        up.cyl(0.26, 1.34, 'trim', segs=8, o='c', rot=Y, at=(L1, 0, 0))
        # kneecap: an armoured shell over the outside of the joint, in the one arc neither the shin nor its horn sweeps
        arc = lambda r, a0, a1, n=4: [(L1 + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
                                       r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]
        up.prism(slab(arc(1.06, -34, 8), 0.2), 1.62, 'paint', bevel=0.04, plane='xz')
        up.prism(slab(arc(1.19, -30, 4, 3), 0.07), 0.36, 'trim', plane='xz')
        for y in (-0.6, 0.6):
            up.prism(slab(arc(1.18, -22, -4, 1), 0.05), 0.07, 'glow_main', plane='xz', at=(0, y, 0))
        up.prism([(TH[0] - 0.55, -0.45), (TH[0] - 0.3, TH[1] - 0.2), (TH[0] + 0.3, TH[1] - 0.2), (TH[0] + 0.6, -0.45)], 0.5,
                 'trim', bevel=0.04, plane='xz')                                                  # lug of the hip cylinder
        up.box((0.5, 0.5, 0.3), 'trim', bevel=0.04, at=(1.0, 0, 0.56))                          # lug of the knee cylinder
        # hose down the flank from the hip to the knee
        up.tube([(0.5, 0.42, -0.2), (1.2, 0.5, -0.5), (L1 - 1.6, 0.5, -0.46), (L1 - 0.9, 0.44, -0.1)], 0.06, 'steel',
                segs=4)
    # --- shin
    with lo.frames(Fm @ AL):
        lo.cyl(0.62, 0.78, 'trim', segs=12, bevel=0.04, o='c', rot=Y)
        lo.prism([(-0.5, -0.3), (0.3, -0.88), (2.5, -0.84), (3.5, -0.46), (L2 - 0.5, -0.32), (L2 + 0.15, -0.26),
                  (L2 + 0.2, 0.26), (L2 - 0.6, 0.36), (1.3, 0.56), (0.2, 0.6), (-1.35, 0.42), (-1.4, 0.12)], 0.58, 'hull',
                 bevel=0.05, plane='xz')
        lo.cyl(0.2, 0.7, 'trim', segs=8, o='c', rot=Y, at=(-1.15, 0, 0.27))                      # pin on the horn
        lo.prism(slab([(0.85, 0.66), (1.7, 0.86), (4.6, 0.66), (L2 - 0.9, 0.5)], 0.18), 0.86, 'paint', bevel=0.04,
                 plane='xz')
        lo.prism(slab([(2.0, 0.84), (L2 - 1.8, 0.6)], 0.05), 0.16, 'glow_main', plane='xz', at=(0, 0, 0.03))
        for y in (-0.31, 0.31):
            lo.prism([(0.55, -0.72), (2.4, -0.7), (3.1, -0.36), (3.0, 0.3), (0.9, 0.36)], 0.1, 'paint', plane='xz', at=(0, y, 0))
            lo.box((0.9, 0.03, 0.1), 'glow_main', bevel=0, at=(1.75, y * 1.2, -0.32), rot=(0, 4, 0))
            lo.cyl(0.5, 0.14, 'trim', segs=10, bevel=0.03, o='c', rot=Y, at=(L2, y * 1.36, 0))  # ankle fork
            lo.prism([(L2 - 1.2, -0.3), (L2, -0.44), (L2 + 0.1, 0.36), (L2 - 1.2, 0.34)], 0.14, 'hull', plane='xz', at=(0, y * 1.36, 0))
            lo.rod((3.4, y * 0.6, -0.5), (L2 - 1.3, y * 0.6, -0.36), 0.06, 'steel', segs=4)       # tendon rods
        lo.cyl(0.2, 1.0, 'trim', segs=8, o='c', rot=Y, at=(L2, 0, 0))
        lo.box((0.4, 0.44, 0.3), 'trim', bevel=0.04, at=(L2 - 2.5, 0, -0.5))                     # lug of the ankle cylinder
    # --- tarsus
    with ft.frames(Fm @ AF):
        ft.cyl(0.4, 0.68, 'trim', segs=10, bevel=0.03, o='c', rot=Y)
        ft.prism([(-0.15, -0.38), (0.2, -0.95), (0.55, -0.92), (L3 - 0.1, -0.3), (L3 - 0.1, 0.3), (0.0, 0.42)], 0.56,
                 'hull', bevel=0.05, plane='xz')
        ft.prism(slab([(0.1, 0.5), (L3 - 0.25, 0.4)], 0.12), 0.7, 'paint', bevel=0.03, plane='xz')
        ft.sphere(0.42, 'trim', segs=10, rings=6, at=(L3, 0, 0))
    # --- pad
    with toe.frames(Fm):
        toe.ring(0.54, 0.16, 0.34, 'trim', segs=10, at=(F[0], 0, 0.36))
        toe.prism([(4.85, -0.75), (4.7, 0), (4.85, 0.75), (6.3, 1.02), (6.8, 0.6), (6.8, -0.6), (6.3, -1.02)], 0.3, 'hull',
                  bevel=0.06, at=(0, 0, 0.15))
        toe.prism([(5.0, -0.6), (4.9, 0), (5.0, 0.6), (5.25, 0.82), (5.25, -0.82)], 0.07, 'paint', at=(0, 0, 0.33))
        with toe.frames([T(at=(F[0], 0, 0)) @ rotz(a) for a in (-34, 0, 34)]):
            toe.prism([(0.7, 0.0), (0.66, 0.44), (1.0, 0.66), (1.5, 0.56), (2.0, 0.0)], 0.44, 'hull', bevel=0.05, plane='xz')
            toe.prism([(1.55, 0.0), (1.56, 0.4), (2.3, 0.0)], 0.3, 'trim', plane='xz')
            toe.prism(slab([(0.7, 0.5), (1.02, 0.72), (1.5, 0.62)], 0.08), 0.52, 'paint', plane='xz')
            toe.cyl(0.17, 0.56, 'trim', segs=5, o='c', rot=Y, at=(0.86, 0, 0.5))
            toe.rod((0.42, 0, 0.72), (1.2, 0, 0.7), 0.06, 'steel', segs=4)
        with toe.frames(T(at=(F[0], 0, 0)) @ rotz(180)):
            toe.prism([(0.6, 0.0), (0.6, 0.42), (0.95, 0.5), (1.55, 0.0)], 0.5, 'hull', bevel=0.05, plane='xz')
            toe.prism([(1.2, 0.0), (1.22, 0.3), (1.8, 0.0)], 0.3, 'trim', plane='xz')
    # --- hydraulics. Each is cut for the whole travel of its joint in the game (see GAITS.titan and solveLeg in anim.ts):
    # thigh 1.36..3.33 rad from straight down, knee folded by 1.15..2.72 rad, tarsus -0.62..0.62 rad against the shin
    # (the widest of it out in the district, where it climbs over roofs; on the deck it uses about two thirds)
    a1, a2, a3 = (math.atan2(q[0] - p[0], p[2] - q[2]) for p, q in ((Hh, K), (K, A), (A, F)))
    sweep = lambda lo_, hi_: [lo_ + (hi_ - lo_) * i / 24 for i in range(25)]
    span = lambda pa, f, angs: (lambda d: (min(d), max(d)))([dist(pa, f(a)) for a in angs])
    hp, kp, ap = PH, seg_pt(Hh, a1, 1.0, 0.7), seg_pt(K, a2, L2 - 2.5, -0.6)
    piston(m, f'{tag}h', hp, seg_pt(Hh, a1, *TH), root, up, Fm, hinge, rb=0.24, rr=0.12,
           rng=span(hp, lambda a: seg_pt(Hh, a, *TH), sweep(1.36, 3.33)))
    piston(m, f'{tag}k', kp, seg_pt(K, a2, -1.15, 0.27), up, lo, Fm, hinge, rb=0.24, rr=0.12,
           rng=span(kp, lambda k: seg_pt(K, a1 - k, -1.15, 0.27), sweep(1.15, 2.72)))
    piston(m, f'{tag}a', ap, seg_pt(A, a3, 0.36, -0.82), lo, ft, Fm, hinge, rb=0.16, rr=0.08,
           rng=span(ap, lambda f: seg_pt(A, a2 - f, 0.36, -0.82), sweep(-0.62, 0.62)))
    return root, up, lo, ft, toe


def weak_big(m, name, at, r, parent):
    """A weak point on a machine big enough to be read from across the deck: a rounder core."""
    w = m.joint(name, at, parent=parent)
    w.sphere(r, 'glow_weak', segs=14, rings=8, at=at)
    return w


ENEMIES = [enemy_grunt, enemy_runner, enemy_drone, enemy_brute, enemy_shield, enemy_boss, enemy_wheel, enemy_brood,
           enemy_mite, enemy_titan]
