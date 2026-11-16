// Procedural animation for BEATSPIRE's rigid-jointed models (no glTF clips, no skinning).
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
//                            id = l | r (bipeds), fl | fr | hl | hr (runner), 1..3 (tripod), 1..4 (boss:
//                            1 left front, 2 left rear, 3 right front, 4 right rear).
//   leg_<id>                 radial legs only (tripod, boss): yaw root at the hip whose FRONT (+Z) points
//                            away from the body; the leg chain below it flexes about local X like any other.
//   spin_<n>                 free-spinning parts (rotors, projector ring, reactor ring, gyros): spin about local Y.
//   rim                      Gyre only: the big wheel, pivot at its centre; it rolls about its local X (+ = forward).
//                            Its hub is the body node (pivot at the wheel centre too), which stays upright.
//   cell_<n>                 Broodcarrier only: launch cell lids, joints on their outer edge; they open about local Z.
//                            Its six legs are leg_1..6 (1-3 left front to rear, 4-6 right front to rear).
//   neck_1 > neck_2 > head   Titan only. The head's pivot is its eye (weak_1), so the eye stays where the game tests it.
//                            Its legs are leg_1..4 like the Colossus'; weak_3 / weak_4 are its hip hubs, weak_2 its reactor.
//   body, eye, legs_a, legs_b   Mite: no rig. The view draws mites instanced and swings the two leg sets itself.
//
// Towers  (root = tower_<type>)
//   base, turret             turret yaws about Y (not arc / beacon).
//   barrel | barrel_1, barrel_2   child of turret (pulse: twin, rail: rails); recoils along turret -Z.
//   cradle > barrel          mortar: cradle pitches about X at the trunnion (elevation), the barrel slides
//                            along its own bore (local +Y of the barrel node).
//   dish                     cryo nozzle, child of turret: recoil along -Z + scale pulse.
//   orb                      arc pylon discharge sphere, child of turret: scale pulse.
//   spin_<n>                 beacon mast, gravity rings.
//   barrel (lance emitter), barrel_1.. (missile pods): same recoil rule as above.
//   turret                   Firewall Pylon: the head with the four emitter fins; the view turns it along its wall.
//   orb                      gravity well core: contracts on every pulse.
//   node                     optional power node (it shows the special's charge). The view lights it
//                            by charge; without it the view draws its own emblem above the tower.
//   lvl2, lvl3               optional groups shown from tower level 2 / 3 (also lvl2_<x>, lvl3_<x>).
//   weak_<n>                 enemies (brute, boss, titan): glowing parts with lights of their own.
// ----
//
// API:  makeEnemyRig / resetEnemy / updateEnemy,  makeTowerRig / updateTower / towerShot,
//       Rigs cache every joint once; updates allocate nothing.
import * as THREE from 'three';
import type { EnemyType, TowerType } from './data.ts';
/** Every enemy the view can draw: the game's own list plus the machines this module already knows how to move. */
export type ET = EnemyType | 'brood' | 'mite' | 'titan';

const PI = Math.PI, TAU = PI * 2;
const V = new THREE.Vector3();
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
  tx: number; tz: number;                  // world spot the swing is heading for (rigs with a snap callback)
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
    down: false, wx: 0, wz: 0, wyaw: 0, sx: T.x, sz: T.z, tx: 0, tz: 0,
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
  shape?: number;   // where the swing peaks: below 1 early (a quick snatch), above 1 late (a slow heave, then the foot comes down hard)
  curve?: number;   // 0..1: in a bend the footfalls follow the curve of the road (EnemyRig.roadF / roadR) instead of the machine's own tangent
}

/** Per-update context shared by all legs of one rig. */
const C = { X: 0, Y: 0, Z: 0, cs: 1, sn: 0, sc: 1, psi: 0, vx: 0, vz: 0, om: 0, sp: 0, spMin: 1, liftAmp: 1, pitch: 0, yaw: 0, init: false };
const QBI = new THREE.Quaternion(), QC = new THREE.Quaternion(), QD = new THREE.Quaternion(), EU = new THREE.Euler();
const SN = { x: 0, z: 0 };
/** How far a leaping machine pulls its feet up under itself (model units). */
const AIR_TUCK = 3.2;

