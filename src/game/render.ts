// Three.js view of a Sim: models, cameras (bird view + third person on an Uplink Spire), effects.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TOWERS, TOWER_TYPES, ENEMIES, ENEMY_TYPES, ENEMY_SCALE, BOW_TIERS, TITAN_LAND, GW, GH, cellX, cellZ, worldToCell } from './data.ts';
import type { TowerType, EnemyType } from './data.ts';
import { HEX_SIZE, BOARD_W, BOARD_D, HEX_CORNERS } from './hex.ts';
import { Sim, TOWER_SCALE, TOWER_H, HERO_SCALE, SKILL_CAST, NODE_R, ARROW_PAD, FIRE_RING, SPIRE_R, standY, nodePos, weakPos, spireTarget, raySphere } from './sim.ts';
import type { Ev, Tower, Enemy, TitanState } from './sim.ts';
import type { GameMap } from './map.ts';
import { Fx, makeBeam, placeBeam, fireMat, reticleMat, FIRE_CLOCK } from './fx.ts';
import { buildWorld, noAO, FX_LAYER } from './world.ts';
import { Post } from './post.ts';
import { lightPool, glowTexture, POOL_GEO } from './tex.ts';
import { makeEnemyRig, resetEnemy, updateEnemy, makeTowerRig, updateTower, towerShot, makeHeroRig, updateHero, heroTrigger, resetHero, BOSS_REACH } from './anim.ts';
import type { EnemyRig, TowerRig, TowerState, HeroRig, HeroEvent } from './anim.ts';

const MODEL_NAMES = [...TOWER_TYPES.map((t) => 'tower_' + t), ...ENEMY_TYPES.map((t) => 'enemy_' + t), 'hero', 'core', 'prop_barrier', 'prop_lamp', 'prop_crate'];

// Ember palette. Defenders are warm, the Static is cold, verdigris belongs to the Uplink.
const SAND = 0xe3dc92, APRICOT = 0xf68b56, RUST = 0xce6b44, UPLINK = 0x6fe0c8;
const STATIC = 0x8fd0ff, VIOLET = 0x8a7dff, FROST = 0xdff0ff;
const HEAT = 0xffa24a; // hot metal sparks
const SINGC = 0xa99cff; // a singularity is cold violet and white, whoever throws it
const HSL = { h: 0, s: 0, l: 0 };
const DUST = 0x8f866c; // sand that has been kicked up
const TRAIL = 0x596066; // what an Arrow Rain shaft leaves in the air: cold white, kept dim so nine of them do not burn out the picture
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), RO = new THREE.Vector3(), RD = new THREE.Vector3();
const V3 = new THREE.Vector3(), ZA = new THREE.Vector3(0, 0, 1), YA = new THREE.Vector3(0, 1, 0), M4 = new THREE.Matrix4(), M5 = new THREE.Matrix4(), M6 = new THREE.Matrix4();
const C1 = new THREE.Color(), C2 = new THREE.Color(), Q1 = new THREE.Quaternion(), Q2 = new THREE.Quaternion();
const W3 = { x: 0, y: 0, z: 0 }, PT = { x: 0, z: 0 };
const wrapA = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const ST: TowerState = { down: false, spec: false, power: 1, heat: 0 };
const TAU = Math.PI * 2;
const DMG = new Float64Array(96);
const sat = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (u: number) => { u = sat(u); return u * u * (3 - 2 * u); };
const damp = (cur: number, to: number, rate: number, dt: number) => cur + (to - cur) * (1 - Math.exp(-rate * dt));

/** The world module's side of the bargain. Members after `update` are optional here so an older world keeps running. */
interface FxOptions { impact: boolean; beat: boolean; borders: boolean; env: boolean; towers: boolean; intensity: number; color: number | null }
interface WorldApi {
  sun: THREE.DirectionalLight;
  setMap(map: GameMap): void;
  update(time: number, dt: number): void;
  startIntro?(): void;
  skipIntro?(): void;
  introActive?(): boolean;
  revealAt?(x: number, z: number): number;
  roadY?(x: number, z: number): number;
  pulse?(x: number, z: number, color: number, radius: number, strength?: number): void;
  setBeat?(level: number): void;
  fxOptions?: FxOptions;
  /** The district the Titan roams: lattice pitch, what stands on a cell (0 = open, else its height), wreck the tower on a cell, rebuild them all, ground height off the deck. */
  cityStep?: number;
  cityTop?(c: number, row: number): number;
  citySmash?(c: number, row: number): { x: number; z: number; h: number } | null;
  cityRestore?(): void;
  groundY?(x: number, z: number): number;
}

// Third-person camera: an orbit round a point above and to the right of Kestrel's head.
const CAM_BACK = 3.0, CAM_SIDE = 0.85, CAM_UP = 1.5;
/** Enemies are drawn no closer to the core's centre than this plus 0.6 of their radius: its plinth is in the way. */
const CORE_STAND = 1.6;
/** How far the aim ray reaches when it hits nothing. */
const AIM_FAR = 150;

// ---------- shared geometry and materials (never disposed) ----------
const hexFlat = (g: THREE.BufferGeometry) => g.rotateX(-Math.PI / 2);
const G_HEX = hexFlat(new THREE.CircleGeometry(HEX_SIZE * 0.93, 6, Math.PI / 6));
const G_HEX_RING = hexFlat(new THREE.RingGeometry(HEX_SIZE * 0.86, HEX_SIZE * 0.95, 6, 1, Math.PI / 6));
const G_HEX_LINE = hexFlat(new THREE.RingGeometry(HEX_SIZE * 0.9, HEX_SIZE * 0.95, 6, 1, Math.PI / 6));
const G_BAR = new THREE.PlaneGeometry(HEX_SIZE * 1.1, 0.12).rotateX(-Math.PI / 2);
const G_DISC = hexFlat(new THREE.CircleGeometry(1, 48));
const G_RING = hexFlat(new THREE.RingGeometry(0.975, 1, 72));
const G_SPH = new THREE.SphereGeometry(1, 16, 12);
const G_ICE = new THREE.IcosahedronGeometry(1, 0);
const G_OCTA = new THREE.OctahedronGeometry(1);
const G_QUAD = new THREE.PlaneGeometry(2, 2);
// a wall of fire in local space: x 0..1 along the wall, y 0..1 up; one upright sheet and two that lean out, so it has body from above
const G_WALL = (() => {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const lean of [0, 0.5, -0.5]) {
    const o = pos.length / 3, h = lean ? 0.8 : 1;
    pos.push(0, 0, 0, 1, 0, 0, 1, h, lean, 0, h, lean); uv.push(0, 0, 1, 0, 1, 1, 0, 1); idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
})();
// the ring of fire round a lone pylon: an open cylinder, uv.x once round
const G_FIRE_RING = new THREE.CylinderGeometry(1, 1.06, 1, 40, 1, true).translate(0, 0.5, 0);
const G_GLOW_STRIP = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const G_ACC = hexFlat(new THREE.RingGeometry(0.42, 1, 56, 1));
/** Painted frame on a tower's tile, the level cue that reads from the bird view: the two near edges at level 2, closed at level 3. */
function levelFrame(edges: number[], trim: number, r0: number, r1: number) {
  const pos: number[] = [];
  for (const i of edges) {
    const a = HEX_CORNERS[i], b = HEX_CORNERS[(i + 1) % 6];
    const ax = a[0] + (b[0] - a[0]) * trim, az = a[1] + (b[1] - a[1]) * trim, bx = b[0] + (a[0] - b[0]) * trim, bz = b[1] + (a[1] - b[1]) * trim;
    pos.push(ax * r0, 0, az * r0, ax * r1, 0, az * r1, bx * r1, 0, bz * r1, ax * r0, 0, az * r0, bx * r1, 0, bz * r1, bx * r0, 0, bz * r0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
// the bases fill their tile, so the frame sits on the seam just outside it
const NEAR_EDGES = [0, 1, 2, 3, 4, 5].filter((i) => HEX_CORNERS[i][1] + HEX_CORNERS[(i + 1) % 6][1] > 0.5);
const G_LVL = [levelFrame(NEAR_EDGES, 0, 0.965, 1.07), levelFrame([0, 1, 2, 3, 4, 5], 0, 0.965, 1.07)];
const M_LVL = new THREE.MeshBasicMaterial({ color: new THREE.Color(SAND).multiplyScalar(0.55), side: THREE.DoubleSide });
const G_PLATE = new THREE.BoxGeometry(0.5, 0.36, 0.09);
const G_STRIP = new THREE.BoxGeometry(0.3, 0.05, 0.03);
const G_FIN = new THREE.BoxGeometry(0.1, 1, 0.3);
const G_TIP = new THREE.BoxGeometry(0.12, 0.07, 0.12);
const G_POD = new THREE.BoxGeometry(0.16, 0.24, 0.46);
const G_MAST = new THREE.CylinderGeometry(0.018, 0.03, 0.7, 5);
const M_ADD_HULL = new THREE.MeshStandardMaterial({ color: 0x2c2723, roughness: 0.5, metalness: 0.75 });
const M_ADD_TRIM = new THREE.MeshStandardMaterial({ color: 0x70675c, roughness: 0.34, metalness: 0.9 });
const M_ICE = new THREE.MeshStandardMaterial({ color: 0xcfeaf2, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.42, flatShading: true, emissive: 0x3a6a80, emissiveIntensity: 0.4, depthWrite: false });
const M_BUFF = new THREE.MeshBasicMaterial({ color: new THREE.Color(TOWERS.beacon.color).multiplyScalar(0.9), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

// Gyre guard, in the plane of its wheel (the rim node's local YZ): the light strips blurred into a ring, and a shimmer over the face
const G_GUARD_RING = new THREE.RingGeometry(0.79, 0.855, 56).rotateY(Math.PI / 2);
const G_GUARD_DISC = new THREE.RingGeometry(0.12, 1.07, 56, 1).rotateY(Math.PI / 2);
const guardMat = () => new THREE.ShaderMaterial({
  uniforms: { time: FIRE_CLOCK, color: { value: new THREE.Color(STATIC) }, gain: { value: 0 }, seed: { value: Math.random() * 40 } },
  vertexShader: 'varying vec2 vP; void main(){ vP = position.zy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform float time, gain, seed; uniform vec3 color; varying vec2 vP;
    void main(){ float r = length(vP), a = atan(vP.y, vP.x);
      float k = smoothstep(0.12, 1.0, r);
      float s1 = 0.5 + 0.5 * sin(a * 5.0 - time * 23.0 + seed), s2 = 0.5 + 0.5 * sin(a * 13.0 + time * 9.0 + r * 7.0 + seed);
      float v = k * k * (0.3 + 0.7 * s1 * s2) * (1.0 - smoothstep(0.99, 1.07, r));
      gl_FragColor = vec4(color * v * gain, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, side: THREE.DoubleSide,
});

// Arrow Rain: the volley climbs for RAIN_CLIMB seconds after the release, hangs for RAIN_HANG and comes down in RAIN_DIVE
const RAIN_CLIMB = 0.3, RAIN_HANG = 0.1, RAIN_DIVE = 0.17, RAIN_N = 9;
/** Seconds from the cast to the first shafts landing: the ground marker fills over this time. */
const RAIN_LAND = SKILL_CAST[1] + RAIN_CLIMB + RAIN_HANG + RAIN_DIVE;
const SHAFTS = 96;
/** One shaft of Arrow Rain. mode 0 free, 1 climbing with the volley, 2 hanging at the top, 3 coming down, 4 stuck in the deck. */
interface Shaft {
  mode: number; t: number; T: number; pow: number; tr: number; gy: number;
  p0: THREE.Vector3; p1: THREE.Vector3; p2: THREE.Vector3; to: THREE.Vector3; pos: THREE.Vector3; dir: THREE.Vector3; d0: THREE.Vector3; last: THREE.Vector3;
}

// accretion disc of a singularity: streaks that wind inward, white at the inner edge
const accMat = () => new THREE.ShaderMaterial({
  uniforms: { time: FIRE_CLOCK, color: { value: new THREE.Color(SINGC) }, gain: { value: 1 } },
  vertexShader: 'varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform float time, gain; uniform vec3 color; varying vec2 vP;
    void main(){ float r = length(vP), a = atan(vP.y, vP.x);
      float k = (r - 0.42) / 0.58;
      float s1 = 0.5 + 0.5 * sin(a * 3.0 + r * 9.0 + time * 7.0), s2 = 0.5 + 0.5 * sin(a * 7.0 - r * 17.0 + time * 11.0);
      float v = (0.25 + 0.75 * s1 * s1) * (0.55 + 0.45 * s2) * smoothstep(0.0, 0.08, k) * (1.0 - k) * (1.0 - k);
      vec3 c = mix(vec3(1.0), color, smoothstep(0.0, 0.45, k));
      gl_FragColor = vec4(c * v * gain * 1.6, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, side: THREE.DoubleSide,
});
// the lensed rim round its dark core, on a quad that faces the camera: black inside, a hard white ring, a violet falloff
const lensMat = () => new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color(SINGC) }, gain: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform float gain; uniform vec3 color; varying vec2 vUv;
    void main(){ vec2 p = vUv * 2.0 - 1.0; float r = length(p);
      float ring = exp(-(r - 0.4) * (r - 0.4) * 900.0);
      float halo = smoothstep(0.37, 0.4, r) * exp(-(r - 0.4) * 5.5) * (1.0 - smoothstep(0.8, 1.0, r));
      gl_FragColor = vec4((vec3(1.0) * ring * 1.5 + color * halo * 0.55) * gain, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
});

interface Glow { m: THREE.MeshStandardMaterial; i0: number }
interface WeakVis { core: THREE.Mesh; ring: THREE.Mesh; mat: THREE.MeshBasicMaterial; rmat: THREE.ShaderMaterial }
/** Gyre guard: its own strip lights, the blur rings and shimmer discs on both faces, the smoothed spin, and a short flare */
interface GuardVis { strips: Glow[]; rmat: THREE.MeshBasicMaterial; dmat: THREE.ShaderMaterial; parts: THREE.Mesh[]; lvl: number; surge: number; em: number }
interface EVis {
  obj: THREE.Object3D; rig: EnemyRig; sx: number; sz: number; glow: THREE.Mesh; back: THREE.Sprite; bar: THREE.Sprite; sbar: THREE.Sprite | null; bubble: THREE.Mesh | null;
  ice: THREE.Mesh | null; weak: WeakVis[]; wglow: Glow[]; type: EnemyType; phase: number; seen: number; fresh: boolean; lx: number; lz: number; lgy: number; tilt: number; em: number;
  /** hit flash: the meshes and their own materials, and the seconds the flash still has to run */
  meshes: THREE.Mesh[]; mats: (THREE.Material | THREE.Material[])[]; hitT: number;
  guard: GuardVis | null;
  /** Titan: its own copies of the lights that are not weak points, its health last frame, and how hard those lights stutter after a hit */
  own: Glow[]; hp0: number; dim: number;
}
interface TVis {
  obj: THREE.Object3D; rig: TowerRig; type: TowerType; lvl: number; grow: number; s: number; seen: number;
  glows: Glow[]; acc: THREE.MeshStandardMaterial; pad: THREE.Mesh; buff: THREE.Mesh;
  /** model parts shown from level 2 / 3, and the procedural add-ons used when the model has none */
  lv: THREE.Object3D[][]; addons: THREE.Object3D[];
  /** power node: emblem group (null for towers without a special), its materials, and the model's own node lights */
  node: THREE.Group | null; core: THREE.Mesh | null; nodeMat: THREE.MeshBasicMaterial | null; ringMat: THREE.ShaderMaterial | null; halo: THREE.Sprite | null; mnode: Glow[];
  power: number; boot: number; fired: number; em: number; em2: number; tick: number; downMax: number; deny: number;
  /** jammed by mites / stunned by the Titan last frame (the lights stutter back on when either ends), and the spark clock for both */
  jam: boolean; stun: boolean; em3: number;
  /** Firewall Pylon: heading of its emitter head, how hard its walls burn (0 none, 1 on, 2 hot), frame it was last linked, and the ring of fire it burns when it stands alone */
  wYaw: number; wTo: number; wHeat: number; wSeen: number; ring: THREE.Group | null; ringMats: THREE.Material[]; ringOn: number;
  /** lance beam, fed by sim events and kept alive between them */
  beam: THREE.Mesh | null; lnT: number; lnX: number; lnY: number; lnZ: number; lnY0: number; lnHeat: number; lnOver: boolean;
}
interface PVis { mesh: THREE.Mesh; kind: string; seen: number; fresh: boolean; em: number }
/** A mite: where it is drawn, how far it has swung onto its tower's wall (0 deck, 1 wall), its own phase. All mites share a few instanced meshes. */
interface MVis { x: number; y: number; z: number; on: number; ph: number; seen: number }
const MITES = 96, MITE_DRAW = 1.25;
/**
 * The Titan before it is an enemy. It walks the district's lattice from cell to cell (c, r is the cell it is heading for, at
 * tx, tz), wrecks a tower now and then, and comes in close as its danger fills. leap >= 0: seconds into its jump onto the gate.
 * owe: it was due to wreck a tower with none in reach, and takes the next one it comes past.
 */
interface Roam {
  v: EVis | null; c: number; r: number; tx: number; tz: number; x: number; y: number; z: number; yaw: number; ang: number; stop: boolean; wait: number; face: number; faceT: number;
  leap: number; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; yaw1: number; off: boolean; owe: boolean;
}
/** The Titan's wreck: its visual, seconds since it died, the clock of its secondary explosions, where it fell. */
interface Wreck { v: EVis; t: number; tick: number; x: number; z: number; gy: number; down: boolean }
const CITY_NEAR = [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]], CITY_NEAR_ODD = [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]];
const cityKey = (c: number, r: number) => (r + 64) * 256 + c + 64;
/** tele > 0: still dissolving at the spire she is leaving; out: playing the uplink-end animation at `pos` */
interface HVis { obj: THREE.Object3D; rig: HeroRig | null; pos: THREE.Vector3; tele: number; out: boolean; shown: boolean; tiers: { n: number; o: THREE.Object3D }[] }
interface ZVis {
  obj: THREE.Group; kind: string; seen: number; t: number; mats: THREE.Material[]; halo: THREE.Object3D | null; c: number; tick: number; x: number; y: number; z: number; r: number; core: THREE.Object3D | null; lens: THREE.Mesh | null; life: number;
  /** Arrow Rain: the soft fill that grows while the volley is in the air, and the side the shower comes in from */
  fill: THREE.Mesh | null; ax: number; az: number;
}
/** A wall of fire between two Firewall Pylons (sim.walls). */
interface WallLike { a: number; b: number; ax: number; az: number; bx: number; bz: number; on: boolean; hot: boolean }
interface WVis { obj: THREE.Group; sheet: THREE.Mesh; mat: THREE.ShaderMaterial; glow: THREE.Mesh; gmat: THREE.MeshBasicMaterial; seen: number; on: number; heat: number; em: number; len: number }
/** Jump target above a Spire. */
interface BVis { obj: THREE.Group; ret: THREE.Mesh; mat: THREE.ShaderMaterial; dia: THREE.Mesh; key: THREE.Sprite; hot: number }
/** An effect held back until the hero's pose reaches its release beat. */
interface Later { t: number; fn: () => void }

/** Half-length of road (before and after a corner) over which each type swings through its turn, and the hardest it can turn (rad/s). */
const TURN_A: Record<EnemyType, number> = { grunt: 0.8, runner: 1.0, drone: 1.3, shield: 1.0, brute: 1.0, boss: 1.6, wheel: 1.3, brood: 1.3, mite: 0.3, titan: 3.2 };
const TURN_RATE: Record<EnemyType, number> = { grunt: 5, runner: 7, drone: 6, shield: 3.2, brute: 2.6, boss: 1.1, wheel: 3.4, brood: 2.2, mite: 9, titan: 0.45 };
const PO = { x: 0, z: 0, dx: 0, dz: 0, y: 0, yaw: 0 }, PO2 = { x: 0, z: 0, dx: 0, dz: 0, y: 0, yaw: 0 };
/**
 * Where an enemy at distance d (lateral offset off) along a lane is drawn: like GameMap.pos, but every corner is
 * replaced by a circular arc that starts `a` before it and ends `a` after it, so heading and position are continuous.
 */
function roundedPose(map: GameMap, lane: number, d: number, off: number, a: number, out: typeof PO) {
  const L = map.lanes[lane] || map.lanes[0], n = L.pts.length;
  map.pos(lane, d, out);
  let hx = out.dx, hz = out.dz, px = out.x, pz = out.z;
  d = Math.max(0, Math.min(L.len, d));
  let i = 1;
  while (i < n - 1 && L.cum[i] < d) i++;
  for (let j = i - 1; j <= i; j++) {
    if (j < 1 || j > n - 2) continue;
    const s0 = L.cum[j] - L.cum[j - 1], s1 = L.cum[j + 1] - L.cum[j];
    const aj = Math.min(a, 0.48 * s0, 0.48 * s1), s = d - L.cum[j];
    if (aj < 1e-3 || Math.abs(s) >= aj) continue;
    const A = L.pts[j - 1], Cn = L.pts[j], B = L.pts[j + 1];
    const u1x = (Cn[0] - A[0]) / s0, u1z = (Cn[1] - A[1]) / s0, u2x = (B[0] - Cn[0]) / s1, u2z = (B[1] - Cn[1]) / s1;
    const h1 = Math.atan2(u1x, u1z);
    let del = Math.atan2(u2x, u2z) - h1;
    while (del > Math.PI) del -= Math.PI * 2;
    while (del < -Math.PI) del += Math.PI * 2;
    if (Math.abs(del) < 0.02) continue;
    const R = aj / Math.tan(Math.abs(del) / 2), sg = del > 0 ? 1 : -1, h = h1 + del * (s + aj) / (2 * aj);
    px = Cn[0] - aj * u1x + R * sg * (Math.cos(h1) - Math.cos(h));
    pz = Cn[1] - aj * u1z + R * sg * (Math.sin(h) - Math.sin(h1));
    hx = Math.sin(h); hz = Math.cos(h);
    break;
  }
  // near a corner the column closes up on the lane centre: the inside track would otherwise pivot on the spot
  let near = 1e9;
  for (let j = Math.max(1, i - 1); j <= Math.min(n - 2, i); j++) near = Math.min(near, Math.abs(d - L.cum[j]));
  if (near < 3.5) { const u = 1 - near / 3.5; off *= 1 - 0.7 * u * u * (3 - 2 * u); }
  out.x = px - hz * off; out.z = pz + hx * off; out.dx = hx; out.dz = hz; out.yaw = Math.atan2(hx, hz);
  return out;
}

/** Stand-in for a model file that is missing. Same node and material names as the real ones, so rigs and tuning work. */
function fallbackModel(name: string): THREE.Object3D {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0x2a231e, roughness: 0.5, metalness: 0.6, name: 'hull' });
  const trim = new THREE.MeshStandardMaterial({ color: 0x6b6258, roughness: 0.35, metalness: 0.9, name: 'trim' });
  const glow = (c: number, n = 'glow_main') => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 3, name: n });
  const part = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const group = (parent: THREE.Object3D, n: string, x = 0, y = 0, z = 0) => { const o = new THREE.Group(); o.name = n; o.position.set(x, y, z); parent.add(o); return o; };
  const alongZ = (geo: THREE.BufferGeometry) => geo.rotateX(Math.PI / 2);
  if (name.startsWith('tower_')) {
    const t = name.slice(6) as TowerType, c = TOWERS[t].color, H = TOWER_H[t] / TOWER_SCALE;
    const paint = new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.5, name: 'paint' });
    const lit = glow(c);
    const base = group(g, 'base');
    part(base, new THREE.CylinderGeometry(0.7, 0.86, 0.4, 6), hull, 0, 0.2, 0);
    part(base, new THREE.CylinderGeometry(0.72, 0.72, 0.06, 6), paint, 0, 0.43, 0);
    if (t === 'spire') {
      part(base, new THREE.CylinderGeometry(0.26, 0.42, H - 0.5, 6), hull, 0, 0.4 + (H - 0.5) / 2, 0);
      for (let i = 0; i < 3; i++) {
        const a = (i * TAU) / 3, s = part(base, new THREE.BoxGeometry(0.08, H * 0.5, 0.08), trim, Math.cos(a) * 0.5, H * 0.27, Math.sin(a) * 0.5);
        s.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
      }
      part(base, new THREE.CylinderGeometry(1.0, 0.8, 0.14, 6), hull, 0, H - 0.07, 0);
      part(base, new THREE.CylinderGeometry(0.84, 0.84, 0.05, 6), lit, 0, H - 0.17, 0);
      part(base, new THREE.CylinderGeometry(0.02, 0.03, 1.1, 5), trim, -0.86, H + 0.5, -0.3);
      part(base, new THREE.SphereGeometry(0.06, 8, 6), lit, -0.86, H + 1.08, -0.3);
      const dish = group(g, 'spin_1', 0, H * 0.62, 0);
      part(dish, new THREE.CylinderGeometry(0.2, 0.05, 0.12, 8), trim, 0.5, 0, 0).rotation.z = -Math.PI / 2;
      part(dish, new THREE.BoxGeometry(0.5, 0.05, 0.05), trim, 0.25, 0, 0);
    } else if (t === 'gravity') {
      for (let i = 0; i < 3; i++) {
        const a = (i * TAU) / 3 + 0.5, p = part(base, new THREE.BoxGeometry(0.14, H * 0.8, 0.2), hull, Math.cos(a) * 0.58, H * 0.42, Math.sin(a) * 0.58);
        p.rotation.set(-0.2, Math.PI / 2 - a, 0, 'YXZ');
        part(base, new THREE.BoxGeometry(0.1, 0.1, 0.1), lit, Math.cos(a) * 0.42, H * 0.84, Math.sin(a) * 0.42);
      }
      const orb = group(g, 'orb', 0, H * 0.66, 0);
      part(orb, new THREE.SphereGeometry(0.36, 16, 12), new THREE.MeshStandardMaterial({ color: 0x0c0a12, roughness: 0.25, metalness: 0.9, name: 'hull' }));
      const r1 = group(g, 'spin_1', 0, H * 0.66, 0);
      part(r1, new THREE.TorusGeometry(0.56, 0.025, 6, 32), lit).rotation.x = Math.PI / 2;
      const r2 = group(g, 'spin_2', 0, H * 0.66, 0); r2.rotation.z = 0.5;
      part(r2, new THREE.TorusGeometry(0.46, 0.02, 6, 28), trim).rotation.x = Math.PI / 2;
    } else {
      const ty = t === 'lance' ? H * 0.78 : t === 'arc' || t === 'beacon' ? H * 0.8 : H * 0.62;
      part(base, new THREE.CylinderGeometry(t === 'lance' ? 0.2 : 0.34, t === 'lance' ? 0.3 : 0.46, ty - 0.4, 6), hull, 0, 0.4 + (ty - 0.4) / 2, 0);
      const tur = group(g, 'turret', 0, ty, 0);
      if (t === 'flame') {
        part(tur, new THREE.BoxGeometry(0.62, 0.44, 0.7), hull);
        for (const s of [-1, 1]) part(tur, new THREE.CylinderGeometry(0.15, 0.15, 0.6, 10), paint, s * 0.2, 0.3, -0.3).rotation.x = Math.PI / 2;
        const b = group(tur, 'barrel', 0, 0, 0.35);
        part(b, alongZ(new THREE.CylinderGeometry(0.24, 0.12, 0.62, 10)), trim, 0, 0, 0.3);
        part(b, alongZ(new THREE.TorusGeometry(0.2, 0.03, 6, 16).rotateX(Math.PI / 2)), lit, 0, 0, 0.6);
      } else if (t === 'lance') {
        part(tur, new THREE.BoxGeometry(0.4, 0.36, 0.6), hull);
        part(tur, new THREE.BoxGeometry(0.44, 0.08, 0.3), paint, 0, 0.2, -0.1);
        const b = group(tur, 'barrel', 0, 0, 0.3);
        part(b, alongZ(new THREE.CylinderGeometry(0.05, 0.07, 1.3, 8)), trim, 0, 0, 0.65);
        for (let i = 0; i < 3; i++) part(b, new THREE.TorusGeometry(0.11, 0.02, 5, 14), trim, 0, 0, 0.35 + i * 0.4);
        part(b, new THREE.SphereGeometry(0.09, 10, 8), lit, 0, 0, 1.32);
      } else if (t === 'missile') {
        part(tur, new THREE.BoxGeometry(0.36, 0.4, 0.5), hull);
        for (const s of [-1, 1]) {
          const b = group(tur, s < 0 ? 'barrel_1' : 'barrel_2', s * 0.42, 0.12, 0); b.rotation.x = -0.5;
          part(b, new THREE.BoxGeometry(0.42, 0.42, 0.86), hull);
          part(b, new THREE.BoxGeometry(0.44, 0.1, 0.5), paint, 0, 0.2, -0.1);
          for (let i = 0; i < 4; i++) part(b, alongZ(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 8)), i === 0 ? lit : trim, ((i % 2) - 0.5) * 0.2, ((i >> 1) - 0.5) * 0.2, 0.44);
        }
      } else if (t === 'arc' || t === 'beacon') {
        const o = group(tur, t === 'arc' ? 'orb' : 'spin_1');
        if (t === 'arc') part(o, new THREE.SphereGeometry(0.3, 14, 10), lit);
        else { part(o, new THREE.BoxGeometry(0.9, 0.06, 0.14), trim); part(o, new THREE.SphereGeometry(0.12, 10, 8), lit, 0, 0.2, 0); }
        for (let i = 0; i < 3; i++) { const a = (i * TAU) / 3; part(tur, new THREE.BoxGeometry(0.06, 0.5, 0.06), trim, Math.cos(a) * 0.36, -0.2, Math.sin(a) * 0.36); }
      } else {
        part(tur, new THREE.BoxGeometry(0.8, 0.5, 1.0), hull);
        part(tur, new THREE.BoxGeometry(0.84, 0.08, 0.5), paint, 0, 0.27, -0.15);
        const b = group(tur, 'barrel', 0, 0, 0.5);
        part(b, new THREE.BoxGeometry(0.2, 0.2, 0.9), lit, 0, 0, 0.3);
      }
    }
  } else if (name.startsWith('enemy_')) {
    const t = name.slice(6) as EnemyType, d = ENEMIES[t];
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c2230, roughness: 0.5, metalness: 0.5, name: 'hull' });
    if (t === 'wheel') {
      // Gyre: a ring wheel (rim, pivot at its centre, axle = local X) with a hub (body) and a sensor (head) inside it
      const rim = group(g, 'rim', 0, 1.1, 0);
      part(rim, new THREE.TorusGeometry(0.95, 0.15, 8, 28).rotateY(Math.PI / 2), dark);
      for (let i = 0; i < 8; i++) { const a = (i * TAU) / 8; part(rim, new THREE.BoxGeometry(0.5, 0.06, 0.3), trim, 0, Math.sin(a) * 1.07, Math.cos(a) * 1.07).rotation.x = -a; }
      for (const sd of [-1, 1]) part(rim, new THREE.TorusGeometry(0.8, 0.02, 4, 28).rotateY(Math.PI / 2), glow(STATIC, 'glow_guard'), sd * 0.17, 0, 0);
      const body = group(g, 'body', 0, 1.1, 0);
      part(body, new THREE.BoxGeometry(0.36, 0.42, 0.6), dark, 0, -0.22, 0);
      part(body, alongZ(new THREE.CylinderGeometry(0.09, 0.09, 0.8, 8)).rotateY(Math.PI / 2), trim);
      const head = group(body, 'head', 0, 0.1, 0.2);
      for (const sd of [-1, 1]) part(head, new THREE.SphereGeometry(0.08, 8, 6), glow(STATIC), sd * 0.42, 0.12, 0.3);
      return g;
    }
    if (t === 'titan') {
      // a hull on four posts with a long head; the weak points sit where the game tests them
      const body = group(g, 'body', 0, 9.6, 0);
      part(body, new THREE.BoxGeometry(3.4, 2.6, 4.4), dark);
      const head = group(body, 'head', 0, 3.8, 2.2);
      part(head, new THREE.BoxGeometry(1.8, 0.6, 5), dark, 0, 1.1, 1.4);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, new THREE.CylinderGeometry(0.3, 0.4, 9, 6), trim, sx * 4, 4.5, sz * 3.5);
      (d.weak || []).forEach((w, i) => part(group(g, 'weak_' + (i + 1), w.x, w.y, w.z), new THREE.SphereGeometry(w.r * 0.82, 12, 8), glow(VIOLET, 'glow_weak')));
      return g;
    }
    if (t === 'mite') {
      part(group(g, 'body', 0, 0.11, 0), new THREE.BoxGeometry(0.3, 0.14, 0.42), dark);
      part(group(g, 'eye', 0, 0.11, 0), new THREE.BoxGeometry(0.1, 0.03, 0.03), glow(STATIC), 0, 0, 0.21);
      return g;
    }
    if (t === 'brood') {
      const body = group(g, 'body', 0, 0.74, 0);
      part(body, new THREE.BoxGeometry(1.6, 0.6, 2.5), dark);
      part(body, new THREE.BoxGeometry(0.5, 0.06, 0.04), glow(STATIC), 0, 0, 1.27);
      return g;
    }
    const b = part(g, new THREE.CapsuleGeometry(d.r * 0.7, d.r, 4, 10), dark, 0, t === 'drone' ? 0 : d.r * 1.2, 0);
    part(g, new THREE.SphereGeometry(d.r * 0.3, 8, 6), glow(STATIC), 0, b.position.y + d.r * 0.3, d.r * 0.6);
  } else if (name === 'hero') {
    part(g, new THREE.CapsuleGeometry(0.3, 1.1, 4, 10), new THREE.MeshStandardMaterial({ color: 0xd8cfb4 }), 0, 0.9, 0);
    const bow = part(g, new THREE.TorusGeometry(0.6, 0.04, 6, 20, Math.PI), glow(BOW_TIERS[0].color, 'glow_bow'), -0.3, 1.2, 0.5);
    bow.name = 'bow'; bow.rotation.set(0, Math.PI / 2, Math.PI / 2);
  } else if (name === 'core') {
    part(g, new THREE.CylinderGeometry(2, 2.3, 1, 6), hull, 0, 0.5, 0);
    part(g, new THREE.SphereGeometry(1.3, 20, 14), glow(SAND, 'glow_core'), 0, 2.8, 0);
  } else {
    part(g, new THREE.BoxGeometry(0.8, 0.8, 0.8), hull, 0, 0.4, 0);
  }
  return g;
}

