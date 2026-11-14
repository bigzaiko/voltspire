// Procedural animation for VOLTSPIRE's rigid-jointed models (no glTF clips, no skinning).
//
// ---- RIG NAMING (nodes in the GLB files) ----
// All models are parent/child hierarchies of rigid meshes whose origins sit on the joints.
// Game space (glTF / three.js): +Y up, FRONT = +Z, the machine's LEFT = +X.
//
// Two kinds of joints are exported by tools/blender/vs_lib.py:
//   * "joint": rest rotation = identity (model axes). Animated with small delta angles:
//                rotation.x = pitch (+ = nose/front DOWN), rotation.y = yaw (+ = turn LEFT),
//                rotation.z = roll (+ = left side UP).
//   * "bone": limb segment in a canonical frame: the segment runs along local -Y, the hinge is local X.
//                The exported rest rotation is only the default pose; the animation writes ABSOLUTE
//                angles: a bone at angle a (measured from straight down towards the limb's front)
//                has rotation.x = -a relative to its parent frame.
//
// Enemies  (root = enemy_<type>)
//   body                     main mass; bobs / pitches / rolls. Everything hangs off it.
//   torso                    upper body, child of body (grunt, brute): counter-rotation, lean.
//   head                     head / sensor / tracking turret (grunt, brute, runner, shield collar, boss).
//   jaw                      runner only, child of head: pitch.
//   eye                      drone only: gimballed sensor, yaw + pitch.
//   arm_<l|r>_upper, arm_<l|r>_lower     joints (shoulder, elbow), grunt + brute.
//   leg_<id>_upper > leg_<id>_lower [> leg_<id>_foot] > leg_<id>_toe
//                            bones (hip, knee[, ankle]) + a toe joint that is kept level.
//                            id = l | r (bipeds), fl | fr | hl | hr (runner), 1..3 (tripod), 1..6 (boss:
//                            1-3 left front to rear, 4-6 right front to rear).
//   leg_<id>                 radial legs only (tripod, boss): yaw root at the hip whose FRONT (+Z) points
//                            away from the body; the leg chain below it flexes about local X like any other.
//   spin_<n>                 free-spinning parts (rotors, projector ring, reactor ring): spin about local Y.
//
// Towers  (root = tower_<type>)
//   base, turret             turret yaws about Y (not arc / beacon).
//   barrel | barrel_1, barrel_2   child of turret (pulse: twin, rail: rails); recoils along turret -Z.
//   cradle > barrel          mortar: cradle pitches about X at the trunnion (elevation), the barrel slides
//                            along its own bore (local +Y of the barrel node).
//   dish                     cryo nozzle, child of turret: recoil along -Z + scale pulse.
//   orb                      arc pylon discharge sphere, child of turret: scale pulse.
//   spin_<n>                 beacon mast, gravity rings, spire dishes.
//   barrel (flame nozzle, lance emitter), barrel_1.. (missile pods): same recoil rule as above.
//   orb                      gravity well core: contracts on every pulse.
//   node                     optional power node (the thing the player shoots to fire the special). The view lights it
//                            by charge; without it the view draws its own emblem above the tower.
//   lvl2, lvl3               optional groups shown from tower level 2 / 3 (also lvl2_<x>, lvl3_<x>).
//   weak_<n>                 enemies (brute, boss): optional weak-point parts, lit by the view.
//   tier2 .. tier5           hero and bow: optional parts shown once the bow has reached that tier.
//
// Hero  (root = hero)
//   pelvis > torso > head
//   torso > arm_<l|r>_upper > arm_<l|r>_lower > hand_<l|r>      bones, solved with 3-D two-bone IK
//           (left = bow arm, right = draw arm)
//   hand_l > bow > string_u, string_l, arrow
//           bow: local +Z = arrow direction, local +Y = upper limb. string_u / string_l are unit-length
//           rods (along local +Y) from the limb tips that are aimed at the nock point and scaled;
//           arrow sits on the nock point (origin = nock, shaft along +Z) and is hidden on release.
//   torso > quiver, torso > cape_1 > cape_2 > cape_3            cape segments: pitch (x) + roll (z) sway
//   pelvis > leg_<l|r>_upper > leg_<l|r>_lower > leg_<l|r>_foot  bones, 3-D IK; feet are planted in deck space and
//           step round (one at a time) when she turns.
// ----
//
// API:  makeEnemyRig / resetEnemy / updateEnemy,  makeTowerRig / updateTower / towerShot,
//       makeHeroRig / updateHero / heroTrigger.   Rigs cache every joint once; updates allocate nothing.
import * as THREE from 'three';
import type { EnemyType, TowerType } from './data.ts';
import { SKILL_CAST, SKILL_LOCK } from './sim.ts';

const PI = Math.PI, TAU = PI * 2;
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3(), V4 = new THREE.Vector3(), V5 = new THREE.Vector3();
const Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion();
const M = new THREE.Matrix4();
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const sat = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (u: number) => { u = sat(u); return u * u * (3 - 2 * u); };
const damp = (cur: number, to: number, rate: number, dt: number) => cur + (to - cur) * (1 - Math.exp(-rate * dt));
const wrap = (a: number) => { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; };
const frac = (v: number) => v - Math.floor(v);
type O3 = THREE.Object3D;
const find = (root: O3, name: string): O3 | null => root.getObjectByName(name) || null;
/** Position of `node` in the space of `root` (rest pose, any time the hierarchy is in its rest pose). */
function relPos(node: O3, root: O3, out: THREE.Vector3) {
  root.updateWorldMatrix(true, true);
  return root.worldToLocal(out.setFromMatrixPosition(node.matrixWorld));
}

// ---------- legs ----------
// Feet are planted in WORLD space: a foot that touches down stays exactly where it landed until its phase
// in the gait lifts it again, whatever the body does in between (bob, sway, turning, slowing, stopping).
// The swing carries it to the spot where the leg's neutral point will be half a stance later.
interface Leg {
  root: O3 | null; upper: O3; lower: O3; foot: O3 | null; toe: O3;
  l1: number; l2: number; l3: number; bend: number;
  hx: number; hy: number; hz: number;      // hip in root space (rest)
  bhx: number; bhy: number; bhz: number;   // hip relative to the body node (rest)
  fx: number; fz: number; toeH: number;    // neutral toe pivot in root space
  a3: number;                              // rest angle of the third segment
  ph: number;                              // phase offset in the gait cycle
  lift: number;                            // current foot lift (0 = planted)
  down: boolean;                           // planted
  wx: number; wz: number; wyaw: number;    // world position / heading of the plant (or of the last lift-off)
  sx: number; sz: number;                  // current toe pivot, root space
}

function makeLeg(root: O3, id: string, ph: number, body: O3 | null): Leg | null {
  const upper = find(root, `leg_${id}_upper`), lower = find(root, `leg_${id}_lower`), toe = find(root, `leg_${id}_toe`);
  if (!upper || !lower || !toe) return null;
  const foot = find(root, `leg_${id}_foot`), yawRoot = find(root, `leg_${id}`);
  const H = relPos(upper, root, new THREE.Vector3()), K = relPos(lower, root, new THREE.Vector3());
  const A = relPos(foot || toe, root, new THREE.Vector3()), T = relPos(toe, root, new THREE.Vector3());
  // leg-plane forward (unit, horizontal): outward for radial legs, +Z otherwise
  let ux = 0, uz = 1;
  if (yawRoot) { const d = Math.hypot(T.x - H.x, T.z - H.z) || 1; ux = (T.x - H.x) / d; uz = (T.z - H.z) / d; }
  const ang = (a: THREE.Vector3, b: THREE.Vector3) => Math.atan2((b.x - a.x) * ux + (b.z - a.z) * uz, a.y - b.y);
  const a1 = ang(H, K), a2 = ang(K, A);
  upper.rotation.order = 'ZYX';            // hip: abduction (z) is applied outside the flexion (x)
  const bp = body ? body.position : H.clone().set(0, 0, 0);
  return {
    root: yawRoot, upper, lower, foot, toe,
    l1: H.distanceTo(K), l2: K.distanceTo(A), l3: foot ? A.distanceTo(T) : 0, bend: a1 >= a2 ? 1 : -1,
    hx: H.x, hy: H.y, hz: H.z, bhx: H.x - bp.x, bhy: H.y - bp.y, bhz: H.z - bp.z,
    fx: T.x, fz: T.z, toeH: T.y, a3: foot ? ang(A, T) : 0, ph, lift: 0,
    down: false, wx: 0, wz: 0, wyaw: 0, sx: T.x, sz: T.z,
  };
}

/**
 * Planar two-bone (+ optional fixed third segment) IK in the leg plane. tz = forward, ty = up, both relative to
 * the hip; a3 = absolute angle of the third segment; abd = hip abduction (non-radial legs).
 * The solve is kept away from its singular ends: a target that is too close is pushed outward along the ground
 * (smoothly), one that is too far is pulled in along the leg. Returns the absolute angle of the last segment.
 */