function stepLeg(r: EnemyRig, L: Leg, G: Gait) {
  const p = frac(r.cyc + L.ph), nz = L.fz;
  // a long machine in a bend: the road ahead of it and behind it lies to the inside of where its nose points. Feet that
  // reach that far are set down either side of the road itself (the view says where it runs), so they stay on it.
  const nx = L.fx + (G.curve ? (nz > 0 ? r.roadF : r.roadR) * G.curve : 0);
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
    if (r.snap && L.down) { r.snap(L.wx, L.wz, SN); L.wx = SN.x; L.wz = SN.z; }
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
      if (r.snap) { // it comes down on the spot it picked when it lifted
        dx = (L.tx - C.X) / C.sc; dz = (L.tz - C.Z) / C.sc;
        ax = dx * C.cs - dz * C.sn; az = dx * C.sn + dz * C.cs;
      }
      L.wx = C.X + (ax * C.cs + az * C.sn) * C.sc; L.wz = C.Z + (-ax * C.sn + az * C.cs) * C.sc;
      if (r.steps && r.air <= 0) r.steps.push(L.wx, L.wz);
    }
    const u = p / G.duty;
    lx = ax; lz = az;
    toe = u > 0.8 ? (u - 0.8) * 5 * 0.35 : 0;
    yawF = clamp(wrap(L.wyaw - C.psi), -0.6, 0.6);
    roll = 1 - 2 * u;
  } else {
    const u = (p - G.duty) / (1 - G.duty), e = ease(u);
    // landing point: half a stride ahead of neutral at touchdown; until then it recedes at ground speed, so the
    // foot leaves and meets the ground without sliding
    const rem = (1 - u) * (1 - G.duty) * (G.stride / G.duty) / den;
    let tx = nx + ox + vnx * rem, tz = nz + oz + vnz * rem;
    if (r.snap) {
      // a machine that picks its footing: the spot is chosen once, in the world, as the foot lifts (the view may move it
      // onto a free tile), and the swing goes there whatever the body does meanwhile
      if (L.down || C.init) { r.snap(C.X + (tx * C.cs + tz * C.sn) * C.sc, C.Z + (-tx * C.sn + tz * C.cs) * C.sc, SN); L.tx = SN.x; L.tz = SN.z; }
      dx = (L.tx - C.X) / C.sc; dz = (L.tz - C.Z) / C.sc;
      tx = dx * C.cs - dz * C.sn; tz = dx * C.sn + dz * C.cs;
      const td = Math.hypot(tx - nx, tz - nz), tmax = leash * 1.15;
      if (td > tmax) { tx = nx + (tx - nx) * tmax / td; tz = nz + (tz - nz) * tmax / td; }
    }
    L.down = false;
    lx = ax + (tx - ax) * e; lz = az + (tz - az) * e;
    lift = Math.sin(PI * Math.pow(u, G.shape || 0.8)) * C.liftAmp;
    toe = (1 - u) * (1 - u) * (0.35 + 0.65 * Math.sin(PI * u)) - 0.25 * Math.sin(PI * u) * u;
    yawF = clamp(wrap(L.wyaw - C.psi), -0.6, 0.6) * (1 - e);
    roll = 2 * e - 1;
  }
  // in the air (a leap): the legs fold up under the hull, feet off the ground
  const air = r.air;
  if (air > 0) { lx += (nx * 0.7 - lx) * air; lz += (nz * 0.7 - lz) * air; L.wx = C.X + (lx * C.cs + lz * C.sn) * C.sc; L.wz = C.Z + (-lx * C.sn + lz * C.cs) * C.sc; }
  L.sx = lx; L.sz = lz; L.lift = lift;
  // the ground under this foot, where the view knows it (terraces, raised roads)
  const gy = r.ground ? (r.ground(C.X + (lx * C.cs + lz * C.sn) * C.sc, C.Z + (-lx * C.sn + lz * C.cs) * C.sc) - C.Y) / C.sc * (1 - air) : 0;
  // foot target relative to the hip, in the body's own frame (exact for any body pitch / roll / yaw)
  const body = r.body;
  V.set(lx, L.toeH + lift * G.lift + gy + air * AIR_TUCK, lz);
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
/**
 * Where the Colossus plants its feet: [distance from its centre line, distance ahead of the hip] for the front and the rear
 * pair (model units). The road is one tile wide with towers on both sides, so the legs reach along it, not across it:
 * the feet land just inside the road's edge, a little outside the hips, front pair ahead and rear pair behind, knees high.
 */