const isUnder = (o: THREE.Object3D, root: THREE.Object3D | null | undefined) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true; return false; };
const lvlOf = (n: string) => (/^lvl([23])(_|$)/.exec(n) || [])[1];

export class View {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.3, 1500);
  post: Post;
  fx = new Fx();
  models: Record<string, THREE.Object3D> = {};
  sim: Sim | null = null;
  me = 0;
  /** Bird camera: look target on the deck, distance from it, and the angle it has been turned round it (radians). The tilt follows the distance. */
  cam = { x: 0, z: 1.5, dist: 48, rot: 0 };
  orbit = false;
  yaw = 0; pitch = -0.25;
  heroBlend = 0;
  shake = 0;
  time = 0;
  quality: 'high' | 'low' = 'high';
  /** Live settings for the deck effects (the same object the world reads). */
  fxOptions: FxOptions;
  private frame = 0;
  private ev = new Map<number, EVis>(); private epool: Record<string, EVis[]> = {};
  private tv = new Map<number, TVis>();
  private pv = new Map<number, PVis>(); private ppool: Record<string, PVis[]> = {};
  private zv = new Map<number, ZVis>();
  private wv = new Map<string, WVis>();
  private beacons: BVis[] = [];
  private teleId = 0;
  private dmgN = 0;
  private keyTex: THREE.Texture | null = null;
  private coreGlows: Glow[] = [];
  /** seconds since the core last took a hit (it flinches), and since it last fired its discharge */
  private coreHit = 9; private coreZap = 9;
  // one shared flash for a model that was just hit by an arrow: pale and brief, white for a weak point
  private hitMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xbfe0ff).multiplyScalar(0.8) });
  private critMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(0.92) });
  private heroes: HVis[] = [];
  private coreSpins: THREE.Object3D[] = [];
  private coreObj: THREE.Object3D | null = null;
  private dyn = new THREE.Group();
  private barMats: THREE.SpriteMaterial[];
  private projGeo: Record<string, THREE.BufferGeometry>;
  private projMat: Record<string, THREE.Material>;
  private rangeRing: THREE.Mesh; private cellMark: THREE.Group; private cellFill: THREE.Mesh; private cellEdge: THREE.Mesh; private cellCross: THREE.Group;
  private ghost = new THREE.Group(); private ghostType = ''; private ghostMat: THREE.MeshStandardMaterial;
  private selRing: THREE.Mesh; private teleMark: THREE.Group; private hoverMark: THREE.Mesh;
  private bowMats: THREE.MeshStandardMaterial[] = [];
  private enemyGlow = new THREE.MeshBasicMaterial({ map: glowTexture(), color: new THREE.Color(STATIC).multiplyScalar(0.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  private bubbleMat = new THREE.MeshBasicMaterial({ color: 0x4a86c8, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  private haloMats = new Map<TowerType, THREE.SpriteMaterial>();
  private metricsOf = new Map<TowerType, { r: number; tb: THREE.Box3 | null }>();
  private world: WorldApi;
  private topPos = new THREE.Vector3(); private topQ = new THREE.Quaternion();
  private heroPos = new THREE.Vector3(); private heroQ = new THREE.Quaternion();
  private dummy = new THREE.PerspectiveCamera();
  private lastHeroAnchor = new THREE.Vector3();
  private bow = new THREE.Vector3();
  private core = { x: 0, z: 0 };
  private scenery = new THREE.Group();
  private lamps: THREE.Object3D[] = [];
  private mapDef: unknown = null;
  private elev = false;
  private intro = false;
  private beatLevel = 0;
  private later: Later[] = [];
  /** Skill zones whose visuals wait for the cast pose: [x, z, delay]. */
  private zoneWait: number[][] = [];
  /** Seconds left in which arcs are drawn as a Thunderhead and missile blasts as a Swarm. */
  private thunder = 0; private swarm = 0;
  /** Arrow Rain: the shafts in the air or stuck in the deck (one instanced mesh), and the seconds since this player's own cast (the camera eases back a little for it). */
  private shafts: Shaft[] = []; private shaftMesh: THREE.InstancedMesh; private shaftN = 0; private rainT = 9;
  /** Mites: their state by enemy id, and the instanced meshes they are drawn with (built from the model on first use). */
  private mites = new Map<number, MVis>(); private miteParts: { mesh: THREE.InstancedMesh; swing: number; pivot: THREE.Vector3 }[] = [];
  /** The Titan while it roams and leaps, and its wreck after it has died. */
  private roam: Roam = { v: null, c: 0, r: 0, tx: 0, tz: 0, x: 0, y: 0, z: 0, yaw: 0, ang: -1.57, stop: false, wait: 0, face: 0, faceT: 0, leap: -1, x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, yaw1: 0, off: false, owe: false };
  private wreck: Wreck | null = null;
  private groundAt = (x: number, z: number) => (Math.abs(x) < BOARD_W / 2 + 3 && Math.abs(z) < BOARD_D / 2 + 3 ? this.deckY(x, z) : this.world.groundY ? this.world.groundY(x, z) : 0);
  /** Where a Titan foot may come down: the middle of the tile under the spot if that is free deck or road, else of the nearest tile round it that is. */
  private footing = (x: number, z: number, out: { x: number; z: number }) => {
    out.x = x; out.z = z;
    const sim = this.sim;
    if (!sim) return;
    const [cx, cz] = worldToCell(x, z);
    if (cx < 0 || cz < 0 || cx >= GW || cz >= GH) return;
    let bd = 1e9;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= GW || nz >= GH || sim.grid[nz * GW + nx] > 1) continue;
      const px = cellX(nx, nz), pz = cellZ(nz), d = (px - x) * (px - x) + (pz - z) * (pz - z);
      if (d < bd) { bd = d; out.x = px; out.z = pz; }
    }
  };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.camera.layers.enable(FX_LAYER);
    this.post = new Post(this.renderer, this.scene, this.camera, FX_LAYER);

    this.world = buildWorld(this.scene, this.renderer) as unknown as WorldApi;
    this.fxOptions = this.world.fxOptions || { impact: true, beat: true, borders: true, env: true, towers: true, intensity: 1, color: null };
    this.scene.add(this.dyn, this.fx.group);

    // hp bars: sand, apricot, rust by health; cold blue for a shield; a dark strip behind them
    this.barMats = [SAND, APRICOT, RUST, STATIC, 0x14110f].map((c, i) => new THREE.SpriteMaterial({ color: c, depthWrite: false, fog: false, transparent: i === 4, opacity: i === 4 ? 0.7 : 1 }));
    const arrow = new THREE.CylinderGeometry(0.035, 0.035, 2.6, 5); arrow.rotateX(Math.PI / 2);
    const bolt = new THREE.SphereGeometry(0.11, 8, 6); bolt.scale(1, 1, 4.2);
    const missile = new THREE.CapsuleGeometry(0.075, 0.5, 3, 6); missile.rotateX(Math.PI / 2);
    this.projGeo = { arrow, bolt, missile, shell: new THREE.SphereGeometry(0.2, 14, 10) };
    this.projMat = {
      bolt: new THREE.MeshBasicMaterial({ color: new THREE.Color(TOWERS.pulse.color).multiplyScalar(2.0) }),
      shell: new THREE.MeshBasicMaterial({ color: new THREE.Color(TOWERS.mortar.color).multiplyScalar(2.2) }),
      missile: new THREE.MeshBasicMaterial({ color: new THREE.Color(TOWERS.missile.color).multiplyScalar(0.7) }),
    };
    BOW_TIERS.forEach((b, i) => { this.projMat['arrow' + i] = new THREE.MeshBasicMaterial({ color: new THREE.Color(b.color).lerp(new THREE.Color(0xffffff), 0.25).multiplyScalar(2.3) }); });
    // Arrow Rain shafts: slim cold-white arrows, all in one draw call
    this.shaftMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.022, 0.03, 2.2, 5).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(FROST).multiplyScalar(1.35), fog: false }), SHAFTS);
    this.shaftMesh.count = 0; this.shaftMesh.frustumCulled = false; this.shaftMesh.layers.set(FX_LAYER); this.scene.add(this.shaftMesh);
    for (let i = 0; i < SHAFTS; i++) this.shafts.push({ mode: 0, t: 0, T: 1, pow: 1, tr: 0, gy: 0, p0: new THREE.Vector3(), p1: new THREE.Vector3(), p2: new THREE.Vector3(), to: new THREE.Vector3(), pos: new THREE.Vector3(), dir: new THREE.Vector3(), d0: new THREE.Vector3(), last: new THREE.Vector3() });

    const flat = (geo: THREE.BufferGeometry, color: number, opacity = 1) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
      m.layers.set(FX_LAYER);
      return m;
    };
    const put = <T extends THREE.Object3D>(o: T) => { o.visible = false; this.scene.add(o); return o; };
    this.rangeRing = put(flat(hexFlat(new THREE.RingGeometry(0.985, 1, 128)), 0xffffff, 0.7));
    this.selRing = put(flat(G_HEX_RING, SAND, 0.85));
    this.hoverMark = put(flat(G_HEX_LINE, SAND, 0.45));
    // build marker: a tile-sized plate with a rim, plus a cross when the tile cannot take a tower
    this.cellMark = put(new THREE.Group());
    this.cellFill = flat(G_HEX, SAND, 0.28); this.cellEdge = flat(G_HEX_LINE, SAND, 0.7);
    this.cellCross = new THREE.Group();
    for (const s of [-1, 1]) { const b = flat(G_BAR, RUST, 0.8); b.rotation.y = s * Math.PI / 4; b.position.y = 0.01; this.cellCross.add(b); }
    this.cellMark.add(this.cellFill, this.cellEdge, this.cellCross);
    // placement ghost: pale, lit, and it writes depth so the model keeps its form instead of stacking into a blob
    this.ghostMat = new THREE.MeshStandardMaterial({ color: 0xcfc8a4, roughness: 0.75, metalness: 0.05, transparent: true, opacity: 0.62, emissive: SAND, emissiveIntensity: 0.1, envMapIntensity: 0.4 });
    this.ghost.visible = false; this.scene.add(this.ghost);
    // where a jump will land her: a verdigris column and a ring on the platform of the Spire the controller has picked
    this.teleMark = new THREE.Group();
    const tm = new THREE.MeshBasicMaterial({ color: new THREE.Color(UPLINK).multiplyScalar(1.7), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 30, 6), tm); col.position.y = 17; this.teleMark.add(col);
    const tr = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.04, 6, 6), tm); tr.rotation.x = Math.PI / 2; tr.position.y = 0.12; this.teleMark.add(tr);
    this.teleMark.visible = false; this.scene.add(noAO(this.teleMark));
    this.resize();
  }

  async loadModels(onProgress: (f: number) => void) {
    const loader = new GLTFLoader();
    let done = 0;
    await Promise.all(MODEL_NAMES.map(async (name) => {
      let obj: THREE.Object3D;
      try { obj = (await loader.loadAsync(import.meta.env.BASE_URL + 'models/' + name + '.glb')).scene; }
      catch { obj = fallbackModel(name); }
      const enemy = name.startsWith('enemy_'), tower = name.startsWith('tower_') ? (name.slice(6) as TowerType) : null;
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true; m.receiveShadow = !enemy;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (!mat || !mat.isMeshStandardMaterial) return;
        if (mat.name && mat.name.startsWith('glow')) {
          m.castShadow = false;
          if (mat.userData.tuned) return;
          mat.userData.tuned = true;
          if (mat.emissive.getHex() === 0) mat.emissive.copy(mat.color);
          // emissive accents: bright enough to cross the bloom threshold, capped so they never white out
          mat.emissiveIntensity = name === 'core' ? 0.7 : name === 'hero' ? 1.7 : name.startsWith('prop_') ? 1.6 : enemy ? 2.1 : 2.0;
          mat.emissive.getHSL(HSL);
          if (name === 'prop_lamp') { mat.emissive.setHex(0xffb070); mat.color.setHex(0xffb070); mat.emissiveIntensity = 2.6; } // sodium lamps
          else if (enemy) { if (HSL.h < 0.2 || HSL.h > 0.88) { mat.emissive.setHex(STATIC); mat.color.setHex(STATIC); } } // the Static glows cold, whatever the file says
          else if (tower && (mat.name === 'glow_main' || mat.name === 'glow_node')) { mat.emissive.setHex(TOWERS[tower].color); mat.color.setHex(TOWERS[tower].color); }
          else if (!mat.name.startsWith('glow_bow')) mat.emissive.setHSL(HSL.h, HSL.s * 0.82, HSL.l);
          mat.color.multiplyScalar(0.25);
          if (name === 'hero' && mat.name.startsWith('glow_bow') && !this.bowMats.includes(mat)) this.bowMats.push(mat);
          return;
        }
        if (mat.userData.tuned) return;
        mat.userData.tuned = true;
        mat.envMapIntensity = 1;
        mat.color.getHSL(HSL);
        if (mat.name === 'paint') {
          // type colour becomes a muted coated-metal accent instead of flat toy paint
          if (enemy) { if (HSL.h < 0.2 || HSL.h > 0.88) { HSL.h = 0.61; HSL.s *= 0.4; } mat.color.setHSL(HSL.h, HSL.s * 0.8, Math.max(0.26, Math.min(HSL.l, 0.34))); } // pale cold plating
          else {
            if (tower) { C1.setHex(TOWERS[tower].color).getHSL(HSL); }
            mat.color.setHSL(HSL.h, HSL.s * 0.62, Math.min(HSL.l, 0.3) * 0.95);
          }
          mat.metalness = Math.max(mat.metalness, 0.55); mat.roughness = enemy ? 0.6 : 0.5; mat.envMapIntensity = 1.1;
        } else if (mat.name === 'hull') {
          // near-black hulls vanish against the dark deck: lift them to gunmetal and let reflections do the work
          mat.color.setHSL(HSL.h, HSL.s * 0.5, Math.max(HSL.l, 0.1));
          mat.metalness = 0.85; mat.roughness = enemy ? 0.58 : 0.42; mat.envMapIntensity = 1.3;
          // the spire's platform floor fills the bottom of the third-person view: keep it matte or it mirrors the sky into the bloom
          if (name === 'tower_spire') { mat.metalness = 0.6; mat.roughness = 0.7; mat.envMapIntensity = 0.55; }
        } else if (mat.name === 'trim') {
          mat.color.setHSL(HSL.h, HSL.s * 0.6, Math.min(0.5, Math.max(HSL.l, 0.3)));
          // enemy plates swing through the sun as they walk: a mirror finish there blooms to a white flash
          mat.metalness = enemy ? 0.8 : 0.95; mat.roughness = enemy ? 0.55 : 0.3; mat.envMapIntensity = enemy ? 1.1 : 1.4;
          if (name === 'tower_spire') { mat.roughness = 0.6; mat.envMapIntensity = 0.6; }
        } else {
          mat.envMapIntensity = 1.1;
        }
      });
      this.models[name] = obj;
      onProgress(++done / MODEL_NAMES.length);
    }));
    // core + props are static scenery
    const core = this.models.core.clone();
    this.scene.add(this.scenery);
    core.traverse((o) => {
      if (o.name.startsWith('spin')) this.coreSpins.push(o);
      const m = o as THREE.Mesh, mat = m.isMesh ? (m.material as THREE.MeshStandardMaterial) : null;
      if (mat && !Array.isArray(mat) && mat.name.startsWith('glow') && !this.coreGlows.some((g) => g.m === mat)) this.coreGlows.push({ m: mat, i0: mat.emissiveIntensity });
    });
    this.coreObj = core;
    this.scene.add(core);
    // lamp posts along the two long edges of the deck, every other one lit
    const hx = BOARD_W / 2, hz = BOARD_D / 2;
    for (let i = 0; i < 12; i++) {
      for (const s of [-1, 1]) {
        const l = this.models.prop_lamp.clone();
        l.position.set(-hx + 2 + i * ((hx * 2 - 4) / 11), 0, s * (hz + 1.6)); l.rotation.y = s > 0 ? Math.PI : 0;
        this.scene.add(l); this.lamps.push(l);
        if (i % 2 === (s > 0 ? 0 : 1)) {
          const pool = noAO(lightPool(4.2, 0xff9a4a, 0.3)); pool.position.set(0, 0.035, 2.0); l.add(pool); // local +z points at the deck on both sides
        } else l.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh && (mm.material as THREE.Material).name.startsWith('glow')) { mm.material = (mm.material as THREE.MeshStandardMaterial).clone(); (mm.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05; } });
      }
    }
  }

  setSim(sim: Sim | null, me = 0) {
    this.sim = sim; this.me = me;
    for (const [id, v] of this.ev) { this.poolEnemy(v); this.ev.delete(id); }
    for (const [id, v] of this.tv) { this.dropTower(v); this.tv.delete(id); }
    for (const [id, v] of this.pv) { v.mesh.visible = false; (this.ppool[v.kind] ||= []).push(v); this.pv.delete(id); }
    for (const [id, v] of this.zv) { this.dropZone(v, false); this.zv.delete(id); }
    for (const [id, v] of this.wv) { this.dropWall(v); this.wv.delete(id); }
    for (const b of this.beacons) b.obj.visible = false;
    this.mites.clear(); for (const m of this.miteParts) m.mesh.count = 0;
    if (this.roam.v) { this.poolEnemy(this.roam.v); this.roam.v = null; }
    if (this.wreck) { this.poolEnemy(this.wreck.v); this.wreck = null; }
    this.roam.leap = -1; this.roam.off = false; this.roam.owe = false;
    this.world.cityRestore?.();
    this.coreHit = this.coreZap = 9;
    for (const h of this.heroes) { h.obj.visible = false; h.out = false; h.shown = false; h.tele = 0; if (h.rig) resetHero(h.rig); }
    this.later.length = 0; this.zoneWait.length = 0;
    for (const sh of this.shafts) sh.mode = 0;
    this.shaftMesh.count = 0; this.rainT = 9;
    this.heroBlend = 0; this.thunder = 0; this.swarm = 0;
    this.setGhost(null); this.setSelected(null); this.setTele(null);
    this.hoverMark.visible = false;
    if (!sim) return;
    this.elev = sim.map.lanes.some((l) => l.ys.some((y) => y > 0));
    if (sim.map.def !== this.mapDef && this.coreObj) {
      // dress the deck for this map: road, gates, core position, wreckage on blocked tiles
      this.mapDef = sim.map.def;
      this.world.setMap(sim.map);
      this.core = sim.map.core;
      this.coreObj.position.set(this.core.x, 0, this.core.z);
      this.scenery.clear();
      sim.map.def.blocked.forEach(([cx, cz], i) => {
        const k = (cx * 7 + cz * 13 + i) % 5;
        const add = (model: string, x: number, y: number, z: number, ry: number, s: number) => {
          const o = this.models[model].clone();
          o.position.set(x, y, z); o.rotation.y = ry; o.scale.setScalar(s); o.userData.s = s;
          this.scenery.add(o);
        };
        const x = cellX(cx, cz) + ((k % 3) - 1) * 0.12, z = cellZ(cz) + ((k % 2) - 0.5) * 0.16;
        add(k < 2 ? 'prop_crate' : 'prop_barrier', x, -0.06, z, k * 1.3 + cx, k < 2 ? 1.25 : 0.95);
        if (k === 0) add('prop_crate', x + 0.1, 1.1, z - 0.1, cz, 0.85);
        else if (k === 3) add('prop_crate', x - 0.45, -0.06, z + 0.4, cx * 0.7, 0.6);
      });
    }
    // a fresh match assembles the deck; one that is already running (capture demo, attract) shows it finished
    if (sim.time > 5) this.world.skipIntro?.(); else this.world.startIntro?.();
    this.intro = true; // one more pass over the reveal scales, whatever the world says
  }

  /** Tilt of the bird camera above the horizon for a zoom distance: low and flat up close, steep from far away. */
  tiltOf(dist: number) { return 0.74 + 0.36 * ease((dist - 20) / 45); }

  /**
   * Bird camera that shows the whole board of the current map, gates included, for the current cam.rot: { x, z, dist }.
   * Nothing is moved: the caller writes the values to view.cam. bottom = share of the screen height the HUD bar covers.
   */
  frameMap(bottom = 0.1) {
    const out = { x: 0, z: 1.5, dist: 48 }, sim = this.sim;
    if (!sim) return out;
    // everything that has to be on screen: the board, the core pad, and each gate with the bunker behind it
    const pts: number[] = [], hx = BOARD_W / 2, hz = BOARD_D / 2;
    pts.push(-hx, 0, -hz, hx, 0, -hz, hx, 0, hz, -hx, 0, hz, sim.map.core.x, 5, sim.map.core.z);
    for (const L of sim.map.lanes) {
      const a = L.pts[0], b = L.pts[1] || a, l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, dx = (b[0] - a[0]) / l, dz = (b[1] - a[1]) / l, y = L.ys[0] || 0;
      for (const s of [-1, 1]) pts.push(a[0] - dx * 4.6 - dz * 2.4 * s, y + 4.5, a[1] - dz * 4.6 + dx * 2.4 * s, a[0] - dz * 2.4 * s, y, a[1] + dx * 2.4 * s);
    }
    const rot = this.cam.rot, cam = this.dummy, lo = Math.min(0.6, -1 + 2 * bottom + 0.05), hi = 0.84, wide = 0.95;
    cam.fov = 42; cam.aspect = this.camera.aspect; cam.updateProjectionMatrix();
    let x = 0, z = 0, dist = 48;
    for (let it = 0; it < 10; it++) {
      const tl = this.tiltOf(dist), h = dist * Math.cos(tl);
      cam.position.set(x + Math.sin(rot) * h, dist * Math.sin(tl), z + Math.cos(rot) * h); cam.lookAt(x, 0, z); cam.updateMatrixWorld();
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (let i = 0; i < pts.length; i += 3) { V.set(pts[i], pts[i + 1], pts[i + 2]).project(cam); x0 = Math.min(x0, V.x); x1 = Math.max(x1, V.x); y0 = Math.min(y0, V.y); y1 = Math.max(y1, V.y); }
      // slide the look target until the picture is centred in the free part of the screen, then zoom until it fills it
      const tx = Math.tan((42 * Math.PI) / 360), ex = ((x0 + x1) / 2) * dist * tx * cam.aspect, ey = ((y0 + y1) / 2 - (lo + hi) / 2) * dist * tx / Math.sin(tl);
      x += Math.cos(rot) * ex - Math.sin(rot) * ey; z += -Math.sin(rot) * ex - Math.cos(rot) * ey;
      dist = Math.max(26, Math.min(120, dist * Math.max((x1 - x0) / (2 * wide), (y1 - y0) / (hi - lo))));
    }
    out.x = x; out.z = z; out.dist = dist;
    return out;
  }

  skipIntro() { this.world.skipIntro?.(); }
  introActive() { return !!this.world.introActive?.(); }
  /** One coloured ripple along the tile borders, outward from (x, z). */
  pulse(x: number, z: number, color: number, radius: number, strength = 1) { this.world.pulse?.(x, z, color, radius, strength); }
  /** Beat envelope 0..1 from the music: the deck and (subtly) the tower lights breathe with it. */
  beat(level: number) { this.beatLevel = sat(level); this.world.setBeat?.(this.beatLevel); }

  setQuality(q: 'high' | 'low') {
    this.quality = q;
    this.renderer.shadowMap.enabled = q === 'high';
    this.world.sun.castShadow = q === 'high';
    this.renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1);
    this.resize();
  }

  resize() {
    const c = this.renderer.domElement, w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- deck height ----------
  /** Height of the deck or road surface at a world position. */
  deckY(x: number, z: number): number {
    if (this.world.roadY) return this.world.roadY(x, z);
    if (!this.elev || !this.sim) return 0;
    // no world to ask: take it from the lanes themselves (a road is about one tile wide)
    let best = 0;
    for (const L of this.sim.map.lanes) {
      for (let i = 1; i < L.pts.length; i++) {
        if (L.ys[i] <= 0 && L.ys[i - 1] <= 0) continue;
        const a = L.pts[i - 1], b = L.pts[i], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
        const u = sat(((x - a[0]) * dx + (z - a[1]) * dz) / l2);
        if (Math.hypot(x - a[0] - dx * u, z - a[1] - dz * u) < 1.05) best = Math.max(best, L.ys[i - 1] + (L.ys[i] - L.ys[i - 1]) * u);
      }
    }
    return best;
  }
  private reveal(x: number, z: number) { return this.intro && this.world.revealAt ? ease(this.world.revealAt(x, z)) : 1; }
  /** Distance along a ray to the deck (flat or raised), or Infinity. */
  private rayDeck(o: THREE.Vector3, d: THREE.Vector3, max: number) {
    if (!this.elev) return d.y < -1e-4 ? -o.y / d.y : Infinity;
    const step = 0.5;
    for (let t = step; t <= max; t += step) {
      const y = o.y + d.y * t;
      if (y > 8 && d.y >= 0) break;
      if (y <= this.deckY(o.x + d.x * t, o.z + d.z * t)) {
        let lo = t - step, hi = t;
        for (let i = 0; i < 7; i++) { const m = (lo + hi) / 2; if (o.y + d.y * m <= this.deckY(o.x + d.x * m, o.z + d.z * m)) hi = m; else lo = m; }
        return hi;
      }
    }
    return Infinity;
  }

  // ---------- picking ----------
  groundPoint(clientX: number, clientY: number, out = new THREE.Vector3()) {
    const r = this.renderer.domElement.getBoundingClientRect();
    V.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    const u = V.y < -1e-4 ? -this.camera.position.y / V.y : 200;
    return out.copy(this.camera.position).addScaledVector(V, u);
  }
  /** Third-person camera position and view direction for the look angles as they are right now. */
  private camPose(pos: THREE.Vector3, dir: THREE.Vector3) {
    const cp = Math.cos(this.pitch), fx = Math.sin(this.yaw) * cp, fy = Math.sin(this.pitch), fz = Math.cos(this.yaw) * cp;
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw), a = this.lastHeroAnchor;
    // looking up swings the camera down: stop above the platform floor
    pos.set(a.x - fx * CAM_BACK + rx * CAM_SIDE, Math.max(a.y + 0.6, a.y + CAM_UP - fy * CAM_BACK), a.z - fz * CAM_BACK + rz * CAM_SIDE);
    dir.set(fx, fy, fz);
  }
  /**
   * The point under the crosshair. A plain ray cast with no help: enemy bodies at their true radius, weak points,
   * tower power nodes and the deck (raised roads included). Hits nothing: a point far along the ray.
   */
  aimPoint(out = new THREE.Vector3()) {
    this.camPose(RO, RD);
    const o = RO, d = RD, sim = this.sim;
    let best = Math.min(AIM_FAR, this.rayDeck(o, d, AIM_FAR));
    const hit = (x: number, y: number, z: number, r: number) => {
      const u = raySphere(o.x, o.y, o.z, d.x, d.y, d.z, x, y, z, r);
      // anything nearer than Kestrel herself is behind the bow
      if (u > CAM_BACK * 0.8 && u < best) best = u;
    };
    if (sim) {
      for (const e of sim.enemies) {
        if (!e.alive) continue;
        hit(e.x, e.y, e.z, e.r);
        const wk = ENEMIES[e.type].weak;
        if (wk) for (let i = 0; i < wk.length; i++) if (weakPos(e, i, W3)) hit(W3.x, W3.y, W3.z, wk[i].r * ENEMY_SCALE[e.type]);
      }
      const me = sim.players[this.me];
      for (const t of sim.towers) {
        if (TOWERS[t.type].special) { nodePos(t, W3); hit(W3.x, W3.y, W3.z, NODE_R); }
        // the jump target above every other Spire: an arrow through it carries her over
        else if (t.type === 'spire' && me && me.heroActive && t.id !== me.heroTower) { spireTarget(t, W3); hit(W3.x, W3.y, W3.z, SPIRE_R); }
      }
    }
    return out.copy(o).addScaledVector(d, best);
  }
  /** Spire under the crosshair (teleport target), or 0. Only other Uplink Spires count. */
  aimTower(): number {
    if (!this.sim) return 0;
    const p = this.sim.players[this.me];
    this.camPose(RO, RD);
    let best = 0, bu = Infinity;
    for (const t of this.sim.towers) {
      if (t.type !== 'spire' || t.id === p.heroTower) continue;
      // closest approach of the ray to the spire's axis (ground to a little above the platform)
      const wx = RO.x - t.x, wz = RO.z - t.z, top = t.h + 1.4;
      const a = RD.x * RD.x + RD.z * RD.z;
      let u = a > 1e-6 ? -(wx * RD.x + wz * RD.z) / a : 0;
      if (u < 0) continue;
      let y = RO.y + RD.y * u;
      if (y > top && RD.y < -1e-4) { u = (top - RO.y) / RD.y; y = top; } else if (y < 0 && RD.y > 1e-4) { u = -RO.y / RD.y; y = 0; }
      if (y > top + 0.01 || y < -0.01) continue;
      if (Math.hypot(wx + RD.x * u, wz + RD.z * u) < 1.25 && u < bu) { bu = u; best = t.id; }
    }
    return best;
  }
  project(x: number, y: number, z: number): [number, number, boolean] {
    V.set(x, y, z).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return [(V.x * 0.5 + 0.5) * r.width, (-V.y * 0.5 + 0.5) * r.height, V.z < 1 && Math.abs(V.x) < 1.1 && Math.abs(V.y) < 1.1];
  }

  // ---------- markers ----------
  setGhost(type: TowerType | null, cx = 0, cz = 0, ok = true, range = 0) {
    this.ghost.visible = this.cellMark.visible = !!type;
    if (!type) { if (!this.selRing.visible) this.rangeRing.visible = false; return; }
    if (this.ghostType !== type) {
      this.ghost.clear();
      const g = this.models['tower_' + type].clone();
      g.scale.setScalar(TOWER_SCALE);
      g.traverse((o) => {
        if (lvlOf(o.name) || o.name === 'node') o.visible = false;
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.material = this.ghostMat; m.castShadow = false; m.receiveShadow = false; m.layers.set(FX_LAYER); }
      });
      this.ghost.add(g); this.ghostType = type;
    }
    const x = cellX(cx, cz), z = cellZ(cz), y = this.deckY(x, z), c = ok ? SAND : RUST; // validity never borrows the tower colour: some of those are red
    this.ghost.position.set(x, y, z);
    this.ghost.visible = ok;
    this.cellMark.position.set(x, y + 0.045, z);
    this.cellCross.visible = !ok;
    (this.cellFill.material as THREE.MeshBasicMaterial).color.setHex(ok ? SAND : RUST);
    (this.cellEdge.material as THREE.MeshBasicMaterial).color.setHex(ok ? SAND : RUST);
    this.rangeRing.visible = range > 0; this.rangeRing.position.set(x, y + 0.06, z); this.rangeRing.scale.setScalar(Math.max(0.01, range));
    (this.rangeRing.material as THREE.MeshBasicMaterial).color.setHex(c);
  }
  setSelected(t: Tower | null, range = 0) {
    this.selRing.visible = !!t;
    if (!t) { if (!this.ghost.visible && !this.cellMark.visible) this.rangeRing.visible = false; return; }
    this.selRing.position.set(t.x, 0.08, t.z);
    this.rangeRing.visible = range > 0; this.rangeRing.position.set(t.x, 0.06, t.z); this.rangeRing.scale.setScalar(Math.max(0.01, range));
    (this.rangeRing.material as THREE.MeshBasicMaterial).color.setHex(TOWERS[t.type].color);
  }
  setHover(cx: number, cz: number, show: boolean) {
    this.hoverMark.visible = show;
    if (show) this.hoverMark.position.set(cellX(cx, cz), 0.05, cellZ(cz));
  }
  /** Mark a Spire as the jump target the controller has picked (its beacon lights up, a column shows where she will land). */
  setTele(t: Tower | null) {
    this.teleMark.visible = !!t && t.type === 'spire';
    this.teleId = t && t.type === 'spire' ? t.id : 0;
    if (t) this.teleMark.position.set(t.x, standY(t), t.z);
  }

  // ---------- events to effects ----------
  /** Route a sim event to player p's hero rig. */
  private heroAnim(p: unknown, ev: HeroEvent, pw = 1) {
    const h = this.heroes[p as number];
    if (h && h.rig) heroTrigger(h.rig, ev, pw);
  }
  /** The enemy a player damaged at (x, z) in the batch of events being handled, or -1. tol = how far off the spot may be (squared). */
  private dmgId(x: number, z: number, tol: number) {
    let id = -1;
    for (let i = 0; i < this.dmgN; i++) { const d = (DMG[i * 3 + 1] - x) * (DMG[i * 3 + 1] - x) + (DMG[i * 3 + 2] - z) * (DMG[i * 3 + 2] - z); if (d < tol) { tol = d; id = DMG[i * 3]; } }
    return id;
  }
  /**
   * An arrow struck at (x, y, z): the model it hit flashes for an instant and sparks leave along the arrow's path.
   * crit = a weak point. id = the enemy it hit, or -1 for the deck.
   */
  private arrowHit(x: number, y: number, z: number, color: number, crit: boolean, id: number) {
    const sim = this.sim, fx = this.fx;
    if (!sim) return;
    const v = id >= 0 ? this.ev.get(id) : undefined;
    if (v) this.flashEnemy(v, crit);
    // direction of travel: from the bow of whoever is linked (her own first)
    let o = sim.players[this.me]?.heroActive ? sim.heroOrigin(this.me) : null;
    for (let i = 0; !o && i < sim.players.length; i++) if (sim.players[i].heroActive) o = sim.heroOrigin(i);
    let dx = 0, dy = 0.4, dz = 0;
    if (o) { dx = x - o.x; dy = y - o.y; dz = z - o.z; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l; }
    if (crit) {
      // weak point: a hard cold star, and the far side of the hull comes out with it
      fx.star(x, y, z, 1.5, FROST, 7, 0.2);
      fx.flash(x, y, z, 0.9, 0xffffff, 0.12);
      fx.spray(x, y, z, dx, dy, dz, 16, 13, SINGC, 0.5, 0.26, 0.35);
      fx.spray(x, y, z, -dx, -dy, -dz, 6, 6, HEAT, 0.5, 0.18, 0.6);
    } else {
      fx.flash(x, y, z, v ? 0.55 : 0.35, color, 0.09);
      fx.spray(x, y, z, dx, dy, dz, v ? 6 : 3, 9, color, 0.3, 0.2, 0.35);
      fx.spray(x, y, z, -dx * 0.6, 0.5, -dz * 0.6, v ? 4 : 3, 5, HEAT, 0.35, 0.14, 0.6);
    }
  }
  private flashEnemy(v: EVis, crit: boolean) {
    // the Titan is hit almost without pause and fills the screen: a whole-model flash would leave it a white cut-out.
    // Its hits show as sparks and bursts at the point instead.
    if (v.type === 'titan') return;
    const m = crit ? this.critMat : this.hitMat;
    if (v.hitT <= 0) for (const o of v.meshes) o.material = m;
    else if (crit) for (const o of v.meshes) o.material = m;
    v.hitT = crit ? 0.085 : 0.05;
  }
  /**
   * Camera shake that falls off with distance from the camera. In the Uplink only big events (a special going off, the
   * core being hit) reach the camera at all: her own arrows, hits and ordinary blasts never move the picture she aims with.
   */
  private bump(a: number, x: number, z: number, big = false) {
    if (this.heroBlend > 0.5 && !big) return;
    const d = Math.hypot(x - this.camera.position.x, z - this.camera.position.z);
    this.shake = Math.max(this.shake, a * Math.max(0.12, Math.min(1, 1.5 - d / 30)));
  }

  handle(evs: Ev[]) {
    const fx = this.fx, sim = this.sim;
    // a special's own effects (the chain of a Thunderhead, the first missiles of a Swarm) sit in the same batch ahead of its event
    this.dmgN = 0;
    for (const e of evs) {
      if (e.k === 'special') { if (e.t === 'arc') this.thunder = 0.2; else if (e.t === 'missile') this.swarm = 5; }
      // who a player hurt in this batch: lets an arrow's 'hit' find the model it struck
      else if (e.k === 'dmg' && e.p >= 0 && typeof e.id === 'number' && this.dmgN < 32) { DMG[this.dmgN * 3] = e.id; DMG[this.dmgN * 3 + 1] = e.x; DMG[this.dmgN * 3 + 2] = e.z; this.dmgN++; }
    }
    for (const e of evs) {
      switch (e.k) {
        case 'shot': {
          const tv = this.tv.get(e.id), c = TOWERS[e.t as TowerType]?.color ?? 0xffffff;
          fx.burst(e.x, e.y, e.z, 2, 3, c, 0.12, 0.24, 0);
          if (tv) towerShot(tv.rig, +e.d || 0);
          const t = sim && sim.towerById(e.id);
          if (e.t === 'missile') { fx.puff(e.x, e.y, e.z, 0.9, 0.9, 1.2); fx.burst(e.x, e.y, e.z, 5, 4, HEAT, 0.3, 0.22, 3, 1); }
          else if (e.t === 'mortar') { fx.puff(e.x, e.y + 0.3, e.z, 0.8, 1.0, 1.4); if (t && t.spec > 0) { fx.flash(e.x, e.y + 0.4, e.z, 1.3, c, 0.14); fx.burst(e.x, e.y + 0.3, e.z, 8, 7, HEAT, 0.4, 0.24, 8, 1.4); } }
          else if (e.t === 'pulse' && t && t.spec > 0) {
            // Bullet Storm: every shot throws a tracer and a casing
            const sn = Math.sin(t.yaw), cs = Math.cos(t.yaw);
            fx.beam(e.x + sn * 0.9, e.y, e.z + cs * 0.9, e.x + sn * 5.5, e.y - 0.5, e.z + cs * 5.5, c, 0.1, 0.09);
            fx.flash(e.x + sn * 1.0, e.y, e.z + cs * 1.0, 0.55, c, 0.07);
            fx.spark(e.x - cs * 0.3, e.y, e.z + sn * 0.3, -cs * 3 + (Math.random() - 0.5), 2.5, sn * 3 + (Math.random() - 0.5), 0.5, 0.16, HEAT, 12);
          }
          break;
        }
        case 'hit':
          // a turret bolt: a couple of sparks. An arrow: the model answers (see arrowHit)
          {
            const id = this.dmgId(e.x, e.z, 1e-4);
            if (id >= 0 || e.y <= 0.11) this.arrowHit(e.x, e.y, e.z, e.c, false, id);
            else { fx.burst(e.x, e.y, e.z, 3, 4, e.c, 0.2, 0.22, 6); fx.burst(e.x, e.y, e.z, 2, 5, HEAT, 0.3, 0.14, 12); }
          }
          break;
        case 'cryo': {
          const tv = this.tv.get(e.id); if (tv) towerShot(tv.rig);
          const gy = this.deckY(e.tx, e.tz);
          fx.beam(e.x, e.y, e.z, e.tx, e.ty, e.tz, TOWERS.cryo.color, 0.16, 0.22);
          fx.ring(e.tx, gy + 0.1, e.tz, e.r, TOWERS.cryo.color, 0.4);
          fx.burst(e.tx, e.ty, e.tz, 8, 3.5, FROST, 0.5, 0.2, 1);
          break;
        }
        case 'arc': {
          if (!Array.isArray(e.p)) break;
          const storm = !!e.big || this.thunder > 0, n = e.p.length;
          fx.arc(e.p, e.c, storm ? 0.2 : 0.07);
          if (storm && n >= 6) {
            fx.arc(e.p, 0xffffff, 0.06);
            for (let i = 3; i + 2 < n && i < 24; i += 3) { fx.flash(e.p[i], e.p[i + 1], e.p[i + 2], 1.3, e.c, 0.2); this.pulse(e.p[i], e.p[i + 2], e.c, 4, 0.6); }
          }
          break;
        }
        case 'rail': this.railFx(e); break;
        case 'boom': {
          const gy = this.deckY(e.x, e.z);
          fx.boom(e.x, e.y, e.z, e.r, e.c, !!e.s, Math.min(gy, e.y));
          if (!e.s) { this.bump(0.12, e.x, e.z); this.pulse(e.x, e.z, e.c, e.r * 2.4, 0.8); }
          else if (this.swarm > 0 && e.c === TOWERS.missile.color) this.pulse(e.x, e.z, e.c, 3, 0.5);
          break;
        }
        case 'die': {
          if (e.t === 'mite') { // a pop and a pinch of sparks: there can be dozens
            fx.burst(e.x, e.y, e.z, 4, 3.5, STATIC, 0.3, 0.2, 8); fx.flash(e.x, e.y, e.z, 0.45, STATIC, 0.1);
            if (Math.random() < 0.4) fx.puff(e.x, e.y, e.z, 0.3, 0.5, 0.5);
            break;
          }
          const big = e.t === 'boss', mid = e.t === 'brute' || e.t === 'shield' || e.t === 'wheel' || e.t === 'brood', gy = this.deckY(e.x, e.z);
          fx.burst(e.x, e.y, e.z, big ? 70 : mid ? 14 : 6, big ? 15 : 6, STATIC, big ? 1.1 : 0.45, big ? 0.5 : 0.28, 10);
          fx.burst(e.x, e.y, e.z, big ? 40 : mid ? 8 : 4, big ? 11 : 5, HEAT, big ? 1.3 : 0.7, 0.2, 14);
          fx.flash(e.x, e.y, e.z, big ? 5 : mid ? 1.5 : 0.9, STATIC, big ? 0.45 : 0.16);
          fx.smoke(e.x, e.y + 0.2, e.z, big ? 12 : mid ? 3 : 1, big ? 2.6 : mid ? 1.2 : 0.8, big ? 3 : 0.6);
          if (e.y - gy < 2 && (big || mid || Math.random() < 0.35)) fx.scorch(e.x, e.z, big ? 5 : mid ? 1.7 : 1.1, APRICOT, big ? 10 : 5, gy);
          if (big) { fx.ring(e.x, gy + 0.15, e.z, 9, VIOLET, 0.9); fx.column(e.x, gy, e.z, FROST); this.bump(0.8, e.x, e.z, true); this.pulse(e.x, e.z, STATIC, 14, 1); }
          // a Gyre is a mini-boss: its wheel goes with a ring and a ripple of its own
          else if (e.t === 'wheel') { fx.ring(e.x, gy + 0.12, e.z, 4.5, STATIC, 0.6); fx.burst(e.x, e.y, e.z, 26, 9, STATIC, 0.7, 0.3, 9); this.bump(0.35, e.x, e.z); this.pulse(e.x, e.z, STATIC, 8, 0.9); }
          break;
        }
        case 'brood': {
          // a swarm leaves: the lids fly open, cold light and a breath of vapour off the carrier's back
          const v = this.ev.get(e.id), gy = this.deckY(e.x, e.z);
          if (v) v.rig.open = 1.5;
          fx.burst(e.x, e.y + 0.4, e.z, 16, 4.5, STATIC, 0.5, 0.2, 7, 1.1); fx.flash(e.x, e.y + 0.5, e.z, 1.3, STATIC, 0.16);
          fx.puff(e.x, e.y + 0.6, e.z, 0.9, 0.8, 0.9); fx.ring(e.x, gy + 0.1, e.z, 2.0, STATIC, 0.4);
          break;
        }
        case 'jam': {
          // the mites are on it: a crackle runs up the tower and its tile answers
          const t = sim && sim.towerById(e.id), h = t ? t.h : 3, a = Math.random() * TAU;
          fx.arc([e.x + Math.cos(a) * 0.6, 0.3, e.z + Math.sin(a) * 0.6, e.x - Math.cos(a) * 0.4, h * 0.55, e.z - Math.sin(a) * 0.4, e.x, h, e.z], STATIC, 0.05);
          fx.burst(e.x, h * 0.8, e.z, 12, 4, STATIC, 0.45, 0.2, 6); fx.flash(e.x, h * 0.7, e.z, 1.2, VIOLET, 0.16);
          fx.ring(e.x, 0.1, e.z, 1.7, VIOLET, 0.4, 1.6, 0.8); this.pulse(e.x, e.z, STATIC, 3, 0.7);
          break;
        }
        case 'unjam': {
          const v = this.tv.get(e.id), t = sim && sim.towerById(e.id), c = t ? TOWERS[t.type].color : SAND;
          if (v) v.boot = 0;
          fx.ring(e.x, 0.1, e.z, 1.9, c, 0.45); fx.burst(e.x, t ? t.h * 0.7 : 2, e.z, 8, 3, c, 0.45, 0.2, -2, 1);
          break;
        }
        case 'titanSmash': this.titanSmash(); break;
        case 'titanLand': this.titanLeap(e.x, e.z, +e.lane || 0, 0); break;
        case 'titanImpact': {
          // it lands: a shock wave over the whole deck, dust rolling out from the gate, and a camera that takes the blow
          const gy = this.deckY(e.x, e.z);
          fx.flash(e.x, gy + 3, e.z, 16, STATIC, 0.4); fx.flash(e.x, gy + 2, e.z, 8, 0xffffff, 0.16);
          fx.ring(e.x, gy + 0.15, e.z, 26, DUST, 1.3, 0.06, 1.3); fx.ring(e.x, gy + 0.2, e.z, 15, STATIC, 0.7, 0.08);
          fx.burst(e.x, gy + 0.5, e.z, 90, 16, DUST, 1.1, 0.4, 11, 0.5); fx.burst(e.x, gy + 1, e.z, 40, 13, STATIC, 0.8, 0.34, 8);
          for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU, r = 3 + Math.random() * 5; fx.smoke(e.x + Math.cos(a) * r, gy + 0.3, e.z + Math.sin(a) * r, 2, 2.4, 1.5, 0.7); }
          fx.scorch(e.x, e.z, 7, STATIC, 12, gy);
          this.pulse(e.x, e.z, STATIC, 85, 1); this.later.push({ t: 0.22, fn: () => this.pulse(e.x, e.z, VIOLET, 85, 0.9) }); this.later.push({ t: 0.5, fn: () => this.pulse(e.x, e.z, FROST, 60, 0.6) });
          this.shake = Math.max(this.shake, 3);
          break;
        }
        case 'titanStrike': {
          // its blow on the core (the 'leak' in the same batch makes the core flinch): the deck rings with it
          const cx = this.core.x, cz = this.core.z;
          fx.ring(cx, 0.2, cz, 12, RUST, 0.8, 0.08, 1.2); fx.burst(cx, 2.5, cz, 50, 13, RUST, 0.9, 0.34, 9); fx.smoke(cx, 1, cz, 6, 2, 3, 1);
          this.pulse(cx, cz, RUST, 40, 1); this.shake = Math.max(this.shake, 1.6);
          break;
        }
        case 'titanDie': this.titanDie(e.x, e.y, e.z); break;
        case 'crit': this.arrowHit(e.x, e.y, e.z, FROST, true, this.dmgId(e.x, e.z, 16)); break;
        case 'crack': fx.star(e.x, e.y, e.z, 2.6, VIOLET, 9, 0.35); fx.burst(e.x, e.y, e.z, 26, 8, VIOLET, 0.8, 0.3, 9); fx.smoke(e.x, e.y, e.z, 3, 1.2, 1); break;

        case 'shieldbreak': fx.burst(e.x, e.y, e.z, 14, 7, STATIC, 0.5, 0.24, 3); fx.flash(e.x, e.y, e.z, 1.5, STATIC, 0.18); break;
        case 'deflect': this.deflectFx(e.x, e.y, e.z); break;
        case 'spindown': {
          // the rim stalls: the guard goes out in a burst, hot metal off the tread (the rig staggers on its own)
          const gy = this.deckY(e.x, e.z), ws = ENEMY_SCALE.wheel;
          fx.flash(e.x, e.y, e.z, 1.5 * ws, STATIC, 0.16);
          fx.burst(e.x, e.y, e.z, 20, 7, STATIC, 0.5, 0.26, 5); fx.burst(e.x, gy + 0.2, e.z, 12, 6, HEAT, 0.6, 0.2, 12);
          fx.ring(e.x, gy + 0.1, e.z, 2.4 * ws, STATIC, 0.4); fx.smoke(e.x, gy + 0.5, e.z, 2, 0.8 * ws, 0.7, 0.6);
          break;
        }
        case 'spinup': {
          // back up to speed: light climbs the rim and the guard flares as it closes again
          const v = this.ev.get(e.id), gy = this.deckY(e.x, e.z), ws = ENEMY_SCALE.wheel;
          if (v && v.guard) v.guard.surge = 1.4;
          const yaw = v ? v.obj.rotation.y : 0, sn = Math.sin(yaw), cs = Math.cos(yaw);
          fx.ring(e.x, gy + 0.1, e.z, 0.4 * ws, STATIC, 0.55, 6.5, 0.8);
          for (let i = 0; i < 16; i++) { const a = Math.random() * TAU, c = Math.cos(a) * 1.02 * ws, h = Math.sin(a) * 1.02 * ws; fx.spark(e.x + sn * c, e.y + h, e.z + cs * c, sn * c * 0.6, 2.2 + Math.random() * 2.2, cs * c * 0.6, 0.45 + Math.random() * 0.3, 0.2, STATIC, -1.5); }
          fx.flash(e.x, e.y, e.z, 1.9 * ws, STATIC, 0.34);
          break;
        }
        case 'build': if (this.reveal(e.x, e.z) < 0.5) break; // placed before its tile has arrived (a bot at second zero)
          fx.ring(e.x, 0.1, e.z, 2.0, e.c, 0.5); fx.burst(e.x, 0.3, e.z, 12, 4, e.c, 0.6, 0.24, -3, 1); fx.smoke(e.x, 0.2, e.z, 3, 1, 1.6, 0.35); this.pulse(e.x, e.z, e.c, 3.5, 0.6); break;
        case 'sell': fx.burst(e.x, 0.8, e.z, 12, 5, SAND, 0.6, 0.24, 9); fx.smoke(e.x, 0.4, e.z, 3, 1.1, 1.2, 0.5); break;
        case 'arrow': {
          // the release is as strong as the draw was: a weak loose is a twitch of the string, a full one cracks
          // (no flash at the bow: nothing of her own shot may get between the player and the target)
          this.heroAnim(e.p, 'arrow', typeof e.pw === 'number' ? sat(e.pw) : 1);
          break;
        }
        case 'heroOn': { const h = this.hero(+e.p); h.out = false; h.tele = 0; h.pos.set(e.x, e.y, e.z); this.heroAnim(e.p, 'on'); }
          // a slim shaft of light: a wide column would hide the whole materialise animation from the camera behind her
          fx.beam(e.x, e.y, e.z, e.x, e.y + 30, e.z, UPLINK, 0.2, 0.45); this.shake = Math.max(this.shake, 0.3); this.pulse(e.x, e.z, UPLINK, 9, 1); break;
        case 'heroOff': { const h = this.heroes[+e.p]; if (h && h.rig && h.shown) { h.out = true; h.tele = 0; h.pos.set(e.x, e.y, e.z); heroTrigger(h.rig, 'off'); } }
          fx.beam(e.x, e.y, e.z, e.x, e.y + 18, e.z, UPLINK, 0.2, 0.5); break;
        case 'tele': { const h = this.heroes[+e.p]; if (h && h.rig) { h.tele = 0.13; h.pos.set(e.fx, e.fy, e.fz); heroTrigger(h.rig, 'teleOut'); } }
          fx.beam(e.fx, e.fy, e.fz, e.fx, e.fy + 12, e.fz, UPLINK, 0.2, 0.4); fx.beam(e.x, e.y, e.z, e.x, e.y + 22, e.z, UPLINK, 0.2, 0.45); this.pulse(e.x, e.z, UPLINK, 6, 0.7); break;
        case 'skill': {
          const rain = e.s === 1, wait = SKILL_CAST[rain ? 1 : 2];
          this.heroAnim(e.p, rain ? 'rain' : 'sing');
          if (rain) {
            // the marker is on the ground at once and fills while the volley is up; the volley leaves on the release beat
            if (+e.p === this.me) this.rainT = 0;
            this.later.push({ t: wait, fn: () => this.rainVolley(+e.p, e.x, typeof e.y === 'number' ? e.y : this.deckY(e.x, e.z), e.z) });
            this.later.push({ t: RAIN_LAND, fn: () => this.pulse(e.x, e.z, SAND, 8, 1) });
            break;
          }
          this.zoneWait.push([e.x, e.z, wait]);
          this.later.push({ t: wait, fn: () => { fx.ring(e.x, this.deckY(e.x, e.z) + 0.15, e.z, 5, UPLINK, 0.5, 1.4, 0.6); this.pulse(e.x, e.z, UPLINK, -10, 1); } });
          break;
        }
        case 'lance': {
          const v = this.tv.get(e.id);
          if (!v) break;
          v.lnT = 0.34; v.lnX = e.tx; v.lnY = e.ty; v.lnZ = e.tz; v.lnY0 = e.y; v.lnHeat = +e.heat || 0; v.lnOver = !!e.o;
          towerShot(v.rig);
          break;
        }
        case 'gravity': {
          const v = this.tv.get(e.id), c = TOWERS.gravity.color;
          if (v) towerShot(v.rig);
          // the pulse runs inward: a ring that closes on the well, dust dragged along with it
          fx.ring(e.x, 0.12, e.z, e.r * 0.1, c, 0.6, 10, 0.3);
          this.pulse(e.x, e.z, c, -e.r, 0.5);
          for (let i = 0; i < 18; i++) { const a = Math.random() * TAU, r = e.r * (0.5 + Math.random() * 0.5); fx.spark(e.x + Math.cos(a) * r, 0.2 + Math.random() * 1.2, e.z + Math.sin(a) * r, -Math.cos(a) * r * 1.8, 0.4, -Math.sin(a) * r * 1.8, 0.55, 0.24, c); }
          break;
        }
        case 'special': this.specialFx(e); break;
        case 'nospec': {
          // the node was hit but its special has nothing to reach: a dull fizzle, the charge stays
          const v = this.tv.get(e.id), t = sim && sim.towerById(e.id);
          if (v) v.deny = 0.45;
          if (t) { nodePos(t, W3); fx.burst(W3.x, W3.y, W3.z, 7, 2.2, 0x8a8478, 0.35, 0.14, 7); fx.puff(W3.x, W3.y, W3.z, 0.45, 0.6, 0.5); fx.ring(W3.x, W3.y - 0.5, W3.z, 0.9, 0x6a655c, 0.3, 0.5, 0.8); }
          break;
        }
        case 'down': {
          const t = sim && sim.towerById(e.id), y = t ? t.h : 2;
          fx.burst(e.x, y * 0.8, e.z, 12, 4, HEAT, 0.7, 0.2, 10);
          fx.smoke(e.x, y * 0.8, e.z, 3, 0.9, 0.6, 0.7);
          break;
        }
        case 'up': {
          const v = this.tv.get(e.id), t = sim && sim.towerById(e.id), c = t ? TOWERS[t.type].color : SAND;
          if (v) v.boot = 0;
          fx.ring(e.x, 0.12, e.z, 2.6, c, 0.6);
          fx.burst(e.x, t ? t.h * 0.6 : 1.5, e.z, 16, 4, c, 0.6, 0.22, -2, 1);
          if (t) fx.beam(e.x, 0.3, e.z, e.x, t.h + 0.5, e.z, c, 0.25, 0.3);
          this.pulse(e.x, e.z, c, 4.5, 0.9);
          break;
        }
        case 'leak': {
          // the core takes the blow: it flinches, its light stutters, the hit shows on the side it came from
          const hx = typeof e.x === 'number' ? e.x : this.core.x, hz = typeof e.z === 'number' ? e.z : this.core.z, l = Math.hypot(hx - this.core.x, hz - this.core.z);
          const sx = l > 0.3 ? this.core.x + ((hx - this.core.x) / l) * Math.min(l, 1.6) : this.core.x, sz = l > 0.3 ? this.core.z + ((hz - this.core.z) / l) * Math.min(l, 1.6) : this.core.z;
          this.coreHit = 0;
          fx.ring(this.core.x, 0.2, this.core.z, 6, RUST, 0.7); fx.burst(sx, 2, sz, 24, 9, RUST, 0.8, 0.3, 8); fx.flash(sx, 2, sz, 1.6, RUST, 0.18);
          this.bump(0.3, this.core.x, this.core.z, true); this.pulse(this.core.x, this.core.z, RUST, 8, 1);
          break;
        }
        case 'breach': {
          // the core answers: a discharge from its heart into the machine that struck it, and nothing is left standing there
          const v = this.ev.get(e.id), big = e.t === 'boss', mid = e.t === 'brute' || e.t === 'shield' || e.t === 'wheel' || e.t === 'brood';
          const x = v ? v.obj.position.x : e.x, z = v ? v.obj.position.z : e.z, y = typeof e.y === 'number' ? e.y : 1, gy = this.deckY(x, z);
          const cx = this.core.x, cz = this.core.z, cy = 2.7;
          this.coreZap = 0;
          fx.arc([cx, cy, cz, (cx + x) / 2, (cy + y) / 2 + 0.9, (cz + z) / 2, x, y, z], SAND, 0.26);
          fx.arc([cx, cy, cz, (cx + x) / 2, (cy + y) / 2 + 0.5, (cz + z) / 2, x, y, z], 0xffffff, 0.08);
          fx.flash(cx, cy, cz, 2.2, SAND, 0.2); fx.flash(x, y, z, big ? 4 : mid ? 2 : 1.4, SAND, 0.22);
          fx.burst(x, y, z, big ? 60 : mid ? 18 : 10, big ? 13 : 7, STATIC, big ? 1 : 0.5, big ? 0.45 : 0.28, 10);
          fx.burst(x, y, z, big ? 30 : mid ? 10 : 6, big ? 10 : 6, HEAT, 0.8, 0.2, 14);
          fx.smoke(x, y + 0.2, z, big ? 10 : mid ? 3 : 2, big ? 2.4 : mid ? 1.2 : 0.8, big ? 2.6 : 0.6);
          fx.ring(x, gy + 0.12, z, big ? 6 : 2.2, SAND, 0.4);
          this.pulse(cx, cz, SAND, big ? 14 : 7, 1);
          if (big) this.bump(0.5, x, z, true);
          break;
        }
        case 'lose': fx.column(this.core.x, 0, this.core.z, RUST, 40); fx.boom(this.core.x, 2.5, this.core.z, 12, APRICOT); this.shake = 1.2; this.pulse(this.core.x, this.core.z, RUST, 30, 1); break;
      }
    }
  }

  /** Rail beams: a tower's shot, a tower's Overcharge (big, no player) and Kestrel's Rail Shot (big, with a player). */
  private railFx(e: Ev) {
    const fx = this.fx;
    const hero = e.big && e.p !== undefined && this.heroes[+e.p] && this.heroes[+e.p].rig;
    const over = e.big && e.p === undefined;
    const fire = () => {
      let x = e.x, y = e.y, z = e.z;
      const dx = e.tx - x, dy = e.ty - y, dz = e.tz - z, L = Math.hypot(dx, dy, dz) || 1;
      if (hero) { x += dx / L * 0.5; y += dy / L * 0.5 + 0.1; z += dz / L * 0.5; } // leaves from the bow, not from the middle of her body
      fx.beam(x, y, z, e.tx, e.ty, e.tz, e.c, over ? 0.9 : e.big ? 0.3 : 0.2, over ? 0.9 : e.big ? 0.5 : 0.32);
      fx.burst(e.tx, e.ty, e.tz, e.big ? 14 : 5, 6, HEAT, 0.45, 0.2, 10);
      if (!e.big) return;
      this.bump(over ? 0.6 : 0.3, x, z, !!over);
      for (let i = 0; i < 12; i++) { const u = Math.random(); fx.burst(x + dx * u, y + dy * u, z + dz * u, 2, 2.5, e.c, 0.45, 0.22, 0); }
      if (over) {
        // Overcharge: a white core inside the slug, shock rings and a ripple in the deck all along its path
        fx.beam(x, y, z, e.tx, e.ty, e.tz, 0xffffff, 0.3, 1.1);
        fx.flash(x, y, z, 2.2, e.c, 0.3);
        for (let d = 4; d < L; d += 7) {
          const u = d / L, px = x + dx * u, pz = z + dz * u, gy = this.deckY(px, pz);
          fx.ring(px, gy + 0.12, pz, 2.6, e.c, 0.5 + u * 0.3);
          if (gy < 0.1) fx.scorch(px, pz, 1.3, e.c, 5, gy);
          this.pulse(px, pz, e.c, 5, 0.9);
        }
      } else {
        // Rail Shot: the deck answers where the ray meets it
        const u = dy < -1e-4 ? Math.min(1, -y / dy) : 1;
        this.pulse(x + dx * u, z + dz * u, e.c, 7, 1);
      }
    };
    // Rail Shot: the pose winds up first, the beam leaves on the release beat
    if (hero) { this.heroAnim(e.p, 'rail'); this.later.push({ t: SKILL_CAST[0], fn: fire }); } else fire();
  }

  /** A tower's special goes off: the node bursts, then each type does its own thing (the long ones carry on in sync). */
  private specialFx(e: Ev) {
    const fx = this.fx, sim = this.sim, t = sim && sim.towerById(e.id), v = this.tv.get(e.id);
    const type = e.t as TowerType, c = TOWERS[type]?.color ?? SAND;
    fx.flash(e.x, e.y, e.z, 1.5, c, 0.3);
    fx.ring(e.x, e.y, e.z, 1.8, c, 0.4);
    fx.burst(e.x, e.y, e.z, 18, 7, c, 0.5, 0.26, 4);
    if (v) { v.fired = 0; towerShot(v.rig); }
    if (!t || !sim) return;
    const R = sim.range(t);
    switch (type) {
      case 'pulse': this.pulse(t.x, t.z, c, 5, 0.9); break;
      case 'cryo': {
        // Flash Freeze: a white wall of frost out to the edge of its range
        fx.ring(t.x, 0.14, t.z, R, FROST, 0.7, 0.15, 0.6);
        fx.flash(t.x, 0.6, t.z, R * 0.35, c, 0.25);
        for (let i = 0; i < 90; i++) { const a = Math.random() * TAU, s = (R / 0.5) * (0.5 + Math.random() * 0.6); fx.spark(t.x, 0.25 + Math.random() * 0.5, t.z, Math.cos(a) * s, Math.random() * 1.5, Math.sin(a) * s, 0.45 + Math.random() * 0.25, 0.3, FROST, 1); }
        this.pulse(t.x, t.z, c, R * 1.2, 1);
        break;
      }
      case 'arc': {
        // Thunderhead: the charge comes down out of the sky into the orb, then leaves along the chain
        const ox = (Math.random() - 0.5) * 6, oz = (Math.random() - 0.5) * 6;
        fx.arc([t.x + ox, 34, t.z + oz, t.x + ox * 0.4, 16, t.z + oz * 0.4, t.x, t.h, t.z], c, 0.3);
        fx.arc([t.x + ox, 34, t.z + oz, t.x + ox * 0.4, 16, t.z + oz * 0.4, t.x, t.h, t.z], 0xffffff, 0.08);
        fx.flash(t.x, t.h, t.z, 3, c, 0.3);
        this.bump(0.4, t.x, t.z, true);
        this.pulse(t.x, t.z, c, 6, 1);
        break;
      }
      case 'mortar': fx.smoke(t.x, t.h, t.z, 5, 1.1, 0.8, 1.6); this.pulse(t.x, t.z, c, 4, 0.7); break;
      case 'rail': this.pulse(t.x, t.z, c, 4, 0.7); break;
      case 'beacon': fx.column(t.x, t.h, t.z, c, 16); this.pulse(t.x, t.z, c, R * 1.3, 1); break;
      case 'flame': fx.flash(t.x, t.h * 0.8, t.z, 2.4, APRICOT, 0.3); fx.burst(t.x, t.h * 0.8, t.z, 24, 7, APRICOT, 0.7, 0.3, -2, 1); this.pulse(t.x, t.z, c, 7, 1); break;
      case 'lance': fx.star(e.x, t.h * 0.85, e.z, 1.6, 0xffffff, 6, 0.25); this.pulse(t.x, t.z, c, 4, 0.8); break;
      case 'missile': fx.smoke(t.x, t.h, t.z, 8, 1.2, 1.2, 2); fx.burst(t.x, t.h, t.z, 20, 8, HEAT, 0.6, 0.24, 6, 1.6); this.pulse(t.x, t.z, c, 5, 0.9); break;
      case 'gravity': this.pulse(t.x, t.z, c, 5, 0.8); break;
    }
  }

  // ---------- towers ----------
  private metrics(type: TowerType) {
    let m = this.metricsOf.get(type);
    if (m) return m;
    const model = this.models['tower_' + type];
    model.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(model.getObjectByName('base') || model);
    const tur = model.getObjectByName('turret');
    let tb: THREE.Box3 | null = null;
    if (tur && type !== 'arc' && type !== 'beacon') { tb = new THREE.Box3().setFromObject(tur); tb.translate(V.setFromMatrixPosition(tur.matrixWorld).negate()); }
    m = { r: Math.max(0.6, Math.min(0.9, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2)), tb };
    this.metricsOf.set(type, m);
    return m;
  }

  private makeTower(t: Tower): TVis {
    const def = TOWERS[t.type], obj = this.models['tower_' + t.type].clone();
    // every tower gets its own emissive materials: lights go out, flicker and breathe per tower
    const glows: Glow[] = [], mnode: Glow[] = [], seen = new Map<string, THREE.MeshStandardMaterial>();
    const nodeObj = obj.getObjectByName('node');
    const lv: THREE.Object3D[][] = [[], []];
    obj.traverse((o) => {
      const l = lvlOf(o.name);
      if (l) lv[+l - 2].push(o);
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const inNode = isUnder(o, nodeObj);
      // rail and lance barrels glow on their own (charge, heat), apart from the rest of the tower's lights
      let own = false;
      if (t.type === 'rail' || t.type === 'lance') for (let p: THREE.Object3D | null = o; p && !own; p = p.parent) own = p.name === 'barrel' || p.name.startsWith('barrel_');
      const swap = (mat: THREE.Material) => {
        if (!mat.name.startsWith('glow')) return mat;
        const key = (inNode ? 'n' : own ? 'b' : 'g') + mat.uuid;
        let c = seen.get(key);
        if (!c) { c = (mat as THREE.MeshStandardMaterial).clone(); seen.set(key, c); (inNode ? mnode : glows).push({ m: c, i0: c.emissiveIntensity }); if (inNode) c.color.multiplyScalar(0.35); }
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    });
    const rig = makeTowerRig(obj, t.type);
    const acc = new THREE.MeshStandardMaterial({ color: new THREE.Color(def.color).multiplyScalar(0.25), emissive: def.color, emissiveIntensity: 1.8 });
    glows.push({ m: acc, i0: 1.8 });
    // soft pool of the tower's own light on the deck: grounds it and keeps it readable from the bird view
    const pad = lightPool(2.1, def.color, 0.24); pad.layers.set(FX_LAYER); pad.position.y = 0.04; obj.add(pad);
    const buff = new THREE.Mesh(G_HEX_LINE, M_BUFF); buff.scale.setScalar(1 / TOWER_SCALE); buff.position.y = 0.07; buff.layers.set(FX_LAYER); obj.add(buff);
    const v: TVis = {
      obj, rig, type: t.type, lvl: 0, grow: 0, s: -1, seen: 0, glows, acc, pad, buff, lv, addons: [],
      node: null, core: null, nodeMat: null, ringMat: null, halo: null, mnode,
      power: 1, boot: 9, fired: 9, em: 0, em2: 0, tick: 0, downMax: 0, deny: 0, jam: false, stun: false, em3: 0,
      wYaw: t.yaw || 0, wTo: NaN, wHeat: 0, wSeen: -9, ring: null, ringMats: [], ringOn: 0, beam: null, lnT: 0, lnX: 0, lnY: 0, lnZ: 0, lnY0: 0, lnHeat: 0, lnOver: false,
    };
    if (def.special) {
      // power node emblem at the exact spot the sim tests (nodePos): a ring that fills with the charge round a core
      const node = new THREE.Group(), k = NODE_R / TOWER_SCALE;
      node.position.y = (t.h + 0.55) / TOWER_SCALE;
      v.ringMat = reticleMat(4);
      const ring = new THREE.Mesh(G_QUAD, v.ringMat); ring.scale.setScalar(k * 1.2); node.add(ring);
      if (!nodeObj) {
        v.nodeMat = new THREE.MeshBasicMaterial({ color: def.color, fog: false });
        v.core = new THREE.Mesh(G_OCTA, v.nodeMat); v.core.scale.setScalar(k * 0.42); node.add(v.core);
      }
      let hm = this.haloMats.get(t.type);
      if (!hm) { hm = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(def.color).multiplyScalar(0.14), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }); this.haloMats.set(t.type, hm); }
      v.halo = new THREE.Sprite(hm); v.halo.scale.setScalar(k * 3.2); node.add(v.halo);
      node.traverse((o) => o.layers.set(FX_LAYER));
      node.visible = false; obj.add(node);
      v.node = node;
    }
    obj.position.set(t.x, 0, t.z);
    this.dyn.add(obj);
    this.tv.set(t.id, v);
    return v;
  }

  private dropTower(v: TVis) {
    this.dyn.remove(v.obj);
    for (const g of v.glows) g.m.dispose();
    for (const g of v.mnode) g.m.dispose();
    (v.pad.material as THREE.Material).dispose();
    v.nodeMat?.dispose(); v.ringMat?.dispose();
    if (v.ring) { this.dyn.remove(v.ring); for (const m of v.ringMats) m.dispose(); }
    if (v.beam) { this.dyn.remove(v.beam); (v.beam.material as THREE.Material).dispose(); }
  }

  /** Show what a tower level looks like: the model's own lvl2 / lvl3 parts, or procedural plating when it has none. */
  private setLevel(v: TVis, lvl: number) {
    v.lvl = lvl;
    for (let i = 0; i < 2; i++) for (const o of v.lv[i]) o.visible = lvl >= i + 2;
    for (const o of v.addons) o.removeFromParent();
    v.addons.length = 0;
    if (lvl >= 2) {
      const fr = new THREE.Mesh(G_LVL[lvl >= 3 ? 1 : 0], M_LVL);
      fr.scale.setScalar(1 / TOWER_SCALE); fr.position.y = 0.03 / TOWER_SCALE; fr.layers.set(FX_LAYER);
      v.obj.add(fr); v.addons.push(fr);
    }
    if (lvl < 2 || v.lv[0].length || v.lv[1].length) return;
    const M = this.metrics(v.type), g = new THREE.Group();
    const mesh = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = mat !== v.acc; m.receiveShadow = true; parent.add(m); return m; };
    // level 2: an armour skirt on the six faces of the base, every other plate with a light strip
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3, p = new THREE.Group();
      p.position.set(Math.cos(a) * M.r, 0.24, Math.sin(a) * M.r); p.rotation.set(-0.24, Math.PI / 2 - a, 0, 'YXZ');
      mesh(p, G_PLATE, M_ADD_HULL, 0, 0, 0);
      if (i % 2 === 0) mesh(p, G_STRIP, v.acc, 0, 0.06, 0.05);
      g.add(p);
    }
    if (lvl >= 3) {
      // level 3: three buttresses on the corners with a lit cap, and a sensor kit on the turret
      const tall = M.tb ? 1 : 1.5;
      for (let i = 0; i < 3; i++) {
        const a = (i * TAU) / 3 + Math.PI / 6, p = new THREE.Group();
        p.position.set(Math.cos(a) * M.r * 0.98, 0, Math.sin(a) * M.r * 0.98); p.rotation.set(-0.3, Math.PI / 2 - a, 0, 'YXZ');
        mesh(p, G_FIN, M_ADD_TRIM, 0, 0.5 * tall, 0).scale.y = tall;
        mesh(p, G_TIP, v.acc, 0, tall + 0.03, 0);
        g.add(p);
      }
      if (M.tb && v.rig.turret) {
        const kit = new THREE.Group(), b = M.tb, cy = (b.min.y + b.max.y) / 2, back = Math.max(b.min.z, -0.5) * 0.6;
        for (const s of [-1, 1]) {
          const x = s * (Math.min(0.6, Math.max(b.max.x, -b.min.x)) + 0.07);
          mesh(kit, G_POD, M_ADD_HULL, x, cy, back);
          mesh(kit, G_STRIP, v.acc, x + s * 0.085, cy, back).rotation.y = Math.PI / 2;
        }
        mesh(kit, G_MAST, M_ADD_TRIM, 0.16, b.max.y + 0.3, back);
        mesh(kit, G_TIP, v.acc, 0.16, b.max.y + 0.66, back).scale.setScalar(0.5);
        v.rig.turret.add(kit); v.addons.push(kit);
      }
    }
    v.obj.add(g); v.addons.push(g);
  }

  private syncTower(t: Tower, v: TVis, dt: number, linked: boolean) {
    const sim = this.sim!, fx = this.fx, def = TOWERS[t.type], c = def.color, off = t.down > 0, spec = t.spec > 0;
    if (v.grow < 1) v.grow = Math.min(1, v.grow + dt * 3.5);
    const s = Math.max(0.001, (1 - Math.pow(1 - v.grow, 3)) * this.reveal(t.x, t.z)) * TOWER_SCALE;
    if (s !== v.s) { v.s = s; v.obj.scale.setScalar(s); v.obj.visible = s > 0.02; }
    if (v.lvl !== t.lvl) this.setLevel(v, t.lvl);
    v.buff.visible = t.buff > 0 && !off;

    // lights: out while offline, a stutter and a surge when the tower reboots
    v.boot += dt; v.fired += dt; if (v.deny > 0) v.deny -= dt;
    // jammed by mites: the lights stutter and the tower hangs its head. Stunned by the Titan's landing: dark, like a reboot.
    const jam = t.jam > 0, stun = t.stun > 0;
    if ((v.jam && !jam) || (v.stun && !stun)) v.boot = 0;
    v.jam = jam; v.stun = stun;
    let pw = 1;
    if (!off && v.boot < 0.9) pw = v.boot < 0.6 ? (Math.sin(v.boot * 52) > 0.1 ? 1.6 : 0.08) : 1 + (0.9 - v.boot) * 2.5;
    if (jam && !stun) pw = Math.sin(this.time * 61 + t.id * 7) * Math.sin(this.time * 23 + t.id) > 0.12 ? 0.85 : 0.05;
    v.power = off || stun ? damp(v.power, 0.03, 9, dt) : pw;
    let mul = v.power;
    if (this.fxOptions.towers && this.fxOptions.beat) mul *= 1 + 0.16 * this.beatLevel;
    if (linked) mul *= 1.5;
    if (spec) mul *= 1.35 + 0.15 * Math.sin(this.time * 24);
    let yaw = t.yaw;
    if (t.type === 'flame') {
      // Firewall Pylon: the head turns its emitter fins along the wall (it has four, so the nearest quarter turn will do);
      // a pylon with no partner sweeps slowly and burns a ring round itself instead
      const linked = v.wSeen >= this.frame - 1;
      if (linked && v.wTo === v.wTo) { let d = v.wTo - v.wYaw; d -= Math.round(d / (Math.PI / 2)) * (Math.PI / 2); v.wYaw += d * (1 - Math.exp(-7 * dt)); }
      else if (!off) v.wYaw += dt * 0.5;
      if (!linked) v.wHeat = 0;
      yaw = v.wYaw;
      if (v.wHeat > 0 && !off) mul *= v.wHeat > 1 ? 1.9 + 0.3 * Math.sin(this.time * 31 + t.id) : 1.35 + 0.08 * Math.sin(this.time * 9 + t.id);
      this.syncFireRing(t, v, dt, !linked && !off && v.grow >= 1, spec);
    }
    ST.down = off || jam || stun; ST.spec = spec; ST.power = mul; ST.heat = t.heat;
    updateTower(v.rig, yaw, t.cd, t.type === 'beacon' || t.type === 'spire' ? 0 : sim.towerRate(t), dt, ST);
    for (const g of v.glows) if (g.m !== v.rig.glow) g.m.emissiveIntensity = g.i0 * mul;
    // offline: the pool on the deck turns to a slow rust warning light
    if (off) (v.pad.material as THREE.MeshBasicMaterial).color.setHex(RUST).multiplyScalar(0.1 + 0.08 * Math.sin(this.time * 5 + t.id));
    else if (stun) (v.pad.material as THREE.MeshBasicMaterial).color.setHex(STATIC).multiplyScalar(0.03);
    else if (jam) (v.pad.material as THREE.MeshBasicMaterial).color.setHex(VIOLET).multiplyScalar(0.06 + 0.2 * mul);
    else (v.pad.material as THREE.MeshBasicMaterial).color.setHex(c).multiplyScalar(0.24 * Math.min(1.3, mul));
    if (jam || stun) {
      // cold crackle off a jammed tower, hot spits and a thread of smoke off a stunned one
      v.em3 += dt * (jam ? 7 : 2.4);
      while (v.em3 >= 1) {
        v.em3 -= 1;
        const a = Math.random() * TAU, y = t.h * (0.3 + Math.random() * 0.6);
        if (jam) {
          fx.burst(t.x + Math.cos(a) * 0.5, y, t.z + Math.sin(a) * 0.5, 3, 2.6, Math.random() < 0.3 ? VIOLET : STATIC, 0.3, 0.16, 5);
          if (Math.random() < 0.3) fx.arc([t.x + Math.cos(a) * 0.5, y, t.z + Math.sin(a) * 0.5, t.x + Math.cos(a + 1.4) * 0.6, y + (Math.random() - 0.5) * 1.2, t.z + Math.sin(a + 1.4) * 0.6], STATIC, 0.035);
        } else { fx.burst(t.x + Math.cos(a) * 0.4, y, t.z + Math.sin(a) * 0.4, 4, 3, HEAT, 0.5, 0.16, 10); if (Math.random() < 0.5) fx.puff(t.x, t.h * 0.9, t.z, 0.5, 1.2, 0.9); }
      }
    }
    if (off) {
      // shorted out: now and then a spit of sparks and a thread of smoke
      v.em += dt * 3;
      while (v.em >= 1) { v.em -= 1; fx.burst(t.x + (Math.random() - 0.5) * 0.8, t.h * (0.5 + Math.random() * 0.4), t.z + (Math.random() - 0.5) * 0.8, 4, 3, HEAT, 0.5, 0.16, 10); fx.puff(t.x, t.h * 0.9, t.z, 0.5, 1.2, 0.9); }
    }

    // special in progress
    if (spec) {
      const R = sim.range(t);
      v.tick -= dt;
      if (t.type === 'pulse') {
        // Bullet Storm: the turret runs hot, heat shimmer and brass all round it
        if (v.tick <= 0) { v.tick = 0.4; fx.puff(t.x, t.h, t.z, 0.6, 0.8, 1.4); }
        v.em += dt * 40;
        while (v.em >= 1) { v.em -= 1; const a = t.yaw + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1) + (Math.random() - 0.5) * 0.8; fx.spark(t.x, t.h * 0.8, t.z, Math.sin(a) * 3.5, 2.5 + Math.random() * 2, Math.cos(a) * 3.5, 0.6, 0.15, HEAT, 12); }
      } else if (t.type === 'cryo') {
        // frost hangs low over everything in range
        v.em += dt * 60;
        while (v.em >= 1) { v.em -= 1; const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * R; fx.spark(t.x + Math.cos(a) * r, 0.15 + Math.random() * 0.5, t.z + Math.sin(a) * r, (Math.random() - 0.5) * 0.6, 0.5, (Math.random() - 0.5) * 0.6, 0.9, 0.3, FROST, -0.4); }
        if (v.tick <= 0) { v.tick = 0.9; this.pulse(t.x, t.z, FROST, R * 1.1, 0.45); }
      } else if (t.type === 'beacon') {
        // Surge: waves run out to its reach, the mast throws light upward
        if (v.tick <= 0) { v.tick = 0.7; this.pulse(t.x, t.z, c, R * 1.2, 0.5); }
        v.em += dt * 30;
        while (v.em >= 1) { v.em -= 1; fx.spark(t.x + (Math.random() - 0.5) * 0.4, t.h, t.z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 1.5, 5 + Math.random() * 3, (Math.random() - 0.5) * 1.5, 0.7, 0.26, c, -1); }
        // and every tower it feeds shows it
        for (const o of sim.towers) if (o.buff > 0 && o.down <= 0 && Math.random() < dt * 9 && Math.hypot(o.x - t.x, o.z - t.z) <= R) fx.spark(o.x + (Math.random() - 0.5) * 1.2, 0.2, o.z + (Math.random() - 0.5) * 1.2, 0, 3 + Math.random() * 2, 0, 0.8, 0.22, c, -1);
      } else if (t.type === 'arc' || t.type === 'rail') {
        // the discharge leaves the tower crackling
        if (v.tick <= 0) { v.tick = 0.07; const a = Math.random() * TAU, r = 1 + Math.random() * 1.5; fx.arc([t.x, t.h * 0.9, t.z, t.x + Math.cos(a) * r, t.h * (0.3 + Math.random() * 0.6), t.z + Math.sin(a) * r], c, 0.05); }
      }
    }
    if (t.type === 'beacon' && !off && t.buff === 0 && spec) v.buff.visible = false;

    // lance beam
    if (v.lnT > 0) {
      v.lnT -= dt;
      if (!v.lnOver && t.tgt) { for (const e of sim.enemies) if (e.id === t.tgt) { if (e.alive) { v.lnX = e.x; v.lnY = e.y; v.lnZ = e.z; } break; } }
      if (!v.beam) { v.beam = makeBeam(); this.dyn.add(v.beam); }
      const h = v.lnHeat, sn = Math.sin(t.yaw), cs = Math.cos(t.yaw), ax = t.x + sn * 0.8, az = t.z + cs * 0.8;
      const flick = 1 + 0.08 * Math.sin(this.time * 70 + t.id);
      // cold: a thin line in the tower's colour. Hot: wider, brighter, the core burns white
      const col = C1.setHex(c).lerp(C2.setHex(0xffe2c0), h * 0.7).getHex();
      placeBeam(v.beam, ax, v.lnY0, az, v.lnX, v.lnY, v.lnZ, v.lnOver ? 0.32 * flick : (0.045 + 0.11 * h) * flick, v.lnOver ? 0xffd0b8 : col, (v.lnOver ? 1.8 : 0.6 + 1.0 * h) * flick, v.lnOver ? 1 : 0.25 + 0.75 * h);
      v.em2 += dt * (v.lnOver ? 90 : 8 + 50 * h);
      while (v.em2 >= 1) {
        v.em2 -= 1;
        if (v.lnOver) { const u = Math.random(); fx.burst(ax + (v.lnX - ax) * u, v.lnY0 + (v.lnY - v.lnY0) * u, az + (v.lnZ - az) * u, 1, 3, c, 0.35, 0.24, 0); }
        fx.burst(v.lnX, v.lnY, v.lnZ, 1, 2 + 5 * h, HEAT, 0.3 + 0.2 * h, 0.14 + 0.1 * h, 9);
      }
      if (h > 0.6 || v.lnOver) { v.tick -= dt; if (v.tick <= 0) { v.tick = v.lnOver ? 0.4 : 0.25; fx.flash(v.lnX, v.lnY, v.lnZ, v.lnOver ? 1.4 : 0.5 + 0.4 * h, col, 0.2); if (v.lnOver) this.pulse(v.lnX, v.lnZ, c, 5, 0.7); } }
    } else if (v.beam) v.beam.visible = false;
  }

  /** The ring of fire a Firewall Pylon burns round itself while it has no partner to throw a wall to. */
  private syncFireRing(t: Tower, v: TVis, dt: number, on: boolean, hot: boolean) {
    v.ringOn = damp(v.ringOn, on ? 1 : 0, on ? 5 : 9, dt);
    if (v.ringOn < 0.01) { if (v.ring) v.ring.visible = false; return; }
    if (!v.ring) {
      const g = new THREE.Group(), fm = fireMat(), gm = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      fm.uniforms.len.value = TAU * FIRE_RING; fm.uniforms.ends.value = 0;
      const fire = new THREE.Mesh(G_FIRE_RING, fm), glow = new THREE.Mesh(POOL_GEO, gm);
      glow.scale.setScalar(FIRE_RING * 1.5); glow.position.y = 0.045;
      g.add(glow, fire); g.position.set(t.x, 0, t.z);
      this.dyn.add(noAO(g));
      v.ring = g; v.ringMats = [fm, gm];
    }
    const fm = v.ringMats[0] as THREE.ShaderMaterial, gm = v.ringMats[1] as THREE.MeshBasicMaterial, fire = v.ring.children[1], k = v.ringOn;
    v.ring.visible = true;
    fm.uniforms.on.value = k; fm.uniforms.heat.value = damp(fm.uniforms.heat.value, hot ? 1 : 0, 6, dt);
    const heat = fm.uniforms.heat.value as number;
    fire.scale.set(FIRE_RING, 0.95 + 0.9 * heat, FIRE_RING);
    gm.color.setHex(APRICOT).multiplyScalar((0.07 + 0.12 * heat) * k * (1 + 0.08 * Math.sin(this.time * 13 + t.id)));
    v.em2 += dt * (10 + 40 * heat) * k;
    while (v.em2 >= 1) {
      v.em2 -= 1;
      const a = Math.random() * TAU, r = FIRE_RING * (0.96 + Math.random() * 0.1);
      this.fx.spark(t.x + Math.cos(a) * r, 0.15 + Math.random() * 0.5, t.z + Math.sin(a) * r, (Math.random() - 0.5) * 0.6, 1.4 + Math.random() * 1.8, (Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.4, 0.13 + Math.random() * 0.08, APRICOT, -1.5, 0.6);
    }
  }

  private makeWall(): WVis {
    const obj = new THREE.Group(), mat = fireMat();
    const sheet = new THREE.Mesh(G_WALL, mat); sheet.frustumCulled = false;
    const gmat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const glow = new THREE.Mesh(G_GLOW_STRIP, gmat); glow.position.y = 0.045;
    obj.add(glow, sheet);
    this.dyn.add(noAO(obj));
    return { obj, sheet, mat, glow, gmat, seen: 0, on: 0, heat: 0, em: 0, len: 1 };
  }
  private dropWall(v: WVis) { this.dyn.remove(v.obj); v.mat.dispose(); v.gmat.dispose(); }

  /** Walls of fire between linked Firewall Pylons (sim.walls): a low dense sheet, embers and a glow on the deck; taller and whiter when hot. */
  private syncWalls(dt: number, f: number) {
    const sim = this.sim!, fx = this.fx, walls = (sim as unknown as { walls?: WallLike[] }).walls;
    if (walls) for (const w of walls) {
      const key = w.a + ':' + w.b, dx = w.bx - w.ax, dz = w.bz - w.az, len = Math.hypot(dx, dz) || 1, ux = dx / len, uz = dz / len;
      let v = this.wv.get(key);
      if (!v) { v = this.makeWall(); this.wv.set(key, v); }
      v.seen = f;
      // both pylons must have finished rising before fire runs between them
      const ta = this.tv.get(w.a), tb = this.tv.get(w.b), up = !!ta && !!tb && ta.grow >= 1 && tb.grow >= 1;
      for (const [tv, sg] of [[ta, 1], [tb, -1]] as [TVis | undefined, number][]) {
        if (!tv) continue;
        if (tv.wSeen !== f) { tv.wSeen = f; tv.wHeat = 0; tv.wTo = Math.atan2(ux * sg, uz * sg); }
        tv.wHeat = Math.max(tv.wHeat, w.on ? (w.hot ? 2 : 1) : 0);
      }
      v.on = damp(v.on, w.on && up ? 1 : 0, w.on ? 5 : 10, dt);
      v.heat = damp(v.heat, w.hot ? 1 : 0, 5, dt);
      v.obj.visible = v.on > 0.01;
      if (!v.obj.visible) continue;
      // the sheet runs from emitter head to emitter head, a little inside each pylon
      const in0 = 0.45, L = Math.max(0.2, len - in0 * 2), h = 1.5 + 1.1 * v.heat;
      v.obj.position.set(w.ax + ux * in0, 0.02, w.az + uz * in0); v.obj.rotation.y = Math.atan2(-uz, ux);
      v.sheet.scale.set(L, h, 0.8 + 0.5 * v.heat);
      v.mat.uniforms.len.value = L; v.mat.uniforms.heat.value = v.heat; v.mat.uniforms.on.value = v.on;
      v.glow.position.x = L / 2; v.glow.scale.set(L + 2.2, 1, 3 + 1.6 * v.heat);
      v.gmat.color.setHex(APRICOT).multiplyScalar((0.1 + 0.14 * v.heat) * v.on * (1 + 0.07 * Math.sin(this.time * 11 + w.a)));
      v.em += dt * L * (4 + 13 * v.heat) * v.on;
      while (v.em >= 1) {
        v.em -= 1;
        const u = in0 + Math.random() * L, j = (Math.random() - 0.5) * 0.4;
        fx.spark(w.ax + ux * u - uz * j, 0.2 + Math.random() * h * 0.7, w.az + uz * u + ux * j, (Math.random() - 0.5) * 0.8, 1.4 + Math.random() * (2 + 2 * v.heat), (Math.random() - 0.5) * 0.8,
          0.5 + Math.random() * 0.5, 0.12 + Math.random() * 0.1, v.heat > 0.5 && Math.random() < 0.4 ? SAND : APRICOT, -1.5, 0.6);
      }
      if (v.heat > 0.5 && Math.random() < dt * 5) { const u = in0 + Math.random() * L; fx.scorch(w.ax + ux * u, w.az + uz * u, 0.9, APRICOT, 3); if (Math.random() < 0.4) fx.puff(w.ax + ux * u, h, w.az + uz * u, 0.8, 1.1, 1.3); }
    }
    for (const [id, v] of this.wv) if (v.seen !== f) { this.dropWall(v); this.wv.delete(id); }
  }

  /**
   * Power node: a target reticle, seen in the Uplink view only. The ring fills with the charge; ready, it is bright,
   * breathes and shows its brackets; it flashes when it is hit and fires, fizzles when it is hit with nothing to reach,
   * and is a dead rust arc while the tower is offline.
   */
  private syncNode(t: Tower, v: TVis, b: number) {
    const c = TOWERS[t.type].color, held = t.jam > 0 || t.stun > 0, off = t.down > 0 || held, spec = t.spec > 0, ready = t.charge >= 1 && !off && !spec;
    const beat = 0.5 + 0.5 * Math.sin(this.time * 4.2 + t.id);
    for (const g of v.mnode) g.m.emissiveIntensity = g.i0 * (off ? 0.01 : spec ? 0.2 + 3 * Math.max(0, 1 - v.fired / 0.35) : ready ? 0.3 + 0.1 * beat : 0.03 + (0.1 + 0.2 * b) * t.charge * t.charge);
    const node = v.node;
    if (!node) return;
    node.visible = b > 0.02 && v.grow >= 1;
    if (!node.visible) return;
    node.quaternion.copy(this.camera.quaternion);
    const flash = Math.max(0, 1 - v.fired / 0.35), deny = v.deny > 0 ? v.deny / 0.45 : 0;
    node.scale.setScalar(b * (ready ? 1 + 0.07 * beat : 0.9) * (1 + 0.6 * flash));
    node.position.x = deny > 0 ? Math.sin(v.deny * 80) * 0.07 * deny : 0;
    const u = v.ringMat!.uniforms;
    (u.color.value as THREE.Color).setHex(c);
    // offline: a rust arc that drains as the reboot runs down
    if (off) v.downMax = Math.max(v.downMax, t.down); else v.downMax = 0;
    if (off) (u.color.value as THREE.Color).setHex(held ? VIOLET : RUST);
    else if (deny > 0) (u.color.value as THREE.Color).lerp(C1.setHex(0x8a8478), Math.min(1, deny * 1.5));
    u.fill.value = ready ? 1 : held ? t.charge : off ? t.down / (v.downMax || 1) : spec ? 0 : t.charge;
    const dk = deny > 0 ? (Math.sin(v.deny * 60) > 0 ? 0.3 : 0.9) : 1;
    u.gain.value = (off ? 0.4 : spec ? 0.2 + 2.2 * flash : ready ? 0.85 + 0.3 * beat : 0.5) * dk;
    u.mark.value = ready ? 1 : spec ? flash : 0;
    u.spin.value = ready ? this.time * 0.7 + t.id : 0;
    if (v.nodeMat && v.core) {
      if (off) v.nodeMat.color.setHex(RUST).multiplyScalar(0.22);
      else if (spec) v.nodeMat.color.setHex(c).multiplyScalar(0.1 + 3 * flash);
      else if (ready) v.nodeMat.color.setHex(c).multiplyScalar((0.8 + 0.15 * beat) * dk);
      else v.nodeMat.color.setHex(c).multiplyScalar(0.14 + 0.12 * t.charge);
      v.core.rotation.y = ready ? this.time * 1.6 : 0;
    }
    v.halo!.visible = ready;
    if (ready) v.halo!.scale.setScalar((NODE_R / TOWER_SCALE) * (1.7 + 0.2 * beat));
  }

  // ---------- enemies ----------
  private enemyVis(type: EnemyType): EVis {
    const pool = this.epool[type];
    if (pool && pool.length) { const v = pool.pop()!; v.obj.visible = true; v.fresh = true; return v; }
    const obj = this.models['enemy_' + type].clone();
    obj.scale.setScalar(ENEMY_SCALE[type]);
    obj.rotation.order = 'YXZ';
    const sc = ENEMY_SCALE[type];
    // weak-point parts of the model get their own lights
    const wglow: Glow[] = [], meshes: THREE.Mesh[] = [];
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) meshes.push(m);
      if (!m.isMesh || Array.isArray(m.material)) return;
      let under = false;
      for (let p: THREE.Object3D | null = o; p && !under; p = p.parent) under = p.name.startsWith('weak_');
      if (!under || !m.material.name.startsWith('glow')) return;
      const c = (m.material as THREE.MeshStandardMaterial).clone(); m.material = c; wglow.push({ m: c, i0: c.emissiveIntensity });
    });
    // the Titan's other lights are its own too: they stutter when it is hurt and fail when it dies
    const own: Glow[] = [];
    if (type === 'titan') {
      const mine = new Map<string, THREE.MeshStandardMaterial>();
      for (const m of meshes) {
        const mat = m.material as THREE.MeshStandardMaterial;
        if (Array.isArray(mat) || !mat.name.startsWith('glow') || wglow.some((g) => g.m === mat)) continue;
        let c = mine.get(mat.uuid);
        if (!c) { c = mat.clone(); c.emissiveIntensity *= 0.5; mine.set(mat.uuid, c); own.push({ m: c, i0: c.emissiveIntensity }); }   // its light strips are metres long: at a small machine's brightness they burn out the view from a Spire
        m.material = c;
      }
    }
    const guard = type === 'wheel' ? this.makeGuard(obj) : null;
    const rig = makeEnemyRig(obj, type);
    const d = ENEMIES[type];
    const by = (type === 'drone' ? 0.85 : d.y * 2 + 0.55) / sc;
    const back = new THREE.Sprite(this.barMats[4]), bar = new THREE.Sprite(this.barMats[0]);
    for (const s of [back, bar]) { s.position.y = by; s.visible = false; s.layers.set(FX_LAYER); obj.add(s); }
    bar.renderOrder = 2; back.renderOrder = 1;
    // cold light spill on the ground: the Static stays easy to pick out on the dark roadway
    const glow = new THREE.Mesh(POOL_GEO, this.enemyGlow); glow.scale.setScalar((d.r * 2.0 + 0.8) / sc); glow.layers.set(FX_LAYER);
    obj.add(glow);
    let sbar: THREE.Sprite | null = null, bubble: THREE.Mesh | null = null;
    if (d.shield) {
      sbar = new THREE.Sprite(this.barMats[3]); sbar.position.y = by + 0.1 / sc; sbar.layers.set(FX_LAYER); sbar.renderOrder = 2; obj.add(sbar);
      bubble = new THREE.Mesh(G_SPH, this.bubbleMat);
      bubble.scale.setScalar(d.r * 1.7 / sc); bubble.position.y = d.y / sc; bubble.layers.set(FX_LAYER); obj.add(bubble);
    }
    const weak: WeakVis[] = [];
    for (const w of d.weak || []) {
      const r = w.r * sc;
      const mat = new THREE.MeshBasicMaterial({ color: FROST, fog: false });
      // a three-bracket reticle that is drawn over the hull, so the target reads from any side it can be hit from
      const rmat = reticleMat(3, false);
      rmat.uniforms.mark.value = 1;
      const core = new THREE.Mesh(G_OCTA, mat); core.scale.setScalar(r * 0.5);
      const ring = new THREE.Mesh(G_QUAD, rmat); ring.scale.setScalar(r); ring.renderOrder = 3;
      for (const m of [core, ring]) { m.layers.set(FX_LAYER); m.visible = false; this.dyn.add(m); }
      weak.push({ core, ring, mat, rmat });
    }
    this.dyn.add(obj);
    // the hp bars, glow and bubble were added after the traverse: only the model's own meshes flash
    return { obj, rig, sx: 0, sz: 0, back, bar, sbar, bubble, glow, ice: null, weak, wglow, type, phase: Math.random() * 6.28, seen: 0, fresh: true, lx: 0, lz: 0, lgy: 0, tilt: 0, em: 0,
      meshes, mats: meshes.map((m) => m.material), hitT: 0, guard, own, hp0: -1, dim: 0 };
  }
  /**
   * The Gyre's guard. The rim's light strips get their own material so each wheel can dim alone; on both faces of the rim
   * sit a ring (the strips, blurred by the spin) and a faint shimmer disc. They ride on the rim node, so they lean with it.
   */
  private makeGuard(obj: THREE.Object3D): GuardVis {
    const rim = obj.getObjectByName('rim') || obj, strips: Glow[] = [], own = new Map<string, THREE.MeshStandardMaterial>();
    const swap = (mat: THREE.Material) => {
      if (mat.name !== 'glow_guard') return mat;
      let c = own.get(mat.uuid);
      if (!c) { c = (mat as THREE.MeshStandardMaterial).clone(); own.set(mat.uuid, c); strips.push({ m: c, i0: c.emissiveIntensity }); }
      return c;
    };
    rim.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material); });
    const rmat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const dmat = guardMat(), parts: THREE.Mesh[] = [];
    for (const sd of [-1, 1]) {
      const ring = new THREE.Mesh(G_GUARD_RING, rmat), disc = new THREE.Mesh(G_GUARD_DISC, dmat);
      ring.position.x = sd * 0.236; disc.position.x = sd * 0.25;
      for (const m of [ring, disc]) { m.layers.set(FX_LAYER); m.visible = false; rim.add(m); parts.push(m); }
    }
    return { strips, rmat, dmat, parts, lvl: 1, surge: 0, em: 0 };
  }
  /** A hit glances off a Gyre's spinning rim at (x, y, z) = its centre: a ricochet spark off the tread, and the guard flares. */
  private deflectFx(x: number, y: number, z: number) {
    const fx = this.fx;
    let v: EVis | undefined, bd = 4, titan: EVis | undefined;
    for (const o of this.ev.values()) {
      if (o.type === 'titan') titan = o;
      if (o.type !== 'wheel') continue;
      const d = (o.obj.position.x - x) * (o.obj.position.x - x) + (o.obj.position.z - z) * (o.obj.position.z - z); if (d < bd) { bd = d; v = o; }
    }
    if (!v && titan) {
      // the Titan's plating: the shot skids off where it struck, away from the hull
      const d = ENEMIES.titan, cx = titan.obj.position.x, cy = titan.obj.position.y + d.y, cz = titan.obj.position.z;
      let dx = x - cx, dy = y - cy, dz = z - cz;
      const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      fx.flash(x, y, z, 1.1, FROST, 0.1);
      fx.beam(x, y, z, x + dx * 2.4 + (Math.random() - 0.5), y + dy * 2.4 + 0.8, z + dz * 2.4 + (Math.random() - 0.5), FROST, 0.07, 0.12);
      fx.spray(x, y, z, dx, dy, dz, 12, 12, STATIC, 0.4, 0.24, 0.5); fx.spray(x, y, z, dx, dy, dz, 5, 7, HEAT, 0.5, 0.16, 0.6);
      return;
    }
    if (v && v.guard) v.guard.surge = Math.max(v.guard.surge, 0.7);
    // a point on the top or the back of the tread, thrown off the way the rim is moving there (forward over the top, up at the back)
    const yaw = v ? v.obj.rotation.y : Math.random() * TAU, sn = Math.sin(yaw), cs = Math.cos(yaw), R = 1.1 * ENEMY_SCALE.wheel;
    const a = 0.9 + Math.random() * 2.1, c = Math.cos(a), h = Math.sin(a), sd = (Math.random() - 0.5) * 0.4;
    if (v) y = v.obj.position.y + R;
    const px = x + sn * c * R + cs * sd, py = y + h * R, pz = z + cs * c * R - sn * sd;
    const dx = sn * (c * 0.5 + h * 0.9) + cs * sd * 2, dy = h * 0.5 - c * 0.9 + 0.3, dz = cs * (c * 0.5 + h * 0.9) - sn * sd * 2, l = Math.hypot(dx, dy, dz) || 1;
    fx.flash(px, py, pz, 0.6, FROST, 0.09);
    fx.beam(px, py, pz, px + (dx / l) * 1.9, py + (dy / l) * 1.9, pz + (dz / l) * 1.9, FROST, 0.06, 0.11);
    fx.spray(px, py, pz, dx / l, dy / l, dz / l, 8, 12, STATIC, 0.32, 0.2, 0.3);
    fx.spray(px, py, pz, dx / l, dy / l, dz / l, 3, 7, HEAT, 0.4, 0.14, 0.5);
  }
  private poolEnemy(v: EVis) {
    if (v.hitT > 0) { v.hitT = 0; for (let i = 0; i < v.meshes.length; i++) v.meshes[i].material = v.mats[i]; }
    v.obj.visible = false;
    for (const w of v.weak) w.core.visible = w.ring.visible = false;
    (this.epool[v.type] ||= []).push(v);
  }

  private syncEnemy(e: Enemy, v: EVis, dt: number, k: number, b: number, aim: boolean) {
    const sim = this.sim!, d = ENEMIES[e.type], sc = ENEMY_SCALE[e.type];
    // visual pose: the sim walks hard-cornered lanes; the view rounds every corner into an arc and limits the turn rate
    let dist = e.dist, lane = e.lane, off = e.off;
    const fresh = v.fresh;
    if (v.hitT > 0 && (v.hitT -= dt) <= 0) for (let i = 0; i < v.meshes.length; i++) v.meshes[i].material = v.mats[i];
    if (sim.replica) { // replicas only know x / z: recover the lane position from them
      if (v.fresh) { v.sx = e.x; v.sz = e.z; } else { v.sx += (e.x - v.sx) * k; v.sz += (e.z - v.sz) * k; }
      let bd = 1e9;
      for (let l = 0; l < sim.map.lanes.length; l++) {
        const nd = sim.map.nearest(l, v.sx, v.sz);
        sim.map.pos(l, nd, PO);
        const dd = Math.hypot(PO.x - v.sx, PO.z - v.sz);
        if (dd < bd - 1e-6) { bd = dd; dist = nd; lane = l; off = -(v.sx - PO.x) * PO.dz + (v.sz - PO.z) * PO.dx; }
      }
    }
    // nobody walks into the core itself: they pull up at its plinth and batter it from there
    const stand = (sim.map.lanes[lane] || sim.map.lanes[0]).len - (CORE_STAND + 0.6 * e.r), atCore = dist > stand;
    if (atCore) dist = stand;
    roundedPose(sim.map, lane, dist, off, TURN_A[e.type], PO);
    const gy = e.gy || 0, fly = e.type === 'drone', y = fly ? e.y : gy;
    if (v.fresh) {
      v.obj.position.set(PO.x, y, PO.z); v.obj.rotation.set(0, PO.yaw, 0); v.fresh = false; v.tilt = 0; v.lx = PO.x; v.lz = PO.z; v.lgy = gy; resetEnemy(v.rig);
      if (e.type === 'titan') {
        // it picks its footing on the deck; fresh from its leap, the legs take the fall
        v.rig.ground = this.groundAt; v.rig.snap = this.footing; v.hp0 = e.hp; v.dim = 0; v.glow.visible = true;
        if (this.roam.off) { this.roam.off = false; v.rig.sagV = -9; }
      }
    }
    else {
      v.obj.position.set(PO.x, y, PO.z);
      let dy = PO.yaw - v.obj.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      const lim = TURN_RATE[e.type] * dt;
      v.obj.rotation.y += Math.max(-lim, Math.min(lim, dy));
      // walkers lean with a ramp
      const run = Math.hypot(PO.x - v.lx, PO.z - v.lz);
      if (!fly && run > 1e-4 && e.type !== 'titan') v.tilt = damp(v.tilt, -Math.atan2(gy - v.lgy, run) * 0.8, 6, dt);
      v.obj.rotation.x = v.tilt;
      v.lx = PO.x; v.lz = PO.z; v.lgy = gy;
    }
    let look = NaN;
    if (e.type === 'boss') {
      // where the road runs under its front and its rear feet, seen from the machine: in a bend it sets them down on the
      // road, not out to the side where its nose and tail point (that is where the towers stand)
      const cs = Math.cos(v.obj.rotation.y), sn = Math.sin(v.obj.rotation.y), reach = BOSS_REACH * sc;
      for (const sg of [1, -1]) {
        roundedPose(sim.map, lane, dist + sg * reach, off, TURN_A.boss, PO2);
        const lat = Math.max(-1.2, Math.min(1.2, ((PO2.x - PO.x) * cs - (PO2.z - PO.z) * sn) / sc));
        if (sg > 0) v.rig.roadF = lat; else v.rig.roadR = lat;
      }
    }
    if (e.type === 'boss') { // the colossus' turret head tracks the nearest tower
      let bd = 400;
      for (const t of sim.towers) { const dd = (t.x - e.x) * (t.x - e.x) + (t.z - e.z) * (t.z - e.z); if (dd < bd) { bd = dd; look = Math.atan2(t.x - e.x, t.z - e.z); } }
    }
    const titan = e.type === 'titan';
    if (titan) {
      // its head follows the nearest Spire that has someone on it, eye to eye
      let bd = 1e9;
      for (const p of sim.players) {
        const t = p.heroActive ? sim.towerById(p.heroTower) : undefined, dd = t ? Math.hypot(t.x - e.x, t.z - e.z) : 1e9;
        if (t && dd < bd) { bd = dd; look = Math.atan2(t.x - e.x, t.z - e.z); v.rig.lookPitch = Math.max(-0.3, Math.min(0.6, Math.atan2(gy + 13.4 - (t.h + 0.8), Math.max(3, dd - 2.2)))); }
      }
    }
    const frozen = e.frz > 0 && !titan, strike = atCore || (e.breach || 0) > 0;
    const spin = e.type === 'wheel' ? (typeof e.spin === 'number' ? e.spin : 1) : 0;
    updateEnemy(v.rig, dt, e.hp / e.maxHp, e.sing > 0, frozen && e.type !== 'boss', look, strike, spin);
    if (titan) this.titanWalkFx(e, v, dt);
    if (v.guard) this.syncGuard(e, v, v.guard, spin, frozen, dt, fresh);
    if (v.rig.hit) {
      // a blow lands on the core: sparks where the machine meets it
      const l = Math.hypot(this.core.x - PO.x, this.core.z - PO.z) || 1, reach = Math.min(l, e.r + 0.5), hx = PO.x + ((this.core.x - PO.x) / l) * reach, hz = PO.z + ((this.core.z - PO.z) / l) * reach;
      this.fx.burst(hx, gy + d.y, hz, e.type === 'boss' ? 14 : 6, 5, SAND, 0.35, 0.2, 9);
      this.fx.flash(hx, gy + d.y, hz, e.type === 'boss' ? 1.4 : 0.6, APRICOT, 0.1);
      this.coreHit = Math.min(this.coreHit, 0.22);
    }
    v.glow.position.y = (gy + 0.05 - y) / sc;

    // hp bar: thin, flat, drains to the left
    const r = Math.max(0, e.hp / e.maxHp), bw = (0.5 + e.r * 0.8) / sc, bh = 0.055 / sc;
    v.bar.visible = v.back.visible = r < 0.999 && !titan;   // (the Titan's health is a bar in the HUD)
    if (v.bar.visible) {
      const f = Math.max(0.04, r);
      v.bar.material = this.barMats[r > 0.6 ? 0 : r > 0.3 ? 1 : 2];
      v.bar.scale.set(f * bw, bh, 1); v.bar.center.set(0.5 / f, 0.5);
      v.back.scale.set(bw + 0.04 / sc, bh + 0.04 / sc, 1);
    }
    if (v.sbar && v.bubble) {
      const on = e.shield > 0;
      v.bubble.visible = on; v.sbar.visible = on && e.maxShield > 0;
      if (on) { const f = Math.max(0.04, Math.min(1, e.shield / (e.maxShield > 1 ? e.maxShield : e.shield))); v.sbar.scale.set(f * bw, bh * 0.8, 1); v.sbar.center.set(0.5 / f, 0.5); }
    }

    // frozen solid: a shell of ice. Burning: flames lick up off the hull
    if (frozen && !v.ice) { v.ice = new THREE.Mesh(G_ICE, M_ICE); v.ice.scale.setScalar(d.r * 1.15 / sc); v.ice.position.y = (fly ? 0 : d.y) / sc; v.ice.rotation.set(v.phase, v.phase * 2, 0); v.obj.add(v.ice); }
    if (v.ice) v.ice.visible = frozen;
    if (e.burnT > 0 || e.crackT > 0) {
      v.em += dt * 14;
      while (v.em >= 1) {
        v.em -= 1;
        const a = Math.random() * TAU, rr = e.r * 0.7;
        if (e.burnT > 0) this.fx.spark(e.x + Math.cos(a) * rr, e.y + (Math.random() - 0.3) * e.r, e.z + Math.sin(a) * rr, 0, 1.6 + Math.random(), 0, 0.4, 0.3, APRICOT, -2);
        if (e.crackT > 0) this.fx.spark(e.x + Math.cos(a) * rr, e.y + Math.random() * e.r, e.z + Math.sin(a) * rr, Math.cos(a) * 2, 1, Math.sin(a) * 2, 0.5, 0.2, VIOLET, 5);
      }
    }

    // weak points: drawn where the sim tests them, in the Uplink view only
    const wk = d.weak;
    if (wk) {
      const beat = 0.5 + 0.5 * Math.sin(this.time * 6 + v.phase);
      let hot = 0;
      for (let i = 0; i < v.weak.length; i++) {
        const w = v.weak[i], show = b > 0.05 && !!weakPos(e, i, W3) && (!aim || this.weakOpen(e, wk[i].r * sc));
        w.core.visible = w.ring.visible = show;
        if (!show) continue;
        // how close the crosshair is, in weak-point radii
        let near = 0;
        if (aim) {
          const ex = W3.x - RO.x, ey = W3.y - RO.y, ez = W3.z - RO.z, u = ex * RD.x + ey * RD.y + ez * RD.z;
          const miss = Math.hypot(ex - RD.x * u, ey - RD.y * u, ez - RD.z * u) / (wk[i].r * sc);
          near = u > 0 ? sat(1.6 - miss * 0.4) : 0;
        }
        hot = Math.max(hot, near);
        const rad = wk[i].r * sc;
        w.core.position.set(W3.x, W3.y, W3.z); w.ring.position.copy(w.core.position);
        w.core.rotation.set(this.time * 2, this.time * 2.6, 0);
        w.core.scale.setScalar(rad * (0.3 + 0.07 * beat + 0.12 * near) * b);
        w.ring.quaternion.copy(this.camera.quaternion);
        // the brackets close on the point and stop turning as the crosshair comes onto it
        w.ring.scale.setScalar(rad * (1.5 - 0.3 * near) * b);
        w.mat.color.setHex(FROST).multiplyScalar(0.8 + 0.3 * beat + 0.9 * near);
        const ru = w.rmat.uniforms;
        (ru.color.value as THREE.Color).setHex(near > 0.6 ? 0xffffff : STATIC);
        ru.gain.value = 0.55 + 0.2 * beat + 0.8 * near;
        ru.spin.value = w.ring.userData.s = (w.ring.userData.s || v.phase) + dt * 1.4 * (1 - near);
      }
      for (const g of v.wglow) g.m.emissiveIntensity = g.i0 * (0.7 + 0.4 * beat + 0.8 * hot * b);
    }
  }

  /**
   * The Gyre's rim reads as a shield in proportion to its spin: at full speed the light strips blur into bright rings and a
   * faint disc shimmers over both faces; it all dims as the spin drops, and below 0.25 the guard is down: the strips are dark
   * and stutter, and the tread throws sparks where it drags on the road.
   */
  private syncGuard(e: Enemy, v: EVis, g: GuardVis, spin: number, frozen: boolean, dt: number, fresh: boolean) {
    if (fresh) { g.lvl = spin; g.surge = 0; g.em = 0; }
    g.lvl = damp(g.lvl, spin, 9, dt);
    g.surge *= Math.exp(-dt * 3.2);
    const lvl = g.lvl, up = ease((lvl - 0.25) / 0.6), down = spin < 0.25, su = g.surge;
    const stutter = down && !frozen && Math.sin(this.time * 47 + v.phase * 9) > 0.86 ? 0.5 : 0;
    for (const s of g.strips) s.m.emissiveIntensity = s.i0 * (0.03 + 1.45 * up * Math.sqrt(lvl) + stutter + 0.8 * su);
    const blur = ease((lvl - 0.35) / 0.5), on = blur > 0.01 || su > 0.02;
    for (const m of g.parts) m.visible = on;
    if (on) {
      const fl = 1 + 0.07 * Math.sin(this.time * 38 + v.phase);
      g.rmat.color.setHex(STATIC).multiplyScalar((0.6 * blur + 0.7 * su) * fl);
      g.dmat.uniforms.gain.value = (0.2 * blur * blur + 0.45 * su) * fl;
    }
    if (!down || frozen) return;
    g.em += dt * (5 + 16 * v.rig.mv);
    while (g.em >= 1) {
      g.em -= 1;
      const yaw = v.obj.rotation.y, sn = Math.sin(yaw), cs = Math.cos(yaw), gy = e.gy || 0, ws = ENEMY_SCALE.wheel;
      // hot metal from under the tread, and now and then a cold crackle from a strip that tries to light
      this.fx.spark(e.x - sn * 0.25 * ws, gy + 0.08, e.z - cs * 0.25 * ws, -sn * (2 + Math.random() * 3) + (Math.random() - 0.5) * 2.5, 1.5 + Math.random() * 2.5, -cs * (2 + Math.random() * 3) + (Math.random() - 0.5) * 2.5, 0.4 + Math.random() * 0.3, 0.16, HEAT, 11);
      if (Math.random() < 0.35) { const a = Math.random() * TAU; this.fx.burst(e.x + sn * Math.cos(a) * 0.82 * ws, gy + (1.1 + Math.sin(a) * 0.82) * ws, e.z + cs * Math.cos(a) * 0.82 * ws, 2, 2.5, STATIC, 0.25, 0.16, 4); }
    }
  }

  /**
   * Can an arrow from the bow reach the weak point at W3 before the hull stops it? Same test as the sim's arrow step,
   * so a marker is only drawn where a hit on it would count.
   */
  private weakOpen(e: Enemy, r: number) {
    const o = this.bow, dx = W3.x - o.x, dy = W3.y - o.y, dz = W3.z - o.z, L = Math.hypot(dx, dy, dz) || 1;
    const ub = raySphere(o.x, o.y, o.z, dx / L, dy / L, dz / L, e.x, e.y, e.z, e.r + ARROW_PAD);
    return ub < 0 || L - r - 0.1 <= ub + 0.35;
  }

  // ---------- mites ----------
  /** The mite model as instanced meshes: one per part and material, the two leg sets with their pivot taken out so they can swing. */
  private buildMites() {
    const model = this.models.enemy_mite;
    model.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      let swing = 0, piv: THREE.Object3D | null = null;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) { if (p.name === 'legs_a') { swing = 1; piv = p; } else if (p.name === 'legs_b') { swing = -1; piv = p; } }
      const pivot = new THREE.Vector3();
      if (piv) pivot.setFromMatrixPosition(piv.matrixWorld).applyMatrix4(inv);
      const geo = m.geometry.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z).multiply(inv).multiply(m.matrixWorld));
      const mesh = new THREE.InstancedMesh(geo, m.material, MITES);
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = !m.material.name.startsWith('glow');
      this.dyn.add(mesh);
      this.miteParts.push({ mesh, swing, pivot });
    });
  }
  /**
   * Mites are drawn where the sim has them (each can be shot off on its own): flat on the deck while they run, and swung
   * onto the wall once they sit on their tower, belly to it, head up, creeping a little on the spot.
   */
  private syncMites(dt: number, f: number) {
    const sim = this.sim!, k = 1 - Math.exp(-dt * 22), sc = MITE_DRAW * ENEMY_SCALE.mite;
    let n = 0;
    for (const e of sim.enemies) {
      if (e.type !== 'mite' || n >= MITES) continue;
      if (!this.miteParts.length) this.buildMites();
      let v = this.mites.get(e.id);
      const gy = e.gy || 0;
      if (!v) { v = { x: e.x, y: gy, z: e.z, on: e.latched ? 1 : 0, ph: (e.id * 0.618) % 1, seen: f }; this.mites.set(e.id, v); }
      v.seen = f;
      v.x += (e.x - v.x) * k; v.y += (gy - v.y) * k; v.z += (e.z - v.z) * k;
      v.on = damp(v.on, e.latched ? 1 : 0, 9, dt);
      const t = v.on > 0.01 ? sim.towerById(e.prey) : undefined;
      Q1.setFromAxisAngle(YA, e.yaw);
      let px = v.x, py = v.y + 0.02, pz = v.z;
      if (t) {
        // wall frame: up = out from the tower's axis, forward = up the tower with a slow wander to either side
        let nx = v.x - t.x, nz = v.z - t.z;
        const l = Math.hypot(nx, nz) || 1, wd = 0.6 * Math.sin(this.time * 1.7 + v.ph * 30), creep = 0.07 * Math.sin(this.time * 2.3 + v.ph * 20) * v.on;
        nx /= l; nz /= l;
        V.set(nx, 0, nz); V2.set(-nz * Math.sin(wd), Math.cos(wd), nx * Math.sin(wd)); V3.crossVectors(V, V2);
        Q1.slerp(Q2.setFromRotationMatrix(M4.makeBasis(V3, V, V2)), ease(v.on));
        px += V2.x * creep; py += V2.y * creep; pz += V2.z * creep;
      }
      M5.compose(V.set(px, py, pz), Q1, V2.setScalar(sc));
      // the two leg sets swing against each other: fast on the run, slow on the wall
      const a = 0.38 * Math.sin(this.time * (e.latched ? 9 : 34) + v.ph * 40);
      for (const p of this.miteParts) {
        if (p.swing) p.mesh.setMatrixAt(n, M6.makeRotationY(a * p.swing).setPosition(p.pivot).premultiply(M5));
        else p.mesh.setMatrixAt(n, M5);
      }
      n++;
    }
    for (const p of this.miteParts) if (n || p.mesh.count) { p.mesh.count = n; p.mesh.instanceMatrix.needsUpdate = true; }
    if (this.mites.size > n) for (const [id, v] of this.mites) if (v.seen !== f) this.mites.delete(id);
  }

  // ---------- the Titan ----------
  /** What a footfall of the Titan does: dust and a ring; on the deck the tile borders answer and the camera feels it. */
  private footfall(x: number, z: number, deck: boolean) {
    const fx = this.fx, gy = this.groundAt(x, z);
    fx.ring(x, gy + 0.1, z, deck ? 3 : 4.5, DUST, 0.55, 0.2, 0.9);
    fx.smoke(x, gy + 0.3, z, deck ? 2 : 3, deck ? 1.2 : 2.4, 1.6, 0.5);
    fx.burst(x, gy + 0.2, z, 10, 5, DUST, 0.5, 0.26, 10, 0.3);
    if (deck) { this.pulse(x, z, STATIC, 7, 0.75); this.bump(0.3, x, z, true); }
  }
  /** The Titan on the deck: its footfalls, and how it shows a hit that got through (a weak point, a tower special). */
  private titanWalkFx(e: Enemy, v: EVis, dt: number) {
    const fx = this.fx, steps = v.rig.steps;
    if (steps) for (let i = 0; i < steps.length; i += 2) this.footfall(steps[i], steps[i + 1], true);
    if (v.hp0 >= 0 && e.hp < v.hp0 - 1e-6) {
      const big = (v.hp0 - e.hp) / e.maxHp > 0.015;
      this.flashEnemy(v, true); v.dim = 1;
      fx.burst(e.x, e.y + 1, e.z, big ? 40 : 14, 11, VIOLET, 0.8, 0.34, 9); fx.burst(e.x, e.y, e.z, big ? 20 : 8, 8, HEAT, 0.9, 0.22, 12);
      if (big) { fx.flash(e.x, e.y + 1, e.z, 6, VIOLET, 0.22); fx.smoke(e.x, e.y + 1.5, e.z, 4, 2, 3, 1); this.bump(0.45, e.x, e.z, true); }
    }
    v.hp0 = e.hp;
    v.dim *= Math.exp(-dt * 2.2);
    const lit = v.dim > 0.03 ? 1 - 0.85 * v.dim * (Math.sin(this.time * 67) > -0.2 ? 1 : 0) : 1;
    for (const g of v.own) g.m.emissiveIntensity = g.i0 * lit;
  }
  private cityXZ(c: number, r: number, out: { x: number; z: number }) { const s = this.world.cityStep || 13; out.x = (c + (r & 1 ? 0.5 : 0)) * s; out.z = r * s * 0.8660254; return out; }
  private walkable(c: number, r: number) { return Math.abs(c) <= 26 && Math.abs(r) <= 24 && (this.world.cityTop ? this.world.cityTop(c, r) : 0) < 5; }
  /** Where the roaming Titan wants to be: on a wide ring round the platform, or (warned) behind the gate it will land on, nearer as its danger fills. */
  private roamGoal(T: TitanState, out: { x: number; z: number }) {
    const sim = this.sim!, R = this.roam;
    if (T.phase === 'far') { out.x = Math.cos(R.ang) * (BOARD_W / 2 + 84); out.z = Math.sin(R.ang) * (BOARD_D / 2 + 84); return out; }
    const L = sim.map.lanes[T.lane] || sim.map.lanes[0], a = L.pts[0], b = L.pts[1] || a, l = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    const d = 15 + (1 - sat(T.danger)) * 64;
    out.x = a[0] + ((a[0] - b[0]) / l) * d; out.z = a[1] + ((a[1] - b[1]) / l) * d;
    return out;
  }
  /** Put the roaming Titan on the open cell nearest to where it wants to be. */
  private roamStart(T: TitanState) {
    const R = this.roam;
    R.ang = -Math.PI / 2 + 0.7 * Math.sin(T.wave * 12.9898);
    this.roamGoal(T, PT);
    const gx = PT.x, gz = PT.z;
    let bd = 1e9;
    for (let r = -24; r <= 24; r++) for (let c = -26; c <= 26; c++) {
      if (!this.walkable(c, r)) continue;
      this.cityXZ(c, r, PT);
      const d = Math.hypot(PT.x - gx, PT.z - gz);
      if (d < bd) { bd = d; R.c = c; R.r = r; R.x = PT.x; R.z = PT.z; }
    }
    R.tx = R.x; R.tz = R.z; R.y = this.groundAt(R.x, R.z); R.yaw = Math.atan2(-R.x, -R.z); R.stop = false; R.wait = 0; R.faceT = 0; R.leap = -1; R.owe = false;
  }
  /** Next cell on the way to its goal: a search over the open cells for the one nearest the goal, then the first step toward it. False if it is already as near as it can get. */
  private roamNext(T: TitanState) {
    const R = this.roam;
    this.roamGoal(T, PT);
    const gx = PT.x, gz = PT.z, seen = new Map<number, number>(), q: number[] = [R.c, R.r];
    this.cityXZ(R.c, R.r, PT);
    let best = -1, bd = Math.hypot(PT.x - gx, PT.z - gz) - 0.5;
    seen.set(cityKey(R.c, R.r), -1);
    for (let i = 0; i < q.length && i < 900; i += 2) {
      const c = q[i], r = q[i + 1];
      for (const n of r & 1 ? CITY_NEAR_ODD : CITY_NEAR) {
        const nc = c + n[0], nr = r + n[1], key = cityKey(nc, nr);
        if (seen.has(key) || !this.walkable(nc, nr)) continue;
        seen.set(key, i); q.push(nc, nr);
        this.cityXZ(nc, nr, PT);
        const d = Math.hypot(PT.x - gx, PT.z - gz);
        if (d < bd) { bd = d; best = q.length - 2; }
      }
    }
    if (best < 0) return false;
    let i = best;
    for (let p = seen.get(cityKey(q[i], q[i + 1]))!; p > 0; p = seen.get(cityKey(q[i], q[i + 1]))!) i = p;
    R.c = q[i]; R.r = q[i + 1];
    this.cityXZ(R.c, R.r, PT); R.tx = PT.x; R.tz = PT.z;
    return true;
  }
  /**
   * The Titan before its wave: it walks the district among the towers, comes in behind its gate as the danger fills, and
   * leaps onto the gate when its wave begins. The same visual then becomes the enemy that walks the road.
   */
  private syncTitan(dt: number) {
    const sim = this.sim!, T = sim.titan, R = this.roam, ph = T ? T.phase : 'none';
    if ((ph !== 'far' && ph !== 'warn' && ph !== 'landing') || !this.world.cityTop || !this.models.enemy_titan) {
      if (R.v) { this.poolEnemy(R.v); R.v = null; }
      R.leap = -1;
      return;
    }
    if (!R.v) {
      const v = R.v = this.enemyVis('titan');
      v.fresh = false; v.glow.visible = false; v.hp0 = -1; v.dim = 0; v.bar.visible = v.back.visible = false;
      for (const g of v.own) g.m.emissiveIntensity = g.i0;
      for (const g of v.wglow) g.m.emissiveIntensity = g.i0;
      this.roamStart(T);
      v.obj.position.set(R.x, R.y, R.z); v.obj.rotation.set(0, R.yaw, 0);
      resetEnemy(v.rig); v.rig.ground = this.groundAt; v.rig.snap = null;
    }
    const v = R.v, rig = v.rig;
    if (v.hitT > 0 && (v.hitT -= dt) <= 0) for (let i = 0; i < v.meshes.length; i++) v.meshes[i].material = v.mats[i];
    if (ph === 'landing' && R.leap < 0) { sim.map.pos(T.lane, 0, PO2); this.titanLeap(PO2.x, PO2.z, T.lane, T.t); }
    if (R.leap >= 0) {
      const u0 = R.leap / TITAN_LAND, u = (R.leap += dt) / TITAN_LAND, dx = R.x1 - R.x0, dz = R.z1 - R.z0, D = Math.hypot(dx, dz);
      if (u < 0.3) {
        // it gathers itself: down on its legs, turning to face the gate
        rig.crouch = ease(u / 0.24); rig.air = 0;
        const err = wrapA(Math.atan2(dx, dz) - R.yaw);
        R.yaw += Math.max(-2.4 * dt, Math.min(2.4 * dt, err));
      } else {
        const s = sat((u - 0.3) / 0.7);
        if (u0 < 0.3) { // it leaves the ground
          this.fx.ring(R.x0, R.y0 + 0.3, R.z0, 14, DUST, 1, 0.1, 0.9); this.fx.smoke(R.x0, R.y0 + 1, R.z0, 8, 4, 8, 1.2); this.fx.flash(R.x0, R.y0 + 4, R.z0, 9, STATIC, 0.3);
          this.bump(0.8, R.x0, R.z0, true);
        }
        rig.crouch = 1 - sat(s * 8); rig.air = Math.max(1e-3, sat(s * 7) * (1 - ease((s - 0.78) / 0.22)));
        R.x = R.x0 + dx * s; R.z = R.z0 + dz * s; R.y = R.y0 + (R.y1 - R.y0) * s + (12 + D * 0.12) * 4 * s * (1 - s);
        R.yaw += wrapA(R.yaw1 - R.yaw) * (1 - Math.exp(-dt * 3.5));
      }
    } else {
      const dx = R.tx - R.x, dz = R.tz - R.z, d = Math.hypot(dx, dz), sp = ph === 'warn' ? 2.5 : 1.9;
      if ((d < 3.8 || R.stop) && (R.wait -= dt) <= 0) {
        // at its cell: where next? (stuck in a pocket of towers, it waits and looks again; a wrecked tower opens the way)
        this.roamGoal(T, PT);
        const far = Math.hypot(PT.x - R.x, PT.z - R.z);
        if (ph === 'far' && far < 30) R.ang += 0.5;
        R.stop = !this.roamNext(T);
        if (R.stop && ph === 'warn' && this.roamGoal(T, PT) && far > 4 && far < 34) { R.tx = PT.x; R.tz = PT.z; R.stop = false; }   // the last stretch is open ground
        R.wait = R.stop ? 1.5 : 0;
        if (R.owe) this.titanSmash();
      }
      if (!R.stop && d >= 1) {
        const err = wrapA(Math.atan2(dx, dz) - R.yaw), w = sp * 0.3 * dt, go = sp * Math.max(0.12, Math.cos(err));
        R.yaw += Math.max(-w, Math.min(w, err));
        R.x += Math.sin(R.yaw) * go * dt; R.z += Math.cos(R.yaw) * go * dt;
      } else {
        // it stands: turned to the platform, or to the tower it has just struck
        const err = wrapA((R.faceT > 0 ? R.face : Math.atan2(-R.x, -R.z)) - R.yaw);
        R.yaw += Math.max(-0.45 * dt, Math.min(0.45 * dt, err));
      }
      R.faceT -= dt;
      R.y = damp(R.y, this.groundAt(R.x, R.z), 2.5, dt);
    }
    v.obj.position.set(R.x, R.y, R.z); v.obj.rotation.set(0, R.yaw, 0);
    updateEnemy(rig, dt, 1, false, false, NaN, false);
    if (R.leap < 0 && rig.steps) for (let i = 0; i < rig.steps.length; i += 2) this.footfall(rig.steps[i], rig.steps[i + 1], false);
  }
  /** The Titan jumps from where it stands onto the gate at (x, z). t0: seconds of the leap that are already gone. */
  private titanLeap(x: number, z: number, lane: number, t0: number) {
    const sim = this.sim, R = this.roam;
    if (!sim || !R.v || R.leap >= 0) return;   // (no visual yet: syncTitan starts the leap as soon as it has one)
    const L = sim.map.lanes[lane] || sim.map.lanes[0], a = L.pts[0], b = L.pts[1] || a;
    R.leap = Math.max(0, t0); R.x0 = R.x; R.y0 = R.y; R.z0 = R.z; R.x1 = x; R.z1 = z; R.y1 = L.ys[0] || 0; R.yaw1 = Math.atan2(b[0] - a[0], b[1] - a[1]);
  }
  /** It wrecks a tower of the district: one next to it, for choice the one in its way. The tower comes down in dust with a flash that carries to the deck. */
  private titanSmash() {
    const sim = this.sim, R = this.roam, W = this.world, v = R.v;
    if (!sim || !v || R.leap >= 0 || !W.citySmash || !W.cityTop || !W.cityStep) return;
    const s = W.cityStep, r0 = Math.round(R.z / (s * 0.8660254)), c0 = Math.round(R.x / s - (r0 & 1 ? 0.5 : 0)), cand: number[][] = [];
    this.roamGoal(sim.titan, PT);
    const gx = PT.x, gz = PT.z;
    for (const n of r0 & 1 ? CITY_NEAR_ODD : CITY_NEAR) {
      const c = c0 + n[0], r = r0 + n[1], top = W.cityTop(c, r);
      if (top < 5 || top === Infinity) continue;
      this.cityXZ(c, r, PT);
      cand.push([Math.hypot(PT.x - gx, PT.z - gz), c, r]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    let b: { x: number; z: number; h: number } | null = null;
    for (const c of cand) if ((b = W.citySmash(c[1], c[2]))) break;
    R.owe = !b;   // nothing in reach: the next tower it comes past
    if (!b) return;
    const fx = this.fx, hit = b, h = Math.min(hit.h, 40), gy = -3;
    v.rig.lunge = 1; R.face = Math.atan2(hit.x - R.x, hit.z - R.z); R.faceT = 2.4; R.wait = Math.min(R.wait, 0.4);
    fx.flash(hit.x, gy + h * 0.55, hit.z, 13, STATIC, 0.32); fx.flash(hit.x, gy + h * 0.55, hit.z, 6, 0xffffff, 0.12);
    fx.burst(hit.x, gy + h * 0.6, hit.z, 40, 14, HEAT, 1.2, 0.5, 9); fx.burst(hit.x, gy + h * 0.6, hit.z, 30, 10, STATIC, 0.9, 0.5, 6);
    for (let i = 0; i < 6; i++) this.later.push({ t: 0.3 + i * 0.5, fn: () => {
      const up = 1 - i / 6;
      fx.smoke(hit.x, gy + 1 + h * 0.5 * up, hit.z, 5, 5 + 2 * (1 - up), 9, 1.4);
      if (i === 4) { fx.ring(hit.x, gy + 0.3, hit.z, 16, DUST, 1.2, 0.1, 0.8); fx.burst(hit.x, gy + 1, hit.z, 40, 12, DUST, 1.2, 0.6, 8, 0.4); }
    } });
    this.bump(0.9, hit.x, hit.z);
  }
  /** The Titan dies: its visual leaves the enemy list and becomes a wreck that takes its time coming down (syncWreck). */
  private titanDie(x: number, y: number, z: number) {
    const fx = this.fx;
    let v: EVis | undefined;
    for (const [id, o] of this.ev) if (o.type === 'titan') { v = o; this.ev.delete(id); break; }
    fx.flash(x, y, z, 12, VIOLET, 0.5); fx.flash(x, y, z, 6, 0xffffff, 0.2); fx.star(x, y, z, 7, FROST, 14, 0.4);
    fx.burst(x, y, z, 120, 18, VIOLET, 1.3, 0.5, 9); fx.burst(x, y, z, 60, 12, HEAT, 1.5, 0.3, 12);
    this.shake = Math.max(this.shake, 1.6); this.pulse(x, z, VIOLET, 40, 1);
    if (!v) return;
    if (this.wreck) this.poolEnemy(this.wreck.v);
    for (const w of v.weak) w.core.visible = w.ring.visible = false;
    if (v.hitT > 0) { v.hitT = 0; for (let i = 0; i < v.meshes.length; i++) v.meshes[i].material = v.mats[i]; }
    v.bar.visible = v.back.visible = false; v.glow.visible = false;
    v.rig.dead = 1e-3; v.rig.snap = null; v.rig.ground = null;
    this.wreck = { v, t: 0, tick: 0.3, x: v.obj.position.x, z: v.obj.position.z, gy: v.obj.position.y, down: false };
  }
  /** The long collapse: lights failing in fits, explosions walking over the hull as it sinks, the hull meeting the deck with a ripple that crosses all of it, then the wreck going under its own smoke. */
  private syncWreck(dt: number) {
    const w = this.wreck;
    if (!w) return;
    const fx = this.fx, v = w.v, rig = v.rig;
    w.t += dt; rig.dead = w.t;
    updateEnemy(rig, dt, 0, false, false, NaN, false);
    const k = ease(w.t / 2.6), hy = w.gy + ENEMIES.titan.y - 5.6 * k;
    const fits = w.t < 2.8 ? (Math.sin(this.time * 53) * Math.sin(this.time * 17) > 0.12 * w.t ? 1 - 0.7 * k : 0.04) : 0.02;
    for (const g of v.own) g.m.emissiveIntensity = g.i0 * fits;
    for (const g of v.wglow) g.m.emissiveIntensity = g.i0 * (w.t < 3.2 ? 0.4 + 1.2 * Math.abs(Math.sin(this.time * 9)) * (1 - 0.5 * k) : 0.03);
    if (w.t < 3.6 && (w.tick -= dt) <= 0) {
      w.tick = 0.16 + Math.random() * 0.3;
      const a = Math.random() * TAU, r = Math.random() * 3, px = w.x + Math.cos(a) * r, pz = w.z + Math.sin(a) * r, py = hy + (Math.random() - 0.3) * 2.5, big = Math.random() < 0.35;
      fx.flash(px, py, pz, big ? 4.5 : 2.4, big ? APRICOT : VIOLET, 0.2); fx.burst(px, py, pz, big ? 30 : 14, big ? 12 : 8, big ? HEAT : STATIC, 0.8, 0.3, 10);
      fx.smoke(px, py, pz, big ? 4 : 2, big ? 2.4 : 1.5, 2, 1.2);
      if (big) { this.bump(0.5, px, pz, true); this.pulse(px, pz, APRICOT, 9, 0.7); }
    }
    if (!w.down && w.t >= 2.5) {
      w.down = true;
      fx.ring(w.x, w.gy + 0.15, w.z, 22, DUST, 1.2, 0.06, 1.2); fx.ring(w.x, w.gy + 0.2, w.z, 12, VIOLET, 0.7, 0.1);
      fx.burst(w.x, w.gy + 1, w.z, 80, 15, DUST, 1.1, 0.4, 11, 0.5); fx.column(w.x, w.gy, w.z, VIOLET, 30); fx.scorch(w.x, w.z, 8, VIOLET, 14, w.gy);
      for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; fx.smoke(w.x + Math.cos(a) * 4, w.gy + 0.5, w.z + Math.sin(a) * 4, 3, 2.6, 2, 0.8); }
      this.pulse(w.x, w.z, VIOLET, 85, 1); this.later.push({ t: 0.25, fn: () => this.pulse(w.x, w.z, STATIC, 85, 0.9) });
      this.shake = Math.max(this.shake, 2.4);
    }
    if (w.t > 4.6) {
      v.obj.position.y -= dt * 5.5;
      if (Math.random() < dt * 14) fx.smoke(w.x + (Math.random() - 0.5) * 6, w.gy + 0.6, w.z + (Math.random() - 0.5) * 6, 2, 2.4, 2, 0.9);
      if (w.t > 7.6) { this.poolEnemy(v); this.wreck = null; }
    }
  }

  /** collapse = the zone ran out in play (a singularity goes with a hard flash), false when the match is cleared away. */
  private dropZone(v: ZVis, collapse = true) {
    this.dyn.remove(v.obj);
    for (const m of v.mats) m.dispose();
    if (!collapse || v.kind !== 'sing' || v.t < 0) return;
    const fx = this.fx, y = v.y + 1.7;
    fx.flash(v.x, y, v.z, 3.4, 0xffffff, 0.16); fx.flash(v.x, y, v.z, 5.5, SINGC, 0.34);
    fx.star(v.x, y, v.z, 3.2, 0xffffff, 10, 0.22);
    fx.ring(v.x, v.y + 0.14, v.z, v.r * 1.25, SINGC, 0.5, 0.05, 1.3); fx.ring(v.x, v.y + 0.14, v.z, v.r * 0.7, 0xffffff, 0.3, 0.05);
    fx.burst(v.x, y, v.z, 40, 12, SINGC, 0.7, 0.3, 3); fx.burst(v.x, y, v.z, 16, 7, FROST, 0.5, 0.2, 1);
    this.pulse(v.x, v.z, SINGC, v.r * 2, 1);
    this.bump(0.3, v.x, v.z, true);
  }

  // ---------- per-frame sync ----------
  private sync(dt: number) {
    const sim = this.sim;
    if (!sim) return;
    const fx = this.fx, f = ++this.frame, k = 1 - Math.exp(-dt * 18), b = this.heroBlend;
    for (let i = 0; i < this.later.length; i++) { const l = this.later[i]; if ((l.t -= dt) <= 1e-6) { this.later.splice(i--, 1); l.fn(); } }
    if (this.zoneWait.length > 8) this.zoneWait.shift();
    this.thunder -= dt; this.swarm -= dt;
    const me = sim.players[this.me], aim = !!me && me.heroActive && b > 0.5;
    if (aim) { this.camPose(RO, RD); const o = sim.heroOrigin(this.me); if (o) this.bow.set(o.x, o.y, o.z); }

    // deck assembly: the core, wreckage and lamps come in with their tiles (one last pass at full size when it ends)
    if (this.intro) {
      this.intro = this.introActive();
      if (this.coreObj) this.coreObj.scale.setScalar(Math.max(0.001, this.reveal(this.core.x, this.core.z)));
      for (const o of this.scenery.children) o.scale.setScalar(Math.max(0.001, this.reveal(o.position.x, o.position.z)) * (o.userData.s || 1));
      const hz = BOARD_D / 2 - 1;
      for (const l of this.lamps) l.scale.setScalar(Math.max(0.001, this.reveal(l.position.x, l.position.z > 0 ? hz : -hz)));
    }

    // enemies
    for (const e of sim.enemies) {
      if (e.type === 'mite') continue;   // drawn instanced, all of them together (syncMites)
      let v = this.ev.get(e.id);
      if (!v) {
        // the Titan that leapt in from the district is the one that now walks
        if (e.type === 'titan' && this.roam.v) { v = this.roam.v; this.roam.v = null; this.roam.leap = -1; this.roam.off = true; v.fresh = true; v.obj.visible = true; }
        else v = this.enemyVis(e.type);
        this.ev.set(e.id, v);
      }
      v.seen = f;
      this.syncEnemy(e, v, dt, k, b, aim);
    }
    for (const [id, v] of this.ev) if (v.seen !== f) { this.poolEnemy(v); this.ev.delete(id); }
    this.syncMites(dt, f);
    this.syncTitan(dt);
    this.syncWreck(dt);

    // towers
    for (const t of sim.towers) {
      const v = this.tv.get(t.id) || this.makeTower(t);
      v.seen = f;
      let linked = false;
      if (t.type === 'spire') for (const p of sim.players) if (p.heroActive && p.heroTower === t.id) linked = true;
      this.syncTower(t, v, dt, linked);
      this.syncNode(t, v, b);
    }
    for (const [id, v] of this.tv) if (v.seen !== f) { this.dropTower(v); this.tv.delete(id); }

    // projectiles
    for (const p of sim.projs) {
      let v = this.pv.get(p.id);
      if (!v) {
        const pool = this.ppool[p.kind];
        if (pool && pool.length) { v = pool.pop()!; v.mesh.visible = true; v.fresh = true; }
        else { const mesh = new THREE.Mesh(this.projGeo[p.kind] || this.projGeo.bolt, this.projMat[p.kind] || this.projMat.arrow0); mesh.frustumCulled = false; mesh.layers.set(FX_LAYER); this.dyn.add(mesh); v = { mesh, kind: p.kind, seen: 0, fresh: true, em: 0 }; }
        if (p.kind === 'arrow') v.mesh.material = this.projMat['arrow' + p.tier] || this.projMat.arrow0;
        this.pv.set(p.id, v);
      }
      v.seen = f;
      v.mesh.position.set(p.x, p.y, p.z);
      if (p.vx || p.vy || p.vz) { V.set(p.x + p.vx, p.y + p.vy, p.z + p.vz); v.mesh.lookAt(V); }
      if (p.kind === 'arrow') { const w = 1 + 0.18 * (p.tier || 0); v.mesh.scale.set(w, w, 1); fx.spark(p.x, p.y, p.z, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0.24 + 0.03 * (p.tier || 0), 0.17 + 0.04 * (p.tier || 0), (BOW_TIERS[p.tier] || BOW_TIERS[0]).color); }
      else if (p.kind === 'shell') fx.spark(p.x, p.y, p.z, 0, 0.5, 0, 0.4, 0.3, APRICOT);
      else if (p.kind === 'missile') {
        // exhaust flame and a thin smoke trail behind the motor
        const sp = Math.hypot(p.vx, p.vy, p.vz) || 1, bx = p.x - (p.vx / sp) * 0.35, by = p.y - (p.vy / sp) * 0.35, bz = p.z - (p.vz / sp) * 0.35;
        fx.spark(bx, by, bz, -p.vx * 0.1, -p.vy * 0.1, -p.vz * 0.1, 0.16, 0.3, HEAT);
        v.em += dt * 26;
        while (v.em >= 1) { v.em -= 1; fx.puff(bx + (Math.random() - 0.5) * 0.1, by, bz + (Math.random() - 0.5) * 0.1, 0.32, 0.75, 0.25); }
      }
    }
    for (const [id, v] of this.pv) if (v.seen !== f) { v.mesh.visible = false; (this.ppool[v.kind] ||= []).push(v); this.pv.delete(id); }

    // walls of fire (after the towers: they mark the pylons they join)
    this.syncWalls(dt, f);

    // zones. They sit at Zone.y: the deck or the raised road they were thrown onto
    for (const z of sim.zones) {
      let v = this.zv.get(z.id);
      const zy = z.y || 0;
      if (!v) {
        const obj = new THREE.Group();
        const c = z.kind === 'burn' ? APRICOT : z.kind === 'rain' ? SAND : SINGC;
        const mats: THREE.Material[] = [];
        let halo: THREE.Object3D | null = null, core: THREE.Object3D | null = null, lens: THREE.Mesh | null = null, fill: THREE.Mesh | null = null, ax = 0.88, az = 0.47;
        const rim = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(z.kind === 'sing' ? 0.5 : 0.7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
        const ring = new THREE.Mesh(G_RING, rim); ring.scale.setScalar(z.r); obj.add(ring);
        mats.push(rim);
        if (z.kind === 'sing') {
          // no light comes out of the middle: the deck goes dark under it, a black core hangs above with a hard white
          // rim where the light bends round it, and a disc of matter winds in
          const shade = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: glowTexture(), transparent: true, opacity: 0.62, depthWrite: false, fog: false });
          const m3 = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }), m4 = accMat(), m5 = lensMat();
          const dark = new THREE.Mesh(POOL_GEO, shade); dark.scale.setScalar(z.r * 0.95); obj.add(dark);
          core = new THREE.Group(); core.position.y = 1.7;
          const hole = new THREE.Mesh(G_SPH, m3); hole.scale.setScalar(0.62); core.add(hole);
          halo = new THREE.Mesh(G_ACC, m4); halo.scale.setScalar(2.1); halo.rotation.set(0.42, 0, 0.16); core.add(halo);
          lens = new THREE.Mesh(G_QUAD, m5); lens.scale.setScalar(1.6); lens.renderOrder = 2; core.add(lens);
          obj.add(core);
          mats.push(shade, m3, m4, m5);
        } else if (z.kind === 'rain') {
          // a soft pool of light that grows from the middle while the volley is in the air
          const m1 = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
          fill = new THREE.Mesh(POOL_GEO, m1); fill.position.y = -0.01; obj.add(fill);
          mats.push(m1);
          rim.color.setHex(0x000000);
          // the shower comes in from the side the volley was loosed from
          const o = z.owner >= 0 ? sim.heroOrigin(z.owner) : null, l = o ? Math.hypot(o.x - z.x, o.z - z.z) : 0;
          if (o && l > 0.5) { ax = (o.x - z.x) / l; az = (o.z - z.z) / l; }
        } else {
          const m1 = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
          const disc = new THREE.Mesh(G_DISC, m1); disc.scale.setScalar(z.r); obj.add(disc);
          mats.push(m1);
        }
        obj.position.set(z.x, zy + 0.07, z.z);
        this.dyn.add(noAO(obj));
        v = { obj, kind: z.kind, seen: f, t: 0, mats, halo, c, tick: 0, x: z.x, y: zy, z: z.z, r: z.r, core, lens, life: z.life, fill, ax, az };
        // a rain zone that is already old (a guest joined late, a snapshot) has its shower running
        if (z.kind === 'rain' && z.life < 3.5 - RAIN_LAND) v.t = RAIN_LAND;
        // a zone thrown by the hero shows up when her pose releases it
        for (let i = this.zoneWait.length - 1; i >= 0; i--) { const w = this.zoneWait[i]; if (Math.abs(w[0] - z.x) < 0.01 && Math.abs(w[1] - z.z) < 0.01) { v.t = -w[2]; this.zoneWait.splice(i, 1); break; } }
        if (z.kind === 'sing' && z.owner < 0) {
          // Collapse: the well reaches out to its victim and the space round it folds in
          let src: Tower | null = null;
          for (const t of sim.towers) if (t.type === 'gravity' && t.spec > 0 && (!src || Math.hypot(t.x - z.x, t.z - z.z) < Math.hypot(src.x - z.x, src.z - z.z))) src = t;
          if (src) { nodePos(src, W3); fx.beam(W3.x, W3.y, W3.z, z.x, zy + 1.7, z.z, c, 0.3, 0.6); fx.beam(W3.x, W3.y, W3.z, z.x, zy + 1.7, z.z, 0xffffff, 0.08, 0.7); }
          fx.flash(z.x, zy + 1.7, z.z, 2.4, c, 0.35);
          this.bump(0.3, z.x, z.z, true);
        }
        this.zv.set(z.id, v);
      }
      v.seen = f; v.t += dt; v.life = z.life;
      v.obj.visible = v.t >= 0;
      if (v.t < 0) continue;
      if (z.kind === 'rain') {
        // marker: the rim fades in, the pool fills until the first shafts land, then both sit low under the shower and fade with it
        const k = ease(v.t / RAIN_LAND), end = Math.min(1, z.life / 0.5), landed = ease((v.t - RAIN_LAND) / 0.4);
        (v.mats[0] as THREE.MeshBasicMaterial).color.setHex(SAND).multiplyScalar(ease(v.t / 0.25) * (0.75 - 0.3 * landed) * end);
        if (v.fill) {
          v.fill.scale.setScalar(z.r * (0.2 + 1.05 * k));
          (v.fill.material as THREE.MeshBasicMaterial).color.setHex(SAND).multiplyScalar((0.1 + 0.5 * k * (1 - 0.7 * landed)) * end);
        }
        // the shower: shafts come down all over the zone, a few at a time, for as long as it lasts
        if (v.t >= RAIN_LAND - 0.12 && z.life > 0.2) {
          v.tick += dt * 24;
          while (v.tick >= 1) {
            v.tick -= 1;
            const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * z.r * 0.96, x = z.x + Math.cos(a) * r, zz = z.z + Math.sin(a) * r, sh = this.shaft();
            sh.mode = 3; sh.t = 0; sh.T = 0.19 + Math.random() * 0.04; sh.pow = 1; sh.gy = zy; sh.tr = 0;
            sh.to.set(x, zy, zz); sh.p0.set(x + v.ax * 3.6 + (Math.random() - 0.5) * 1.2, zy + 13, zz + v.az * 3.6 + (Math.random() - 0.5) * 1.2);
            sh.pos.copy(sh.p0); sh.last.copy(sh.p0); sh.dir.subVectors(sh.to, sh.p0).normalize();
          }
        }
      } else if (z.kind === 'sing' && v.core) {
        // it opens fast, feeds for as long as it lives and shrinks to a point just before it goes
        const open = ease(v.t / 0.18) * (z.life < 0.22 ? Math.max(0.05, z.life / 0.22) : 1), cy = zy + 1.7;
        v.core.scale.setScalar(open * (1 + 0.04 * Math.sin(v.t * 23)));
        if (v.halo) { v.halo.rotation.y -= dt * 2.4; v.halo.rotation.x = 0.42 + Math.sin(v.t * 1.7) * 0.12; }
        if (v.lens) v.lens.quaternion.copy(this.camera.quaternion).premultiply(Q1.copy(v.core.quaternion).invert());
        // hex borders: ripples that run inward, one after the other
        if ((v.tick -= dt) <= 0) { v.tick = 0.42; this.pulse(z.x, z.z, v.c, -z.r * 1.3, 0.7); fx.ring(z.x, zy + 0.12, z.z, z.r * 0.12, v.c, 0.5, 8.5, 0.45); }
        // matter pulled in: dust that spirals to the core, and now and then a long streak
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * 6.28, r = z.r * (0.45 + Math.random() * 0.55), px = z.x + Math.cos(a) * r, pz = z.z + Math.sin(a) * r, py = zy + 0.2 + Math.random() * 2.6, T = 0.4 + Math.random() * 0.2;
          fx.spark(px, py, pz, (-Math.cos(a) * r * 1.5 - Math.sin(a) * r * 0.9) / T, ((cy - py) * 1.5) / T, (-Math.sin(a) * r * 1.5 + Math.cos(a) * r * 0.9) / T, T, 0.3, Math.random() < 0.3 ? 0xffffff : v.c, 0, 0.5);
        }
        if (Math.random() < dt * 22) {
          const a = Math.random() * 6.28, r = z.r * (0.5 + Math.random() * 0.5), y0 = zy + 0.15 + Math.random() * 1.2;
          fx.beam(z.x + Math.cos(a) * r, y0, z.z + Math.sin(a) * r, z.x + Math.cos(a + 0.35) * r * 0.3, cy + (y0 - cy) * 0.3, z.z + Math.sin(a + 0.35) * r * 0.3, Math.random() < 0.4 ? 0xffffff : v.c, 0.05, 0.16);
        }
      } else if (z.kind === 'burn' && Math.random() < 0.6) {
        const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * z.r;
        fx.spark(z.x + Math.cos(a) * r, zy + 0.1, z.z + Math.sin(a) * r, 0, 2 + Math.random() * 2, 0, 0.6, 0.45, APRICOT, -1);
      }
    }
    for (const [id, v] of this.zv) if (v.seen !== f) { this.dropZone(v, v.life < 0.3); this.zv.delete(id); }

    this.syncShafts(dt);

    // jump targets above the other Spires
    this.syncBeacons(dt, aim);

    // heroes
    const tier = BOW_TIERS[sim.tier];
    for (const m of this.bowMats) { m.color.setHex(tier.color).multiplyScalar(0.25); m.emissive.setHex(tier.color); }
    sim.players.forEach((p, i) => {
      const h = this.hero(i);
      const t = p.heroActive ? sim.towerById(p.heroTower) : undefined;
      if (t) h.out = false;
      h.obj.visible = h.shown = !!t || h.out;
      if (!h.shown) return;
      for (const tr of h.tiers) tr.o.visible = sim.tier + 1 >= tr.n;
      const yaw = i === this.me ? this.yaw : p.yaw, pitch = i === this.me ? this.pitch : p.pitch;
      if (h.tele > 0) { h.tele -= dt; if (h.tele <= 0 && h.rig) heroTrigger(h.rig, 'teleIn'); }
      // she stands on the platform of the spire she is linked to
      if (t && h.tele <= 0) h.pos.set(t.x, standY(t), t.z);
      h.obj.position.copy(h.pos);
      h.obj.rotation.y = yaw;
      // the rig owns scale (squash / materialise) and the teleport flicker
      // and the bow shows the tension the player holds in it
      const pull = p.heroActive && typeof p.draw === 'number' ? p.draw : -1;
      if (h.rig) { if (!updateHero(h.rig, yaw, pitch, dt, HERO_SCALE, pull)) { h.out = false; h.obj.visible = h.shown = false; } }
    });
  }

  private hero(i: number): HVis {
    let h = this.heroes[i];
    if (!h) {
      const obj = this.models.hero.clone();
      obj.scale.setScalar(HERO_SCALE); obj.visible = false;
      const tiers: HVis['tiers'] = [];
      obj.traverse((o) => { const m = /^tier([2-5])(_|$)/.exec(o.name); if (m) tiers.push({ n: +m[1], o }); });
      this.dyn.add(obj);
      h = this.heroes[i] = { obj, rig: makeHeroRig(obj), pos: new THREE.Vector3(), tele: 0, out: false, shown: false, tiers };
    }
    return h;
  }

  /**
   * In the Uplink every other Spire carries a jump target at spireTarget(): a verdigris reticle with the F key under it
   * (shoot it or press F). The one under the crosshair, or picked by the controller, lights up and closes its brackets.
   */
  private syncBeacons(dt: number, aim: boolean) {
    const sim = this.sim!, me = sim.players[this.me], b = this.heroBlend;
    let n = 0;
    if (aim && me) for (const t of sim.towers) {
      if (t.type !== 'spire' || t.id === me.heroTower || t.down > 0) continue;
      let v = this.beacons[n];
      if (!v) {
        const obj = new THREE.Group(), mat = reticleMat(4);
        const ret = new THREE.Mesh(G_QUAD, mat); ret.scale.setScalar(SPIRE_R * 1.2);
        const dia = new THREE.Mesh(G_OCTA, new THREE.MeshBasicMaterial({ color: new THREE.Color(UPLINK).multiplyScalar(1.4), fog: false })); dia.scale.set(0.13, 0.2, 0.13);
        const key = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.keyTexture(), color: UPLINK, transparent: true, depthWrite: false, fog: false })); key.center.set(0.5, 1);
        obj.add(ret, dia, key);
        this.dyn.add(noAO(obj));
        v = this.beacons[n] = { obj, ret, mat, dia, key, hot: 0 };
      }
      n++;
      spireTarget(t, W3);
      const u = raySphere(RO.x, RO.y, RO.z, RD.x, RD.y, RD.z, W3.x, W3.y, W3.z, SPIRE_R), on = u > 0 || t.id === this.teleId;
      v.hot = damp(v.hot, on ? 1 : 0, 16, dt);
      const hot = v.hot, d = Math.hypot(W3.x - RO.x, W3.y - RO.y, W3.z - RO.z);
      v.obj.visible = true;
      v.obj.position.set(W3.x, W3.y, W3.z);
      v.obj.scale.setScalar(Math.max(0.01, b));
      v.ret.quaternion.copy(this.camera.quaternion);
      v.ret.scale.setScalar(SPIRE_R * (1.2 - 0.12 * hot));
      const uu = v.mat.uniforms;
      (uu.color.value as THREE.Color).setHex(UPLINK).lerp(C1.setHex(0xffffff), 0.35 * hot);
      uu.gain.value = 0.6 + 0.12 * Math.sin(this.time * 3 + t.id) + 1.0 * hot;
      uu.mark.value = 0.45 + 0.55 * hot;
      uu.spin.value = v.ret.userData.s = (v.ret.userData.s || 0) + dt * (0.5 + 2.5 * hot);
      v.dia.rotation.y += dt * (1.5 + 4 * hot);
      (v.dia.material as THREE.MeshBasicMaterial).color.setHex(UPLINK).multiplyScalar(1.1 + 1.2 * hot);
      // the key cap keeps a readable size at any distance
      const ks = Math.max(0.5, d * 0.032) * (1 + 0.15 * hot);
      v.key.scale.set(ks, ks, 1); v.key.position.y = -SPIRE_R * 1.15;
      (v.key.material as THREE.SpriteMaterial).opacity = 0.6 + 0.4 * hot;
    }
    for (let i = n; i < this.beacons.length; i++) this.beacons[i].obj.visible = false;
  }
  /** A small key cap with an F on it, drawn once. */
  private keyTexture() {
    if (this.keyTex) return this.keyTex;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.strokeStyle = '#ffffff'; g.fillStyle = 'rgba(8,14,13,0.75)'; g.lineWidth = 4;
    g.beginPath(); g.roundRect(8, 8, 48, 48, 9); g.fill(); g.stroke();
    g.fillStyle = '#ffffff'; g.font = '700 32px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('F', 32, 34);
    this.keyTex = new THREE.CanvasTexture(c); this.keyTex.colorSpace = THREE.SRGBColorSpace;
    return this.keyTex;
  }

  /** A free Arrow Rain shaft (the oldest one in use when all are taken). */
  private shaft(): Shaft {
    for (const s of this.shafts) if (!s.mode) return s;
    return this.shafts[this.shaftN++ % SHAFTS];
  }
  /**
   * The Arrow Rain volley leaves the bow (the sim only knows the zone it lands in): a tight fan of shafts that climbs fast,
   * slows into its top above the road between her and the zone, tips over there and comes down spread across the zone.
   */
  private rainVolley(pi: number, zx: number, zy: number, zz: number) {
    const sim = this.sim, p = sim && sim.players[pi], o = sim && p && p.heroActive ? sim.heroOrigin(pi) : null;
    if (!o || !sim) return;
    let r = 4.5;
    for (const z of sim.zones) if (z.kind === 'rain' && Math.abs(z.x - zx) < 0.01 && Math.abs(z.z - zz) < 0.01) r = z.r;
    const d = Math.hypot(zx - o.x, zz - o.z), yaw = d > 0.5 ? Math.atan2(zx - o.x, zz - o.z) : pi === this.me ? this.yaw : p!.yaw;
    const hx = Math.sin(yaw), hz = Math.cos(yaw);
    // the top of the climb: part of the way to the zone, well above the bow. For the player who loosed it the top stays
    // inside the picture: looking steeply down at a near zone, the volley goes out in a low arc instead of leaving the screen
    const run = Math.min(d * 0.5, 9);
    let rise = Math.max(5, Math.min(10, 4.5 + 0.2 * d));
    if (pi === this.me && this.heroBlend > 0.5) rise = Math.max(1.3, Math.min(rise, this.camera.position.y - o.y + Math.tan(Math.min(1.2, this.pitch + 0.4)) * (run + CAM_BACK)));
    const reach = Math.hypot(run, rise) * 0.6;
    // the shafts leave along the bow, which points high; a low arc bends over sooner
    const el = Math.min(1.08, Math.atan2(rise, run) + 0.45), cu = Math.cos(el), su = Math.sin(el);
    const bx = o.x + hx * cu * 0.5, by = o.y + su * 0.5 + 0.1, bz = o.z + hz * cu * 0.5;
    for (let i = 0; i < RAIN_N; i++) {
      const k = i - (RAIN_N - 1) / 2, ak = Math.abs(k), s = this.shaft();
      const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * r * 0.9;
      s.mode = 1; s.t = 0; s.T = RAIN_CLIMB * (1 + 0.03 * ak); s.pow = 2; s.gy = zy; s.tr = 0;
      s.p0.set(bx + hz * k * 0.03, by, bz - hx * k * 0.03);
      s.p1.set(bx + hx * cu * reach + hz * k * 0.3, by + su * reach, bz + hz * cu * reach - hx * k * 0.3);
      s.p2.set(o.x + hx * (run - ak * 0.22) + hz * k * 0.6, o.y + rise - ak * 0.14 + Math.random() * 0.3, o.z + hz * (run - ak * 0.22) - hx * k * 0.6);
      s.to.set(zx + Math.cos(a) * rr, zy, zz + Math.sin(a) * rr);
      s.pos.copy(s.p0); s.last.copy(s.p0); s.dir.set(hx * cu, su, hz * cu);
    }
    this.fx.burst(bx, by, bz, 4, 2.5, FROST, 0.22, 0.14, 0);
  }
  /** Move the Arrow Rain shafts: climb, hang, fall, strike (sparks, a dust ring), then stand in the deck a moment and sink. */
  private syncShafts(dt: number) {
    const fx = this.fx, mesh = this.shaftMesh;
    let n = 0;
    for (const s of this.shafts) {
      if (!s.mode) continue;
      s.t += dt;
      let len = 1;
      if (s.mode === 1) {
        // fast off the string, slowing all the way up
        const u = Math.min(1, s.t / s.T), e = 1 - Math.pow(1 - u, 2.3), q = 1 - e;
        s.pos.set(q * q * s.p0.x + 2 * e * q * s.p1.x + e * e * s.p2.x, q * q * s.p0.y + 2 * e * q * s.p1.y + e * e * s.p2.y, q * q * s.p0.z + 2 * e * q * s.p1.z + e * e * s.p2.z);
        s.dir.set(q * (s.p1.x - s.p0.x) + e * (s.p2.x - s.p1.x), q * (s.p1.y - s.p0.y) + e * (s.p2.y - s.p1.y), q * (s.p1.z - s.p0.z) + e * (s.p2.z - s.p1.z)).normalize();
        len = 1 + 0.5 * q;
        if (u >= 1) { s.mode = 2; s.t = 0; s.d0.copy(s.dir); }
      } else if (s.mode === 2) {
        // the beat at the top: the shaft drifts on a little and tips its head toward the zone
        const u = Math.min(1, s.t / RAIN_HANG), e = ease(u);
        s.pos.copy(s.p2).addScaledVector(s.d0, 0.3 * Math.sin(u * Math.PI * 0.5)); s.pos.y -= 0.25 * u * u;
        s.dir.subVectors(s.to, s.pos).normalize().multiplyScalar(e).addScaledVector(s.d0, 1 - e).normalize();
        if (u >= 1) { s.mode = 3; s.t = 0; s.T = RAIN_DIVE * (0.85 + 0.5 * Math.random()); s.p0.copy(s.pos); }
      } else if (s.mode === 3) {
        const u = Math.min(1, s.t / s.T), e = s.pow === 1 ? u : u * u;
        s.pos.lerpVectors(s.p0, s.to, e);
        s.dir.subVectors(s.to, s.p0).normalize();
        len = 1.45;
        if (u >= 1) {
          const x = s.to.x, z = s.to.z, gy = s.gy;
          s.mode = 4; s.t = 0; s.T = 0.4 + Math.random() * 0.35;
          fx.burst(x, gy + 0.08, z, 3, 3.2, SAND, 0.28, 0.2, 7);
          fx.spark(x, gy + 0.12, z, 0, 0.4, 0, 0.12, 0.5, FROST);
          if (this.shaftN++ & 1) fx.ring(x, gy + 0.06, z, 0.5 + Math.random() * 0.3, DUST, 0.3, 0.25, 0.8);
          else if (Math.random() < 0.5) fx.puff(x, gy + 0.12, z, 0.34, 0.5, 0.4);
        }
      }
      if (s.mode === 4) {
        // stuck: a third of it in the deck, then it sinks away
        const k = Math.min(1, (s.T - s.t) / 0.15);
        len = 0.7;
        s.pos.copy(s.to).addScaledVector(s.dir, 0.3 - 0.77 * k);
        if (s.t >= s.T) { s.mode = 0; continue; }
      } else {
        // a thin trail: one short segment every few hundredths of a second
        s.tr += dt;
        if (s.tr >= 0.035) { s.tr = 0; fx.beam(s.last.x, s.last.y, s.last.z, s.pos.x, s.pos.y, s.pos.z, s.mode === 3 ? FROST : TRAIL, 0.034, s.mode === 3 ? 0.13 : 0.3); s.last.copy(s.pos); }
      }
      mesh.setMatrixAt(n++, M4.compose(s.pos, Q1.setFromUnitVectors(ZA, s.dir), V3.set(1, 1, len)));
    }
    if (n || mesh.count) { mesh.count = n; mesh.instanceMatrix.needsUpdate = true; }
  }

  private updateCamera(dt: number) {
    const sim = this.sim, p = sim ? sim.players[this.me] : null;
    const t = p && p.heroActive && sim ? sim.towerById(p.heroTower) : undefined;
    const target = t ? 1 : 0;
    this.heroBlend += Math.max(-dt * 2.4, Math.min(dt * 2.4, target - this.heroBlend));
    // bird view
    if (this.orbit) { const a = this.time * 0.06; this.topPos.set(Math.sin(a) * 46, 30 + Math.sin(a * 1.7) * 4, Math.cos(a) * 40 + 4); V.set(2, 0, 0); }
    else { const c = this.cam, tl = this.tiltOf(c.dist), h = c.dist * Math.cos(tl); this.topPos.set(c.x + Math.sin(c.rot) * h, c.dist * Math.sin(tl), c.z + Math.cos(c.rot) * h); V.set(c.x, 0, c.z); }
    this.dummy.position.copy(this.topPos); this.dummy.lookAt(V); this.topQ.copy(this.dummy.quaternion);
    // third person: the anchor glides only when she changes spire; the look angles are used as they are, unsmoothed
    if (t) this.lastHeroAnchor.lerp(V.set(t.x, standY(t), t.z), this.heroBlend < 0.05 ? 1 : 1 - Math.exp(-dt * 14));
    this.camPose(this.heroPos, V2);
    this.dummy.position.copy(this.heroPos); this.dummy.lookAt(V.copy(this.heroPos).add(V2)); this.heroQ.copy(this.dummy.quaternion);
    const b = this.heroBlend, s = b * b * (3 - 2 * b);
    this.camera.position.lerpVectors(this.topPos, this.heroPos, s);
    this.camera.position.y += Math.sin(s * Math.PI) * 6;
    this.camera.quaternion.slerpQuaternions(this.topQ, this.heroQ, s);
    // Arrow Rain: the camera eases straight back a little and opens up, then returns. It moves along the line of sight
    // only, so the crosshair and the aim stay exactly where the mouse has them.
    this.rainT += dt;
    const nudge = this.rainT < 1.3 ? ease(this.rainT / 0.3) * (1 - ease((this.rainT - 0.5) / 0.8)) * s : 0;
    if (nudge > 0) this.camera.position.addScaledVector(V2, -0.5 * nudge);
    const fov = (this.orbit ? 50 : 42) + (66 - 42) * s + 2.5 * nudge;
    if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    if (this.shake > 0.001) {
      // a nudge of the camera position only: the view direction, and with it the aim, never moves
      const a = this.shake * (0.3 - 0.22 * s);
      this.camera.position.x += (Math.random() - 0.5) * a; this.camera.position.y += (Math.random() - 0.5) * a; this.camera.position.z += (Math.random() - 0.5) * a;
      this.shake *= Math.exp(-dt * 7);
    }
  }

  render(dt: number) {
    this.time += dt;
    this.sync(dt);
    this.updateCamera(dt);
    FIRE_CLOCK.value = this.time;
    // the core: hit, it drops and shudders and its light stutters; when it discharges, its rings spin up and it flares
    this.coreHit += dt; this.coreZap += dt;
    const flinch = Math.max(0, 1 - this.coreHit / 0.45), zap = Math.max(0, 1 - this.coreZap / 0.5);
    if (this.coreObj && !this.intro) {
      this.coreObj.position.set(this.core.x + Math.sin(this.time * 71) * 0.05 * flinch, -0.1 * flinch * flinch, this.core.z + Math.cos(this.time * 83) * 0.05 * flinch);
      this.coreObj.scale.set(1 + 0.035 * flinch, 1 - 0.05 * flinch, 1 + 0.035 * flinch);
    }
    const cg = (flinch > 0 ? (Math.sin(this.time * 90) > 0 ? 0.35 : 1.15) * flinch + (1 - flinch) : 1) + 1.6 * zap;
    for (const g of this.coreGlows) g.m.emissiveIntensity = g.i0 * cg;
    for (let i = 0; i < this.coreSpins.length; i++) this.coreSpins[i].rotateY(dt * (i % 2 ? -1.1 : 0.8) * (1 + 7 * zap));
    if (this.coreObj && this.sim) { const hurt = this.sim.lives <= 6; if (hurt && Math.random() < 0.3) this.fx.spark(this.core.x + (Math.random() - 0.5) * 3, 1 + Math.random() * 3, this.core.z + (Math.random() - 0.5) * 3, 0, 2, 0, 0.5, 0.4, RUST); }
    if (this.selRing.visible) (this.selRing.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.2 * Math.sin(this.time * 5);
    this.fx.update(dt, this.camera, this.renderer.domElement.height);
    this.world.update(this.time, dt);
    if (this.quality === 'high') this.post.render(dt, this.time); else this.renderer.render(this.scene, this.camera);
  }
}