function solveLeg(L: Leg, tz: number, ty: number, a3: number, abd: number) {
  if (L.foot) { tz -= L.l3 * Math.sin(a3); ty += L.l3 * Math.cos(a3); }
  const l1 = L.l1, l2 = L.l2, sum = l1 + l2;
  let d = Math.hypot(tz, ty);
  const dmin = Math.abs(l1 - l2) + 0.05 * sum, w = 0.05 * sum, x = (d - dmin) / w;
  if (x < 1) {
    const d2 = dmin + (x > -1 ? w * (x + 1) * (x + 1) * 0.25 : 0);
    const h = Math.sqrt(Math.max(d2 * d2 - ty * ty, 1e-6));
    tz = tz < 0 && !L.root ? -h : h; d = Math.hypot(tz, ty);
  }
  const dmax = sum * 0.995;
  if (d > dmax) { tz *= dmax / d; ty *= dmax / d; d = dmax; }
  const phi = Math.atan2(tz, -ty);
  const A = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const Kn = Math.acos(clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
  const a1 = phi + L.bend * A, a2 = a1 - L.bend * (PI - Kn);
  L.upper.rotation.set(-a1, 0, abd);
  L.lower.rotation.set(a1 - a2, 0, 0);
  if (L.foot) L.foot.rotation.set(a2 - a3, 0, 0);
}

interface Gait {
  stride: number;   // ground distance a planted foot travels under the body (model units)
  duty: number;     // fraction of the cycle a foot is planted, so one cycle covers stride / duty
  lift: number;     // swing height
  toe: number;      // toe-down pitch at lift-off (rad)
  meta: number;     // extra fold of the third segment while the foot is in the air (rad)
  roll: number;     // third segment rolls over the toe through the stance (rad at the ends of the stride)
  ph: number[];     // phase per leg
}

/** Per-update context shared by all legs of one rig. */
const C = { X: 0, Z: 0, cs: 1, sn: 0, sc: 1, psi: 0, vx: 0, vz: 0, om: 0, sp: 0, spMin: 1, liftAmp: 1, pitch: 0, yaw: 0, init: false };
const QBI = new THREE.Quaternion(), QC = new THREE.Quaternion(), QD = new THREE.Quaternion(), EU = new THREE.Euler();

function stepLeg(r: EnemyRig, L: Leg, G: Gait) {
  const p = frac(r.cyc + L.ph), nx = L.fx, nz = L.fz;
  // velocity of this leg's neutral point over the ground (root space), which gives the spot for the next footfall
  const vnx = C.vx + C.om * nz, vnz = C.vz - C.om * nx, den = Math.max(C.sp, C.spMin);
  let ox = vnx * G.stride * 0.5 / den, oz = vnz * G.stride * 0.5 / den;
  const ol = Math.hypot(ox, oz), omax = G.stride * 0.6;
  if (ol > omax) { ox *= omax / ol; oz *= omax / ol; }
  const leash = G.stride * 0.85 + 0.06;
  let lx: number, lz: number, lift = 0, toe = 0, yawF = 0, roll: number;
  if (C.init) {
    // first frame of a (re)used visual: drop every foot where a steady walk would have it
    const u = p < G.duty ? p / G.duty : 1;
    L.down = p < G.duty; L.sx = nx + ox * (1 - 2 * u); L.sz = nz + oz * (1 - 2 * u); L.wyaw = C.psi;
    L.wx = C.X + (L.sx * C.cs + L.sz * C.sn) * C.sc; L.wz = C.Z + (-L.sx * C.sn + L.sz * C.cs) * C.sc;
  }
  // the stored world point seen from the body now
  let dx = (L.wx - C.X) / C.sc, dz = (L.wz - C.Z) / C.sc;
  let ax = dx * C.cs - dz * C.sn, az = dx * C.sn + dz * C.cs;
  const ex = ax - nx, ez = az - nz, ed = Math.hypot(ex, ez);
  if (ed > leash) { // out of reach (dragged, pushed): give way, keep the foot under the machine
    ax = nx + ex * leash / ed; az = nz + ez * leash / ed;
    L.wx = C.X + (ax * C.cs + az * C.sn) * C.sc; L.wz = C.Z + (-ax * C.sn + az * C.cs) * C.sc;
  }
  if (p < G.duty) {
    if (!L.down) { // touchdown: plant where the swing was heading
      L.down = true; L.wyaw = C.psi;
      const back = p * (G.stride / G.duty) / den;                 // ground covered since the exact moment of touchdown
      ax = nx + ox - vnx * back; az = nz + oz - vnz * back;
      L.wx = C.X + (ax * C.cs + az * C.sn) * C.sc; L.wz = C.Z + (-ax * C.sn + az * C.cs) * C.sc;
    }
    const u = p / G.duty;
    lx = ax; lz = az;
    toe = u > 0.8 ? (u - 0.8) * 5 * 0.35 : 0;
    yawF = clamp(wrap(L.wyaw - C.psi), -0.6, 0.6);
    roll = 1 - 2 * u;
  } else {
    L.down = false;
    const u = (p - G.duty) / (1 - G.duty), e = ease(u);
    // landing point: half a stride ahead of neutral at touchdown; until then it recedes at ground speed, so the
    // foot leaves and meets the ground without sliding
    const rem = (1 - u) * (1 - G.duty) * (G.stride / G.duty) / den;
    lx = ax + (nx + ox + vnx * rem - ax) * e; lz = az + (nz + oz + vnz * rem - az) * e;
    lift = Math.sin(PI * Math.pow(u, 0.8)) * C.liftAmp;
    toe = (1 - u) * (1 - u) * (0.35 + 0.65 * Math.sin(PI * u)) - 0.25 * Math.sin(PI * u) * u;
    yawF = clamp(wrap(L.wyaw - C.psi), -0.6, 0.6) * (1 - e);
    roll = 2 * e - 1;
  }
  L.sx = lx; L.sz = lz; L.lift = lift;
  // foot target relative to the hip, in the body's own frame (exact for any body pitch / roll / yaw)
  const body = r.body;
  V.set(lx, L.toeH + lift * G.lift, lz);
  if (body) V.sub(body.position).applyQuaternion(QBI);
  V.x -= L.bhx; V.y -= L.bhy; V.z -= L.bhz;
  let a3 = L.a3 + G.meta * lift + G.roll * roll * Math.min(1, ol / (G.stride * 0.4));
  let legYaw = 0;
  if (L.root) {
    legYaw = Math.atan2(V.x, V.z);
    L.root.rotation.set(0, legYaw, 0);
    solveLeg(L, Math.hypot(V.x, V.z), V.y, a3, 0);
  } else {
    a3 -= C.pitch;
    solveLeg(L, V.z, -Math.hypot(V.x, V.y), a3, clamp(Math.atan2(V.x, -V.y), -0.7, 0.7));
  }
  // toe: flat on the ground, pointing where it was planted, whatever the chain above it does
  if (body) QC.copy(body.quaternion); else QC.identity();
  if (L.root) QC.multiply(L.root.quaternion);
  QC.multiply(L.upper.quaternion).multiply(L.lower.quaternion);
  if (L.foot) QC.multiply(L.foot.quaternion);
  QD.setFromEuler(EU.set(toe * G.toe, L.root ? legYaw + C.yaw : yawF, 0, 'YXZ'));
  L.toe.quaternion.copy(QC.invert()).multiply(QD);
}

// ---------- enemies ----------
/** How far the Colossus plants its feet from the hips (1 = the model's rest pose). Kept tight: it walks a road one tile wide between towers. */
const BOSS_STANCE = 1.0;
const GAITS: Record<EnemyType, Gait> = {
  grunt: { stride: 0.85, duty: 0.5, lift: 0.16, toe: 0.9, meta: 0.5, roll: 0.32, ph: [0, 0.5] },
  runner: { stride: 0.62, duty: 0.38, lift: 0.09, toe: 0.7, meta: 0, roll: 0, ph: [0.5, 0.0, 0.62, 0.1] },      // fl hl fr hr: bounding gallop
  brute: { stride: 1.0, duty: 0.62, lift: 0.2, toe: 0.4, meta: 0, roll: 0, ph: [0, 0.5] },
  shield: { stride: 0.8, duty: 0.67, lift: 0.2, toe: 0.3, meta: 0, roll: 0, ph: [0, 1 / 3, 2 / 3] },
  boss: { stride: 1.5, duty: 0.72, lift: 0.5, toe: 0.3, meta: 0.25, roll: 0.1, ph: [2 / 3, 1 / 3, 0, 1 / 6, 5 / 6, 0.5] },   // metachronal wave, rear to front
  drone: { stride: 1, duty: 0.5, lift: 0, toe: 0, meta: 0, roll: 0, ph: [] },
};
const LEG_IDS: Record<EnemyType, string[]> = {
  grunt: ['l', 'r'], runner: ['fl', 'hl', 'fr', 'hr'], brute: ['l', 'r'], shield: ['1', '2', '3'], boss: ['1', '2', '3', '4', '5', '6'], drone: [],
};

export interface EnemyRig {
  type: EnemyType; root: O3; gait: Gait; legs: Leg[]; spins: O3[];
  body: O3 | null; torso: O3 | null; head: O3 | null; jaw: O3 | null; eye: O3 | null;
  armLU: O3 | null; armLL: O3 | null; armRU: O3 | null; armRL: O3 | null;
  bx: number; by: number; bz: number;   // rest position of the body node
  footR: number;                        // mean distance of the feet from the turning axis
  cyc: number; t: number; seed: number; age: number; flinch: number; hp: number;
  speed: number; mv: number; sing: number; lastYaw: number; bank: number; look: number;
  lastX: number; lastZ: number; vx: number; vz: number; om: number; init: boolean; walk: number;
}

export function makeEnemyRig(root: O3, type: EnemyType): EnemyRig {
  const g = GAITS[type], legs: Leg[] = [];
  const body = find(root, 'body');
  LEG_IDS[type].forEach((id, i) => { const l = makeLeg(root, id, g.ph[i], body); if (l) legs.push(l); });
  if (type === 'runner') legs.forEach((l) => { l.fz += l.fz > 0 ? 0.05 : -0.05; });          // fore and hind feet never bunch up
  if (type === 'shield') legs.forEach((l) => { l.fx = l.hx + (l.fx - l.hx) * 1.1; l.fz = l.hz + (l.fz - l.hz) * 1.1; });   // wider stance: room for the stride
  if (type === 'boss') legs.forEach((l) => { l.fx = l.hx + (l.fx - l.hx) * BOSS_STANCE; l.fz = l.hz + (l.fz - l.hz) * BOSS_STANCE; });
  const spins: O3[] = [];
  root.traverse((o) => { if (o.name.startsWith('spin')) spins.push(o); });
  let footR = 0;
  for (const l of legs) footR += Math.hypot(l.fx, l.fz) / legs.length;
  const r: EnemyRig = {
    type, root, gait: g, legs, spins, body, torso: find(root, 'torso'), head: find(root, 'head'), jaw: find(root, 'jaw'), eye: find(root, 'eye'),
    armLU: find(root, 'arm_l_upper'), armLL: find(root, 'arm_l_lower'), armRU: find(root, 'arm_r_upper'), armRL: find(root, 'arm_r_lower'),
    bx: body ? body.position.x : 0, by: body ? body.position.y : 0, bz: body ? body.position.z : 0, footR,
    cyc: 0, t: 0, seed: 0, age: 0, flinch: 0, hp: -1, speed: 0, mv: 0, sing: 0, lastYaw: 0, bank: 0, look: 0,
    lastX: 0, lastZ: 0, vx: 0, vz: 0, om: 0, init: true, walk: 1,
  };
  resetEnemy(r);
  return r;
}

/** Nominal walking speed (model units / s) used to normalise the "how fast am I moving" blend. */
const NOMINAL: Record<EnemyType, number> = { grunt: 3, runner: 5, drone: 3.8, shield: 2.5, brute: 1.9, boss: 1.04 };

/** Call when a pooled visual is handed to a new enemy (after its root has been placed). */
export function resetEnemy(r: EnemyRig) {
  r.seed = Math.random() * 100; r.cyc = Math.random(); r.t = 0; r.age = 0; r.flinch = 0; r.hp = -1;
  r.sing = 0; r.bank = 0; r.look = 0; r.lastYaw = r.root.rotation.y;
  // assume it walks in at its normal pace: the first frame is already a valid walking pose
  r.speed = NOMINAL[r.type]; r.mv = 1; r.vx = 0; r.vz = r.speed; r.om = 0; r.walk = 1;
  r.lastX = r.root.position.x; r.lastZ = r.root.position.z; r.init = true;
}

/**
 * Advance one enemy rig. Movement is read from the root's own position / heading (set them before the call).
 * @param hpFrac current hp / max hp (a drop triggers a flinch)
 * @param sing   true while held by a singularity
 * @param frozen true while frozen solid: the machine holds its pose, nothing moves
 * @param lookYaw world yaw the head should track (boss), or NaN
 */
export function updateEnemy(r: EnemyRig, dt: number, hpFrac: number, sing: boolean, frozen: boolean, lookYaw: number) {
  if (dt <= 0) return;
  const root = r.root, g = r.gait, sc = root.scale.x || 1, psi = root.rotation.y;
  const wdx = root.position.x - r.lastX, wdz = root.position.z - r.lastZ, dpsi = wrap(psi - r.lastYaw);
  r.lastX = root.position.x; r.lastZ = root.position.z; r.lastYaw = psi;
  if (frozen && !r.init) { r.hp = hpFrac; r.speed = 0; r.vx = r.vz = r.om = 0; return; }
  const t = (r.t += dt), s = r.seed;
  const cs = Math.cos(psi), sn = Math.sin(psi);
  // ground covered this frame in the machine's own frame (x = left, z = forward)
  let mx = (wdx * cs - wdz * sn) / sc, mz = (wdx * sn + wdz * cs) / sc;
  if (Math.hypot(mx, mz) > 2.5) { mx = mz = 0; r.init = true; }   // moved by something other than walking
  const dist = Math.hypot(mx, mz);
  r.age += dt;
  const kv = 1 - Math.exp(-10 * dt);
  if (!r.init) { r.vx += (mx / dt - r.vx) * kv; r.vz += (mz / dt - r.vz) * kv; r.om += (dpsi / dt - r.om) * kv; }
  r.speed = Math.hypot(r.vx, r.vz);
  const mv = (r.mv = sat(r.speed / (NOMINAL[r.type] * 0.55)));
  r.sing = damp(r.sing, sing ? 1 : 0, sing ? 12 : 4, dt);
  if (r.hp >= 0 && hpFrac < r.hp - 1e-4) r.flinch = Math.min(1, r.flinch + 0.3 + (r.hp - hpFrac) * 5);
  r.hp = hpFrac;
  r.flinch *= Math.exp(-dt * 7);
  const fl = r.flinch, sg = r.sing;
  // gait phase: driven by the ground actually covered (walking and stepping round a turn); scrabbling in place while held
  const step = dist + Math.abs(dpsi) * r.footR;
  r.cyc += step / (g.stride / g.duty) + sg * dt * (r.type === 'boss' ? 0.5 : 1.7);
  const c = r.cyc, w = c * TAU;
  const amp = Math.max(mv, sg * 0.55);
  // feet that are in the air when the machine stops are set down instead of hanging there
  r.walk = damp(r.walk, step / dt > NOMINAL[r.type] * 0.04 || sg > 0.05 ? 1 : 0, 6, dt);
  const spawn = 1 - ease(r.age / 0.7);
  r.bank = damp(r.bank, clamp(r.om * 0.055, -0.2, 0.2) * mv, 5, dt);
  const shake = sg * Math.sin(t * 31 + s), shake2 = sg * Math.sin(t * 23 + s * 2);

  let bx = 0, by = 0, bz = 0, pitch = 0, roll = 0, yaw = 0;
  const body = r.body;
  switch (r.type) {
    case 'grunt': {
      // loping walk: lowest as each foot takes the weight, highest at mid-stance; pelvis yaws with the legs, torso counters
      const b2 = Math.cos(2 * (w - 0.3));
      by = 0.0 - 0.05 * amp * b2 - 0.2 * spawn - 0.03 * fl;
      bx = 0.02 * amp * Math.sin(w + 0.6);
      roll = 0.045 * amp * Math.sin(w + 0.6) - r.bank * 0.6 + shake * 0.06;
      pitch = 0.1 * mv + 0.035 * amp * Math.sin(2 * w) - 0.2 * fl - 0.25 * sg + shake2 * 0.05;
      yaw = 0.12 * amp * Math.sin(w + 1.2);
      if (r.torso) r.torso.rotation.set(0.05 * mv + 0.04 * amp * Math.sin(2 * w + 1) + 0.02 * Math.sin(t * 1.7 + s) - 0.12 * fl, -1.9 * yaw + 0.04 * Math.sin(t * 0.8 + s), -0.6 * roll);
      if (r.head) r.head.rotation.set(-pitch * 0.8 + 0.06 * Math.sin(t * 1.3 + s) + 0.25 * fl, 0.35 * Math.sin(t * 0.9 + s) * (1 - sg) + 0.5 * shake, 0);
      const sw = 0.36 * amp * Math.sin(w + 0.3);
      if (r.armLU) r.armLU.rotation.set(sw - 0.5 * sg + 0.2 * fl, 0, 0.05 * amp);
      if (r.armRU) r.armRU.rotation.set(-sw - 0.5 * sg * Math.sin(t * 9) + 0.2 * fl, 0, -0.05 * amp);
      if (r.armLL) r.armLL.rotation.set(-sw * 0.8 - 0.1 * amp + 0.06 * amp * Math.sin(2 * w), 0, 0);
      if (r.armRL) r.armRL.rotation.set(sw * 0.8 - 0.1 * amp + 0.06 * amp * Math.sin(2 * w + 1), 0, 0);
      break;
    }
    case 'runner': {
      // bounding gallop: hind legs push (cycle 0..), front legs land half a cycle later; the spine rocks
      by = 0.03 + 0.04 * amp * Math.sin(w * 1 - 0.9) + 0.015 * amp * Math.sin(2 * w) - 0.12 * spawn - 0.02 * fl;
      pitch = 0.09 * amp * Math.sin(w + 0.75) + 0.04 * mv - 0.15 * fl - 0.2 * sg + shake2 * 0.07;
      roll = -r.bank * 1.0 + shake * 0.08;                              // leans into the turn
      bz = 0.03 * amp * Math.sin(w + 2.2);
      if (r.head) r.head.rotation.set(-pitch * 0.9 + 0.05 * Math.sin(t * 2.3 + s) + 0.2 * fl, 0.25 * Math.sin(t * 1.1 + s) * (1 - mv * 0.6) + 0.4 * shake + r.bank * 1.5, 0);
      if (r.jaw) r.jaw.rotation.set(0.1 + 0.1 * amp * (0.5 + 0.5 * Math.sin(w + 2)) + 0.25 * sg + 0.3 * fl, 0, 0);
      break;
    }
    case 'brute': {
      // slow stomp: the mass drops onto each planted foot and is heaved over it; shoulders roll against the hips
      const st = Math.sin(w - g.duty * PI + PI / 2);                       // +1 left mid-stance, -1 right
      const drop = Math.pow(Math.abs(Math.cos(w - 0.3)), 2.2);           // sag as each foot takes the weight
      by = 0.02 - 0.075 * amp * drop - 0.3 * spawn - 0.04 * fl;
      bx = 0.09 * amp * st;
      roll = -0.05 * amp * st + r.bank * 0.25 + shake * 0.03;            // heavy: the mass swings out of the turn
      pitch = 0.07 * mv + 0.035 * amp * Math.cos(2 * w - 0.6) - 0.1 * fl - 0.12 * sg + shake2 * 0.03;
      yaw = 0.1 * amp * Math.sin(w + 1.0);
      if (r.torso) r.torso.rotation.set(0.06 + 0.05 * amp * drop + 0.015 * Math.sin(t * 1.1 + s) - 0.08 * fl, -1.7 * yaw, 0.13 * amp * st - roll * 0.5);
      if (r.head) r.head.rotation.set(-0.05 + 0.15 * fl, 0.22 * Math.sin(t * 0.6 + s) * (1 - sg) + 0.9 * yaw + 0.3 * shake, 0);
      const sw = 0.3 * amp * Math.sin(w + 0.5);
      if (r.armLU) r.armLU.rotation.set(sw - 0.35 * sg, 0, 0.05 + 0.05 * amp * st + 0.1 * fl);
      if (r.armRU) r.armRU.rotation.set(-sw - 0.35 * sg, 0, -0.05 + 0.05 * amp * st - 0.1 * fl);
      if (r.armLL) r.armLL.rotation.set(-0.12 * amp - 0.25 * Math.max(0, sw) - 0.5 * sg, 0, 0);
      if (r.armRL) r.armRL.rotation.set(-0.12 * amp - 0.25 * Math.max(0, -sw) - 0.5 * sg * (0.5 + 0.5 * Math.sin(t * 7)), 0, 0);
      break;
    }
    case 'shield': {
      // tripod: one leg at a time; the pod leans away from the lifted leg and dips as it lands
      let lx = 0, lz = 0;
      for (const L of r.legs) { lx += (L.fx - L.hx) * L.lift; lz += (L.fz - L.hz) * L.lift; }
      by = -0.05 - 0.035 * amp * Math.cos(3 * w + 0.6) - 0.25 * spawn - 0.03 * fl;
      bx = -lx * 0.13; bz = -lz * 0.13;
      roll = lx * 0.16 + shake * 0.05; pitch = -lz * 0.16 + 0.03 * mv - 0.1 * fl + shake2 * 0.05;
      if (r.head) r.head.rotation.set(0, 0.9 * Math.sin(t * 0.7 + s) + 0.3 * Math.sin(t * 1.9 + s * 3) + shake, 0);
      break;
    }
    case 'boss': {
      // six-leg wave: the hull rises as each pair takes the weight and settles in between, with a slow sway
      by = -0.12 + 0.07 * amp * Math.sin(3 * w + 0.4) + 0.03 * amp * Math.sin(w) - 0.5 * spawn - 0.05 * fl;
      bx = 0.07 * amp * Math.sin(w + 0.9);
      roll = 0.022 * amp * Math.sin(w + 0.9) + r.bank * 0.15 + shake * 0.015;
      pitch = 0.02 * amp * Math.sin(3 * w + 1.9) + 0.015 - 0.04 * fl + shake2 * 0.015;
      yaw = 0.03 * amp * Math.sin(w + 2.2);
      if (r.head) {
        const want = lookYaw === lookYaw ? clamp(wrap(lookYaw - psi), -1.05, 1.05) : 0.3 * Math.sin(t * 0.4 + s);
        r.look += clamp(want - r.look, -dt * 1.1, dt * 1.1);
        r.head.rotation.set(-pitch + 0.03 * Math.sin(t * 0.9) - 0.06 * fl, r.look - yaw, 0);
      }
      break;
    }
    case 'drone': {
      // hover: nose down with speed, bank into turns, slow bob with a faster rotor shudder
      by = 0.16 * Math.sin(t * 2.0 + s) + 0.05 * Math.sin(t * 4.3 + s * 2) + 1.2 * spawn - 0.12 * fl + 0.1 * shake;
      bx = 0.08 * Math.sin(t * 1.3 + s * 3);
      pitch = 0.13 * mv * (1 - sg) + 0.04 * Math.sin(t * 2.7 + s) - 0.3 * fl - 0.35 * sg;
      roll = -r.bank * 1.8 + 0.05 * Math.sin(t * 1.3 + s * 3 + 1.2) + 0.25 * shake2;
      yaw = 0.05 * Math.sin(t * 0.9 + s);
      if (r.eye) r.eye.rotation.set(0.35 - pitch + 0.2 * Math.sin(t * 1.2 + s), 0.6 * Math.sin(t * 0.8 + s * 2) - r.bank * 2, 0);
      break;
    }
  }
  if (body) { body.position.set(r.bx + bx, r.by + by, r.bz + bz); body.rotation.set(pitch, yaw, roll); QBI.copy(body.quaternion).invert(); }
  C.X = root.position.x; C.Z = root.position.z; C.cs = cs; C.sn = sn; C.sc = sc; C.psi = psi;
  C.vx = r.vx; C.vz = r.vz; C.om = r.om; C.sp = r.speed + Math.abs(r.om) * r.footR; C.spMin = NOMINAL[r.type] * 0.2;
  C.liftAmp = r.walk * (sg > 0.05 ? 0.55 + 0.45 * mv : 1); C.pitch = pitch; C.yaw = yaw; C.init = r.init;
  const legs = r.legs;
  for (let i = 0; i < legs.length; i++) stepLeg(r, legs[i], g);
  r.init = false;
  const spin = dt * (r.type === 'drone' ? 38 : r.type === 'boss' ? 2.5 : 4.5);
  for (let i = 0; i < r.spins.length; i++) r.spins[i].rotateY(i & 1 ? -spin : spin);
}

// ---------- towers ----------
export interface TowerRig {
  type: TowerType; turret: O3 | null; barrels: O3[]; rest: THREE.Vector3[]; axis: THREE.Vector3[]; kick: number[]; next: number;
  cradle: O3 | null; dish: O3 | null; orb: O3 | null; spins: O3[]; glow: THREE.MeshStandardMaterial | null; glow0: number;
  since: number; idle: number; sweep: number; t: number; elev: number; elevTo: number; ty: number; slump: number;
}
/** What the view tells a tower rig each frame beyond the sim's aim. */
export interface TowerState {
  /** true while the tower is offline after a special: it slumps and nothing moves */
  down: boolean;
  /** true while its special runs */
  spec: boolean;
  /** brightness of its lights, 1 = normal */
  power: number;
  /** lance heat 0..1 */
  heat: number;
}
const IDLE_STATE: TowerState = { down: false, spec: false, power: 1, heat: 0 };
const RECOIL: Record<TowerType, { d: number; T: number; pitch: number }> = {
  pulse: { d: 0.16, T: 0.26, pitch: 0.035 }, cryo: { d: 0.07, T: 0.5, pitch: 0.03 }, arc: { d: 0, T: 0.45, pitch: 0 },
  mortar: { d: 0.26, T: 1.1, pitch: 0.11 }, rail: { d: 0.4, T: 1.5, pitch: 0.07 }, beacon: { d: 0, T: 1, pitch: 0 },
  flame: { d: 0.05, T: 0.2, pitch: 0.01 }, lance: { d: 0.03, T: 0.3, pitch: 0 }, missile: { d: 0.2, T: 0.8, pitch: 0.06 }, gravity: { d: 0, T: 1, pitch: 0 }, spire: { d: 0, T: 1, pitch: 0 },
};

export function makeTowerRig(root: O3, type: TowerType): TowerRig {
  const barrels: O3[] = [], spins: O3[] = [];
  root.traverse((o) => { if (o.name.startsWith('spin')) spins.push(o); else if (o.name === 'barrel' || o.name.startsWith('barrel_')) barrels.push(o); });
  barrels.sort((a, b) => (a.name < b.name ? -1 : 1));
  let glow: THREE.MeshStandardMaterial | null = null;
  if ((type === 'rail' || type === 'lance') && barrels[0]) {
    // charge / heat glow of the barrel. The view gives every tower its own copies of the emissive materials before it
    // builds the rig, so this one belongs to this tower alone.
    barrels[0].traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || glow) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if (mat.name.startsWith('glow')) { glow = mat as THREE.MeshStandardMaterial; break; }
    });
  }
  return {
    type, turret: find(root, 'turret'), barrels, rest: barrels.map((b) => b.position.clone()),
    // slide direction in the barrel's parent space: along the bore for the mortar, straight back otherwise
    axis: barrels.map((b) => (type === 'mortar' ? new THREE.Vector3(0, -1, 0).applyQuaternion(b.quaternion) : new THREE.Vector3(0, 0, -1))),
    kick: barrels.map(() => 9), next: 0, cradle: find(root, 'cradle'), dish: find(root, 'dish'), orb: find(root, 'orb'), spins,
    glow, glow0: glow ? (glow as THREE.MeshStandardMaterial).emissiveIntensity : 1,
    since: 9, idle: 0, sweep: Math.random() * 6, t: Math.random() * 10, elev: 0, elevTo: 0, ty: NaN, slump: 0,
  };
}