const BOSS_FEET = [[0.86, 1.22], [0.86, -1.18]];
/** How far ahead of and behind its centre the Colossus sets its feet down (model units): where the view samples the road for EnemyRig.roadF / roadR. */
export const BOSS_REACH = 2.0;
/** Radius of the Gyre's wheel (model units): the rim turns by distance / WHEEL_R. */
const WHEEL_R = 1.1;
const GAITS: Record<ET, Gait> = {
  grunt: { stride: 0.85, duty: 0.5, lift: 0.16, toe: 0.9, meta: 0.5, roll: 0.32, ph: [0, 0.5] },
  runner: { stride: 0.62, duty: 0.38, lift: 0.09, toe: 0.7, meta: 0, roll: 0, ph: [0.5, 0.0, 0.62, 0.1] },      // fl hl fr hr: bounding gallop
  brute: { stride: 1.0, duty: 0.62, lift: 0.2, toe: 0.4, meta: 0, roll: 0, ph: [0, 0.5] },
  shield: { stride: 0.8, duty: 0.67, lift: 0.2, toe: 0.3, meta: 0, roll: 0, ph: [0, 1 / 3, 2 / 3] },
  // a walk, one foot at a time: left rear, left front, right rear, right front. Each is down for more than three quarters
  // of the cycle, so the swings never overlap and all four feet carry the hull for a moment between them
  boss: { stride: 1.15, duty: 0.78, lift: 0.46, toe: 0.3, meta: 0.25, roll: 0.1, ph: [0.75, 0, 0.25, 0.5], shape: 1.25, curve: 1 },
  drone: { stride: 1, duty: 0.5, lift: 0, toe: 0, meta: 0, roll: 0, ph: [] },
  wheel: { stride: 1, duty: 0.5, lift: 0, toe: 0, meta: 0, roll: 0, ph: [] },
  // two tripods that take turns: left front, left rear and right middle against the other three
  brood: { stride: 0.7, duty: 0.6, lift: 0.15, toe: 0.3, meta: 0, roll: 0, ph: [0, 0.5, 0, 0.5, 0, 0.5] },
  mite: { stride: 1, duty: 0.5, lift: 0, toe: 0, meta: 0, roll: 0, ph: [] },
  // one foot at a time, each a long slow heave that comes down hard; four fifths of the cycle on the ground
  titan: { stride: 4.6, duty: 0.8, lift: 2.3, toe: 0.22, meta: 0.2, roll: 0.05, ph: [0.75, 0, 0.25, 0.5], shape: 1.35 },
};
const LEG_IDS: Record<ET, string[]> = {
  grunt: ['l', 'r'], runner: ['fl', 'hl', 'fr', 'hr'], brute: ['l', 'r'], shield: ['1', '2', '3'], boss: ['1', '2', '3', '4'], drone: [], wheel: [],
  brood: ['1', '2', '3', '4', '5', '6'], mite: [], titan: ['1', '2', '3', '4'],
};

