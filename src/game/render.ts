// Three.js view of a Sim: models, cameras (bird view + third person on an Uplink Spire), effects.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TOWERS, TOWER_TYPES, ENEMIES, ENEMY_TYPES, ENEMY_SCALE, BOW_TIERS, cellX, cellZ } from './data.ts';
import type { TowerType, EnemyType } from './data.ts';
import { HEX_SIZE, BOARD_W, BOARD_D, HEX_CORNERS } from './hex.ts';
import { Sim, TOWER_SCALE, TOWER_H, HERO_SCALE, SKILL_CAST, NODE_R, ARROW_PAD, standY, nodePos, weakPos, raySphere } from './sim.ts';
import type { Ev, Tower, Enemy } from './sim.ts';
import type { GameMap } from './map.ts';
import { Fx, makeBeam, placeBeam } from './fx.ts';
import { buildWorld, noAO, FX_LAYER } from './world.ts';
import { Post } from './post.ts';
import { lightPool, glowTexture, POOL_GEO } from './tex.ts';
import { makeEnemyRig, resetEnemy, updateEnemy, makeTowerRig, updateTower, towerShot, makeHeroRig, updateHero, heroTrigger, resetHero, RAIN_GAP } from './anim.ts';
import type { EnemyRig, TowerRig, TowerState, HeroRig, HeroEvent } from './anim.ts';

const MODEL_NAMES = [...TOWER_TYPES.map((t) => 'tower_' + t), ...ENEMY_TYPES.map((t) => 'enemy_' + t), 'hero', 'core', 'prop_barrier', 'prop_lamp', 'prop_crate'];

// Ember palette. Defenders are warm, the Static is cold, verdigris belongs to the Uplink.
const SAND = 0xe3dc92, APRICOT = 0xf68b56, RUST = 0xce6b44, UPLINK = 0x6fe0c8;
const STATIC = 0x8fd0ff, VIOLET = 0x8a7dff, FROST = 0xdff0ff;
const HEAT = 0xffa24a; // hot metal sparks
const HSL = { h: 0, s: 0, l: 0 };
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), RO = new THREE.Vector3(), RD = new THREE.Vector3();
const C1 = new THREE.Color(), C2 = new THREE.Color();
const W3 = { x: 0, y: 0, z: 0 };
const ST: TowerState = { down: false, spec: false, power: 1, heat: 0 };
const TAU = Math.PI * 2;
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
}

// Third-person camera: an orbit round a point above and to the right of Kestrel's head.
const CAM_BACK = 3.0, CAM_SIDE = 0.85, CAM_UP = 1.5;
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
const G_HALO = new THREE.TorusGeometry(1.5, 0.09, 6, 40);
const G_ICE = new THREE.IcosahedronGeometry(1, 0);
const G_OCTA = new THREE.OctahedronGeometry(1);
const G_NODE_RING = new THREE.RingGeometry(0.78, 1, 48);
const G_WEAK_RING = new THREE.RingGeometry(0.86, 1, 32);
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