/** A tower fired. dist = ground distance to the target (mortar elevation), 0 if unknown. */
export function towerShot(r: TowerRig, dist = 0) {
  r.since = 0;
  if (r.barrels.length) { r.kick[r.next] = 0; r.next = (r.next + 1) % r.barrels.length; }
  if (r.type === 'mortar' && dist > 0) r.elevTo = clamp((dist - 7.5) / 9, -0.5, 0.5) * 0.42;
  if (r.type === 'missile') r.elevTo = -0.42;   // pods tip up to launch
}

/** Recoil curve: slams back within ~35 ms, then a slow eased return. */
const recoil = (t: number, T: number) => (t >= T ? 0 : t < 0.035 ? t / 0.035 : 1 - ease((t - 0.035) / (T - 0.035)));

/** @param cd the sim's cooldown for this tower: at or below 0 for a while means "no target", so it idles and sweeps */
export function updateTower(r: TowerRig, yaw: number, cd: number, rate: number, dt: number, st: TowerState = IDLE_STATE) {
  const R = RECOIL[r.type];
  r.t += dt; r.since += dt;
  // offline: the turret sags onto its stops, comes back up when the tower reboots
  r.slump = damp(r.slump, st.down ? 1 : 0, st.down ? 3.5 : 6, dt);
  const sl = r.slump, live = 1 - sl;
  const k = recoil(r.since, R.T);
  for (let i = 0; i < r.barrels.length; i++) {
    r.kick[i] += dt;
    const d = recoil(r.kick[i], R.T) * R.d;
    r.barrels[i].position.copy(r.rest[i]).addScaledVector(r.axis[i], d);
  }
  const tur = r.turret;
  if (tur && r.type !== 'beacon' && r.type !== 'arc' && r.type !== 'gravity' && r.type !== 'spire') {
    const idle = cd < -0.7 && !st.down;
    r.idle = damp(r.idle, idle ? 1 : 0, idle ? 1.2 : 9, dt);
    if (r.idle > 0.001) r.sweep += dt * 0.45;
    if (r.ty !== r.ty) r.ty = tur.position.y;
    // the mortar aims with its cradle, so its turret stays level
    const sag = r.cradle ? 0 : 0.3;
    tur.rotation.set(-k * R.pitch + r.idle * 0.02 * Math.sin(r.sweep * 2.3) + sl * sag, yaw + r.idle * 0.7 * Math.sin(r.sweep), sl * 0.04);
    tur.position.y = r.ty - (r.type === 'mortar' ? 0.05 * recoil(r.since, 0.5) : 0);
  }
  if (r.type === 'missile' && r.since > 1.6) r.elevTo = -0.1;
  if (r.cradle) { r.elev = damp(r.elev, r.elevTo, 4, dt); r.cradle.rotation.x = r.elev + k * R.pitch * 1.2 - r.idle * 0.06 * (1 + Math.sin(r.sweep * 1.3)) + sl * 0.5; }
  if (r.dish) { const s = 1 + 0.16 * recoil(r.since, 0.35) + 0.012 * Math.sin(r.t * 3) * live; r.dish.scale.set(s, s, 1); r.dish.position.z = (r.dish.userData.z0 ??= r.dish.position.z) - k * R.d; }
  if (r.orb) {
    const p = recoil(r.since, R.T);
    if (r.type === 'gravity') {
      // the well's core clenches on every pulse and hangs low while offline
      const s = (1 - 0.32 * p + 0.03 * Math.sin(r.t * 2.1) * live) * (1 - 0.3 * sl) * (st.spec ? 1.25 + 0.1 * Math.sin(r.t * 17) : 1);
      r.orb.scale.set(s, s, s);
      r.orb.rotation.y += dt * (0.8 + 9 * p) * live;
    } else {
      const s = (1 + 0.42 * p + (0.035 * Math.sin(r.t * 5.2) + 0.02 * Math.sin(r.t * 13.7)) * live) * (1 - 0.22 * sl);
      r.orb.scale.set(s, s * (1 - 0.15 * p), s);
      r.orb.rotation.y += dt * (1.5 + 14 * p) * live;
    }
  }
  if (r.glow) {
    if (r.type === 'lance') {
      // the emitter runs from a dull glow to white-hot with the beam's heat
      r.glow.emissiveIntensity = r.glow0 * (0.3 + 2.4 * st.heat * st.heat + (st.spec ? 1.5 + 0.5 * Math.sin(r.t * 30) : 0)) * st.power;
    } else {
      // rail: capacitors glow brighter as the next shot comes up, flash on release, then go dark
      const charge = rate > 0 ? sat(1 - cd * rate) : 0;
      const flash = recoil(r.since, 0.22);
      r.glow.emissiveIntensity = r.glow0 * (0.22 + 1.5 * charge * charge * charge * (cd > -0.7 ? 1 : 0.35) + 3.2 * flash) * (1 + (charge > 0.8 ? 0.12 * Math.sin(r.t * 40) : 0)) * st.power;
    }
  }
  const spin = dt * 2.5 * live * (st.spec ? 4 : 1);
  for (let i = 0; i < r.spins.length; i++) r.spins[i].rotateY(i & 1 ? -spin : spin);
}