export interface EnemyRig {
  type: ET; root: O3; gait: Gait; legs: Leg[]; spins: O3[];
  body: O3 | null; torso: O3 | null; head: O3 | null; jaw: O3 | null; eye: O3 | null;
  armLU: O3 | null; armLL: O3 | null; armRU: O3 | null; armRL: O3 | null;
  bx: number; by: number; bz: number;   // rest position of the body node
  footR: number;                        // mean distance of the feet from the turning axis
  cyc: number; t: number; seed: number; age: number; flinch: number; hp: number;
  speed: number; mv: number; sing: number; lastYaw: number; bank: number; look: number;
  lastX: number; lastZ: number; vx: number; vz: number; om: number; init: boolean; walk: number;
  atk: number; atkT: number; hit: boolean;   // attacking the core: blend, clock, and "a blow landed this frame"
  sag: number; sagV: number; downN: number;  // Colossus: the hull sags onto every footfall (a damped spring), feet planted last frame
  /** Colossus: how far to its left the middle of the road lies where its front feet land (BOSS_REACH ahead) and where its rear feet land (as far behind), model units. Set by the view before each update; 0 on a straight. */
  roadF: number; roadR: number;
  /** Gyre: the rim, its roll angle, the hub's swing about the axle (a pendulum), the spin as it was last frame, and the stagger left from a stall */
  rim: O3 | null; roll: number; pend: number; pendV: number; pvz: number; spin: number; stag: number;
  /** Broodcarrier: its launch cell lids, seconds they still stay open (the view sets it when a swarm leaves), and how far open they are */
  cells: O3[]; open: number; lid: number;
  /**
   * Titan. neck: its two neck joints. lookPitch: how far its head looks down at what it tracks (rad). The view drives the rest:
   * crouch 0..1 (it gathers itself before a leap), air 0..1 (legs folded in flight), lunge (set to 1 for a swipe at a building, it
   * decays on its own), dead (seconds since it died, 0 while it lives: the hull comes down and the neck drops).
   * steps: world x, z of every foot that came down this frame. ground: height of the ground at a world position.
   * snap: may move the spot a foot is about to step to (world x, z in, the result in out).
   */
  neck: O3[]; lookPitch: number; crouch: number; air: number; lunge: number; dead: number;
  steps: number[] | null; ground: ((x: number, z: number) => number) | null; snap: ((x: number, z: number, out: { x: number; z: number }) => void) | null;
}

export function makeEnemyRig(root: O3, type: ET): EnemyRig {
  const g = GAITS[type], legs: Leg[] = [];
  const body = find(root, 'body');
  LEG_IDS[type].forEach((id, i) => { const l = makeLeg(root, id, g.ph[i], body); if (l) legs.push(l); });
  if (type === 'runner') legs.forEach((l) => { l.fz += l.fz > 0 ? 0.05 : -0.05; });          // fore and hind feet never bunch up
  if (type === 'shield') legs.forEach((l) => { l.fx = l.hx + (l.fx - l.hx) * 1.1; l.fz = l.hz + (l.fz - l.hz) * 1.1; });   // wider stance: room for the stride
  if (type === 'boss') legs.forEach((l) => { const f = BOSS_FEET[l.hz > 0 ? 0 : 1]; l.fx = Math.sign(l.hx || 1) * f[0]; l.fz = l.hz + f[1]; l.sx = l.fx; l.sz = l.fz; });
  const rim = type === 'wheel' ? find(root, 'rim') : null;
  if (rim) { rim.rotation.order = 'ZYX'; if (body) body.rotation.order = 'ZYX'; }   // lean, then wobble, then the turn about the axle: the hub stays in the plane of its wheel
  const spins: O3[] = [], cells: O3[] = [], neck: O3[] = [];
  root.traverse((o) => { if (o.name.startsWith('spin')) spins.push(o); else if (o.name.startsWith('cell_')) cells.push(o); else if (o.name.startsWith('neck_')) neck.push(o); });
  cells.sort((a, b) => (a.name < b.name ? -1 : 1)); neck.sort((a, b) => (a.name < b.name ? -1 : 1));
  let footR = 0;
  for (const l of legs) footR += Math.hypot(l.fx, l.fz) / legs.length;
  const r: EnemyRig = {
    type, root, gait: g, legs, spins, body, torso: find(root, 'torso'), head: find(root, 'head'), jaw: find(root, 'jaw'), eye: find(root, 'eye'),
    armLU: find(root, 'arm_l_upper'), armLL: find(root, 'arm_l_lower'), armRU: find(root, 'arm_r_upper'), armRL: find(root, 'arm_r_lower'),
    bx: body ? body.position.x : 0, by: body ? body.position.y : 0, bz: body ? body.position.z : 0, footR,
    cyc: 0, t: 0, seed: 0, age: 0, flinch: 0, hp: -1, speed: 0, mv: 0, sing: 0, lastYaw: 0, bank: 0, look: 0,
    lastX: 0, lastZ: 0, vx: 0, vz: 0, om: 0, init: true, walk: 1, atk: 0, atkT: 0, hit: false,
    sag: 0, sagV: 0, downN: 0, roadF: 0, roadR: 0, rim, roll: 0, pend: 0, pendV: 0, pvz: 0, spin: 1, stag: 0,
    cells, open: 0, lid: 0, neck, lookPitch: 0, crouch: 0, air: 0, lunge: 0, dead: 0, steps: type === 'titan' ? [] : null, ground: null, snap: null,
  };
  if (type === 'titan' && r.head) r.head.rotation.order = 'YXZ';   // it turns its head, then nods along where it now looks
  resetEnemy(r);
  return r;
}

