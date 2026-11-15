"""VOLTSPIRE enemies - "the Static": cold machines. Dark slate hulls, gunmetal-violet plating, blue-white glows.
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


ENEMIES = [enemy_grunt, enemy_runner, enemy_drone, enemy_brute, enemy_shield, enemy_boss, enemy_wheel]