// ---------- hero ----------
const XA = new THREE.Vector3(1, 0, 0), YA = new THREE.Vector3(0, 1, 0);
const BXv = new THREE.Vector3(), BYv = new THREE.Vector3(), BZv = new THREE.Vector3();
const QU = new THREE.Quaternion(), QLW = new THREE.Quaternion(), QI = new THREE.Quaternion();
const E = new THREE.Euler();

/** Quaternion whose local +Z looks along `fwd` and local +Y is as close to `up` as possible. */
function basisQ(out: THREE.Quaternion, fwd: THREE.Vector3, up: THREE.Vector3) {
  BZv.copy(fwd).normalize();
  BXv.crossVectors(up, BZv).normalize();
  BYv.crossVectors(BZv, BXv);
  return out.setFromRotationMatrix(M.makeBasis(BXv, BYv, BZv));
}

/**
 * 3-D two-bone IK in the hero's root space. S = root joint, Tg = end target, pole = direction the middle
 * joint points to, Qp = root-space orientation of the upper bone's parent. Leaves the lower bone's
 * root-space orientation in QLW.
 */
function ik3(S: THREE.Vector3, Tg: THREE.Vector3, pole: THREE.Vector3, l1: number, l2: number, Qp: THREE.Quaternion, upper: O3, lower: O3) {
  V5.subVectors(Tg, S);
  const L = V5.length() || 1e-4, Lc = clamp(L, Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.999);
  V5.multiplyScalar(1 / L);                                           // dn
  const cA = clamp((l1 * l1 + Lc * Lc - l2 * l2) / (2 * l1 * Lc), -1, 1), sA = Math.sqrt(1 - cA * cA);
  BZv.copy(pole).addScaledVector(V5, -pole.dot(V5));                  // pole made perpendicular to dn
  if (BZv.lengthSq() < 1e-8) BZv.set(V5.y, V5.z, V5.x).addScaledVector(V5, -BZv.dot(V5));
  BZv.normalize();
  BYv.copy(V5).multiplyScalar(-cA).addScaledVector(BZv, -sA);         // -d1
  BZv.multiplyScalar(cA).addScaledVector(V5, -sA);                    // bone "front" (towards the pole)
  BXv.crossVectors(BYv, BZv);
  QU.setFromRotationMatrix(M.makeBasis(BXv, BYv, BZv));
  upper.quaternion.copy(QI.copy(Qp).invert()).multiply(QU);
  const k = PI - Math.acos(clamp((l1 * l1 + l2 * l2 - Lc * Lc) / (2 * l1 * l2), -1, 1));
  lower.rotation.set(k, 0, 0);
  QLW.copy(QU).multiply(QI.setFromAxisAngle(XA, k));
}