const NODE_RING_FRAG = `uniform vec3 color; uniform float fill; uniform float gain; varying vec2 vP;
  void main(){ float a = fract(atan(vP.x, vP.y) / 6.2831853);
    vec3 c = color * mix(0.1, 1.0, step(a, fill)) * gain;
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const nodeRingMat = () => new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color() }, fill: { value: 0 }, gain: { value: 1 } },
  vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: NODE_RING_FRAG, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, side: THREE.DoubleSide,
});

interface Glow { m: THREE.MeshStandardMaterial; i0: number }
interface WeakVis { core: THREE.Mesh; ring: THREE.Mesh; mat: THREE.MeshBasicMaterial; rmat: THREE.MeshBasicMaterial }
interface EVis {
  obj: THREE.Object3D; rig: EnemyRig; sx: number; sz: number; glow: THREE.Mesh; back: THREE.Sprite; bar: THREE.Sprite; sbar: THREE.Sprite | null; bubble: THREE.Mesh | null;
  ice: THREE.Mesh | null; weak: WeakVis[]; wglow: Glow[]; type: EnemyType; phase: number; seen: number; fresh: boolean; lx: number; lz: number; lgy: number; tilt: number; em: number;
}
interface TVis {
  obj: THREE.Object3D; rig: TowerRig; type: TowerType; lvl: number; grow: number; s: number; seen: number;
  glows: Glow[]; acc: THREE.MeshStandardMaterial; pad: THREE.Mesh; buff: THREE.Mesh;
  /** model parts shown from level 2 / 3, and the procedural add-ons used when the model has none */
  lv: THREE.Object3D[][]; addons: THREE.Object3D[];
  /** power node: emblem group (null for towers without a special), its materials, and the model's own node lights */
  node: THREE.Group | null; core: THREE.Mesh | null; nodeMat: THREE.MeshBasicMaterial | null; ringMat: THREE.ShaderMaterial | null; halo: THREE.Sprite | null; mnode: Glow[];
  power: number; boot: number; fired: number; em: number; em2: number; tick: number; downMax: number; deny: number;
  /** flame stream and lance beam, both fed by sim events and kept alive between them */
  flT: number; flYaw: number; flR: number; flFull: boolean; flY: number;
  beam: THREE.Mesh | null; lnT: number; lnX: number; lnY: number; lnZ: number; lnY0: number; lnHeat: number; lnOver: boolean;
}
interface PVis { mesh: THREE.Mesh; kind: string; seen: number; fresh: boolean; em: number }
/** tele > 0: still dissolving at the spire she is leaving; out: playing the uplink-end animation at `pos` */
interface HVis { obj: THREE.Object3D; rig: HeroRig | null; pos: THREE.Vector3; tele: number; out: boolean; shown: boolean; tiers: { n: number; o: THREE.Object3D }[] }
interface ZVis { obj: THREE.Group; kind: string; seen: number; t: number; mats: THREE.Material[]; halo: THREE.Object3D | null; c: number; tick: number }
/** An effect held back until the hero's pose reaches its release beat. */
interface Later { t: number; fn: () => void }

/** Half-length of road (before and after a corner) over which each type swings through its turn, and the hardest it can turn (rad/s). */
const TURN_A: Record<EnemyType, number> = { grunt: 0.8, runner: 1.0, drone: 1.3, shield: 1.0, brute: 1.0, boss: 1.6 };
const TURN_RATE: Record<EnemyType, number> = { grunt: 5, runner: 7, drone: 6, shield: 3.2, brute: 2.6, boss: 1.1 };
const PO = { x: 0, z: 0, dx: 0, dz: 0, y: 0, yaw: 0 };
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
    const b = part(g, new THREE.CapsuleGeometry(d.r * 0.7, d.r, 4, 10), new THREE.MeshStandardMaterial({ color: 0x1c2230, roughness: 0.5, metalness: 0.5, name: 'hull' }), 0, t === 'drone' ? 0 : d.r * 1.2, 0);
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
  cam = { x: 0, z: 1.5, dist: 48, tilt: 1.0 };
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
    // teleport target: verdigris, shown on other spires only
    this.teleMark = new THREE.Group();
    const tm = new THREE.MeshBasicMaterial({ color: new THREE.Color(UPLINK).multiplyScalar(1.7), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const dia = new THREE.Mesh(new THREE.OctahedronGeometry(0.4), tm); dia.position.y = 1.7; this.teleMark.add(dia);
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
    core.traverse((o) => { if (o.name.startsWith('spin')) this.coreSpins.push(o); });
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
    for (const [id, v] of this.zv) { this.dropZone(v); this.zv.delete(id); }
    for (const h of this.heroes) { h.obj.visible = false; h.out = false; h.shown = false; h.tele = 0; if (h.rig) resetHero(h.rig); }
    this.later.length = 0; this.zoneWait.length = 0;
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

  /**
   * Bird camera that frames the road and the core of the current map instead of the board centre: { x, z, dist }.
   * bottom = share of the screen height the HUD bar covers.
   */
  frameMap(bottom = 0.1) {
    const out = { x: 0, z: 1.5, dist: 48 }, sim = this.sim;
    if (!sim) return out;
    let x0 = sim.map.core.x - 2.5, x1 = sim.map.core.x + 2.5, z0 = sim.map.core.z - 2.5, z1 = sim.map.core.z + 2.5;
    for (const L of sim.map.lanes) for (const p of L.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    // gates sit past the first road point; never frame tighter than the default view
    x0 = Math.max(x0 - 3, -BOARD_W / 2 - 3); x1 = Math.min(x1 + 3, BOARD_W / 2 + 3); z0 = Math.max(z0 - 3, -BOARD_D / 2 - 3); z1 = Math.min(z1 + 3, BOARD_D / 2 + 3);
    const w = Math.max(x1 - x0, 30), d = Math.max(z1 - z0, 20);
    out.dist = Math.max(40, Math.min(60, Math.max(w / (1.1 * this.camera.aspect) * 1.6, d * 1.4)));
    out.x = Math.max(-8, Math.min(8, (x0 + x1) / 2));
    // shift the look point toward the camera so the bottom gate clears the HUD bar
    out.z = Math.max(-6, Math.min(8, (z0 + z1) / 2 + out.dist * (0.03 + bottom * 0.5)));
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
      for (const t of sim.towers) if (TOWERS[t.type].special) { nodePos(t, W3); hit(W3.x, W3.y, W3.z, NODE_R); }
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
  setTele(t: Tower | null) {
    this.teleMark.visible = !!t && t.type === 'spire';
    if (t) this.teleMark.position.set(t.x, standY(t), t.z);
  }

  // ---------- events to effects ----------
  /** Route a sim event to player p's hero rig. */
  private heroAnim(p: unknown, ev: HeroEvent) {
    const h = this.heroes[p as number];
    if (h && h.rig) heroTrigger(h.rig, ev);
  }
  /** Camera shake that falls off with distance from the camera, so far blasts do not rattle the aim. */
  private bump(a: number, x: number, z: number) {
    const d = Math.hypot(x - this.camera.position.x, z - this.camera.position.z);
    this.shake = Math.max(this.shake, a * Math.max(0.12, Math.min(1, 1.5 - d / 30)));
  }

  handle(evs: Ev[]) {
    const fx = this.fx, sim = this.sim;
    // a special's own effects (the chain of a Thunderhead, the first missiles of a Swarm) sit in the same batch ahead of its event
    for (const e of evs) if (e.k === 'special') { if (e.t === 'arc') this.thunder = 0.2; else if (e.t === 'missile') this.swarm = 5; }
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
        case 'hit': fx.burst(e.x, e.y, e.z, 3, 4, e.c, 0.2, 0.22, 6); fx.burst(e.x, e.y, e.z, 2, 5, HEAT, 0.3, 0.14, 12); break;
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
          const big = e.t === 'boss', mid = e.t === 'brute' || e.t === 'shield', gy = this.deckY(e.x, e.z);
          fx.burst(e.x, e.y, e.z, big ? 70 : mid ? 14 : 6, big ? 15 : 6, STATIC, big ? 1.1 : 0.45, big ? 0.5 : 0.28, 10);
          fx.burst(e.x, e.y, e.z, big ? 40 : mid ? 8 : 4, big ? 11 : 5, HEAT, big ? 1.3 : 0.7, 0.2, 14);
          fx.flash(e.x, e.y, e.z, big ? 5 : mid ? 1.5 : 0.9, STATIC, big ? 0.45 : 0.16);
          fx.smoke(e.x, e.y + 0.2, e.z, big ? 12 : mid ? 3 : 1, big ? 2.6 : mid ? 1.2 : 0.8, big ? 3 : 0.6);
          if (e.y - gy < 2 && (big || mid || Math.random() < 0.35)) fx.scorch(e.x, e.z, big ? 5 : mid ? 1.7 : 1.1, APRICOT, big ? 10 : 5, gy);
          if (big) { fx.ring(e.x, gy + 0.15, e.z, 9, VIOLET, 0.9); fx.column(e.x, gy, e.z, FROST); this.shake = Math.max(this.shake, 0.8); this.pulse(e.x, e.z, STATIC, 14, 1); }
          break;
        }
        case 'crit': {
          // weak-point hit: a hard cold star, nothing like an ordinary spark
          fx.star(e.x, e.y, e.z, 1.5, FROST, 7, 0.2);
          fx.flash(e.x, e.y, e.z, 1.1, 0xffffff, 0.16);
          fx.burst(e.x, e.y, e.z, 14, 9, VIOLET, 0.5, 0.26, 4);
          fx.burst(e.x, e.y, e.z, 8, 5, HEAT, 0.6, 0.18, 12);
          break;
        }
        case 'crack': fx.star(e.x, e.y, e.z, 2.6, VIOLET, 9, 0.35); fx.burst(e.x, e.y, e.z, 26, 8, VIOLET, 0.8, 0.3, 9); fx.smoke(e.x, e.y, e.z, 3, 1.2, 1); break;
        case 'siege': fx.burst(this.core.x, 2, this.core.z, 16, 8, RUST, 0.7, 0.28, 8); this.bump(0.25, this.core.x, this.core.z); this.pulse(this.core.x, this.core.z, RUST, 6, 0.8); break;
        case 'shieldbreak': fx.burst(e.x, e.y, e.z, 14, 7, STATIC, 0.5, 0.24, 3); fx.flash(e.x, e.y, e.z, 1.5, STATIC, 0.18); break;
        case 'build': if (this.reveal(e.x, e.z) < 0.5) break; // placed before its tile has arrived (a bot at second zero)
          fx.ring(e.x, 0.1, e.z, 2.0, e.c, 0.5); fx.burst(e.x, 0.3, e.z, 12, 4, e.c, 0.6, 0.24, -3, 1); fx.smoke(e.x, 0.2, e.z, 3, 1, 1.6, 0.35); this.pulse(e.x, e.z, e.c, 3.5, 0.6); break;
        case 'sell': fx.burst(e.x, 0.8, e.z, 12, 5, SAND, 0.6, 0.24, 9); fx.smoke(e.x, 0.4, e.z, 3, 1.1, 1.2, 0.5); break;
        case 'arrow': this.heroAnim(e.p, 'arrow'); break;
        case 'heroOn': { const h = this.hero(+e.p); h.out = false; h.tele = 0; h.pos.set(e.x, e.y, e.z); this.heroAnim(e.p, 'on'); }
          // a slim shaft of light: a wide column would hide the whole materialise animation from the camera behind her
          fx.beam(e.x, e.y, e.z, e.x, e.y + 30, e.z, UPLINK, 0.2, 0.45); this.shake = Math.max(this.shake, 0.3); this.pulse(e.x, e.z, UPLINK, 9, 1); break;
        case 'heroOff': { const h = this.heroes[+e.p]; if (h && h.rig && h.shown) { h.out = true; h.tele = 0; h.pos.set(e.x, e.y, e.z); heroTrigger(h.rig, 'off'); } }
          fx.beam(e.x, e.y, e.z, e.x, e.y + 18, e.z, UPLINK, 0.2, 0.5); break;
        case 'tele': { const h = this.heroes[+e.p]; if (h && h.rig) { h.tele = 0.13; h.pos.set(e.fx, e.fy, e.fz); heroTrigger(h.rig, 'teleOut'); } }
          fx.beam(e.fx, e.fy, e.fz, e.fx, e.fy + 12, e.fz, UPLINK, 0.2, 0.4); fx.beam(e.x, e.y, e.z, e.x, e.y + 22, e.z, UPLINK, 0.2, 0.45); this.pulse(e.x, e.z, UPLINK, 6, 0.7); break;
        case 'skill': {
          const rain = e.s === 1, wait = SKILL_CAST[rain ? 1 : 2], sc = rain ? e.c : UPLINK;
          this.heroAnim(e.p, rain ? 'rain' : 'sing');
          this.zoneWait.push([e.x, e.z, wait]);
          this.later.push({ t: wait, fn: () => { fx.ring(e.x, this.deckY(e.x, e.z) + 0.15, e.z, 5, sc, 0.5, 1.4, 0.6); this.pulse(e.x, e.z, sc, rain ? 8 : -10, 1); } });
          if (rain) for (let i = 0; i < 3; i++) this.later.push({ t: wait + i * RAIN_GAP, fn: () => this.rainTracer(+e.p, e.c) });
          break;
        }
        case 'flame': {
          const v = this.tv.get(e.id);
          if (!v) break;
          v.flT = 0.26; v.flYaw = e.yaw; v.flR = e.r; v.flFull = !!e.full; v.flY = e.y;
          towerShot(v.rig);
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
        case 'nospec': { const v = this.tv.get(e.id), t = sim && sim.towerById(e.id); if (v) v.deny = 0.35; if (t) fx.burst(t.x, t.h + 0.55, t.z, 5, 2, 0x8a8478, 0.3, 0.14, 6); break; }
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
        case 'leak': fx.ring(this.core.x, 0.2, this.core.z, 6, RUST, 0.7); fx.burst(this.core.x, 2, this.core.z, 24, 9, RUST, 0.8, 0.3, 8); this.bump(0.3, this.core.x, this.core.z); this.pulse(this.core.x, this.core.z, RUST, 8, 1); break;
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
      this.bump(over ? 0.6 : 0.3, x, z);
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
        this.bump(0.4, t.x, t.z);
        this.pulse(t.x, t.z, c, 6, 1);
        break;
      }
      case 'mortar': fx.smoke(t.x, t.h, t.z, 5, 1.1, 0.8, 1.6); this.pulse(t.x, t.z, c, 4, 0.7); break;
      case 'rail': this.pulse(t.x, t.z, c, 4, 0.7); break;
      case 'beacon': fx.column(t.x, t.h, t.z, c, 16); this.pulse(t.x, t.z, c, R * 1.3, 1); break;
      case 'flame': this.pulse(t.x, t.z, c, R * 1.4, 1); break;
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
      power: 1, boot: 9, fired: 9, em: 0, em2: 0, tick: 0, downMax: 0, deny: 0,
      flT: 0, flYaw: 0, flR: 0, flFull: false, flY: 0, beam: null, lnT: 0, lnX: 0, lnY: 0, lnZ: 0, lnY0: 0, lnHeat: 0, lnOver: false,
    };
    if (def.special) {
      // power node emblem at the exact spot the sim tests (nodePos): a ring that fills with the charge round a core
      const node = new THREE.Group(), k = NODE_R / TOWER_SCALE;
      node.position.y = (t.h + 0.55) / TOWER_SCALE;
      v.ringMat = nodeRingMat();
      const ring = new THREE.Mesh(G_NODE_RING, v.ringMat); ring.scale.setScalar(k * 0.95); node.add(ring);
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
    let pw = 1;
    if (!off && v.boot < 0.9) pw = v.boot < 0.6 ? (Math.sin(v.boot * 52) > 0.1 ? 1.6 : 0.08) : 1 + (0.9 - v.boot) * 2.5;
    v.power = off ? damp(v.power, 0.03, 9, dt) : pw;
    let mul = v.power;
    if (this.fxOptions.towers) mul *= 1 + 0.16 * this.beatLevel;
    if (linked) mul *= 1.5;
    if (spec) mul *= 1.35 + 0.15 * Math.sin(this.time * 24);
    ST.down = off; ST.spec = spec; ST.power = mul; ST.heat = t.heat;
    updateTower(v.rig, t.yaw, t.cd, t.type === 'beacon' || t.type === 'spire' ? 0 : sim.towerRate(t), dt, ST);
    for (const g of v.glows) if (g.m !== v.rig.glow) g.m.emissiveIntensity = g.i0 * mul;
    // offline: the pool on the deck turns to a slow rust warning light
    if (off) (v.pad.material as THREE.MeshBasicMaterial).color.setHex(RUST).multiplyScalar(0.1 + 0.08 * Math.sin(this.time * 5 + t.id));
    else (v.pad.material as THREE.MeshBasicMaterial).color.setHex(c).multiplyScalar(0.24 * Math.min(1.3, mul));
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

    // flame stream (kept burning between the sim's flame events)
    if (v.flT > 0) {
      v.flT -= dt;
      v.em2 += dt * (v.flFull ? 200 : 70);
      const n = Math.floor(v.em2); v.em2 -= n;
      if (v.flFull) {
        // Inferno: fire in every direction, and the ground at the rim catches
        fx.flame(t.x, v.flY, t.z, 0, Math.PI, v.flR * 0.95, n, APRICOT);
        if (Math.random() < dt * 14) { const a = Math.random() * TAU; fx.scorch(t.x + Math.cos(a) * v.flR * 0.8, t.z + Math.sin(a) * v.flR * 0.8, 1.2, APRICOT, 2.5); }
        v.tick -= dt; if (v.tick <= 0) { v.tick = 0.6; this.pulse(t.x, t.z, c, v.flR * 1.2, 0.5); }
      } else {
        fx.flame(t.x, v.flY, t.z, t.yaw, 0.4, v.flR * 0.92, n, APRICOT);
        if (Math.random() < dt * 5) fx.puff(t.x + Math.sin(t.yaw) * v.flR * 0.9, v.flY + 0.4, t.z + Math.cos(t.yaw) * v.flR * 0.9, 0.9, 1.1, 1.2);
      }
    }

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

  /** Power node: seen in the Uplink view only. Dim and filling while it charges, lit and pulsing when ready, dark when offline. */
  private syncNode(t: Tower, v: TVis, b: number) {
    const c = TOWERS[t.type].color, off = t.down > 0, spec = t.spec > 0, ready = t.charge >= 1 && !off && !spec;
    const beat = 0.5 + 0.5 * Math.sin(this.time * 4.2 + t.id);
    for (const g of v.mnode) g.m.emissiveIntensity = g.i0 * (off ? 0.01 : spec ? 0.2 + 3 * Math.max(0, 1 - v.fired / 0.35) : ready ? 0.3 + 0.1 * beat : 0.03 + (0.1 + 0.2 * b) * t.charge * t.charge);
    const node = v.node;
    if (!node) return;
    node.visible = b > 0.02 && v.grow >= 1;
    if (!node.visible) return;
    node.quaternion.copy(this.camera.quaternion);
    const flash = Math.max(0, 1 - v.fired / 0.35);
    node.scale.setScalar(b * (ready ? 1 + 0.06 * beat : 1) * (1 + 0.5 * flash));
    const u = v.ringMat!.uniforms;
    (u.color.value as THREE.Color).setHex(c);
    // offline: a rust arc that drains as the reboot runs down
    if (off) v.downMax = Math.max(v.downMax, t.down); else v.downMax = 0;
    if (off) (u.color.value as THREE.Color).setHex(RUST);
    u.fill.value = ready ? 1 : off ? t.down / (v.downMax || 1) : spec ? 0 : t.charge;
    const deny = v.deny > 0 ? (Math.sin(v.deny * 60) > 0 ? 0.25 : 1) : 1;
    u.gain.value = (off ? 0.7 : spec ? 0.2 + 1.5 * flash : ready ? 0.62 + 0.2 * beat : 0.5) * deny;
    if (v.nodeMat && v.core) {
      if (off) v.nodeMat.color.setHex(RUST).multiplyScalar(0.22);
      else if (spec) v.nodeMat.color.setHex(c).multiplyScalar(0.1 + 3 * flash);
      else if (ready) v.nodeMat.color.setHex(c).multiplyScalar((0.8 + 0.15 * beat) * deny);
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
    const wglow: Glow[] = [];
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      let under = false;
      for (let p: THREE.Object3D | null = o; p && !under; p = p.parent) under = p.name.startsWith('weak_');
      if (!under || !m.material.name.startsWith('glow')) return;
      const c = (m.material as THREE.MeshStandardMaterial).clone(); m.material = c; wglow.push({ m: c, i0: c.emissiveIntensity });
    });
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
      const rmat = new THREE.MeshBasicMaterial({ color: FROST, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, side: THREE.DoubleSide });
      const core = new THREE.Mesh(G_OCTA, mat); core.scale.setScalar(r * 0.5);
      const ring = new THREE.Mesh(G_WEAK_RING, rmat); ring.scale.setScalar(r);
      for (const m of [core, ring]) { m.layers.set(FX_LAYER); m.visible = false; this.dyn.add(m); }
      weak.push({ core, ring, mat, rmat });
    }
    this.dyn.add(obj);
    return { obj, rig, sx: 0, sz: 0, back, bar, sbar, bubble, glow, ice: null, weak, wglow, type, phase: Math.random() * 6.28, seen: 0, fresh: true, lx: 0, lz: 0, lgy: 0, tilt: 0, em: 0 };
  }
  private poolEnemy(v: EVis) {
    v.obj.visible = false;
    for (const w of v.weak) w.core.visible = w.ring.visible = false;
    (this.epool[v.type] ||= []).push(v);
  }

  private syncEnemy(e: Enemy, v: EVis, dt: number, k: number, b: number, aim: boolean) {
    const sim = this.sim!, d = ENEMIES[e.type], sc = ENEMY_SCALE[e.type];
    // visual pose: the sim walks hard-cornered lanes; the view rounds every corner into an arc and limits the turn rate
    let dist = e.dist, lane = e.lane, off = e.off;
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
    roundedPose(sim.map, lane, dist, off, TURN_A[e.type], PO);
    const gy = e.gy || 0, fly = e.type === 'drone', y = fly ? e.y : gy;
    if (v.fresh) { v.obj.position.set(PO.x, y, PO.z); v.obj.rotation.set(0, PO.yaw, 0); v.fresh = false; v.tilt = 0; v.lx = PO.x; v.lz = PO.z; v.lgy = gy; resetEnemy(v.rig); }
    else {
      v.obj.position.set(PO.x, y, PO.z);
      let dy = PO.yaw - v.obj.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      const lim = TURN_RATE[e.type] * dt;
      v.obj.rotation.y += Math.max(-lim, Math.min(lim, dy));
      // walkers lean with a ramp
      const run = Math.hypot(PO.x - v.lx, PO.z - v.lz);
      if (!fly && run > 1e-4) v.tilt = damp(v.tilt, -Math.atan2(gy - v.lgy, run) * 0.8, 6, dt);
      v.obj.rotation.x = v.tilt;
      v.lx = PO.x; v.lz = PO.z; v.lgy = gy;
    }
    let look = NaN;
    if (e.type === 'boss') { // the colossus' turret head tracks the nearest tower
      let bd = 400;
      for (const t of sim.towers) { const dd = (t.x - e.x) * (t.x - e.x) + (t.z - e.z) * (t.z - e.z); if (dd < bd) { bd = dd; look = Math.atan2(t.x - e.x, t.z - e.z); } }
    }
    const frozen = e.frz > 0;
    updateEnemy(v.rig, dt, e.hp / e.maxHp, e.sing > 0, frozen && e.type !== 'boss', look);
    v.glow.position.y = (gy + 0.05 - y) / sc;

    // hp bar: thin, flat, drains to the left
    const r = Math.max(0, e.hp / e.maxHp), bw = (0.5 + e.r * 0.8) / sc, bh = 0.055 / sc;
    v.bar.visible = v.back.visible = r < 0.999;
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
        w.core.scale.setScalar(rad * (0.42 + 0.1 * beat + 0.16 * near) * b);
        w.ring.quaternion.copy(this.camera.quaternion);
        w.ring.scale.setScalar(rad * (1.15 - 0.15 * near) * b);
        w.mat.color.setHex(FROST).multiplyScalar(0.8 + 0.3 * beat + 0.9 * near);
        w.rmat.color.setHex(near > 0.6 ? 0xffffff : STATIC).multiplyScalar(0.4 + 0.2 * beat + 0.6 * near);
      }
      for (const g of v.wglow) g.m.emissiveIntensity = g.i0 * (0.7 + 0.4 * beat + 0.8 * hot * b);
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

  private dropZone(v: ZVis) {
    this.dyn.remove(v.obj);
    for (const m of v.mats) m.dispose();
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
      let v = this.ev.get(e.id);
      if (!v) { v = this.enemyVis(e.type); this.ev.set(e.id, v); }
      v.seen = f;
      this.syncEnemy(e, v, dt, k, b, aim);
    }
    for (const [id, v] of this.ev) if (v.seen !== f) { this.poolEnemy(v); this.ev.delete(id); }

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

    // zones
    for (const z of sim.zones) {
      let v = this.zv.get(z.id);
      if (!v) {
        const obj = new THREE.Group();
        // Kestrel's own singularity is verdigris like everything else of the Uplink
        const c = z.kind === 'burn' ? APRICOT : z.owner < 0 ? TOWERS.gravity.color : z.kind === 'rain' ? BOW_TIERS[sim.tier].color : UPLINK;
        const mats: THREE.Material[] = [];
        let halo: THREE.Object3D | null = null;
        const rim = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(z.kind === 'sing' ? 0.45 : 0.7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
        const ring = new THREE.Mesh(G_RING, rim); ring.scale.setScalar(z.r); obj.add(ring);
        mats.push(rim);
        if (z.kind === 'sing') {
          // no light comes out of it: the deck goes dark toward the middle and the seams carry the pull inward
          const shade = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: glowTexture(), transparent: true, opacity: 0.5, depthWrite: false, fog: false });
          const m3 = new THREE.MeshBasicMaterial({ color: 0x000000 }), m4 = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(0.9) });
          const dark = new THREE.Mesh(POOL_GEO, shade); dark.scale.setScalar(z.r * 0.9); obj.add(dark);
          const hole = new THREE.Mesh(G_SPH, m3); hole.scale.setScalar(0.8); hole.position.y = 2; obj.add(hole);
          halo = new THREE.Mesh(G_HALO, m4); halo.scale.setScalar(0.72); halo.position.y = 2; halo.rotation.x = 1.2; obj.add(halo);
          mats.push(shade, m3, m4);
        } else {
          const m1 = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: z.kind === 'burn' ? 0.1 : 0.06, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
          const disc = new THREE.Mesh(G_DISC, m1); disc.scale.setScalar(z.r); obj.add(disc);
          mats.push(m1);
        }
        obj.position.set(z.x, (z.y || 0) + 0.07, z.z);
        this.dyn.add(noAO(obj));
        v = { obj, kind: z.kind, seen: f, t: 0, mats, halo, c, tick: 0 };
        // a zone thrown by the hero shows up when her pose releases it
        for (let i = this.zoneWait.length - 1; i >= 0; i--) { const w = this.zoneWait[i]; if (Math.abs(w[0] - z.x) < 0.01 && Math.abs(w[1] - z.z) < 0.01) { v.t = -w[2]; this.zoneWait.splice(i, 1); break; } }
        if (z.kind === 'sing' && z.owner < 0) {
          // Collapse: the well reaches out to its victim and the space round it folds in
          let src: Tower | null = null;
          for (const t of sim.towers) if (t.type === 'gravity' && t.spec > 0 && (!src || Math.hypot(t.x - z.x, t.z - z.z) < Math.hypot(src.x - z.x, src.z - z.z))) src = t;
          if (src) { nodePos(src, W3); fx.beam(W3.x, W3.y, W3.z, z.x, (z.y || 0) + 2, z.z, c, 0.3, 0.6); fx.beam(W3.x, W3.y, W3.z, z.x, (z.y || 0) + 2, z.z, 0xffffff, 0.08, 0.7); }
          fx.flash(z.x, (z.y || 0) + 2, z.z, 2.4, c, 0.35);
          this.bump(0.3, z.x, z.z);
        }
        this.zv.set(z.id, v);
      }
      v.seen = f; v.t += dt;
      v.obj.visible = v.t >= 0;
      if (v.t < 0) continue;
      const zy = z.y || 0;
      if (z.kind === 'rain') {
        for (let i = 0; i < 2; i++) {
          const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * z.r, x = z.x + Math.cos(a) * r, zz = z.z + Math.sin(a) * r, gy = this.elev ? this.deckY(x, zz) : 0;
          fx.beam(x + 1.5, gy + 14, zz + 0.8, x, gy, zz, v.c, 0.035, 0.12);
          fx.burst(x, gy + 0.1, zz, 2, 3, v.c, 0.25, 0.25, 6);
        }
      } else if (z.kind === 'sing') {
        if (v.halo) { v.halo.rotation.z += dt * 6; v.halo.rotation.x = 1.2 + Math.sin(v.t * 3) * 0.4; }
        if ((v.tick -= dt) <= 0) { v.tick = 0.55; this.pulse(z.x, z.z, v.c, -z.r * 1.3, 0.6); }
        for (let i = 0; i < 4; i++) { const a = Math.random() * 6.28, r = z.r * (0.6 + Math.random() * 0.4); fx.spark(z.x + Math.cos(a) * r, zy + 0.3 + Math.random() * 3, z.z + Math.sin(a) * r, -Math.cos(a) * r * 2.2, 0.5, -Math.sin(a) * r * 2.2, 0.45, 0.4, v.c); }
      } else if (Math.random() < 0.6) {
        const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * z.r;
        fx.spark(z.x + Math.cos(a) * r, zy + 0.1, z.z + Math.sin(a) * r, 0, 2 + Math.random() * 2, 0, 0.6, 0.45, APRICOT, -1);
      }
    }
    for (const [id, v] of this.zv) if (v.seen !== f) { this.dropZone(v); this.zv.delete(id); }

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
      if (h.rig) { if (!updateHero(h.rig, yaw, pitch, dt, HERO_SCALE)) { h.out = false; h.obj.visible = h.shown = false; } }
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

  /** One shaft of Arrow Rain leaving the bow for the sky (the sim only knows the zone it lands in). */
  private rainTracer(pi: number, color: number) {
    const sim = this.sim, p = sim && sim.players[pi], o = sim && p && p.heroActive ? sim.heroOrigin(pi) : null;
    if (!o || !p) return;
    const yaw = pi === this.me ? this.yaw : p.yaw, c = Math.cos(1.12), dx = Math.sin(yaw) * c, dy = Math.sin(1.12), dz = Math.cos(yaw) * c;
    const j = (Math.random() - 0.5) * 0.5;
    this.fx.beam(o.x + dx * 0.4, o.y + dy * 0.4 + 0.1, o.z + dz * 0.4, o.x + dx * 17 + j, o.y + dy * 17, o.z + dz * 17 - j, color, 0.05, 0.16);
    this.fx.burst(o.x + dx * 0.45, o.y + dy * 0.45 + 0.1, o.z + dz * 0.45, 3, 2.5, color, 0.25, 0.16, 0);
  }

  private updateCamera(dt: number) {
    const sim = this.sim, p = sim ? sim.players[this.me] : null;
    const t = p && p.heroActive && sim ? sim.towerById(p.heroTower) : undefined;
    const target = t ? 1 : 0;
    this.heroBlend += Math.max(-dt * 2.4, Math.min(dt * 2.4, target - this.heroBlend));
    // bird view
    if (this.orbit) { const a = this.time * 0.06; this.topPos.set(Math.sin(a) * 46, 30 + Math.sin(a * 1.7) * 4, Math.cos(a) * 40 + 4); V.set(2, 0, 0); }
    else { const c = this.cam; this.topPos.set(c.x, c.dist * Math.sin(c.tilt), c.z + c.dist * Math.cos(c.tilt)); V.set(c.x, 0, c.z); }
    this.dummy.position.copy(this.topPos); this.dummy.lookAt(V); this.topQ.copy(this.dummy.quaternion);
    // third person: the anchor glides only when she changes spire; the look angles are used as they are, unsmoothed
    if (t) this.lastHeroAnchor.lerp(V.set(t.x, standY(t), t.z), this.heroBlend < 0.05 ? 1 : 1 - Math.exp(-dt * 14));
    this.camPose(this.heroPos, V2);
    this.dummy.position.copy(this.heroPos); this.dummy.lookAt(V.copy(this.heroPos).add(V2)); this.heroQ.copy(this.dummy.quaternion);
    const b = this.heroBlend, s = b * b * (3 - 2 * b);
    this.camera.position.lerpVectors(this.topPos, this.heroPos, s);
    this.camera.position.y += Math.sin(s * Math.PI) * 6;
    this.camera.quaternion.slerpQuaternions(this.topQ, this.heroQ, s);
    const fov = (this.orbit ? 50 : 42) + (66 - 42) * s;
    if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    if (this.shake > 0.001) {
      // a nudge of the camera position only: the view direction, and with it the aim, never moves
      const a = this.shake * (0.3 - 0.18 * s);
      this.camera.position.x += (Math.random() - 0.5) * a; this.camera.position.y += (Math.random() - 0.5) * a; this.camera.position.z += (Math.random() - 0.5) * a;
      this.shake *= Math.exp(-dt * 7);
    }
  }

  render(dt: number) {
    this.time += dt;
    this.sync(dt);
    this.updateCamera(dt);
    for (let i = 0; i < this.coreSpins.length; i++) this.coreSpins[i].rotateY(dt * (i % 2 ? -1.1 : 0.8));
    if (this.coreObj && this.sim) { const hurt = this.sim.lives <= 6; if (hurt && Math.random() < 0.3) this.fx.spark(this.core.x + (Math.random() - 0.5) * 3, 1 + Math.random() * 3, this.core.z + (Math.random() - 0.5) * 3, 0, 2, 0, 0.5, 0.4, RUST); }
    if (this.teleMark.visible) this.teleMark.children[0].rotation.y += dt * 3;
    if (this.selRing.visible) (this.selRing.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.2 * Math.sin(this.time * 5);
    this.fx.update(dt, this.camera, this.renderer.domElement.height);
    this.world.update(this.time, dt);
    if (this.quality === 'high') this.post.render(dt, this.time); else this.renderer.render(this.scene, this.camera);
  }
}