/** Seconds per blow while an enemy batters the core, and how far its body lunges (model units). */
const STRIKE_T: Record<ET, number> = { grunt: 0.38, runner: 0.3, drone: 0.34, shield: 0.5, brute: 0.62, boss: 0.8, wheel: 0.5, brood: 0.6, mite: 0.3, titan: 5 };
const STRIKE_REACH: Record<ET, number> = { grunt: 0.3, runner: 0.4, drone: 0.5, shield: 0.34, brute: 0.34, boss: 0.5, wheel: 0.04, brood: 0.25, mite: 0.1, titan: 1.6 };
/** Nominal walking speed (model units / s) used to normalise the "how fast am I moving" blend. */
const NOMINAL: Record<ET, number> = { grunt: 3, runner: 5, drone: 3.8, shield: 2.5, brute: 1.9, boss: 1.37, wheel: 4.4, brood: 1.6, mite: 4, titan: 0.7 };

/** Call when a pooled visual is handed to a new enemy (after its root has been placed). */
export function resetEnemy(r: EnemyRig) {
  r.seed = Math.random() * 100; r.cyc = Math.random(); r.t = 0; r.age = 0; r.flinch = 0; r.hp = -1;
  r.sing = 0; r.bank = 0; r.look = 0; r.lastYaw = r.root.rotation.y;
  // assume it walks in at its normal pace: the first frame is already a valid walking pose
  r.speed = NOMINAL[r.type]; r.mv = 1; r.vx = 0; r.vz = r.speed; r.om = 0; r.walk = 1;
  r.lastX = r.root.position.x; r.lastZ = r.root.position.z; r.init = true; r.atk = 0; r.atkT = 0; r.hit = false;
  r.sag = 0; r.sagV = 0; r.downN = r.legs.length; r.roadF = 0; r.roadR = 0; r.roll = Math.random() * TAU; r.pend = 0; r.pendV = 0; r.pvz = r.speed; r.spin = 1; r.stag = 0;
  r.open = 0; r.lid = 0; r.lookPitch = 0; r.crouch = 0; r.air = 0; r.lunge = 0; r.dead = 0;
  if (r.steps) r.steps.length = 0;
  for (const n of r.neck) n.rotation.set(0, 0, 0);
}

/**
 * Advance one enemy rig. Movement is read from the root's own position / heading (set them before the call).
 * @param hpFrac current hp / max hp (a drop triggers a flinch)
 * @param sing   true while held by a singularity
 * @param frozen true while frozen solid: the machine holds its pose, nothing moves
 * @param lookYaw world yaw the head should track (boss), or NaN
 * @param strike true while it stands at the core and batters it (r.hit is set on the frame a blow lands)
 * @param spin   Gyre: how fast its rim turns, 0..1 (Enemy.spin). Below 0.25 the guard is down: it wobbles
 */