export type HeroEvent = 'arrow' | 'rail' | 'rain' | 'sing' | 'on' | 'off' | 'teleOut' | 'teleIn';
const ACT_NONE = 0, ACT_RAIL = 1, ACT_RAIN = 2, ACT_SING = 3;
/** Arrow Rain looses three shafts this far apart, the first one on SKILL_CAST[1]. */
export const RAIN_GAP = 0.18;
/** Seconds the uplink materialise animation takes (crouch, rise, raise the bow). */
const ON_LEN = 1.0;
/** Stance (root space, model units): front (left) foot, rear (right) foot: x, z, yaw. */
const FOOT = [[0.10, 0.26, -0.14], [-0.13, -0.27, -1.36]];
const TW0 = -1.32, PY0 = -0.75;      // torso and pelvis yaw of the archer's side-on stance
/** A planted foot is left alone until it is this far from where the stance wants it (model units + 0.15 per radian). */
const STEP_AT = 0.2, STEP_SETTLE = 0.05, STEP_DRAG = 0.42;

export interface HeroRig {
  root: O3; pelvis: O3; torso: O3; head: O3;
  aLU: O3; aLL: O3; hL: O3; aRU: O3; aRL: O3; hR: O3;
  lLU: O3; lLL: O3; fL: O3; lRU: O3; lRL: O3; fR: O3;
  bow: O3; sU: O3; sL: O3; arrow: O3; cape: O3[]; quiver: O3 | null;
  pel0: THREE.Vector3; armL1: number; armL2: number; legL1: number; legL2: number; ankle: number;
  bowQi: THREE.Quaternion; hRq: THREE.Quaternion; nock0: THREE.Vector3;
  // state
  t: number; act: number; at: number; fireT: number; fireInt: number; settle: number;
  on: number; tin: number; tout: number; off: number;
  draw: number; hold: number; lastYaw: number; yawV: number; still: number; reset: boolean;
  // smoothed pose parameters
  crouch: number; twist: number; pelYaw: number; aim: number; headAim: number; bowUp: number; lean: number; pelLean: number;
  slide: number; cast: number; thrust: number; follow: number; quiv: number;
  // feet: planted in deck space (world axes, centred on the hero); one may be mid-step
  px: Float32Array; pz: Float32Array; pyaw: Float32Array;
  stepFoot: number; stepU: number; stepDur: number; sx0: number; sz0: number; sy0: number; skid: number;
  capeA: Float32Array; capeV: Float32Array;   // per segment: [pitch, roll]
  capeYaw: number; whip: number; flut: number;
}

export function makeHeroRig(root: O3): HeroRig | null {
  const n = (s: string) => find(root, s);
  const need = ['pelvis', 'torso', 'head', 'arm_l_upper', 'arm_l_lower', 'hand_l', 'arm_r_upper', 'arm_r_lower', 'hand_r',
    'leg_l_upper', 'leg_l_lower', 'leg_l_foot', 'leg_r_upper', 'leg_r_lower', 'leg_r_foot', 'bow', 'string_u', 'string_l', 'arrow'].map(n);
  if (need.some((o) => !o)) return null;      // fallback model: no rig
  const [pelvis, torso, head, aLU, aLL, hL, aRU, aRL, hR, lLU, lLL, fL, lRU, lRL, fR, bow, sU, sL, arrow] = need as O3[];
  const cape = ['cape_1', 'cape_2', 'cape_3'].map(n).filter((o): o is O3 => !!o);
  return {
    root, pelvis, torso, head, aLU, aLL, hL, aRU, aRL, hR, lLU, lLL, fL, lRU, lRL, fR, bow, sU, sL, arrow, cape, quiver: n('quiver'),
    pel0: pelvis.position.clone(), armL1: aLL.position.length(), armL2: hL.position.length(), legL1: lLL.position.length(), legL2: fL.position.length(),
    ankle: relPos(fL, root, new THREE.Vector3()).y,
    bowQi: bow.quaternion.clone().invert(), hRq: hR.quaternion.clone(), nock0: arrow.position.clone(),
    t: 0, act: ACT_NONE, at: 9, fireT: 9, fireInt: 0.18, settle: 9, on: 9, tin: 9, tout: -1, off: -1,
    draw: 0.4, hold: 1, lastYaw: 0, yawV: 0, still: 0, reset: true,
    crouch: 0.04, twist: TW0, pelYaw: PY0, aim: 0, headAim: 0, bowUp: 1, lean: 0, pelLean: 0, slide: 0, cast: 0, thrust: 0, follow: 0, quiv: 0,
    px: new Float32Array(2), pz: new Float32Array(2), pyaw: new Float32Array(2),
    stepFoot: -1, stepU: 0, stepDur: 0.17, sx0: 0, sz0: 0, sy0: 0, skid: 0,
    capeA: new Float32Array(6), capeV: new Float32Array(6), capeYaw: 0, whip: 0, flut: 0,
  };
}

/** A skill lets go of the bow: back to the arrow loop at full draw, ready to loose. */
function endAct(r: HeroRig) { r.act = ACT_NONE; r.fireT = r.fireInt; r.settle = 0; }

/** Back to standing ready, with nothing half-played left over from an earlier match. */
export function resetHero(r: HeroRig) {
  r.on = 9; r.tin = 9; r.off = -1; r.tout = -1; r.act = ACT_NONE; r.fireT = 9; r.reset = true; r.root.visible = true;
}

export function heroTrigger(r: HeroRig, ev: HeroEvent) {
  switch (ev) {
    case 'arrow':
      if (r.act !== ACT_NONE) endAct(r);
      else if (r.fireT < 0.6) r.fireInt = clamp(r.fireInt + (r.fireT - r.fireInt) * 0.5, 0.07, 0.5);
      r.fireT = 0; r.flut = 1;
      if (r.on < ON_LEN) r.on = Math.max(r.on, ON_LEN - 0.08);        // shooting already: snap up out of the crouch
      break;
    case 'rail': r.act = ACT_RAIL; r.at = 0; r.skid = 0; break;
    case 'rain': r.act = ACT_RAIN; r.at = 0; break;
    case 'sing': r.act = ACT_SING; r.at = 0; break;
    case 'on': r.on = 0; r.off = -1; r.tout = -1; r.act = ACT_NONE; r.fireT = 9; r.bowUp = 0; r.crouch = 0.45; r.draw = 0; r.capeA.fill(0); r.capeV.fill(0); r.capeYaw = 0; r.reset = true; break;
    case 'off': r.off = 0; break;
    case 'teleOut': r.tout = 0; break;
    case 'teleIn': r.tin = 0; r.tout = -1; r.whip += 0.35; r.reset = true; break;
  }
}

const P1 = new THREE.Vector3(), P2 = new THREE.Vector3(), P3 = new THREE.Vector3(), AIMV = new THREE.Vector3(), GRIP = new THREE.Vector3(), NOCK = new THREE.Vector3(), POLE = new THREE.Vector3();
const ANCH = new THREE.Vector3(), HP = new THREE.Vector3();
const QP = new THREE.Quaternion(), QT = new THREE.Quaternion(), QB = new THREE.Quaternion(), QH = new THREE.Quaternion(), QB2 = new THREE.Quaternion(), QHD = new THREE.Quaternion();
const WX = [0, 0], WZ = [0, 0], WY = [0, 0], RX = [0, 0], RZ = [0, 0], RY = [0, 0], LIFT = [0, 0];

/**
 * Advance the hero rig. yaw / pitch = look angles (the caller sets root.rotation.y = yaw);
 * baseScale = the hero's world scale (the rig multiplies its squash / materialise scale into root.scale).
 * Returns false once an 'off' animation has finished (the caller hides the hero).
 */