export function updateEnemy(r: EnemyRig, dt: number, hpFrac: number, sing: boolean, frozen: boolean, lookYaw: number, strike = false, spin = 1) {
  r.hit = false;
  if (r.steps) r.steps.length = 0;
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
  if (r.hp >= 0 && hpFrac < r.hp - 1e-4) {
    r.flinch = Math.min(1, r.flinch + 0.3 + (r.hp - hpFrac) * 5);
    if (r.type === 'titan' && r.dead <= 0) { r.stag = 1; r.sagV -= 1.6; }   // something got through: the whole machine jolts
  }
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
      // four-leg walk, one foot at a time: the hull moves its weight off the corner that lifts (away from that foot, and
      // tipped a little toward the three that carry it), and sags onto every foot as it lands
      let lx = 0, lz = 0;
      for (const L of r.legs) { lx += (L.fx > 0 ? 1 : -1) * L.lift; lz += (L.fz > 0 ? 1 : -1) * L.lift; }
      const h = Math.min(dt, 0.05);
      r.sagV += (-70 * r.sag - 9 * r.sagV) * h; r.sag += r.sagV * h;
      by = -0.12 + r.sag + 0.025 * amp * Math.sin(2 * w + 0.6) - 0.5 * spawn - 0.05 * fl;
      bx = -0.085 * lx; bz = -0.05 * lz;
      roll = 0.03 * lx + r.bank * 0.15 + shake * 0.015;
      pitch = -0.024 * lz + 0.012 - 0.04 * fl + shake2 * 0.015;
      yaw = 0.022 * amp * Math.sin(w + 2.2);
      if (r.head) {
        const want = lookYaw === lookYaw ? clamp(wrap(lookYaw - psi), -1.05, 1.05) : 0.3 * Math.sin(t * 0.4 + s);
        r.look += clamp(want - r.look, -dt * 1.1, dt * 1.1);
        r.head.rotation.set(-pitch + 0.03 * Math.sin(t * 0.9) - 0.06 * fl, r.look - yaw, 0);
      }
      break;
    }
    case 'wheel': {
      // the rim rolls by the ground it covers and never slides. The hub hangs from the axle: it swings back when the
      // machine pulls away and forward when it brakes, scans with its eyes, and leans into a turn together with the rim.
      // With the guard down (spin below 0.25) the rim runs out of true: it wobbles, and the stall itself staggers it.
      r.roll += mz / WHEEL_R;
      if (r.roll > 1e4) r.roll -= TAU * 1000;
      if (r.spin >= 0.25 && spin < 0.25) r.stag = 1;
      r.spin = spin;
      r.stag *= Math.exp(-dt * 3.2);
      const st = r.stag, loose = 1 - ease((spin - 0.2) / 0.25);
      const h = Math.min(dt, 0.05), acc = clamp((r.vz - r.pvz) / dt, -12, 12);
      r.pvz = r.vz;
      r.pendV += ((clamp(acc * 0.035, -0.45, 0.45) + 0.05 * mv - 0.3 * fl - r.pend) * 34 - r.pendV * 4.5) * h; r.pend += r.pendV * h;
      const wob = loose * (0.05 * Math.sin(r.roll + s) + 0.018 * Math.sin(t * 19 + s)) + st * 0.13 * Math.sin(t * 15 + s);
      roll = -r.bank * 1.5 + wob + shake * 0.05;
      pitch = r.pend + 0.22 * st * Math.sin(t * 11) - 0.2 * sg + shake2 * 0.06;
      yaw = loose * 0.05 * Math.sin(r.roll * 0.5 + s) + 0.1 * st * Math.sin(t * 9 + 1);
      // the whole wheel leans about the point where it meets the ground
      bx = -WHEEL_R * Math.sin(roll); by = WHEEL_R * (Math.cos(roll) - 1) + 0.012 * Math.sin(t * 7 + s) * mv - 0.04 * st;
      if (r.rim) { r.rim.position.set(bx, r.by + WHEEL_R * (Math.cos(roll) - 1), 0); r.rim.rotation.set(r.roll, yaw + loose * 0.035 * Math.sin(r.roll + s + 1.6), roll); }
      if (r.head) r.head.rotation.set(-pitch * 0.9 + 0.04 * Math.sin(t * 1.7 + s), clamp(0.2 * Math.sin(t * 0.9 + s) * (1 - sg) + r.bank * 1.2 + 0.3 * shake, -0.26, 0.26), 0);
      break;
    }
    case 'brood': {
      // six legs in two tripods: the hull stays low and level and rocks a little from one tripod to the other
      r.open = Math.max(0, r.open - dt);
      r.lid = damp(r.lid, r.open > 0 ? 1 : 0, r.open > 0 ? 16 : 4, dt);
      by = -0.02 - 0.03 * amp * Math.cos(2 * w) - 0.2 * spawn - 0.04 * fl - 0.07 * r.lid;
      roll = 0.03 * amp * Math.sin(w) + r.bank * 0.2 + shake * 0.04;
      pitch = 0.02 * amp * Math.sin(2 * w + 0.8) - 0.06 * fl + shake2 * 0.04;
      yaw = 0.03 * amp * Math.sin(w + 1.1);
      if (r.head) r.head.rotation.set(0.05 * Math.sin(t * 1.3 + s) + 0.12 * fl, 0.3 * Math.sin(t * 0.7 + s) * (1 - sg) + 0.3 * shake, 0);
      // the lids swing up on their outer edges, front pair first
      for (let i = 0; i < r.cells.length; i++) { const cl = r.cells[i]; cl.rotation.z = (cl.position.x > 0 ? -1 : 1) * 1.3 * ease(r.lid * 1.25 - (i % 3) * 0.1); }
      break;
    }
    case 'titan': {
      // one foot at a time. The hull hangs between its hips: it swings its weight off the corner that lifts, and drops onto
      // every foot that lands (a slow, heavy spring). A hit that gets through staggers it; dead, it comes down for good.
      let lx = 0, lz = 0;
      for (const L of r.legs) { lx += (L.fx > 0 ? 1 : -1) * L.lift; lz += (L.fz > 0 ? 1 : -1) * L.lift; }
      const h = Math.min(dt, 0.05);
      r.sagV += (-22 * r.sag - 5 * r.sagV) * h; r.sag += r.sagV * h;
      r.stag *= Math.exp(-dt * 1.7); r.lunge *= Math.exp(-dt * 2.4);
      const st = r.stag, dk = ease(r.dead / 2.6), cr = r.crouch, air = r.air;
      by = -0.2 + r.sag + 0.1 * amp * Math.sin(2 * w + 0.6) - 1.0 * spawn - 2.1 * cr + 0.8 * air - 0.5 * r.lunge - 5.6 * dk - 0.25 * st + 0.05 * Math.sin(t * 23) * (r.dead > 0 ? 1 - dk : 0);
      bx = -0.55 * lx * (1 - dk) + 0.2 * st * Math.sin(t * 13 + s) + 0.9 * dk;
      bz = -0.32 * lz * (1 - dk) + 1.0 * r.lunge - 0.7 * dk;
      roll = 0.035 * lx + r.bank * 0.1 + shake * 0.01 + 0.05 * st * Math.sin(t * 17 + s) + 0.3 * dk;
      pitch = -0.03 * lz + 0.015 + 0.09 * cr - 0.16 * air + 0.16 * r.lunge - 0.06 * st * Math.cos(t * 11 + s) + 0.32 * dk + shake2 * 0.01;
      yaw = 0.03 * amp * Math.sin(w + 2.2) * (1 - dk);
      if (r.head) {
        const want = r.dead > 0 ? 0 : lookYaw === lookYaw ? clamp(wrap(lookYaw - psi), -1.25, 1.25) : 0.45 * Math.sin(t * 0.3 + s);
        r.look += clamp(want - r.look, -dt * 0.7, dt * 0.7);
        const nod = lookYaw === lookYaw ? r.lookPitch : 0.1 + 0.05 * Math.sin(t * 0.5 + s);
        r.head.rotation.set(-pitch + nod * (1 - dk) + 0.04 * Math.sin(t * 0.8) + 0.25 * st + 0.5 * dk, r.look - yaw, -roll * 0.6);
      }
      if (r.neck[0]) r.neck[0].rotation.x = 0.55 * dk + 0.04 * st;
      if (r.neck[1]) r.neck[1].rotation.x = 0.5 * dk + 0.05 * st;
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
  // battering the core: wind up, throw the whole machine forward, recover. Feet stay planted, the body does the work.
  r.atk = damp(r.atk, strike ? 1 : 0, strike ? 14 : 6, dt);
  if (r.atk > 0.01) {
    const T = STRIKE_T[r.type], u0 = frac(r.atkT / T);
    r.atkT += dt;
    const u = frac(r.atkT / T), k = r.atk, tt = r.type === 'titan', heavy = r.type === 'brute' || r.type === 'boss';
    // the Titan rears up for four of its five seconds, then comes down on the core
    const a0 = tt ? 0.72 : 0.45, a1 = tt ? 0.8 : 0.6;
    if (strike && u0 < a1 - 0.02 && u >= a1 - 0.02) r.hit = true;
    const wind = u < a0 ? ease(u / a0) : u < a1 ? 1 - ease((u - a0) / (a1 - a0)) : 0;
    const blow = u < a0 ? 0 : u < a1 ? ease((u - a0) / (a1 - a0)) : 1 - ease((u - a1) / (1 - a1));
    const reach = STRIKE_REACH[r.type];
    bz += (reach * blow - reach * 0.35 * wind) * k;
    by += (tt ? 1.5 : heavy ? 0.1 : 0.04) * wind * k - (tt ? 1.9 : r.type === 'drone' ? 0.45 : 0.07) * blow * k;
    pitch += (0.3 * blow - 0.16 * wind) * k * (r.type === 'boss' ? 0.45 : tt ? 0.7 : 1);
    if (r.armLU && r.armRU) { // both arms go up, then come down on the core
      const a = -(2.0 * wind + 0.9 * blow) * k;
      r.armLU.rotation.x += a; r.armRU.rotation.x += a;
      if (r.armLL) r.armLL.rotation.x -= 0.7 * wind * k;
      if (r.armRL) r.armRL.rotation.x -= 0.7 * wind * k;
    }
    if (r.jaw) r.jaw.rotation.x += (0.5 * wind - 0.1 * blow) * k;
    if (r.head && r.type !== 'boss' && !tt) r.head.rotation.x += (0.25 * blow - 0.2 * wind) * k;
  } else r.atkT = 0;
  if (body) { body.position.set(r.bx + bx, r.by + by, r.bz + bz); body.rotation.set(pitch, yaw, roll); QBI.copy(body.quaternion).invert(); }
  C.X = root.position.x; C.Y = root.position.y; C.Z = root.position.z; C.cs = cs; C.sn = sn; C.sc = sc; C.psi = psi;
  C.vx = r.vx; C.vz = r.vz; C.om = r.om; C.sp = r.speed + Math.abs(r.om) * r.footR; C.spMin = NOMINAL[r.type] * 0.2;
  C.liftAmp = r.walk * (sg > 0.05 ? 0.55 + 0.45 * mv : 1) * (r.dead > 0 ? 0 : 1); C.pitch = pitch; C.yaw = yaw; C.init = r.init;
  const legs = r.legs;
  let downN = 0;
  for (let i = 0; i < legs.length; i++) { stepLeg(r, legs[i], g); if (legs[i].down) downN++; }
  if (r.type === 'boss' && downN > r.downN && !r.init) r.sagV -= 0.55 * amp;   // a foot came down: the hull drops onto it
  if (r.type === 'titan' && downN > r.downN && !r.init && r.dead <= 0) r.sagV -= 1.5 * amp;
  r.downN = downN;
  r.init = false;
  const sp = dt * (r.type === 'drone' ? 38 : r.type === 'boss' ? 2.5 : r.type === 'wheel' ? 6 + 16 * spin : 4.5);
  for (let i = 0; i < r.spins.length; i++) r.spins[i].rotateY(i & 1 ? -sp : sp);
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
  flame: { d: 0.05, T: 0.2, pitch: 0.01 }, lance: { d: 0.03, T: 0.3, pitch: 0 }, missile: { d: 0.2, T: 0.8, pitch: 0.06 }, gravity: { d: 0, T: 1, pitch: 0 },
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
  if (tur && r.type !== 'beacon' && r.type !== 'arc' && r.type !== 'gravity') {
    const idle = cd < -0.7 && !st.down && r.type !== 'flame';   // a Firewall Pylon holds the heading the view gives it
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