export function updateHero(r: HeroRig, yaw: number, pitch: number, dt: number, baseScale: number): boolean {
  const t = (r.t += dt);
  r.at += dt; r.fireT += dt; r.on += dt; r.tin += dt; r.settle += dt;
  if (r.tout >= 0) r.tout += dt;
  if (r.off >= 0) r.off += dt;
  if (r.reset) { r.lastYaw = yaw; r.yawV = 0; }                        // appeared somewhere else: no turn happened
  if (dt > 0) r.yawV = damp(r.yawV, wrap(yaw - r.lastYaw) / dt, 12, dt);
  r.lastYaw = yaw;
  r.still = Math.abs(r.yawV) < 0.4 ? r.still + dt : 0;
  if (r.act !== ACT_NONE && r.at >= SKILL_LOCK[r.act - 1]) endAct(r);

  // targets for the pose parameters
  let crouch = 0.04 + 0.006 * Math.sin(t * 1.8), twist = TW0 + 0.02 * Math.sin(t * 0.9), pelYaw = PY0, aim = pitch, headAim = pitch;
  let bowUp = 1, lean = 0, pelLean = 0, slide = 0, cast = 0, thrust = 0, follow = 0, quiv = 0, bowRoll = 0, dip = 0, skid = 0, push = 0, noStep = false;
  let draw = r.draw, hold = 1, arrowOn = true, kick = 0, tremble = 0, vib = 0, rate = 9 + 13 * sat(r.settle / 0.3);
  const at = r.at;
  if (r.act === ACT_NONE) {
    // arrow volley: release, string snaps, hand follows through, re-nock, draw; timed to the measured fire interval.
    // A fast volley shortens the stroke instead of strobing the arm: short snap draws near the anchor.
    const T = r.fireInt, ft = r.fireT, u = ft / T, fast = sat((0.15 - T) / 0.06), dmin = (T < 0.3 ? 0.34 : 0.1) + 0.36 * fast;
    if (ft < 0.03) draw = 1 + (dmin - 1) * (ft / 0.03);
    else if (u < 0.3) draw = dmin;
    else if (u < 0.95) draw = dmin + (1 - dmin) * ease((u - 0.3) / 0.65);
    else if (ft < T + 0.45) draw = 1;
    else draw = 1 - 0.55 * ease((ft - T - 0.45) / 0.5);
    hold = Math.max(sat((u - 0.12) / 0.18), fast);
    arrowOn = u > 0.3 - 0.12 * fast;
    kick = Math.exp(-ft * 16);
    vib = Math.sin(ft * 110) * Math.exp(-ft * 20);
    follow = kick * (1 - fast);
    // the body works with every shot: settles onto the rear leg through the draw, the release unwinds the torso,
    // dips the bow shoulder and rocks the hips forward
    twist += (0.2 + 0.1 * fast) * kick - 0.06 * (draw - 0.4);
    dip = 0.07 * kick; bowRoll = 0.22 * kick;
    crouch += 0.014 * draw + 0.016 * kick; slide = -0.022 * draw + 0.03 * kick;
    lean = -0.02 * draw + 0.03 * kick;
  } else if (r.act === ACT_RAIL) {
    // rail shot: overdraw and brace, loose on the beat, the recoil throws her back (rear foot skids, front leg
    // straightens), the draw hand flies back along the arrow line, then quiver, nock, draw
    const s = at - SKILL_CAST[0];
    rate = 34;
    if (s < 0) { draw = 1.22; tremble = 1; crouch = 0.12; twist = TW0 - 0.14; lean = -0.04; noStep = true; }
    else {
      const k2 = Math.exp(-s * 5);
      kick = Math.exp(-s * 7) * 3.2; vib = Math.sin(s * 80) * Math.exp(-s * 7) * 2.5;
      draw = s < 0.03 ? 1.22 - 1.17 * (s / 0.03) : 0.05 + 0.95 * ease((s - 0.37) / 0.14);
      hold = sat((s - 0.33) / 0.04); arrowOn = s > 0.35;
      follow = ease(s / 0.05) * (1 - ease((s - 0.14) / 0.1));
      quiv = ease((s - 0.14) / 0.1) * (1 - ease((s - 0.26) / 0.08));
      bowRoll = 0.6 * ease(s / 0.05) * Math.exp(-s * 6);
      skid = 0.2 * ease(s / 0.12); noStep = s < 0.24;
      slide = -0.12 * ease(s / 0.12) * (1 - ease((s - 0.26) / 0.24));
      crouch = 0.12 + 0.07 * k2; lean = -0.22 * k2; aim = pitch + 0.3 * Math.exp(-s * 6); headAim = pitch + 0.1 * k2;
      twist = TW0 - 0.14 + 0.5 * k2; tremble = 0.5 * Math.exp(-s * 3); dip = 0.1 * k2;
    }
  } else if (r.act === ACT_RAIN) {
    // arrow rain: the head leads, hips forward and a backbend shared by pelvis and torso, three shafts loosed at the
    // sky (quiver, nock, draw, loose each time), then back down
    const R0 = SKILL_CAST[1], G = RAIN_GAP, end = R0 + 2 * G;
    const w = ease(at / 0.2) * (1 - ease((at - end - 0.06) / 0.16));
    rate = 26; aim = pitch + (1.12 - pitch) * w; headAim = pitch + (1.25 - pitch) * ease(at / 0.12) * (1 - ease((at - end - 0.02) / 0.14));
    lean = -0.1 * w; pelLean = -0.24 * w; slide = 0.07 * w; crouch = 0.04 + 0.08 * w; twist = TW0 - 0.08 * w;
    const i = at < R0 ? -1 : Math.min(2, Math.floor((at - R0) / G)), s = at - R0 - i * G;
    if (i < 0) { draw = 0.3 + 0.75 * ease((at - 0.03) / 0.19); hold = 1; }
    else {
      const k1 = Math.exp(-s * 14);
      kick = k1 * 1.7; vib = Math.sin(s * 100) * Math.exp(-s * 16);
      lean += 0.06 * k1; dip = 0.07 * k1; bowRoll = 0.25 * k1; twist += 0.14 * k1;
      if (i < 2) {
        draw = s < 0.025 ? 1 - 0.85 * (s / 0.025) : 0.15 + 0.85 * ease((s - 0.1) / 0.07);
        hold = sat((s - 0.085) / 0.02); arrowOn = s > 0.095; quiv = Math.sin(PI * sat(s / 0.095));
      } else {
        draw = s < 0.025 ? 1 - 0.85 * (s / 0.025) : 0.15 + 0.85 * ease((s - 0.17) / 0.07);
        hold = sat((s - 0.15) / 0.03); arrowOn = s > 0.17; follow = ease(s / 0.05) * (1 - ease((s - 0.08) / 0.08));
      }
    }
  } else {
    // singularity: drop the bow to the side, square up, gather the free hand at the hip, thrust it at the target on
    // the beat and keep pushing through the hold; then back to the string
    const REL = SKILL_CAST[2];
    const w = ease(at / 0.14) * (1 - ease((at - 0.42) / 0.18));
    push = sat((at - REL) / 0.24);
    rate = 24; bowUp = 1 - 0.8 * w; twist = TW0 + 1.5 * w; pelYaw = PY0 + 0.7 * w; cast = w;
    thrust = ease((at - 0.07) / (REL - 0.07));
    crouch = 0.04 + 0.09 * w + 0.02 * push * w; lean = (0.1 + 0.1 * push) * w; slide = 0.03 * push * w;
    draw = 0.1 + 0.9 * ease((at - 0.54) / 0.08); hold = sat((at - 0.5) / 0.04); arrowOn = at > 0.53; tremble = 0.6 * w;
  }
  // uplink materialise / teleport / uplink end: crouch + mild squash + flicker
  let sx = 1, sy = 1, flick = 0;
  if (r.on < ON_LEN) {
    const u = r.on;
    crouch += 0.42 * (1 - ease((u - 0.3) / 0.5)); bowUp *= ease((u - 0.6) / 0.35); lean += 0.3 * (1 - ease((u - 0.25) / 0.45));
    draw = Math.min(draw, 0.15 + 0.85 * ease((u - 0.85) / 0.15)); hold = 0; arrowOn = u > 0.85;
    sy = 0.6 + 0.4 * ease(u / 0.25); sx = 1.12 - 0.12 * ease(u / 0.3); flick = 0.6 * (1 - sat(u / 0.3)); rate = 40;
  }
  if (r.tin < 0.6) {
    const u = r.tin, land = Math.sin(PI * sat((u - 0.05) / 0.5));
    sy *= 1 + 0.25 * (1 - ease(u / 0.16)); sx *= 1 - 0.25 * (1 - ease(u / 0.14));
    crouch += 0.2 * land; lean += 0.1 * land; flick = Math.max(flick, 0.6 * (1 - sat(u / 0.1))); rate = 40;
  }
  if (r.tout >= 0) { const u = sat(r.tout / 0.13); sy *= 1 + 0.3 * u * u; sx *= 1 - 0.4 * u; crouch += 0.22 * (1 - u); flick = Math.max(flick, u * 0.7); rate = 40; }
  if (r.off >= 0) { const u = sat(r.off / 0.4); crouch += 0.3 * ease(u * 1.5); bowUp *= 1 - ease(u * 2); lean += 0.2 * u; sy *= 1 + 0.3 * u * u; sx *= 1 - 0.4 * u * u; flick = Math.max(flick, u); draw = 0.1; hold = 0; }
  r.root.scale.set(baseScale * sx, baseScale * sy, baseScale * sx);
  // dissolve: more and more frames drop out
  r.root.visible = !(flick > 0 && frac(Math.sin(Math.floor(t * 45) * 12.9898) * 43758.5453) < flick);

  const k = 1 - Math.exp(-rate * dt), kf = 1 - Math.exp(-40 * dt);
  r.crouch += (crouch - r.crouch) * k; r.twist += (twist - r.twist) * k; r.pelYaw += (pelYaw - r.pelYaw) * k; r.aim += (aim - r.aim) * k;
  r.headAim += (headAim - r.headAim) * k; r.bowUp += (bowUp - r.bowUp) * k; r.lean += (lean - r.lean) * k; r.pelLean += (pelLean - r.pelLean) * k;
  r.slide += (slide - r.slide) * k; r.cast += (cast - r.cast) * k;
  r.thrust += (thrust - r.thrust) * kf; r.follow += (follow - r.follow) * kf; r.quiv += (quiv - r.quiv) * kf;
  r.draw += (draw - r.draw) * (1 - Math.exp(-70 * dt)); r.hold += (hold - r.hold) * (1 - Math.exp(-45 * dt));
  const D = r.draw, up = r.bowUp, ap = r.aim, cst = r.cast;
  const tr = tremble * 0.006, trx = tr * Math.sin(t * 97), try_ = tr * Math.sin(t * 83 + 1);

  // feet: planted on the deck; they step (one at a time, rear first) when the stance has turned away from them
  const cy = Math.cos(yaw), sn = Math.sin(yaw);
  for (let i = 0; i < 2; i++) {
    const F = FOOT[i];
    WX[i] = F[0] * cy + F[1] * sn; WZ[i] = -F[0] * sn + F[1] * cy; WY[i] = yaw + F[2] + (i ? 0 : 0.5 * cst);
    if (r.reset) { r.px[i] = WX[i]; r.pz[i] = WZ[i]; r.pyaw[i] = WY[i]; r.stepFoot = -1; }
    LIFT[i] = 0;
  }
  if (skid > r.skid) { const d = skid - r.skid; r.px[1] -= sn * d; r.pz[1] -= cy * d; }   // recoil: the rear foot skids straight back
  r.skid = skid;
  let stepLift = 0;
  if (r.stepFoot >= 0) {
    const i = r.stepFoot;
    r.stepU += dt / r.stepDur;
    const u = Math.min(1, r.stepU), e = ease(u);
    r.px[i] = r.sx0 + (WX[i] - r.sx0) * e; r.pz[i] = r.sz0 + (WZ[i] - r.sz0) * e; r.pyaw[i] = r.sy0 + wrap(WY[i] - r.sy0) * e;
    LIFT[i] = stepLift = Math.sin(PI * u);
    if (u >= 1) r.stepFoot = -1;
  } else if (!noStep && r.on > 0.3) {
    let best = -1, bm = 0;
    for (let i = 1; i >= 0; i--) {
      const m = Math.hypot(WX[i] - r.px[i], WZ[i] - r.pz[i]) + 0.15 * Math.abs(wrap(WY[i] - r.pyaw[i]));
      if (m > bm + 1e-4) { bm = m; best = i; }
    }
    if (best >= 0 && (bm > STEP_AT || (r.still > 0.22 && bm > STEP_SETTLE))) {
      r.stepFoot = best; r.stepU = 0; r.stepDur = Math.abs(r.yawV) > 2.2 ? 0.12 : 0.18;
      r.sx0 = r.px[best]; r.sz0 = r.pz[best]; r.sy0 = r.pyaw[best];
    }
  }
  let lag = 0;
  for (let i = 0; i < 2; i++) {
    if (i !== r.stepFoot) { // a foot left too far behind (fast spin) is dragged along
      const m = Math.hypot(WX[i] - r.px[i], WZ[i] - r.pz[i]) + 0.15 * Math.abs(wrap(WY[i] - r.pyaw[i]));
      if (m > STEP_DRAG) { const q = 1 - STEP_DRAG / m; r.px[i] += (WX[i] - r.px[i]) * q; r.pz[i] += (WZ[i] - r.pz[i]) * q; r.pyaw[i] += wrap(WY[i] - r.pyaw[i]) * q; }
    }
    RX[i] = r.px[i] * cy - r.pz[i] * sn; RZ[i] = r.px[i] * sn + r.pz[i] * cy; RY[i] = wrap(r.pyaw[i] - yaw);
    lag += wrap(r.pyaw[i] - WY[i]) * 0.5;
  }
  // weight goes over the supporting foot while the other one is in the air
  const sup = r.stepFoot >= 0 ? 1 - r.stepFoot : -1;
  const shx = sup >= 0 ? 0.22 * RX[sup] * stepLift : 0, shz = sup >= 0 ? 0.22 * RZ[sup] * stepLift : 0;

  // pelvis / torso / head (root space)
  const sway = 0.008 * Math.sin(t * 0.7);
  r.pelvis.position.set(r.pel0.x - 0.012 + sway + shx, r.pel0.y - r.crouch - 0.012 * stepLift, r.pel0.z - 0.02 + r.slide + 0.07 * cst + shz);
  // the hips stay between the feet: they follow a turn only half way until the feet have stepped round
  QP.setFromEuler(E.set(r.lean * 0.35 + r.pelLean, r.pelYaw + 0.5 * lag, 0, 'XYZ'));
  r.pelvis.quaternion.copy(QP);
  // the whole upper body pitches with the aim (about the root's X axis, not the twisted torso's)
  QT.setFromEuler(E.set(-ap * 0.42 + r.lean + r.pelLean * 0.6, 0, 0)).multiply(Q.setFromEuler(E.set(0, r.twist, 0.03 + 0.05 * D * up + dip)));
  r.torso.quaternion.copy(QI.copy(QP).invert()).multiply(QT);
  QHD.setFromEuler(E.set(-r.headAim * 0.75, 0.1 * up - 0.1 * cst, -0.06 * up));
  r.head.quaternion.copy(QI.copy(QT).invert()).multiply(QHD);
  P1.copy(r.torso.position).applyQuaternion(QP).add(r.pelvis.position);          // torso origin, root space
  HP.copy(r.head.position).applyQuaternion(QT).add(P1);                           // head joint, root space
  // anchor: the corner of the jaw on the draw side. The arrow line runs through it, outside the face.
  ANCH.set(-0.112, 0.075, 0.03).applyQuaternion(QHD).add(HP);

  // bow arm
  const n0 = r.nock0;
  AIMV.set(0, Math.sin(ap), Math.cos(ap));
  basisQ(QB, AIMV, V.set(-0.14, 1, 0));                                           // aimed, slightly canted
  P2.copy(r.aLU.position).applyQuaternion(QT).add(P1);                            // left shoulder
  // the grip sits on the line through the anchor, as far out as the (all but straight) bow arm reaches
  V.set(n0.x, n0.y, 0).applyQuaternion(QB);
  V2.copy(ANCH).sub(V).sub(P2);
  const reach = 0.5 + 0.03 * D, bq = V2.dot(AIMV), sg = -bq + Math.sqrt(Math.max(bq * bq - V2.lengthSq() + reach * reach, 0.01));
  const drawLen = clamp(sg + n0.z, 0.3, 0.62);                                    // nock travel from brace to the anchor
  GRIP.copy(P2).add(V2).addScaledVector(AIMV, sg);
  const gk = Math.min(kick, 1.8);
  GRIP.x += trx; GRIP.y += 0.028 * gk + try_; GRIP.z -= 0.034 * gk;
  V.set(0.25, r.pel0.y + 0.03 - r.crouch, 0.24 + r.slide);                        // lowered: at the left hip
  GRIP.lerp(V, 1 - up);
  basisQ(QB2, V.set(0.3, -0.5, 0.8), V2.set(0.45, 1, 0.2));                       // lowered
  QB.slerp(QB2, 1 - up);
  if (bowRoll > 1e-4) QB.multiply(Q.setFromAxisAngle(XA, bowRoll));               // the bow rolls forward in the open grip
  QH.copy(QB).multiply(r.bowQi);                                                  // bow hand, root space
  V.copy(r.bow.position).applyQuaternion(QH);
  P3.copy(GRIP).sub(V);                                                           // wrist target
  ik3(P2, P3, POLE.set(0.5, -1, -0.5), r.armL1, r.armL2, QT, r.aLU, r.aLL);
  r.hL.quaternion.copy(QI.copy(QLW).invert()).multiply(QH);

  // string, arrow
  const nz = n0.z - D * drawLen, nx = n0.x + vib * 0.018;
  for (let i = 0; i < 2; i++) {
    const s = i ? r.sL : r.sU;
    V.set(nx - s.position.x, n0.y - s.position.y, nz - s.position.z);
    const len = V.length();
    s.quaternion.setFromUnitVectors(YA, V.multiplyScalar(1 / len));
    s.scale.set(1, len, 1);
  }
  r.arrow.visible = arrowOn;
  r.arrow.position.set(n0.x, n0.y, nz);
  NOCK.set(n0.x, n0.y, nz).applyQuaternion(QB).add(GRIP);                         // nock, root space

  // draw arm
  P2.copy(r.aRU.position).applyQuaternion(QT).add(P1);                            // right shoulder
  // released: the hand travels straight back along the arrow line and opens away from the face
  V.copy(ANCH).addScaledVector(AIMV, -0.03 - 0.2 * r.follow);
  V.x -= 0.02 + 0.07 * r.follow; V.y -= 0.03 * r.follow;
  V.lerp(V2.set(-0.25, r.pel0.y - 0.02 - r.crouch, 0.02), 1 - up);                // bow lowered: the hand hangs at the hip
  P3.copy(V).lerp(NOCK, r.hold);
  P3.addScaledVector(AIMV, -0.06); P3.x -= 0.035;                                  // wrist sits behind the hooked fingers
  if (r.quiv > 0.001) P3.lerp(V.set(-0.04, 0.53, -0.17).applyQuaternion(QT).add(P1), r.quiv);   // over the shoulder to the quiver
  if (cst > 0.001) { // cast: gathered at the hip, then thrust straight at the target from the shoulder
    const ext = (r.armL1 + r.armL2) * (0.86 + 0.1 * push);
    V.set(-0.03 + trx * 2, Math.sin(pitch) * ext + try_ * 2, Math.cos(pitch) * ext).add(P2);
    V2.set(-0.27, r.pel0.y - r.crouch + 0.1, -0.06).lerp(V, r.thrust);
    P3.lerp(V2, cst);
  }
  POLE.set(-1, -0.15 - 0.8 * cst + 1.0 * r.quiv, -0.5);
  ik3(P2, P3, POLE, r.armL1, r.armL2, QT, r.aRU, r.aRL);
  r.hR.quaternion.copy(r.hRq);

  // legs
  for (let i = 0; i < 2; i++) {
    const up1 = i ? r.lRU : r.lLU, lo = i ? r.lRL : r.lLL, ft = i ? r.fR : r.fL;
    P2.copy(up1.position).applyQuaternion(QP).add(r.pelvis.position);              // hip
    P3.set(RX[i], r.ankle + 0.055 * LIFT[i], RZ[i]);
    const fy = RY[i], ka = fy * 0.6 + (r.pelYaw + 0.5 * lag) * 0.4;
    POLE.set(Math.sin(ka), 0.1, Math.cos(ka));
    ik3(P2, P3, POLE, r.legL1, r.legL2, QP, up1, lo);
    ft.quaternion.copy(QI.copy(QLW).invert()).multiply(Q.setFromEuler(E.set(0.35 * LIFT[i], fy, 0, 'YXZ')));
  }

  // cape + quiver: damped springs dragged by turning and recoil, a light wind; it curls, it never planks
  const A = r.capeA, Vv = r.capeV, h = Math.min(dt, 1 / 30);
  const wind = Math.sin(t * 1.3) + 0.6 * Math.sin(t * 2.9 + 1);
  const yv = clamp(r.yawV, -3, 3), whip = r.whip, flut = r.flut;
  r.whip = 0; r.flut = 0;
  const nC = r.cape.length;
  for (let i = 0; i < nC; i++) {
    const kS = 46 - 11 * i, c = 9.5 - 0.8 * i, gain = 1 + 0.7 * i;
    // pitch: lean compensation keeps it hanging plumb; roll: flares outward (negative) when turning or whipped
    const tx = (i === 0 ? (ap * 0.42 - r.lean - r.pelLean * 0.6) * 0.5 : 0) + 0.035 * wind * gain;
    const tz = -0.04 * gain - 0.02 * (wind + 1) * gain - Math.min(0.14, Math.abs(yv) * 0.045) * gain;
    Vv[i * 2] += ((tx - A[i * 2]) * kS - Vv[i * 2] * c + yv * 0.5 * gain) * h + (i === nC - 1 ? flut * 0.45 : 0);
    Vv[i * 2 + 1] += ((tz - A[i * 2 + 1]) * kS - Vv[i * 2 + 1] * c) * h - whip * (2.2 + 1.2 * i);
    const lp = 0.22 + 0.13 * i, lr = 0.18 + 0.1 * i;                       // stiff at the shoulder, looser towards the hem
    A[i * 2] = clamp(A[i * 2] + Vv[i * 2] * h, -lp, lp);
    A[i * 2 + 1] = clamp(A[i * 2 + 1] + Vv[i * 2 + 1] * h, -lr, 0.06);
    if (Math.abs(A[i * 2]) >= lp) Vv[i * 2] *= 0.5;
    if (A[i * 2 + 1] <= -lr) Vv[i * 2 + 1] *= 0.5;
    r.cape[i].rotation.set(A[i * 2], 0, A[i * 2 + 1]);
  }
  // when the torso squares up (singularity) the cape stays behind her instead of swinging round with the shoulders
  r.capeYaw = damp(r.capeYaw, -(r.twist - TW0) * 0.8, 16, dt);
  if (nC) r.cape[0].rotation.y = r.capeYaw;
  if (r.quiver) r.quiver.rotation.set(A[0] * 0.25, 0, A[1] * 0.2 + 0.04 * Math.min(kick, 1.5));
  r.reset = false;
  return !(r.off >= 0.4);
}
