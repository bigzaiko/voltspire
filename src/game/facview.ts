// Three.js view of the factory: deposits on the deck, the buildings, belts with the items riding on them, pipes and power
// lines. Buildings use the Blender models (public/models/fac_<type>.glb) when they are loaded and fall back to plain shapes
// otherwise; belts, pipes and items are built here, in the same warm palette as the towers.
//
// Belts: a belt tile runs from an entry edge to its output edge. The entry is the side its one feeder stands on (another
// belt that points at it); with no feeder or several it runs straight from the side opposite its output. The
// path between the two edge midpoints is a straight line or a circular arc tangent to both edge normals, so neighbouring
// belts meet edge to edge with the same width and heading and a turning line reads as one curved conveyor. Items ride the
// same path (see pathAt), and the tread texture scrolls along it at the belt speed.
//
// Pipes are glass with the fluid visible inside: it fills the tube to its network's level, flows the way the network runs
// (from the pump to what draws from it) and looks like what it is, black viscous crude or thin amber petrol (see fluidMat and
// FacView.syncPipes). Splitters and tunnels are built here too.
//
// Transfer Arms are the connectors of the factory: every hand-off of an item goes through one (see factory.ts). All arms
// are drawn from the parts of one model, instanced, and posed here from Fac.prog and Fac.hand (see ArmRig and syncArms):
// reach back, grip, swing through the tile, put down, return. The other connectors come from Factory.links(): a hatch on
// the tower or building an arm serves (it lights up on every put), the chute from a supply crate to the tower beside it, a
// glass branch from a pipe into its consumer, a drop cable from a pole to what it powers. Between waves the factory stands
// still, so nothing moves here either; the status lamps then show the supply diagnosis (Sim.diag). What a pole, tunnel or
// arm would connect to is drawn by the cues (cues.ts), from the selection kept here.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FACS, ITEMS, FLUIDS, FLUID_TYPES, ORE_TYPES, ORES, ITEM_TYPES, GW, GH, cellX, cellZ, MAKES } from './data.ts';
import type { FacType, ItemType, FluidType } from './data.ts';
import { FX_LAYER } from './world.ts';
import { HEX_SIZE, ROW_H, neighbor, hexDist, lineDir, inBoard, worldToCell } from './hex.ts';
import type { Sim, Ev } from './sim.ts';
import type { Fac, Factory, BeltItem, Diag } from './factory.ts';
import { BELT_SPEED, TUNNEL_REACH, PICK_AT, pipeLike, turns, facKey, armBack, armFront, conveyor } from './factory.ts';

const TAU = Math.PI * 2;
/** World heading of each hex direction (HEX_DIRS: east, then clockwise on screen, 60 degrees apart). */
const DX = [0, 1, 2, 3, 4, 5].map((d) => Math.cos((d * Math.PI) / 3));
const DZ = [0, 1, 2, 3, 4, 5].map((d) => Math.sin((d * Math.PI) / 3));
/** rotation.y that turns local +Z to face direction d */
const yawOf = (d: number) => Math.atan2(DX[d], DZ[d]);

// ---------- shared geometry and materials ----------
const geos = new Map<string, THREE.BufferGeometry>();
/** A cached geometry (built once per key, kept for the page's life: nothing here is per building). */
function geo(key: string, make: () => THREE.BufferGeometry) {
  let g = geos.get(key);
  if (!g) { g = make(); geos.set(key, g); }
  return g;
}
const G_HEXF = new THREE.CircleGeometry(HEX_SIZE * 0.9, 6, Math.PI / 6).rotateX(-Math.PI / 2);
const G_CHEV = (() => {
  // a flat chevron pointing along +z
  const s = new THREE.Shape();
  s.moveTo(-0.32, -0.12); s.lineTo(0, 0.16); s.lineTo(0.32, -0.12); s.lineTo(0.32, -0.26); s.lineTo(0, 0.02); s.lineTo(-0.32, -0.26); s.closePath();
  // (laying the shape flat turns its +y to -z; the half turn about y points it along +z and keeps it facing up)
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2).rotateY(Math.PI);
})();
const G_LAMP = new THREE.SphereGeometry(0.1, 8, 6);
const MAX_ITEMS = 900, MAX_HL = 360;

const mats = new Map<string, THREE.MeshStandardMaterial>();
/** A shared lit material: hull grey, a painted colour, or a glowing one. */
function mat(color: number, kind: 'paint' | 'glow' | 'dark' = 'paint'): THREE.MeshStandardMaterial {
  const key = kind + color;
  let m = mats.get(key);
  if (!m) {
    m = kind === 'glow' ? new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.3), emissive: color, emissiveIntensity: 1.6, roughness: 0.4 })
      : kind === 'dark' ? new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.8 })
      : new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.75), roughness: 0.5, metalness: 0.5 });
    mats.set(key, m);
  }
  return m;
}
const HULL = 0x2f2a25, TRIM = 0x6d655a;
const LAMP = { ok: 0x8fe07a, warn: 0xf2c14e, bad: 0xe05a3c };
/** Where the power wires meet a pole (two crossarm insulators at x = +-POLE_ARM) and a generator (one terminal on its axis). */
const POLE_Y = 3.1, POLE_ARM = 0.4, GEN_Y = 1.6;
/** Working-light strength per model, against the shared glow_work tuning (large lit faces are turned down so they do not bloom out). */
/** Seconds a Depot's glint lasts. */
const GLINT_T = 0.7;
const WORK_GLOW: Partial<Record<FacType, number>> = { press: 0.45, works: 0.7, smelter: 0.75, cells: 0.6, missiles: 0.6, splitter: 0.5, tunnel: 0.6, ptunnel: 0.6 };

/**
 * The pumpjack's linkage in the model (Blender y forward, z up; three.js rotation.x turns the same way): the beam rocks
 * about the saddle at height PJ_PIV, the equalizer sits at (PJ_EY, PJ_EZ) on the beam, the pitman arms of length PJ_L
 * hang from it to the crank pins, which turn at radius PJ_R round the crank shaft (PJ_CY, PJ_CZ). The crank turns all the
 * way round and the beam follows it (two-circle intersection), so the pitman stays on the pins at every point of the stroke.
 */
const PJ_PIV = 1.95, PJ_EY = 0.66, PJ_EZ = -0.04, PJ_CY = 0.48, PJ_CZ = 0.8, PJ_R = 0.18, PJ_L = 1.11;
const PJ_RE = Math.hypot(PJ_EY, PJ_EZ), PJ_A0 = Math.atan2(PJ_EZ, PJ_EY);
function pumpPose(arm: THREE.Object3D, pitman: THREE.Object3D | null, crank: THREE.Object3D | null, p: number) {
  const py = PJ_CY + PJ_R * Math.cos(p), pz = PJ_CZ + PJ_R * Math.sin(p);
  const qz = pz - PJ_PIV, d = Math.hypot(py, qz);
  const cg = Math.max(-1, Math.min(1, (PJ_RE * PJ_RE + d * d - PJ_L * PJ_L) / (2 * PJ_RE * d)));
  const a = Math.atan2(qz, py) + Math.acos(cg), t = a - PJ_A0;
  arm.rotation.x = t;
  if (crank) crank.rotation.x = p;
  if (pitman) pitman.rotation.x = Math.atan2(py - PJ_RE * Math.cos(a), PJ_PIV + PJ_RE * Math.sin(a) - pz) - t;
}

// ---------- belt paths ----------
/** One belt shape, in a frame where the entry edge is on +x: straight across, or an arc round centre (cx, cz). */
interface Path { straight: boolean; cx: number; cz: number; r: number; a0: number; sw: number }
/** k = (exit side - entry side) mod 6: 3 straight, 2 / 4 a gentle 60-degree turn, 1 / 5 a sharp 120-degree turn (0 unused). */
const PATHS: Path[] = [0, 1, 2, 3, 4, 5].map((k) => {
  if (k === 0 || k === 3) return { straight: true, cx: 0, cz: 0, r: 0, a0: 0, sw: 0 };
  // entry midpoint A = (1, 0), heading -x; exit midpoint B = (cos, sin) of k * 60 degrees, heading outward. The arc's centre
  // lies on both edge lines: x = 1 and B + s * (edge direction at B).
  const ck = Math.cos((k * Math.PI) / 3), sk = Math.sin((k * Math.PI) / 3);
  const s = (ck - 1) / sk, t = sk + s * ck;
  const a0 = Math.atan2(-t, 0), a1 = Math.atan2(sk - t, ck - 1);
  let sw = a1 - a0;
  while (sw > Math.PI) sw -= TAU;
  while (sw < -Math.PI) sw += TAU;
  return { straight: false, cx: 1, cz: t, r: Math.abs(t), a0, sw };
});
interface PathPt { x: number; z: number; tx: number; tz: number }
/** The point at p (0 entry edge .. 1 exit edge) on a belt path in its own frame, and the unit heading there. */
function pathAt(P: Path, p: number, o: PathPt): PathPt {
  if (P.straight) { o.x = 1 - 2 * p; o.z = 0; o.tx = -1; o.tz = 0; return o; }
  const a = P.a0 + P.sw * p, c = Math.cos(a), s = Math.sin(a), g = P.sw < 0 ? -1 : 1;
  o.x = P.cx + P.r * c; o.z = P.cz + P.r * s; o.tx = -s * g; o.tz = c * g;
  return o;
}

// belt cross-section (offsets across the belt, heights)
const BW = 0.355, RIN = 0.365, ROUT = 0.475, Y_BOT = 0.085, Y_SURF = 0.155, Y_RAIL = 0.215;
/** Chevrons per tile along the belt (the tread texture repeats this often between the two edges). */
const BELT_REP = 2;

/**
 * Sweep a cross-section along a belt path: segs are [o0, y0, o1, y1, normal o, normal y] in (across, up). The u coordinate
 * runs across each segment, v along the path (p * vRep), so a texture can scroll along the belt.
 */
function sweep(P: Path, n: number, segs: number[][], vRep: number): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const pt: PathPt = { x: 0, z: 0, tx: 0, tz: 0 };
  for (const [o0, y0, o1, y1, no, ny] of segs) {
    const base = pos.length / 3;
    for (let j = 0; j <= n; j++) {
      const p = j / n;
      pathAt(P, p, pt);
      const sx = -pt.tz, sz = pt.tx; // side vector (across the belt)
      pos.push(pt.x + sx * o0, y0, pt.z + sz * o0, pt.x + sx * o1, y1, pt.z + sz * o1);
      const nx = sx * no, nz = sz * no;
      nor.push(nx, ny, nz, nx, ny, nz);
      uv.push(0, p * vRep, 1, p * vRep);
    }
    // winding: make the first quad face along its normal, the rest follow
    const ax = pos[base * 3], ay = pos[base * 3 + 1], az = pos[base * 3 + 2];
    const bx = pos[base * 3 + 3] - ax, by = pos[base * 3 + 4] - ay, bz = pos[base * 3 + 5] - az; // across
    const cx = pos[base * 3 + 6] - ax, cy = pos[base * 3 + 7] - ay, cz = pos[base * 3 + 8] - az; // along
    const fx = cy * bz - cz * by, fy = cz * bx - cx * bz, fz = cx * by - cy * bx; // along x across
    const flip = fx * nor[base * 3] + fy * nor[base * 3 + 1] + fz * nor[base * 3 + 2] < 0;
    for (let j = 0; j < n; j++) {
      const a = base + 2 * j, b = a + 1, c = a + 2, d = a + 3;
      if (!flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
const M4 = new THREE.Matrix4();
/** A copy of a geometry turned to the path heading at p and moved to side offset o, height y (local z = along the belt). */
function onPath(g: THREE.BufferGeometry, P: Path, p: number, o: number, y: number, along = 0): THREE.BufferGeometry {
  const pt = pathAt(P, p, { x: 0, z: 0, tx: 0, tz: 0 });
  const sx = -pt.tz, sz = pt.tx;
  M4.makeRotationY(Math.atan2(pt.tx, pt.tz));
  M4.setPosition(pt.x + sx * o + pt.tx * along, y, pt.z + sz * o + pt.tz * along);
  return g.clone().applyMatrix4(M4);
}

/** Belt geometry for shape k with optional end drums at the open start / end: groups 0 tread, 1 frame, 2 rail light. */
function beltGeo(k: number, capIn: boolean, capOut: boolean): THREE.BufferGeometry {
  return geo('belt' + k + +capIn + +capOut, () => {
    const P = PATHS[k], n = P.straight ? 2 : k === 1 || k === 5 ? 18 : 14;
    const tread = sweep(P, n, [[-BW, Y_SURF, BW, Y_SURF, 0, 1]], BELT_REP);
    const frameSegs: number[][] = [];
    for (const s of [-1, 1]) {
      frameSegs.push([s * RIN, Y_SURF - 0.01, s * RIN, Y_RAIL, -s, 0]); // inner wall
      frameSegs.push([s * RIN, Y_RAIL, s * 0.405, Y_RAIL, 0, 1]); // rail top, inside the light
      frameSegs.push([s * 0.445, Y_RAIL, s * ROUT, Y_RAIL, 0, 1]); // rail top, outside the light
      frameSegs.push([s * ROUT, Y_RAIL, s * ROUT, Y_BOT, s, 0]); // skirt
    }
    frameSegs.push([-ROUT, Y_BOT, ROUT, Y_BOT, 0, -1]); // underside
    const parts = [sweep(P, n, frameSegs, 1)];
    // ribs down the skirts, legs and foot pads, all following the curve
    const rib = geo('beltRib', () => new THREE.BoxGeometry(0.024, Y_RAIL - Y_BOT + 0.012, 0.05));
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) parts.push(onPath(rib, P, 0.125 + i * 0.25, s * (ROUT + 0.008), (Y_RAIL + Y_BOT) / 2));
    const leg = geo('beltLeg', () => new THREE.BoxGeometry(0.07, Y_BOT, 0.1)), foot = geo('beltFoot', () => new THREE.BoxGeometry(0.13, 0.025, 0.2));
    for (const s of [-1, 1]) { parts.push(onPath(leg, P, 0.5, s * 0.43, Y_BOT / 2)); parts.push(onPath(foot, P, 0.5, s * 0.43, 0.0125)); }
    // an end drum and its two bearing blocks where the line starts or stops
    const drum = geo('beltDrum', () => new THREE.CylinderGeometry(0.075, 0.075, BW * 2 + 0.02, 12).rotateZ(Math.PI / 2));
    const bear = geo('beltBear', () => new THREE.BoxGeometry(0.06, 0.13, 0.15));
    for (const [on, p, along] of [[capIn, 0, 0.075], [capOut, 1, -0.075]] as [boolean, number, number][]) {
      if (!on) continue;
      parts.push(onPath(drum, P, p, 0, Y_SURF - 0.07, along));
      for (const s of [-1, 1]) parts.push(onPath(bear, P, p, s * (ROUT + 0.03), Y_SURF - 0.02, along));
    }
    const frame = mergeGeometries(parts);
    for (const g of parts) g.dispose();
    const light = sweep(P, n, [[-0.445, Y_RAIL + 0.002, -0.405, Y_RAIL + 0.002, 0, 1], [0.405, Y_RAIL + 0.002, 0.445, Y_RAIL + 0.002, 0, 1]], 1);
    const all = mergeGeometries([tread, frame, light], true);
    tread.dispose(); frame.dispose(); light.dispose();
    return all;
  });
}

/**
 * The inlet where a side feeder joins a belt that runs straight past it (r = feeder side - belt direction, mod 6): the belt's
 * section from the feeder's edge in to the main belt, its end mitred to lie flush along the main belt's outer skirt. Same groups
 * as beltGeo (tread, frame, rail light), and the tread runs at the same chevrons per unit length, so it scrolls in step.
 */
function stubGeo(r: number): THREE.BufferGeometry {
  return geo('beltStub' + r, () => {
    // the main belt's axis in the stub's frame (entry edge on +x), and its unit normal on the stub's side
    const phi = (-r * Math.PI) / 3;
    let nx = -Math.sin(phi), nz = Math.cos(phi);
    if (nx < 0) { nx = -nx; nz = -nz; }
    const xEnd = (z: number) => (ROUT - nz * z) / nx;
    const P = PATHS[3], len = 1 - xEnd(0);
    const tread = sweep(P, 1, [[-BW, Y_SURF, BW, Y_SURF, 0, 1]], (BELT_REP * len) / 2);
    const segs: number[][] = [];
    for (const s of [-1, 1]) {
      segs.push([s * RIN, Y_SURF - 0.01, s * RIN, Y_RAIL, -s, 0], [s * RIN, Y_RAIL, s * 0.405, Y_RAIL, 0, 1], [s * 0.445, Y_RAIL, s * ROUT, Y_RAIL, 0, 1], [s * ROUT, Y_RAIL, s * ROUT, Y_BOT, s, 0]);
    }
    segs.push([-ROUT, Y_BOT, ROUT, Y_BOT, 0, -1]);
    const frame = sweep(P, 1, segs, 1);
    const light = sweep(P, 1, [[-0.445, Y_RAIL + 0.002, -0.405, Y_RAIL + 0.002, 0, 1], [0.405, Y_RAIL + 0.002, 0.445, Y_RAIL + 0.002, 0, 1]], 1);
    // the straight sweep runs x = 1 .. -1: squeeze each vertex's run to end on the skirt line at its own offset across
    for (const g of [tread, frame, light]) {
      const a = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) a.setX(i, 1 - ((1 - xEnd(a.getZ(i))) * (1 - a.getX(i))) / 2);
    }
    const all = mergeGeometries([tread, frame, light], true);
    tread.dispose(); frame.dispose(); light.dispose();
    return all;
  });
}
/**
 * A straight run of belt from x = xa to x = xb in the belt frame (entry edge on +x, running toward -x), sunk by dropA at its
 * start and dropB at its end (eased between): the stubs of a Belt Splitter, and the ramps that take a Belt Tunnel's line down
 * into its portal and up out of it. Same groups as beltGeo; the tread keeps the belts' chevrons per unit length.
 */
function runGeo(xa: number, xb: number, dropA: number, dropB: number): THREE.BufferGeometry {
  return geo(`run${xa},${xb},${dropA},${dropB}`, () => {
    const P = PATHS[3], len = Math.abs(xa - xb);
    const tread = sweep(P, 6, [[-BW, Y_SURF, BW, Y_SURF, 0, 1]], (BELT_REP * len) / 2);
    const segs: number[][] = [];
    for (const s of [-1, 1]) {
      segs.push([s * RIN, Y_SURF - 0.01, s * RIN, Y_RAIL, -s, 0], [s * RIN, Y_RAIL, s * 0.405, Y_RAIL, 0, 1], [s * 0.445, Y_RAIL, s * ROUT, Y_RAIL, 0, 1], [s * ROUT, Y_RAIL, s * ROUT, Y_BOT, s, 0]);
    }
    segs.push([-ROUT, Y_BOT, ROUT, Y_BOT, 0, -1]);
    const frame = sweep(P, 6, segs, 1);
    const light = sweep(P, 6, [[-0.445, Y_RAIL + 0.002, -0.405, Y_RAIL + 0.002, 0, 1], [0.405, Y_RAIL + 0.002, 0.445, Y_RAIL + 0.002, 0, 1]], 1);
    for (const g of [tread, frame, light]) {
      const a = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) {
        const p = (1 - a.getX(i)) / 2, e = p * p * (3 - 2 * p);
        a.setX(i, xa + (xb - xa) * p); a.setY(i, a.getY(i) - (dropA + (dropB - dropA) * e));
      }
    }
    const all = mergeGeometries([tread, frame, light], true);
    tread.dispose(); frame.dispose(); light.dispose();
    return all;
  });
}
/** Splitter stubs: from the edge in to the hub (a belt bringing items), and from the hub out to the edge (a belt taking them). */
const SPLIT_IN = () => runGeo(1, 0.4, 0, 0), SPLIT_OUT = () => runGeo(-0.4, -1, 0, 0);
/** The same against the modelled splitter: its table's flats stand 0.727 from the middle, and its corner posts cap the rails. */
const SPLIT_IN_M = () => runGeo(1, 0.72, 0, 0), SPLIT_OUT_M = () => runGeo(-0.72, -1, 0, 0);
/** Belt Tunnel ramps: down from the back edge into the portal (entrance), up out of it to the front edge (exit). */
const RAMP_DROP = 0.16;
const RAMP_IN = () => runGeo(1, -0.3, 0, RAMP_DROP), RAMP_OUT = () => runGeo(0.3, -1, RAMP_DROP, 0);
/** Where items vanish into an entrance portal (p along the tile) and come out of an exit portal. */
const PORTAL_IN = 0.56, PORTAL_OUT = 0.44;

/** How high a side-loaded item hops to clear the main belt's rail as it crosses it (see syncItems). */
const HOP = 0.075;

/** The tread: dark rubber with cross ribs and a sand chevron pointing along the belt. Map and emissive map at once. */
function treadTexture(): THREE.Texture {
  const W = 64, H = 128, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1e1c1a'; g.fillRect(0, 0, W, H);
  // cross ribs
  for (let y = 0; y < H; y += 16) { g.fillStyle = '#2a2724'; g.fillRect(0, y, W, 5); g.fillStyle = '#121110'; g.fillRect(0, y + 5, W, 2); }
  // worn edges
  const e = g.createLinearGradient(0, 0, W, 0);
  e.addColorStop(0, 'rgba(0,0,0,0.55)'); e.addColorStop(0.12, 'rgba(0,0,0,0)'); e.addColorStop(0.88, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = e; g.fillRect(0, 0, W, H);
  // the chevron (canvas top = v 1: it points up the canvas, the way the belt runs)
  // (kept slim and muted: it says which way the belt runs without competing with the items riding on it)
  g.fillStyle = '#a89a62';
  g.beginPath(); g.moveTo(32, 44); g.lineTo(48, 62); g.lineTo(48, 70); g.lineTo(32, 53); g.lineTo(16, 70); g.lineTo(16, 62); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// ---------- deposits ----------
// Each deposit tile is a Blender model (tools/blender/models_deposits.py, public/models/dep_<kind>.glb): one of four
// bodies per kind (slate boulders with nodules of steel-blue iron ore, a copper lode with nuggets and malachite, a jagged
// coal seam with what the miners left, a burst deck plate with an old wellhead round a tar pool) and low rubble round the
// tile's rim, on a soft stain of what the ore sheds on the deck. The models carry no textures: albedo and ambient
// occlusion are vertex colours, and the ore, veins, rust, patina, dust and tar are drawn by the material from two more
// per-vertex values (see depMat). Everything is instanced; a tile's pieces are seeded by the tile (turned, mirrored,
// scaled) and rise with it while the map assembles (see FacView.poseDeps).
/** 0..1 from a position and a seed */
const hash3 = (x: number, y: number, z: number, s: number) => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 17.3) * 43758.5453; return h - Math.floor(h); };
/** The deposit kinds' model files, and the colour each is lit in when hovered (the ore's own hue). */
const DEP_FILE: Record<string, string> = { iron_ore: 'dep_iron', copper_ore: 'dep_copper', coal: 'dep_coal', oil: 'dep_oil' };
const DEP_ACCENT: Record<string, number> = { iron_ore: 0x5f97ee, copper_ore: 0xf07c2e, coal: 0xc7ad86, oil: 0x8b55f2 };
const DEP_VARIANTS = 4;
/** How much larger than modelled each kind's body is drawn (the models fit a circle of 0.78; a tile is 1.0 to its flats). */
const DEP_SCALE: Record<string, number> = { iron_ore: 1.05, copper_ore: 1.05, coal: 1.12, oil: 1 };
/** The oil pool's surface height (as modelled) and how far from the middle its bubbles rise. */
const POOL_Y = 0.034, BUBBLE_R = 0.27;

/**
 * A deposit's mark on the deck: what the ore sheds on the plates round it (rock dust and rust, verdigris, coal dust,
 * creeping oil) and the cracks the rock drove through them. It has no outline: it thins out in lobes before the tile's
 * edge, so it lies on the deck like dirt and not like a label.
 */
function stainTexture(kind: string): THREE.Texture {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!, m = S / 2;
  let seed = 3 + kind.length * 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // the geometry's uv maps the hex's circumradius to the canvas half-width, so the flats lie at 0.866 m
  const blobOn = (q: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, a: number, core = 0) => {
    const gr = q.createRadialGradient(x, y, r * core, x, y, r);
    gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`);
    q.fillStyle = gr; q.beginPath(); q.arc(x, y, r, 0, TAU); q.fill();
  };
  const blob = (x: number, y: number, r: number, rgb: string, a: number) => blobOn(g, x, y, r, rgb, a);
  /** n blobs scattered within a share of the tile */
  const blobs = (n: number, reach: number, r0: number, r1: number, rgb: string, a0: number, a1: number, from = 0) => {
    for (let i = 0; i < n; i++) { const a = rnd() * TAU, d = (from + (1 - from) * Math.sqrt(rnd())) * m * reach; blob(m + Math.cos(a) * d, m + Math.sin(a) * d, r0 + rnd() * (r1 - r0), rgb, a0 + rnd() * (a1 - a0)); }
  };
  /** n wandering lines from a ring round the middle outward, thinning as they go, some of them forking */
  const creep = (n: number, from: number, steps: number, len: number, w: number, style: string, wobble = 1.1, fork = 0) => {
    g.strokeStyle = style; g.lineCap = 'round'; g.lineJoin = 'round';
    const run = (a: number, x: number, y: number, k0: number) => {
      for (let k = k0; k < steps; k++) {
        const x0 = x, y0 = y;
        a += (rnd() - 0.5) * wobble; x += Math.cos(a) * len; y += Math.sin(a) * len;
        g.lineWidth = Math.max(0.6, w * (1 - k / steps)); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x, y); g.stroke();
        if (fork && rnd() < fork) run(a + (rnd() < 0.5 ? -0.9 : 0.9), x, y, k + 2);
      }
    };
    for (let v = 0; v < n; v++) { const a = (v / n) * TAU + rnd() * 0.6; run(a, m + Math.cos(a) * m * from, m + Math.sin(a) * m * from, 0); }
  };
  const specks = (n: number, r0: number, r1: number, s0: number, s1: number, rgb: string, a0: number, a1: number) => {
    for (let i = 0; i < n; i++) { const a = rnd() * TAU, d = (r0 + (r1 - r0) * Math.sqrt(rnd())) * m; g.fillStyle = `rgba(${rgb},${a0 + rnd() * (a1 - a0)})`; g.beginPath(); g.arc(m + Math.cos(a) * d, m + Math.sin(a) * d, s0 + rnd() * (s1 - s0), 0, TAU); g.fill(); }
  };
  if (kind === 'iron_ore') {
    blob(m, m, m * 0.84, '40,43,52', 0.85);                       // slate dust, darker than the deck
    blobs(30, 0.66, 10, 26, '58,63,76', 0.2, 0.45);
    blobs(22, 0.7, 8, 22, '128,50,20', 0.3, 0.6, 0.25);          // rust washed out of the ore
    creep(6, 0.2, 9, 10, 1.5, 'rgba(8,8,11,0.85)', 0.9, 0.2);    // the deck cracked round the rock
    creep(7, 0.3, 6, 9, 2.6, 'rgba(112,48,22,0.4)');
    specks(46, 0.3, 0.8, 0.7, 1.7, '120,156,220', 0.35, 0.75);   // grains of the ore
  } else if (kind === 'copper_ore') {
    blob(m, m, m * 0.84, '150,92,56', 0.75);
    blobs(30, 0.66, 10, 26, '205,112,54', 0.2, 0.5);
    blobs(26, 0.7, 7, 22, '52,170,128', 0.3, 0.7, 0.25);
    creep(6, 0.2, 9, 10, 1.5, 'rgba(14,10,9,0.8)', 0.9, 0.2);
    creep(5, 0.35, 5, 9, 2.2, 'rgba(70,170,130,0.5)');
    specks(50, 0.3, 0.8, 0.7, 1.8, '240,150,80', 0.3, 0.7);
  } else if (kind === 'coal') {
    blob(m, m, m * 0.86, '8,8,8', 0.95);                         // the dust lies thick and wide
    blobs(40, 0.7, 14, 34, '5,5,5', 0.5, 0.85);
    specks(300, 0.1, 0.84, 0.8, 2.6, '4,4,4', 0.5, 0.9);
    specks(40, 0.3, 0.8, 0.8, 2.0, '120,124,134', 0.25, 0.5);    // glints of the bright coal in it
    blobs(8, 0.6, 5, 12, '110,96,78', 0.1, 0.2, 0.3);
  } else {
    blob(m, m, m * 0.7, '8,6,12', 0.95);
    blobs(16, 0.5, 16, 34, '6,5,10', 0.6, 0.9);
    creep(12, 0.4, 9, 9, 10, 'rgba(7,5,11,0.92)', 0.8, 0.15);    // the tar creeping out along the plate seams
    creep(8, 0.5, 8, 8, 4, 'rgba(7,5,11,0.85)', 1.3);
    specks(40, 0.55, 0.84, 1, 4.5, '7,5,11', 0.7, 0.9);
    // the film the light oil leaves round the tar: thin rainbow bands
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 22; i++) {
      const a0 = rnd() * TAU, r = (0.5 + rnd() * 0.3) * m, len = 0.4 + rnd() * 0.9;
      g.strokeStyle = `hsla(${Math.floor(rnd() * 360)},90%,58%,${0.1 + rnd() * 0.14})`; g.lineWidth = 2 + rnd() * 4; g.lineCap = 'round';
      g.beginPath(); g.ellipse(m + (rnd() - 0.5) * 14, m + (rnd() - 0.5) * 14, r, r * (0.8 + rnd() * 0.3), rnd() * TAU, a0, a0 + len); g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
  }
  // thin it out towards the edge: a soft core and lobes of its own, nothing past the flats
  const mc = document.createElement('canvas'); mc.width = mc.height = S;
  const q = mc.getContext('2d')!;
  const wide = kind === 'coal' ? 1 : kind === 'oil' ? 0.94 : 0.9;
  blobOn(q, m, m, m * 0.74 * wide, '255,255,255', 1, 0.55);
  for (let i = 0; i < 22; i++) { const a = rnd() * TAU, r = (0.13 + rnd() * 0.13) * m, d = Math.min((0.42 + rnd() * 0.3) * wide * m, 0.85 * m - r); blobOn(q, m + Math.cos(a) * d, m + Math.sin(a) * d, r, '255,255,255', 0.75 + rnd() * 0.25, 0.3); }
  g.globalCompositeOperation = 'destination-in'; g.drawImage(mc, 0, 0); g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
/** The stain's material. Dust has no shine at all (the deck's own sheen under the lamps would wash a dark stain out), so
 *  it is drawn matte; the oil is wet and mirrors the sky. */
function stainMat(kind: string): THREE.Material {
  const o = { color: 0xffffff, map: stainTexture(kind), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  return kind === 'oil' ? new THREE.MeshStandardMaterial({ ...o, roughness: 0.16, metalness: 0.1 }) : new THREE.MeshLambertMaterial(o);
}

/** Value noise for the deposit materials (3D and 1D), cheap enough for every deposit pixel. */
const DEP_NOISE = `
float dH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float dN(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dH(i), dH(i + vec3(1, 0, 0)), f.x), mix(dH(i + vec3(0, 1, 0)), dH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(dH(i + vec3(0, 0, 1)), dH(i + vec3(1, 0, 1)), f.x), mix(dH(i + vec3(0, 1, 1)), dH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float dR(float i) { return fract(sin(i * 127.1 + 3.7) * 43758.5453); }
float dN1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(dR(i), dR(i + 1.0), f); }
`;
/**
 * What every deposit material starts from. dp: the point in the model's own space (the detail sticks to the rock), ds and
 * dm: the kind's two values (see the model file), da: rock and its weathering dw (da up to 0.5) or a hard surface and how
 * metallic it is, dmet (da from 0.75). The three noise octaves fade out as they get smaller than a pixel, so nothing
 * shimmers at play zoom. dshade: how dark the vertex colour is against the kind's usual tone (the baked occlusion), for
 * colours the material paints over it.
 */
const depHead = (ref: number) => `
  vec3 dp = vDepP; float ds = vDepU.x, dm = 1.0 - vDepU.y, da = vColor.a;
  float dfw = length(fwidth(dp));
  float f1 = 1.0 - smoothstep(0.03, 0.09, dfw), f2 = 1.0 - smoothstep(0.012, 0.035, dfw), f3 = 1.0 - smoothstep(0.004, 0.012, dfw);
  float n1 = mix(0.5, dN(dp * 7.0), f1), n2 = mix(0.5, dN(dp * 23.0), f2), n3 = mix(0.5, dN(dp * 61.0), f3);
  float grain = n1 * 0.45 + n2 * 0.33 + n3 * 0.22, n0 = dN(dp * 2.3 + 5.0);
  float dhard = smoothstep(0.58, 0.7, da), dsoft = 1.0 - dhard;
  float dw = clamp(da * 2.0, 0.0, 1.0) * dsoft, dmet = clamp((da - 0.75) * 4.0, 0.0, 1.0);
  float dshade = clamp(dot(vColor.rgb, vec3(0.3333)) * ${ref.toFixed(1)}, 0.3, 1.25);
  float depRough = 0.9, depMetal = 0.0, depH = grain;
`;
/** The hard surfaces of every kind (deck plate, steel, timber, paint): the vertex colour, worn, with the kind's grime on it
 *  (dm; col, rough: what the grime is). Yellow paint is striped black. */
const depHard = (col: string, rough: number) => `
  { vec3 hc = vColor.rgb * (0.76 + 0.48 * grain);
    float haz = step(vColor.b * 7.0, vColor.g) * step(0.5, fract((dp.x + dp.z) * 5.5));
    hc = mix(hc, vec3(0.012), haz * 0.9);
    float gr = dhard * smoothstep(0.4, 0.6, dm * (0.55 + 0.9 * n1) + 0.15 * (n2 - 0.5));
    diffuseColor.rgb = mix(mix(diffuseColor.rgb, hc, dhard), vec3(${col}), gr);
    depRough = mix(mix(depRough, mix(0.84, 0.4, dmet), dhard), ${rough.toFixed(2)}, gr);
    depMetal = mix(depMetal, dmet * 0.9, dhard) * (1.0 - gr);
    depH = mix(depH, grain * 0.6, dhard) * (1.0 - gr); }
`;
const DEP_GLSL: Record<string, string> = {
  // iron: dull slate; the ore in it is steel-blue metal: nodules (ds = 1), a break studded with it (ds about 0.6) with a
  // halo of rust round every grain, thin veins everywhere; rust (dw) runs down the flanks in streaks
  iron_ore: depHead(15) + `
  float cell = dN(dp * 12.0 + 2.0) + 0.3 * (n2 - 0.5);
  float orf = smoothstep(0.3, 0.5, ds), nod = smoothstep(0.8, 0.95, ds);
  float vq = dot(dp, vec3(0.62, 0.48, -0.62)) * 2.2 + 1.1 * n0 + 0.35 * dN(dp * 3.7 + 3.0) + 0.1 * (n1 - 0.5);
  float vein = (1.0 - smoothstep(0.012, 0.035, abs(fract(vq) - 0.5))) * smoothstep(0.5, 0.62, dN(dp * 1.7 + 11.0)) * (0.4 + 0.6 * dm) * f2;
  float ore = dsoft * clamp(max(nod, max(orf * smoothstep(0.66, 0.74, cell), vein * 0.55)), 0.0, 1.0);
  diffuseColor.rgb *= 1.0 + dsoft * (1.0 - nod) * (1.1 * (grain - 0.5) + 0.35 * (n0 - 0.5) + 0.45 * (dN(dp * 4.6 + 9.0) - 0.5));
  float streak = dN(vec3(dp.x * 9.0, dp.y * 2.2, dp.z * 9.0));
  float rust = smoothstep(0.52, 0.8, dw * (0.45 + 1.1 * streak) + 0.12 * (n3 - 0.5));
  rust = max(rust, orf * (1.0 - nod) * smoothstep(0.5, 0.62, cell) * 0.85) * (1.0 - 0.75 * ore) * dsoft;
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.2, 0.38, 0.8), vColor.rgb, nod) * (0.8 + 0.4 * n3), ore);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.075, 0.032) * (0.55 + 0.9 * n2) * dshade, rust * 0.85);
  depRough = mix(mix(0.96, mix(0.5, 0.44, nod), ore), 0.97, rust); depMetal = ore * mix(0.5, 0.75, nod) * (1.0 - rust);
  depH = grain * mix(2.2, 0.5, nod) - 0.3 * ore;
` + depHard('0.2, 0.07, 0.025', 0.95),
  // copper: warm veins of metal through the rock, thick on the break (ds about 0.6), native copper (ds = 1), and the patina
  // (dw) from a dark teal film to a pale malachite crust where it is thickest
  copper_ore: depHead(9) + `
  float vq = dot(dp, vec3(0.55, 0.6, 0.58)) * 3.0 + 0.55 * n0 + 0.12 * (n1 - 0.5), rg = abs(fract(vq) - 0.5);
  float orf = smoothstep(0.3, 0.5, ds), nat = dsoft * smoothstep(0.8, 0.95, ds);
  float vein = (1.0 - smoothstep(0.014, 0.04, rg)) * smoothstep(0.45, 0.6, dN(dp * 1.7 + 4.0)) * (0.4 + 0.6 * dm) * f2;
  vein = max(vein, orf * max(1.0 - smoothstep(0.05, 0.11, rg), smoothstep(0.52, 0.62, dN(dp * 13.0) + 0.25 * (n2 - 0.5))));
  vein *= dsoft * (1.0 - nat);
  diffuseColor.rgb *= 1.0 + 0.8 * (grain - 0.5) * (1.0 - 0.6 * nat) * dsoft;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.27, 0.07) * (0.7 + 0.7 * n3) * dshade, vein);
  float pm = dsoft * smoothstep(0.42, 0.62, dw * (0.6 + 0.8 * n1) + 0.2 * (n2 - 0.5));
  vec3 patC = mix(vec3(0.02, 0.15, 0.12), mix(vec3(0.04, 0.4, 0.25), vec3(0.3, 0.7, 0.52), n3 * dw), smoothstep(0.35, 0.95, dw * (0.5 + n2)));
  diffuseColor.rgb = mix(diffuseColor.rgb, patC * min(dshade, 1.0), pm * 0.92);
  depRough = mix(mix(mix(0.9, 0.4, vein), 0.3 + 0.2 * n2, nat), 0.92, pm); depMetal = max(vein, nat * 0.7) * (1.0 - pm);
  depH = grain * (1.0 - 0.5 * nat) + 0.3 * pm * n2;
` + depHard('0.05, 0.1, 0.08', 0.9),
  // coal: dull black, and about every second break a bright cleavage face (dm): glassy, grey like graphite, with fine
  // ridges along the seam (ds) that draw the highlight out; matte dust (dw) lying on top
  coal: depHead(80) + `
  float sw = ds + 0.012 * (n1 - 0.5);
  float b1 = mix(0.5, dN1(sw * 55.0), f2);
  float dust = dsoft * smoothstep(0.3, 0.75, dw * (0.6 + 0.9 * n1) + 0.25 * (n3 - 0.5));
  float gl = dsoft * smoothstep(0.4, 0.7, dm) * (1.0 - dust);
  diffuseColor.rgb *= 1.0 + 0.6 * (grain - 0.5) * dsoft;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.027, 0.025) * (0.7 + 0.6 * n2) * dshade, dust * 0.85);
  depRough = mix(mix(0.9, 0.16 + 0.14 * b1, gl), 0.97, dust); depMetal = 0.45 * gl;
  depH = grain * 0.6 + 0.4 * b1 * (0.25 + 0.75 * gl) * (0.4 + 1.2 * n0) * (1.0 - dust);
` + depHard('0.012, 0.011, 0.01', 0.95),
  // oil: all of it hard surface (worn deck plate, rusty pipework, paint); the grime is tar creeping up from the pool
  oil: depHead(9) + depHard('0.006, 0.005, 0.008', 0.07),
};
/**
 * A deposit kind's material: vertex-coloured, with the kind's detail drawn in the shader (see DEP_GLSL) and a fine bump.
 * Drawn two-sided with the normal left as modelled, so a mirrored instance (whose faces wind the other way) is lit like
 * any other; the bodies are closed, their insides never show.
 */
function depMat(kind: string): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0, envMapIntensity: 1.15, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vDepP;\nvarying vec2 vDepU;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vDepP = position; vDepU = uv;');
    sh.fragmentShader = 'varying vec3 vDepP;\nvarying vec2 vDepU;\n' + DEP_NOISE + sh.fragmentShader
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'))
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + DEP_GLSL[kind])
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = depRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = depMetal;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec3 bq = -vViewPosition, bx = dFdx(bq), by = dFdy(bq);
          float hx = dFdx(depH), hy = dFdy(depH);
          vec3 r1 = cross(by, normal), r2 = cross(normal, bx); float det = dot(bx, r1);
          normal = normalize(abs(det) * normal - 0.022 * sign(det) * (hx * r1 + hy * r2)); }`);
  };
  m.customProgramCacheKey = () => 'dep9_' + kind;
  return m;
}
/**
 * The oil pool: nearly black and mirror-glossy, with slow rings running out from the middle and a cross swell (they bend the
 * normal), a thin-film sheen in drifting patches whose colours shift with the view angle and swirl slowly over the
 * surface, and a brighter band of that film round the rim, where the light oil gathers.
 */
function oilMat(t: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x060509, roughness: 0.05, metalness: 0.1, envMapIntensity: 1.8 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = t;
    sh.vertexShader = 'varying vec3 vOilW;\nvarying vec2 vOilC;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 oilW = vec4(transformed, 1.0);
      vec4 oilC = vec4(0.0, 0.0, 0.0, 1.0);
      #ifdef USE_INSTANCING
      oilW = instanceMatrix * oilW; oilC = instanceMatrix * oilC;
      #endif
      vOilW = (modelMatrix * oilW).xyz; vOilC = (modelMatrix * oilC).xz;`);
    sh.fragmentShader = 'uniform float uTime;\nvarying vec3 vOilW;\nvarying vec2 vOilC;\n' + DEP_NOISE + sh.fragmentShader
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 oq = vOilW.xz - vOilC; float od = length(oq) + 1e-4;
        vec2 og = (oq / od) * cos(od * 34.0 - uTime * 2.2) * 0.08 * exp(-od * 2.5);
        og += 0.035 * vec2(sin(vOilW.z * 7.0 + uTime * 0.9), cos(vOilW.x * 6.0 - uTime * 0.7));
        normal = normalize(normal - (viewMatrix * vec4(og.x, 0.0, og.y, 0.0)).xyz);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float ofr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.0);
        vec3 ow = vec3(vOilW.xz * 2.4, uTime * 0.05);
        float osw = dN(ow + 1.7 * vec3(dN(ow * 1.9 + 4.0), dN(ow * 1.9 - 7.0), 0.0));
        float oth = ofr * 1.6 + od * 0.9 + 1.5 * osw + 0.05 * uTime;
        vec3 film = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + oth));
        float opatch = smoothstep(0.38, 0.62, dN(vec3(vOilW.xz * 1.5 + 9.0, uTime * 0.035)));
        float oin = smoothstep(0.64, 0.4, od);
        float orim = smoothstep(0.4, 0.52, od + 0.08 * (osw - 0.5)) * smoothstep(0.63, 0.55, od);
        float orip = pow(0.5 + 0.5 * cos(od * 34.0 - uTime * 2.2), 4.0) * exp(-od * 3.0);
        totalEmissiveRadiance += (film * (0.03 + 0.08 * opatch + 0.1 * ofr) + vec3(0.13, 0.13, 0.17) * (0.12 + pow(ofr, 2.0)) + vec3(0.09, 0.08, 0.12) * orip) * oin
          + mix(vec3(0.5), film, 0.85) * orim * (0.1 + 0.08 * opatch);`);
  };
  m.customProgramCacheKey = () => 'oilpool5';
  return m;
}
/** One instanced batch of deposit pieces: each piece's resting matrix, its tile, its delay in the build-up, and what it stays
 *  visible under (0: nothing, 1: a mine or pumpjack, 2: any building). */
class DepBatch {
  mesh: THREE.InstancedMesh; n = 0; cap: number;
  rest: Float32Array; tile: Int32Array; del: Float32Array; keep: Uint8Array;
  constructor(g: THREE.BufferGeometry, m: THREE.Material, cap: number, shadow: boolean) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(g, m, cap);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = shadow; this.mesh.receiveShadow = true;
    this.rest = new Float32Array(cap * 16); this.tile = new Int32Array(cap); this.del = new Float32Array(cap); this.keep = new Uint8Array(cap);
  }
  add(M: THREE.Matrix4, c: THREE.Color, tile: number, del: number, keep: number) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    M.toArray(this.rest, i * 16); this.mesh.setMatrixAt(i, M); this.mesh.setColorAt(i, c);
    this.tile[i] = tile; this.del[i] = del; this.keep[i] = keep;
  }
}
/** Overshooting ease (about 9% over) for the pieces popping up. */
const backOut = (k: number) => { const q = k - 1; return 1 + 2.6 * q * q * q + 1.6 * q * q; };
const sat01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------- items ----------
/** Bake jitter into a polyhedron so it reads as a rough chunk; the same corner moves the same way on every face. */
function rough(g: THREE.BufferGeometry, amt: number, seed: number) {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed) * 43758.5453, r = 1 + amt * ((h - Math.floor(h)) * 2 - 1);
    p.setXYZ(i, x * r, y * r, z * r);
  }
  g.computeVertexNormals();
  return g;
}
/** Make every face flat (low-poly look) */
const flat = (g: THREE.BufferGeometry) => { const n = g.index ? g.toNonIndexed() : g; if (n !== g) g.dispose(); n.computeVertexNormals(); return n; };
const lying = (g: THREE.BufferGeometry) => g.rotateX(Math.PI / 2); // a +y lathe or cylinder lies along +z
const strip = (g: THREE.BufferGeometry) => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; };
/** Merge parts that may be indexed or not, keeping position and normal only. */
const merge = (parts: THREE.BufferGeometry[]) => { const ps = parts.map((g) => strip(g.index ? g.toNonIndexed() : g)); const m = mergeGeometries(ps)!; for (const g of ps) g.dispose(); for (const g of parts) g.dispose(); return m; };

interface ItemPart { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial; tint: boolean }
type Shape = 'ore' | 'coal' | 'plate' | 'frame' | 'crate' | 'shell' | 'slug' | 'cell' | 'missile';
const SHAPE_OF: Record<ItemType, Shape> = {
  iron_ore: 'ore', copper_ore: 'ore', coal: 'coal', iron: 'plate', copper: 'plate', shell: 'shell', cell: 'cell', missile: 'missile',
};
const SHAPES: Shape[] = ['ore', 'coal', 'plate', 'frame', 'crate', 'shell', 'slug', 'cell', 'missile'];
/** Items are drawn a little larger than modelled so they read at play zoom over the tread (ore and coal are small chunks). */
/** Coal is drawn as anthracite a shade lighter than its HUD colour, so its gloss still reads on the black tread. */
const COAL_TINT = 0x4a4642;
const ITEM_SCALE: Record<Shape, number> = { ore: 1.35, coal: 1.35, plate: 1.2, frame: 1.12, crate: 1.12, shell: 1.12, slug: 1.1, cell: 1.12, missile: 1.1 };
function itemParts(): Record<Shape, ItemPart[]> {
  const tinted = (rough = 0.5, metal = 0.4) => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: metal });
  const fixed = (c: number, rough = 0.5, metal = 0.5) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });
  const mOre = tinted(0.85, 0.25), mCoal = tinted(0.28, 0.55), mPlate = tinted(0.45, 0.6), mFrame = tinted(0.45, 0.8);
  const mBand = tinted(0.4, 0.5), mBody = tinted(0.4, 0.6);
  const olive = fixed(0x4e5530, 0.7, 0.2), brass = fixed(0xb38b4d, 0.3, 0.9), steel = fixed(0x55504a, 0.4, 0.85);
  const cellGlow = new THREE.MeshStandardMaterial({ color: 0x1c3a34, emissive: ITEMS.cell.color, emissiveIntensity: 1.7, roughness: 0.3 });
  // ore: two rough chunks leaning on each other
  const ore = merge([
    rough(new THREE.DodecahedronGeometry(0.13, 0), 0.28, 1).scale(1.15, 0.8, 1).translate(-0.04, 0.1, 0.03),
    rough(new THREE.DodecahedronGeometry(0.1, 0), 0.3, 7).scale(1, 0.85, 1.2).translate(0.08, 0.08, -0.07),
  ]);
  const coal = merge([
    rough(new THREE.IcosahedronGeometry(0.12, 0), 0.32, 3).scale(1.2, 0.75, 1.1).translate(0, 0.08, 0.02),
    rough(new THREE.IcosahedronGeometry(0.08, 0), 0.35, 5).translate(0.1, 0.06, -0.09),
    rough(new THREE.IcosahedronGeometry(0.07, 0), 0.35, 9).translate(-0.11, 0.05, -0.08),
  ]);
  // plate: two stacked ingots (tapered bars)
  const ingot = () => new THREE.CylinderGeometry(0.1, 0.135, 0.075, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 1.8);
  const plate = merge([ingot().translate(0, 0.0375, 0), ingot().scale(0.92, 1, 0.92).rotateY(0.1).translate(0.01, 0.112, 0)]);
  // frame: a girder cube, edges and one diagonal brace per side
  const fr: THREE.BufferGeometry[] = [], H = 0.26, W = 0.28, T = 0.035;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) fr.push(new THREE.BoxGeometry(T, H, T).translate((sx * (W - T)) / 2, H / 2, (sz * (W - T)) / 2));
  for (const y of [T / 2, H - T / 2]) for (const s of [-1, 1]) { fr.push(new THREE.BoxGeometry(W, T, T).translate(0, y, (s * (W - T)) / 2)); fr.push(new THREE.BoxGeometry(T, T, W).translate((s * (W - T)) / 2, y, 0)); }
  const diag = Math.hypot(W, H) - T;
  for (const s of [-1, 1]) {
    fr.push(new THREE.BoxGeometry(T * 0.8, diag, T * 0.8).rotateZ(Math.atan2(W, H) * s).translate(0, H / 2, (s * (W - T)) / 2));
    fr.push(new THREE.BoxGeometry(T * 0.8, diag, T * 0.8).rotateX(Math.atan2(W, H) * s).translate((s * (W - T)) / 2, H / 2, 0));
  }
  const frame = merge(fr);
  // ammo: an olive crate with a lid lip, a coloured band and handles
  const crate = merge([new THREE.BoxGeometry(0.3, 0.17, 0.24).translate(0, 0.085, 0), new THREE.BoxGeometry(0.32, 0.04, 0.26).translate(0, 0.19, 0),
    new THREE.BoxGeometry(0.1, 0.03, 0.05).translate(0, 0.22, 0)]);
  const crateBand = merge([new THREE.BoxGeometry(0.305, 0.035, 0.245).translate(0, 0.1, 0), new THREE.BoxGeometry(0.06, 0.012, 0.05).translate(-0.08, 0.215, 0)]);
  // shell: brass casing, coloured ogive head, lying along the belt
  const R = 0.075;
  const casing = merge([lying(new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(R + 0.008, 0), new THREE.Vector2(R + 0.008, 0.025), new THREE.Vector2(R, 0.03), new THREE.Vector2(R, 0.17)], 12)).translate(0, R + 0.008, -0.16)]);
  const head = merge([lying(new THREE.LatheGeometry([new THREE.Vector2(R, 0), new THREE.Vector2(R, 0.03), new THREE.Vector2(R * 0.8, 0.09), new THREE.Vector2(R * 0.4, 0.14), new THREE.Vector2(0, 0.16)], 12)).translate(0, R + 0.008, 0.01)]);
  // slug: three slim rods banded together
  const rods: THREE.BufferGeometry[] = [];
  for (const [x, y] of [[-0.045, 0.035], [0.045, 0.035], [0, 0.11]]) rods.push(lying(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 8)).translate(x, y, 0));
  for (const z of [-0.2, 0.2]) for (const [x, y] of [[-0.045, 0.035], [0.045, 0.035], [0, 0.11]]) rods.push(lying(new THREE.ConeGeometry(0.035, 0.05, 8)).rotateX(z < 0 ? Math.PI : 0).translate(x, y, z + Math.sign(z) * 0.025));
  const slug = merge(rods);
  const slugBand = merge([lying(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10)).scale(1.15, 0.85, 1).translate(0, 0.065, -0.08), lying(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10)).scale(1.15, 0.85, 1).translate(0, 0.065, 0.08)]);
  // energy cell: upright battery, steel caps and a glowing core
  const cellCase = merge([new THREE.CylinderGeometry(0.1, 0.1, 0.06, 14).translate(0, 0.03, 0), new THREE.CylinderGeometry(0.1, 0.1, 0.06, 14).translate(0, 0.25, 0),
    new THREE.CylinderGeometry(0.035, 0.035, 0.04, 8).translate(0, 0.3, 0), ...[0, 1, 2].map((i) => new THREE.BoxGeometry(0.025, 0.16, 0.025).translate(Math.cos((i * TAU) / 3) * 0.092, 0.14, Math.sin((i * TAU) / 3) * 0.092))]);
  const cellCore = merge([new THREE.CylinderGeometry(0.085, 0.085, 0.16, 14).translate(0, 0.14, 0)]);
  // missile: a slim capsule with a coloured nose and four fins
  const MR = 0.05;
  const mBodyG = merge([lying(new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(MR * 0.8, 0), new THREE.Vector2(MR, 0.03), new THREE.Vector2(MR, 0.3)], 12)).translate(0, MR + 0.02, -0.2)]);
  const mNose = merge([lying(new THREE.LatheGeometry([new THREE.Vector2(MR, 0), new THREE.Vector2(MR * 0.85, 0.05), new THREE.Vector2(MR * 0.45, 0.1), new THREE.Vector2(0, 0.12)], 12)).translate(0, MR + 0.02, 0.1)]);
  // four fins round the tail, turned about the missile's axis
  const fins: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) fins.push(new THREE.BoxGeometry(0.008, 0.06, 0.09).translate(0, MR + 0.02, 0).rotateZ(Math.PI / 4 + (i * Math.PI) / 2).translate(0, MR + 0.02, -0.15));
  const finG = merge(fins);
  return {
    ore: [{ geo: flat(ore), mat: mOre, tint: true }],
    coal: [{ geo: flat(coal), mat: mCoal, tint: true }],
    plate: [{ geo: flat(plate), mat: mPlate, tint: true }],
    frame: [{ geo: frame, mat: mFrame, tint: true }],
    crate: [{ geo: crate, mat: olive, tint: false }, { geo: crateBand, mat: mBand, tint: true }],
    shell: [{ geo: casing, mat: brass, tint: false }, { geo: head, mat: mBody, tint: true }],
    slug: [{ geo: slug, mat: mBody, tint: true }, { geo: slugBand, mat: steel, tint: false }],
    cell: [{ geo: cellCase, mat: steel, tint: false }, { geo: cellCore, mat: cellGlow, tint: false }],
    missile: [{ geo: mBodyG, mat: steel, tint: false }, { geo: mNose, mat: mBody, tint: true }, { geo: finG, mat: mBody, tint: true }],
  };
}

// ---------- pipes ----------
/** Pipe axis height, the glass tube's radius and the radius of the fluid inside it (it fills the glass but for the wall). */
const PY = 0.4, PR = 0.105, KR = 0.088;
/** The fluid's bottom and top inside a lying pipe. */
const HY0 = PY - KR, HY1 = PY + KR;
/** How fast each fluid runs along the pipes (tiles a second; index: 0 none, then FLUID_TYPES): crude creeps, petrol runs. */
const FLOW_SPEED = [0, 0.4, 1.45];
/** The least a pipe is shown filled while its fluid is being pumped through it (a busy line is drained as fast as it is
 *  fed: its real level would show an empty tube); its real fill shows in the rest of the tube's height. */
const FLOW_FILL = 0.62;
/** The pipe state texture: one texel per tile (x = 2 cx + the row's half-tile shift, y = cz), see FacView.syncPipes. */
const PT_W = 2 * GW + 1, PT_H = GH;
/** A stretch t0..t1 of another curve (the two halves of an elbow's fluid). */
class SubCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private c: THREE.Curve<THREE.Vector3>, private t0: number, private t1: number) { super(); }
  override getPoint(t: number, out = new THREE.Vector3()) { return this.c.getPoint(this.t0 + (this.t1 - this.t0) * t, out); }
}
/**
 * Give a piece of fluid its flow attribute aFl = (side, r, y0, y1). side: the hex side of the pipe arm it lies in (the
 * fluid runs toward the tile's middle in an arm that leads upstream, away from it in the others; 6: a branch into a
 * consumer, always downstream), r: how far along that arm from the tile's middle (1 at the edge; rOf gets the vertex's x, z
 * and its u along a tube), y0 / y1: the fluid's bottom and top there, between which its level rises with the network's fill.
 */
function flTag(g: THREE.BufferGeometry, side: number, y0: number, y1: number, rOf: (x: number, z: number, u: number) => number): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  const p = n.getAttribute('position'), uv = n.getAttribute('uv'), a = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) { a[i * 4] = side; a[i * 4 + 1] = Math.max(0, rOf(p.getX(i), p.getZ(i), uv ? uv.getX(i) : 0)); a[i * 4 + 2] = y0; a[i * 4 + 3] = y1; }
  n.setAttribute('aFl', new THREE.BufferAttribute(a, 4));
  return n;
}
/** Merge tagged fluid pieces (position, normal and the flow attribute). */
const mergeK = (parts: THREE.BufferGeometry[]) => {
  for (const g of parts) for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'aFl') g.deleteAttribute(k);
  const m = mergeGeometries(parts)!;
  for (const g of parts) g.dispose();
  return m;
};
/** A belt-style arc (entry side a to exit side b) at pipe height, for elbows. */
class ElbowCurve extends THREE.Curve<THREE.Vector3> {
  private P: Path; private c: number; private s: number; private pt: PathPt = { x: 0, z: 0, tx: 0, tz: 0 };
  constructor(a: number, k: number) { super(); this.P = PATHS[k]; this.c = DX[a]; this.s = DZ[a]; }
  override getPoint(t: number, out = new THREE.Vector3()) {
    const q = pathAt(this.P, t, this.pt);
    return out.set(q.x * this.c - q.z * this.s, PY, q.x * this.s + q.z * this.c);
  }
}
/** A geometry made along +z (centred), laid along direction d from distance `from` to `to` from the tile centre. */
function along(g: THREE.BufferGeometry, d: number, from: number, to: number, y = PY) {
  const m = (from + to) / 2;
  return g.rotateY(yawOf(d)).translate(DX[d] * m, y, DZ[d] * m);
}
const tubeZ = (r: number, len: number, seg = 12) => lying(new THREE.CylinderGeometry(r, r, len, seg));
/**
 * Pipe geometry for a side mask: [glass tube, fluid core inside it, fittings (steel), valve wheel (paint)]. A Pipe Tunnel
 * (shaft) gets the same arms running into a capped shaft that takes the pipe underground.
 */
function pipeGeo(mask: number, valve: boolean, shaft = false, model = false): THREE.BufferGeometry[] {
  const key = (shaft ? (model ? 'shaftm' : 'shaft') : 'pipe') + mask + +valve;
  const have = geos.get(key + 'b');
  if (have) return [have, geos.get(key + 'k')!, geos.get(key + 'f')!, geos.get(key + 'v')!];
  const sides: number[] = [];
  for (let d = 0; d < 6; d++) if (mask & (1 << d)) sides.push(d);
  const B: THREE.BufferGeometry[] = [], K: THREE.BufferGeometry[] = [], F: THREE.BufferGeometry[] = [], V: THREE.BufferGeometry[] = [];
  // (the fluid is an open tube per arm, each from the tile's middle outward: a piece never spans two sides, see flTag)
  const karm = (d: number, from: number, to: number) => K.push(flTag(along(lying(new THREE.CylinderGeometry(KR, KR, to - from, 12, 1, true)), d, from, to), d, HY0, HY1, (x, z) => x * DX[d] + z * DZ[d]));
  const arm = (d: number, from: number, to: number) => {
    B.push(along(tubeZ(PR, to - from, 14), d, from, to));
    if (from < 0) { karm(d, 0, to); karm((d + 3) % 6, 0, -from); } else karm(d, from, to);
  };
  const vessel = (g: THREE.BufferGeometry, y0: number, y1: number) => K.push(flTag(g, 0, y0, y1, () => 0));
  // steel bands hold the glass: a flange at the tile edge and a collar just inside it
  const flange = (d: number, at: number) => { F.push(along(tubeZ(PR + 0.06, 0.05, 12), d, at - 0.025, at + 0.025)); F.push(along(tubeZ(PR + 0.022, 0.06, 12), d, at - 0.1, at - 0.04)); };
  const support = (x: number, z: number, yaw: number) => {
    F.push(new THREE.BoxGeometry(0.06, PY - PR, 0.06).translate(0, (PY - PR) / 2, 0).rotateY(yaw).translate(x, 0, z));
    F.push(new THREE.BoxGeometry(0.3, 0.05, 0.08).translate(0, PY - PR - 0.02, 0).rotateY(yaw).translate(x, 0, z));
    F.push(new THREE.BoxGeometry(0.2, 0.025, 0.14).translate(0, 0.0125, 0).rotateY(yaw).translate(x, 0, z));
    // (a clamp ring round the glass over the support)
    F.push(new THREE.TorusGeometry(PR + 0.012, 0.016, 5, 14).rotateY(yaw).translate(x, PY, z));
  };
  const wheel = (x: number, y: number, z: number) => {
    V.push(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 6).translate(x, y + 0.06, z));
    V.push(new THREE.TorusGeometry(0.085, 0.016, 6, 14).rotateX(Math.PI / 2).translate(x, y + 0.12, z));
    for (const r of [0, Math.PI / 2]) V.push(new THREE.BoxGeometry(0.17, 0.014, 0.014).rotateY(r + 0.4).translate(x, y + 0.12, z));
  };
  const n = sides.length;
  if (shaft && model) {
    // the modelled shaft (fac_ptunnel) brings the steelwork: here only the glass arms into its ports, the flanges at the tile
    // edges, and the sight glass on its cap with the fluid in it
    B.push(new THREE.CylinderGeometry(0.17, 0.17, 0.16, 16).translate(0, 0.68, 0));
    vessel(new THREE.CylinderGeometry(0.14, 0.14, 0.15, 12).translate(0, 0.675, 0), 0.6, 0.75);
    for (const d of sides) { arm(d, 0.29, 1); flange(d, 0.95); }
  } else if (shaft) {
    // the shaft: a steel collar on a dark plinth with a cap; each arm runs into its side and a glass well in the cap shows
    // the fluid going down
    F.push(new THREE.CylinderGeometry(HEX_SIZE * 0.5, HEX_SIZE * 0.56, 0.06, 6).rotateY(Math.PI / 6).translate(0, 0.03, 0));
    F.push(new THREE.CylinderGeometry(0.27, 0.31, 0.5, 16).translate(0, 0.31, 0));
    F.push(new THREE.CylinderGeometry(0.33, 0.33, 0.05, 16).translate(0, 0.585, 0));
    F.push(new THREE.TorusGeometry(0.2, 0.025, 6, 18).rotateX(Math.PI / 2).translate(0, 0.62, 0));
    B.push(new THREE.CylinderGeometry(0.17, 0.17, 0.16, 16).translate(0, 0.68, 0));
    vessel(new THREE.CylinderGeometry(0.14, 0.14, 0.15, 12).translate(0, 0.675, 0), 0.6, 0.75);
    F.push(new THREE.CylinderGeometry(0.19, 0.19, 0.03, 16).translate(0, 0.77, 0));
    // a red hazard band round the collar
    V.push(new THREE.CylinderGeometry(0.315, 0.315, 0.06, 16, 1, true).translate(0, 0.45, 0));
    for (const d of sides) { arm(d, 0.26, 1); flange(d, 0.95); F.push(along(tubeZ(PR + 0.05, 0.05, 12), d, 0.27, 0.32)); }
  } else if (n === 0) {
    // a standpipe waiting for a neighbour
    B.push(new THREE.CylinderGeometry(0.15, 0.15, 0.56, 14).translate(0, 0.3, 0));
    vessel(new THREE.CylinderGeometry(0.125, 0.125, 0.5, 12).translate(0, 0.3, 0), 0.05, 0.55);
    F.push(new THREE.CylinderGeometry(0.22, 0.24, 0.06, 14).translate(0, 0.03, 0), new THREE.CylinderGeometry(0.19, 0.19, 0.05, 14).translate(0, 0.58, 0));
    wheel(0, 0.6, 0);
  } else if (n === 2 && (sides[1] - sides[0]) === 3) {
    // a straight run
    const d = sides[0];
    arm(d, -1, 1);
    flange(d, 0.95); flange((d + 3) % 6, 0.95);
    support(0, 0, yawOf(d));
    if (valve) wheel(0, PY + PR, 0);
  } else if (n === 2) {
    // an elbow: the same arcs as the belts, so pipe bends line up with belt bends
    let a = sides[0], k = sides[1] - sides[0];
    if (k === 5 || k === 4) { a = sides[1]; k = 6 - k; } // run the short way round
    const curve = new ElbowCurve(a, k);
    B.push(new THREE.TubeGeometry(curve, 16, PR, 12, false));
    K.push(flTag(new THREE.TubeGeometry(new SubCurve(curve, 0, 0.5), 8, KR, 10, false), a, HY0, HY1, (_x, _z, u) => 1 - u));
    K.push(flTag(new THREE.TubeGeometry(new SubCurve(curve, 0.5, 1), 8, KR, 10, false), (a + k) % 6, HY0, HY1, (_x, _z, u) => u));
    flange(sides[0], 0.95); flange(sides[1], 0.95);
    const mid = curve.getPoint(0.5), t = curve.getTangent(0.5);
    support(mid.x, mid.z, Math.atan2(t.x, t.z));
    if (valve) wheel(mid.x, PY + PR, mid.z);
  } else {
    // one arm with a blind end, or a junction body where three or more meet
    for (const d of sides) { arm(d, n === 1 ? 0 : 0.15, 1); flange(d, 0.95); }
    if (n === 1) {
      F.push(along(tubeZ(PR + 0.06, 0.05, 14), sides[0], -0.03, 0.02), along(tubeZ(PR + 0.035, 0.05, 6), sides[0], -0.07, -0.02));
      support(DX[sides[0]] * 0.45, DZ[sides[0]] * 0.45, yawOf(sides[0]));
      if (valve) wheel(DX[sides[0]] * 0.25, PY + PR, DZ[sides[0]] * 0.25);
    } else {
      const r = 0.22, h = 0.38;
      B.push(new THREE.CylinderGeometry(r, r, h, 16).translate(0, PY, 0));
      // (the body's fluid stands as high as the arms' do: one level through the junction)
      vessel(new THREE.CylinderGeometry(r * 0.86, r * 0.86, 2 * KR, 14).translate(0, PY, 0), HY0, HY1);
      for (const y of [PY - h / 2, PY + h / 2]) F.push(new THREE.CylinderGeometry(r + 0.025, r + 0.025, 0.045, 16).translate(0, y, 0));
      F.push(new THREE.CylinderGeometry(r * 0.75, r + 0.06, PY - h / 2, 16).translate(0, (PY - h / 2) / 2, 0));
      wheel(0, PY + h / 2, 0);
    }
  }
  const out = [merge(B), mergeK(K), F.length ? merge(F) : new THREE.BufferGeometry(), V.length ? merge(V) : new THREE.BufferGeometry()];
  ['b', 'k', 'f', 'v'].forEach((s, i) => geos.set(key + s, out[i]));
  return out;
}
/** Where a pipe mesh (or a branch instance) stands, read from its matrix, and the texel of the pipe state texture for it. */
const PIPE_TEXEL = `
  mat4 flM = modelMatrix;
  #ifdef USE_INSTANCING
  flM = modelMatrix * instanceMatrix;
  #endif
  vec4 flT = texelFetch(uPipe, clamp(ivec2(int(floor(flM[3].x + ${GW.toFixed(1)})), int(floor(flM[3].z / ${ROW_H.toFixed(6)} + ${((GH - 1) / 2 + 0.5).toFixed(1)}))), ivec2(0), ivec2(${PT_W - 1}, ${PT_H - 1})), 0);
`;
/**
 * The fluid inside the glass. One material for every pipe, shaft and branch: what flows in a tile comes from the pipe state
 * texture (FacView.syncPipes writes, per pipe tile: its distance from the pump along the network, which of its sides lead
 * upstream, the level shown, the fluid, and how far the network's fluid has run), so nothing is set per pipe.
 *
 * The body is cut off flat at the level, with a small wave travelling down the pipe, and the inside of the far wall that
 * shows through the cut is lit as the liquid's surface (its normal turned up), so a part-full pipe has a surface and a
 * meniscus line and not a hollow shell. Everything that moves is a function of the flow coordinate (distance from the pump
 * minus how far the fluid has run), so it runs the real way round every bend and junction, at the fluid's own pace, and
 * stands still when the network does.
 *  - crude: black-brown and opaque, slow marbled streaks, a few heavy bubbles dragged along under the surface, and the
 *    colours of an oil film where the light grazes it;
 *  - petrol: thin amber with the light through it (brighter where it is shallow), fine fast streaks, a string of small
 *    bubbles, and the bright wavering line a round glass of it focuses along its lower third.
 */
function fluidMat(tex: THREE.Texture): THREE.MeshStandardMaterial {
  // (little of the sky in it: a mirror-bright tube reads as chrome, not as a liquid behind glass)
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.25 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPipe = { value: tex };
    sh.vertexShader = 'attribute vec4 aFl;\nuniform sampler2D uPipe;\nvarying vec4 vFlD;\nvarying vec2 vFlY;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      ${PIPE_TEXEL}
      float flUp = aFl.x > 5.5 ? 0.0 : mod(floor(mod(flT.g, 64.0) / exp2(aFl.x)), 2.0);
      // (flow coordinate, level, fluid, fill), and the vertex's own height with the fluid's bottom there
      vFlD = vec4(flT.r + (0.5 - flUp) * aFl.y - flT.a, aFl.z + (aFl.w - aFl.z) * flT.b + step(0.985, flT.b) * 0.01, floor(flT.g / 64.0), flT.b);
      vFlY = vec2(transformed.y, aFl.z);`);
    sh.fragmentShader = 'varying vec4 vFlD;\nvarying vec2 vFlY;\n' + DEP_NOISE + 'float flH(float n) { return fract(sin(n * 127.1 + 1.3) * 43758.5453); }\n' + sh.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (vFlD.z < 0.5) discard;
        float flS = vFlD.x, flCr = step(vFlD.z, 1.5), flPart = step(vFlD.w, 0.97);
        float flRip = mix(0.0035 * sin(flS * 25.0) + 0.002 * sin(flS * 59.0 + 0.7), 0.005 * sin(flS * 9.0) + 0.003 * sin(flS * 21.0 + 1.3), flCr) * flPart;
        float flLev = vFlD.y + flRip, flY = vFlY.x;
        if (flY > flLev) discard;
        float flTop = gl_FrontFacing ? 0.0 : 1.0;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float flM1 = dN(vec3(flS * 1.7, flY * 11.0, 2.0)), flM2 = dN(vec3(flS * 4.3 + 7.0, flY * 30.0, 5.0));
        float flDepth = clamp((flLev - flY) / max(0.02, flLev - vFlY.y), 0.0, 1.0);
        vec3 flCrude = mix(vec3(0.02, 0.012, 0.008), vec3(0.1, 0.058, 0.03), smoothstep(0.45, 0.8, flM1 * 0.7 + flM2 * 0.3) * 0.75);
        vec3 flPet = mix(vec3(0.8, 0.4, 0.05), vec3(0.42, 0.13, 0.01), flDepth * 0.8);
        diffuseColor.rgb = mix(flPet, flCrude, flCr);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.3, 0.22, flCr);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (flTop > 0.5) normal = normalize((viewMatrix * vec4(0.07 * cos(flS * mix(25.0, 9.0, flCr)), 1.0, 0.0, 0.0)).xyz);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float flFr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.0);
          float flMen = (1.0 - smoothstep(0.0, 0.014, flLev - flY)) * flPart * (1.0 - flTop);
          if (flCr > 0.5) {
            float c = flS * 1.3, id = floor(c), f = fract(c) - 0.5;
            float on = step(0.4, flH(id * 3.1)), by = flLev - 0.022 - 0.03 * flH(id + 9.0), br = 0.014 + 0.013 * flH(id * 1.7 + 4.0);
            float d = length(vec2(f / 1.3 * 2.0, flY - by));
            float rim = (1.0 - smoothstep(0.003, 0.008, abs(d - br))) * on, core = (1.0 - smoothstep(br * 0.2, br, d)) * on;
            vec3 film = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + flFr * 1.3 + flS * 0.23 + 0.9 * flM1));
            float patch_ = smoothstep(0.5, 0.75, dN(vec3(flS * 0.9 + 3.0, flY * 5.0, 8.0)));
            totalEmissiveRadiance += film * patch_ * (flFr * 0.1 + flTop * 0.04 + 0.02 * smoothstep(0.55, 0.9, flM2)) + vec3(0.34, 0.23, 0.13) * rim + vec3(0.07, 0.045, 0.025) * core + vec3(0.2, 0.12, 0.06) * flMen;
          } else {
            float st = pow(dN(vec3(flS * 1.1, flY * 70.0, 1.0)), 3.0);
            float c = flS * 7.0, id = floor(c), f = fract(c) - 0.5;
            float by = mix(vFlY.y, flLev, 0.2 + 0.7 * flH(id * 2.3)), d = length(vec2(f / 7.0 * 2.0, flY - by));
            float bub = (1.0 - smoothstep(0.003, 0.008, d)) * step(0.3, flH(id + 3.0));
            float yc = mix(vFlY.y, flLev, 0.3) + 0.01 * sin(flS * 7.0) + 0.005 * sin(flS * 17.0 + 2.0);
            float cau = exp(-pow((flY - yc) / 0.008, 2.0)) * (0.55 + 0.45 * sin(flS * 12.0 + 4.0 * flM1));
            totalEmissiveRadiance += diffuseColor.rgb * (0.1 + 0.14 * (1.0 - flDepth)) + vec3(1.0, 0.7, 0.28) * (0.16 * st + 0.55 * bub + 0.5 * cau * (1.0 - flTop) + 0.3 * flMen) + vec3(1.0, 0.8, 0.45) * flTop * 0.05;
          }
        }`);
  };
  m.customProgramCacheKey = () => 'fluid2';
  return m;
}
/** The pipe state texture over its data (four floats per texel, see FacView.syncPipes). */
function pipeTexture(data: Float32Array): THREE.DataTexture {
  const t = new THREE.DataTexture(data, PT_W, PT_H, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}
/** Glass: nearly clear face-on, brighter and more solid at grazing angles, so the tube's outline reads round the fluid.
 *  Where crude runs behind it, the film it leaves on the glass throws back oily colours. */
function glassMat(tex: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xcfe6ec, roughness: 0.04, metalness: 0.05, transparent: true, opacity: 0.08, depthWrite: false });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPipe = { value: tex };
    sh.vertexShader = 'uniform sampler2D uPipe;\nvarying vec3 vGl;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      ${PIPE_TEXEL}
      vGl = vec3(floor(flT.g / 64.0), (flM * vec4(transformed, 1.0)).xz);`);
    sh.fragmentShader = 'varying vec3 vGl;\n' + sh.fragmentShader.replace('#include <opaque_fragment>',
      `float fres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2);
      // (over black crude the glass's own milky edge would turn the whole tube grey: it is thinned there, and carries the film's colours instead)
      float glCr = step(0.5, vGl.x) * step(vGl.x, 1.5);
      diffuseColor.a = mix(diffuseColor.a, mix(0.62, 0.16, glCr), fres);
      outgoingLight *= 1.0 - 0.6 * glCr;
      outgoingLight += vec3(0.5, 0.66, 0.74) * fres * mix(0.34, 0.06, glCr);
      outgoingLight += (0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + fres * 1.7 + 0.31 * (vGl.y + vGl.z)))) * fres * fres * 0.1 * glCr;
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'glass2';
  return m;
}

// ---------- splitters and tunnels ----------
/** Types built here from plain shapes even when a model file exists. (The Belt Splitter, Belt Tunnel and Pipe Tunnel have
 *  models, which fromModel completes with the belt and pipe parts drawn here: stubs, ramps, glass arms; without the file
 *  they fall back to the plain shapes like every other building.) */
const DRAWN_HERE: ReadonlySet<FacType> = new Set<FacType>(['belt', 'pipe']);
/** The model name of each building type ('fac_' + type), made once. */
const MODEL_KEY = Object.fromEntries(Object.keys(FACS).map((t) => [t, 'fac_' + t])) as Record<FacType, string>;
const VOID = new THREE.MeshBasicMaterial({ color: 0x060505 });
type PortalPart = 'hood' | 'trim' | 'void' | 'glow';
/**
 * A Belt Tunnel's hooded portal in the belts' frame (items run toward -x): s = 1 the entrance (mouth facing the back edge,
 * the hood over the middle of the tile), s = -1 the exit (mirrored). A black plane just inside the mouth swallows the ramp
 * and the items riding it.
 */
function portalGeo(s: number): [THREE.BufferGeometry, PortalPart][] {
  const key = 'portal' + s, have = geos.get(key + 'hood');
  const parts: PortalPart[] = ['hood', 'trim', 'void', 'glow'];
  if (have) return parts.map((p) => [geos.get(key + p)!, p]);
  const HR = 0.54, HW = 0.26, HL = 0.78, xm = 0.08 * s, xc = xm - (s * HL) / 2;
  const sh = new THREE.Shape();
  sh.moveTo(-HR, 0); sh.lineTo(-HR, HW); sh.absarc(0, HW, HR, Math.PI, 0, true); sh.lineTo(HR, 0); sh.closePath();
  const arch = (r: number, t: number, x: number) => new THREE.TorusGeometry(r, t, 6, 20, Math.PI).rotateY(Math.PI / 2).translate(x, HW, 0);
  const G: Record<PortalPart, THREE.BufferGeometry[]> = { hood: [], trim: [], void: [], glow: [] };
  G.hood.push(new THREE.CylinderGeometry(HR, HR, HL, 18, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).translate(xc, HW, 0));
  for (const z of [-HR, HR]) G.hood.push(new THREE.BoxGeometry(HL, HW, 0.07).translate(xc, HW / 2, z));
  G.hood.push(new THREE.ShapeGeometry(sh, 10).rotateY((-s * Math.PI) / 2).translate(xm - s * HL, 0, 0));
  G.hood.push(new THREE.BoxGeometry(HL + 0.12, 0.04, HR * 2 + 0.16).translate(xc, 0.02, 0));
  G.trim.push(arch(HR + 0.015, 0.055, xm), arch(HR + 0.01, 0.04, xm - s * HL), arch(HR + 0.01, 0.03, xc));
  for (const z of [-1, 1]) G.trim.push(new THREE.BoxGeometry(0.11, HW, 0.11).translate(xm, HW / 2, z * (HR + 0.015)), new THREE.BoxGeometry(0.09, HW, 0.09).translate(xm - s * HL, HW / 2, z * (HR + 0.01)));
  G.void.push(new THREE.ShapeGeometry(sh, 10).rotateY((s * Math.PI) / 2).translate(xm - s * 0.08, 0, 0));
  G.glow.push(arch(HR - 0.045, 0.02, xm + s * 0.035));
  for (const z of [-1, 1]) G.glow.push(new THREE.BoxGeometry(0.03, HW, 0.03).translate(xm + s * 0.035, HW / 2, z * (HR - 0.045)));
  // chevrons on the roof: the way items run through it
  for (const dx of [-0.17, 0.17]) G.glow.push(G_CHEV.clone().scale(0.5, 1, 0.5).rotateY(-Math.PI / 2).translate(xc + dx, HW + HR + 0.006, 0));
  return parts.map((p) => { const m = merge(G[p]); geos.set(key + p, m); return [m, p]; });
}
/** Where the power wires meet a pole (the insulator on the side facing x) or a generator (its terminal). */
export function wireEnd(q: Fac, x: number): [number, number, number] {
  return q.type === 'pole' ? [q.x + (x >= q.x ? POLE_ARM : -POLE_ARM), POLE_Y, q.z] : [q.x, GEN_Y, q.z];
}
/** The tunnel a new one at (cx, cz) would pair with (as Factory.pairTunnels does): for a belt tunnel the nearest unpaired one
 *  facing the same way ahead (or behind), for a pipe tunnel the nearest unpaired one in a straight line, within TUNNEL_REACH. */
export function tunnelMate(F: Factory, type: FacType, cx: number, cz: number, dir: number): Fac | undefined {
  if (type === 'tunnel') {
    for (const d of [dir, (dir + 3) % 6]) {
      let c: [number, number] = [cx, cz];
      for (let k = 1; k <= TUNNEL_REACH; k++) {
        c = neighbor(c[0], c[1], d);
        const q = F.facAt(c[0], c[1]);
        if (q && q.type === 'tunnel' && q.dir === dir && !q.pair) return q;
      }
    }
    return undefined;
  }
  let best: Fac | undefined, bd = Infinity;
  for (const q of F.facs) {
    if (q.type !== 'ptunnel' || q.pair || (q.cx === cx && q.cz === cz)) continue;
    const d = hexDist(cx, cz, q.cx, q.cz);
    if (d <= TUNNEL_REACH && d < bd && lineDir(cx, cz, q.cx, q.cz) >= 0) { bd = d; best = q; }
  }
  return best;
}

// ---------- supply connectors (see Factory.links) ----------
/** Height of the hatch an arm serves on a tower or building (and of a crate's chute), of a power socket, and how far in from the taker's centre either sits. */
const ARM_Y = 0.5, SOCK_Y = 0.78, TAKER_IN = 0.66;
/** Seconds a chute's light flashes for a take, an item token takes down the chute, and the flash of a put lasts. */
const FLASH_T = 0.45, TOKEN_T = 0.32, PUT_T = 0.34;
const MAX_LINKS = 512, MAX_TOKENS = 64, MAX_MARK = 96, MAX_LVL = 256, MAX_PUT = 48;
const SCAN_AMBER = new THREE.Color(0xf2a54a), SOCK_GREEN = new THREE.Color(0x9ccf6a);
/** A chute along +z from the origin, one unit long (scaled to its length): a supply crate's slide into the tower beside it. */
const G_ARM = () => geo('arm', () => merge([new THREE.BoxGeometry(0.17, 0.11, 1).translate(0, 0, 0.5), ...[-1, 1].map((s) => new THREE.BoxGeometry(0.03, 0.05, 1).translate(s * 0.085, 0.065, 0.5))]));
const G_ARM_LIGHT = () => geo('armLight', () => new THREE.BoxGeometry(0.07, 0.02, 0.92).translate(0, 0.06, 0.5));
/** The hatch or socket on a tower or building (facing +z): where an arm puts items in or takes them out, where a drop cable ends. */
const G_SOCK = () => geo('sock', () => merge([new THREE.BoxGeometry(0.22, 0.22, 0.1).translate(0, 0, 0.05), new THREE.BoxGeometry(0.28, 0.05, 0.14).translate(0, -0.13, 0.04)]));
const G_SOCK_LIGHT = () => geo('sockLight', () => new THREE.BoxGeometry(0.12, 0.06, 0.03).translate(0, 0.04, 0.11));
/** The flash of a put: a soft ring with a bright middle, drawn additively on the spot the item landed. */
function putTexture(): THREE.Texture {
  const S = 64, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!, gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.25)'); gr.addColorStop(0.62, 'rgba(255,255,255,0.05)');
  gr.addColorStop(0.78, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.9, 'rgba(255,255,255,0.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}
/** The branch from a pipe tile's edge into the consumer beside it (along +z from the pipe tile's centre): glass, core, steel. */
const BR_A = 0.96, BR_B = 1.36;
const G_BRANCH = () => geo('branch', () => merge([lying(new THREE.CylinderGeometry(PR, PR, BR_B - BR_A, 14)).translate(0, PY, (BR_A + BR_B) / 2)]));
const G_BRANCH_CORE = () => geo('branchCore', () => mergeK([flTag(lying(new THREE.CylinderGeometry(KR, KR, BR_B - BR_A, 12, 1, true)).translate(0, PY, (BR_A + BR_B) / 2), 6, HY0, HY1, (_x, z) => z)]));
const G_BRANCH_FIT = () => geo('branchFit', () => merge([
  lying(new THREE.CylinderGeometry(PR + 0.05, PR + 0.05, 0.05, 14)).translate(0, PY, 1.02),
  lying(new THREE.CylinderGeometry(PR + 0.07, PR + 0.07, 0.07, 14)).translate(0, PY, BR_B),
  lying(new THREE.CylinderGeometry(PR + 0.035, PR + 0.035, 0.12, 14)).translate(0, PY, BR_B - 0.08),
  new THREE.BoxGeometry(0.05, PY - PR, 0.05).translate(0, (PY - PR) / 2, 1.18),
]));
/** A flat hex ring and a unit box, for the placement previews and level marks. */
const G_HEX_RING = () => geo('hexRing', () => new THREE.RingGeometry(HEX_SIZE * 0.84, HEX_SIZE * 0.97, 6, 1, Math.PI / 6).rotateX(-Math.PI / 2));
const G_BOX = () => geo('unitBox', () => new THREE.BoxGeometry(1, 1, 1));
/** Level marks on an upgraded building: a band round its base and a pip per level on its front corner. */
const G_BAND = () => geo('lvlBand', () => new THREE.CylinderGeometry(HEX_SIZE * 0.93, HEX_SIZE * 0.93, 0.055, 6, 1, true).translate(0, 0.205, 0));
const G_PIP = () => geo('lvlPip', () => new THREE.OctahedronGeometry(0.075, 0).scale(1, 0.7, 1));
const LVL_COLOR = [0, 0, 0xd8b06a, 0xffd27a];

// ---------- Transfer Arms ----------
// Every arm on the map is drawn from the same few parts (the model's nodes, see tools/blender/fac_arm.py: pad, turntable,
// upper arm, forearm, wrist, finger), one instanced mesh per part and material, so a hundred arms cost the draw calls of
// one. The chain is posed here: the hand's place round the arm's axis (turn, reach, height) follows a path from the pick
// point to the drop point with Fac.prog, sprung so it has weight, and a two-link IK folds the arm to it with the hand
// hanging straight down.
/** The parts in drawing order (the finger is drawn twice per arm, the second turned half round). */
const ARM_NODES = ['base', 'turn', 'upper', 'fore', 'wrist', 'fingerL'];
const P_BASE = 0, P_TURN = 1, P_UPPER = 2, P_FORE = 3, P_WRIST = 4, P_FINGER = 5;
/** The joints as modelled (read from the model's nodes when it is loaded): the turntable's seat, the shoulder above it, the
 *  two links, and where a finger sits on the palm rail (x: with the hand closed on nothing, y: below the wrist's axis). */
interface ArmDim { turnY: number; shY: number; L1: number; L2: number; fx: number; fy: number }
const ARM_DIM: ArmDim = { turnY: 0.13, shY: 0.49, L1: 1.08, L2: 1.06, fx: 0.17, fy: 0.14 };
/** How far below the wrist's axis an item's foot hangs, and how far from the hand's middle a finger closes on each shape. */
const GRIP = 0.42;
const GRIP_OF: Partial<Record<Shape, number>> = { cell: 0.5 };
const GAP_OF: Record<Shape, number> = { ore: 0.22, coal: 0.21, plate: 0.19, frame: 0.19, crate: 0.2, shell: 0.115, slug: 0.135, cell: 0.14, missile: 0.09 };
/** How far a finger opens beyond its grip, where the hand rests while time stands still (reach, height), how high it carries, how low it hangs when it has nothing to do. */
const ARM_OPEN = 0.075, ARM_REST_R = 1.0, ARM_REST_Y = 0.58, ARM_CARRY_Y = 1.02, ARM_SLUMP_R = 0.6, ARM_SLUMP_Y = 0.22;
/** What stands behind or in front of an arm (see FacView.armEnds). */
const E_NONE = 0, E_BELT = 1, E_SPLIT = 2, E_TUNNEL = 3, E_ARM = 4, E_FAC = 5, E_TOWER = 6;
const ITEM_BIT = Object.fromEntries(ITEM_TYPES.map((t, i) => [t, 1 << i])) as Record<ItemType, number>;
/** One arm's pose and what it is doing. */
interface ArmRig {
  /** its slot in the instanced parts, the layout its ends were worked out for, what stands behind / in front */
  slot: number; rev: number; src: number; dst: number; q: Fac | null;
  /** the hand as drawn: its turn about the arm's axis (radians from the back side), reach and height, and their speeds */
  yaw: number; r: number; y: number; vyaw: number; vr: number; vy: number; init: boolean;
  /** fingers 0 closed .. 1 open, the jolt of a release, seconds it has had nothing to do, seconds since it picked */
  open: number; kick: number; wait: number; since: number; had: ItemType | null;
  /** pick and drop points (world) */
  px: number; py: number; pz: number; dx: number; dy: number; dz: number;
  /** the status lamp as last written (colour * 8 + step of brightness) */
  lamp: number;
  /** the direction the arm faced last frame (yaw is kept about it: a turn mid-swing carries the hand over, see syncArms) */
  dir: number;
}
const newRig = (): ArmRig => ({ slot: -1, rev: -1, src: 0, dst: 0, q: null, yaw: 0, r: ARM_REST_R, y: ARM_REST_Y, vyaw: 0, vr: 0, vy: 0, init: false, open: 1, kick: 0, wait: 0, since: 9, had: null, px: 0, py: 0, pz: 0, dx: 0, dy: 0, dz: 0, lamp: -1, dir: -1 });
/** The instanced parts of all arms: per part its meshes (one per material), and the lamps (coloured per arm). */
interface ArmBatch { model: boolean; cap: number; parts: THREE.InstancedMesh[][]; lamp: THREE.InstancedMesh; dim: ArmDim; own: (THREE.BufferGeometry | THREE.Material)[] }
const sstep = (a: number, b: number, x: number) => { const k = sat01((x - a) / (b - a)); return k * k * (3 - 2 * k); };

// ---------- the view ----------
interface Glow { m: THREE.MeshStandardMaterial; i0: number }
interface Feed { d: number; id: number; head: BeltItem | null; n: number }
interface FVis {
  obj: THREE.Group; type: FacType; seen: number; dir: number;
  /** built from the model file (false: from plain shapes) */
  model: boolean;
  /** parts that move: a drill head, fan or splitter diverter (spin, about y), a pump beam (arm: rocks about x for models, z for shapes), a bobbing part */
  spin: THREE.Object3D | null; arm: THREE.Object3D | null; armX: boolean; work: THREE.Object3D | null; workY: number;
  /** pumpjack linkage (model only): the pitman arms hang from the beam, the crank turns under them */
  pitman: THREE.Object3D | null; crank: THREE.Object3D | null;
  /** the moving parts' phase (radians) and their speed 0..1, eased so machines spin up and run down instead of snapping */
  ph: number; spd: number;
  /** status lamp materials (recoloured), working lights (dimmed while idle), and materials this building owns (disposed with it) */
  lamps: THREE.MeshStandardMaterial[]; glows: Glow[]; own: THREE.Material[];
  /** the colour and intensity last given to the status lamps (-1: not yet), so an unchanged lamp is not written every frame */
  lampC: number; lampI: number;
  /** belts: the ribbon (only the ghost has a mesh of its own: placed belts are drawn instanced, see syncBelts), its entry side
   *  and shape (k = exit - entry), and its end drums */
  belt: THREE.Mesh | null; e: number; k: number; caps: number;
  /** a belt with several feeders (and every splitter): each feeder's side (a belt gets an inlet stub there unless it is the
   *  straight-on back side), its id, and what it held last frame (its front item, a producer's output count) to tell which
   *  one handed over a new item */
  feeds: Feed[] | null;
  /** a splitter: the sides with a belt stub, as side + 8 for a belt leading away (see layoutBelts) */
  stubs: number[] | null;
  /** a belt tunnel: whether it was built as the exit end */
  ex: boolean;
  /** a modelled splitter: its turntable and the kerbs that close each side (hidden where a belt joins); a modelled belt
   *  tunnel: how brightly its mouth flares (an item passing through) */
  turn: THREE.Object3D | null; gates: (THREE.Object3D | undefined)[] | null; flare: number;
  /** pipes and pipe tunnels: the four meshes (glass, fluid, fittings, valve), the side mask they were built for, the fluid in
   *  them (0 none, else 1 + its index in FLUID_TYPES) and the one a shaft's pit light was last coloured for, the tile's
   *  distance from the pump along its network and which of its sides lead upstream (a bit each; see pipeFlow) */
  pipe: THREE.Mesh[]; mask: number; fluidKey: number; glowK: number; fD: number; fMask: number;
  /** a Transfer Arm: its pose (the arm itself is drawn instanced, see syncArms) */
  rig: ArmRig | null;
}
/** A pipe network as the view reads it (factory.ts keeps the type to itself). */
interface PNet { pipes: Fac[]; fluid: FluidType | null; amt: number; cap: number; prod: Fac[]; cons: Fac[]; towers: unknown[]; forced: FluidType | null }
const FLUID_OF: Partial<Record<FacType, FluidType>> = { pump: 'crude', refinery: 'petrol' };
const wrapPi = (a: number) => a - Math.round(a / TAU) * TAU;

export class FacView {
  private group = new THREE.Group();
  private sim: Sim | null = null;
  private models: () => Record<string, THREE.Object3D>;
  private vis = new Map<number, FVis>();
  private frame = 0;
  /** deposits: the stain decals, and (made once the models are loaded, see depModels) each kind's bodies, rim rubble and the
   *  oil pool (see DepBatch); the oil pools' bubbles, what covers each tile (0 nothing, 1 a building, 2 a mine or pumpjack:
   *  pieces on a built tile are hidden, they would poke through it), and whether the pieces have to be posed again (build-up
   *  running or just over, buildings changed) */
  private deps: DepBatch[] = []; private depB: Record<string, DepBatch> = {}; private depReady = false;
  private bubbles: THREE.InstancedMesh; private oilTiles: number[] = []; private oilT = { value: 0 };
  private cover = new Uint8Array(GW * GH); private depPose = true; private depIntro = false;
  private tileX = new Float32Array(GW * GH); private tileZ = new Float32Array(GW * GH);
  /** the hovered deposit patch: the tile, its outline (a bright line and a fading light curtain on the patch's border), tile rings */
  private hlKey = -1; private hlEdge: THREE.InstancedMesh; private hlCurtain: THREE.InstancedMesh; private hlRing: THREE.InstancedMesh; private hlFill: THREE.InstancedMesh;
  private hlMats: THREE.MeshBasicMaterial[] = [];
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  /** the build-up as handed to sync (null when the deck stands): the connectors and items follow it too (see revealPass) */
  private rv: ((x: number, z: number) => number) | null = null; private rvWas = false;
  private items = new THREE.Group();
  private itemMeshes: Record<Shape, { mesh: THREE.InstancedMesh; tint: boolean }[]>;
  private itemN: Record<Shape, number>;
  private wires: THREE.Mesh; private wireKey = -1;
  private ghost = new THREE.Group(); private ghostKey = ''; private ghostVis: FVis | null = null;
  private ghostMat = new THREE.MeshStandardMaterial({ color: 0xcfc8a4, transparent: true, opacity: 0.55, emissive: 0xe3dc92, emissiveIntensity: 0.15, depthWrite: false });
  // (amber, not the ghost's cream: it has to stand out against the pale body as well as the deck)
  private ghostArrow = new THREE.MeshBasicMaterial({ color: 0xffa62b, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
  private sparks: { x: number; z: number; t: number }[] = [];
  /** the glint over a Depot when a Frame arrives: a few sand diamonds that rise, spread and fade */
  private glint: THREE.InstancedMesh;
  private M = new THREE.Matrix4(); private Q = new THREE.Quaternion(); private S = new THREE.Vector3(); private P = new THREE.Vector3(); private C = new THREE.Color(); private E = new THREE.Euler();
  private V1 = new THREE.Vector3(); private V2 = new THREE.Vector3(); private Z = new THREE.Vector3(0, 0, 1);
  private pt: PathPt = { x: 0, z: 0, tx: 0, tz: 0 }; private P2 = { x: 0, z: 0 }; private M2 = new THREE.Matrix4(); private M3 = new THREE.Matrix4();
  /** the deck's height under a tower (the factory's own tiles lie at 0) */
  private deck: (x: number, z: number) => number;
  /** belts: the tread texture, its materials, how far it has run (tiles), and the layout the belt shapes were worked out for */
  private tread: THREE.Texture;
  private beltMats: THREE.Material[];
  /** placed belts and their inlet stubs, one instanced pair per geometry: the body (tread and frame, casts shadows) and the
   *  rail light (no shadow); a hidden material stands in for the other pair's groups, which the renderer then skips */
  private beltBody: THREE.Material[]; private beltLight: THREE.Material[];
  private beltBatches = new Map<THREE.BufferGeometry, { body: THREE.InstancedMesh; light: THREE.InstancedMesh; n: number }>();
  private beltDirty = true; private beltScaled = false;
  /** the side each item came in by (items on a belt with several feeders, and in a splitter) */
  private inSide = new WeakMap<BeltItem, number>();
  private run = 0; private lastT = -1; private layout = -1;
  /** the belt items stand as the last syncItems() put them (time stands still and the layout has not changed since) */
  private itemsStill = false;
  /** this frame's dt and time for animate(), and the place and heading of the next item for putItem() (x, y, z, tx, tz) */
  private aDt = 0; private aTime = 0; private ip = new Float64Array(5);
  /** the factory's rev when the wires were last checked */
  private wireRev = -1;
  /** whether the factory runs this frame (it stands still between waves: nothing moves on the belts, machines idle) */
  private live = true;
  private pipeFit = mat(0x77706a, 'dark'); private pipeValve = new THREE.MeshStandardMaterial({ color: 0x9a2f1e, roughness: 0.45, metalness: 0.4 });
  /** pipes: the state texture every pipe's fluid is drawn from (see syncPipes), the glass and the fluid, each network's
   *  state by its first pipe's id (the level shown, how far its fluid has run, how much it flows 0..1, its amount last frame,
   *  its fluid), the sim seconds that passed this frame, the networks last seen */
  private pipeData = new Float32Array(PT_W * PT_H * 4); private pipeTex = pipeTexture(this.pipeData);
  private glass = glassMat(this.pipeTex); private fluid = fluidMat(this.pipeTex);
  private pipeSt = new Map<number, { shown: number; phase: number; act: number; last: number; kind: number; seen: number }>(); private simDt = 0; private nets: unknown = null;
  /** Transfer Arms: the instanced parts, what the hands hold this frame (x, y, z and heading per item), whether a hand still moves */
  private arms: ArmBatch | null = null; private heldIt: ItemType[] = []; private heldP = new Float32Array(64 * 5); private heldN = 0; private armMoving = false;
  /** per arm id: the hatch it takes out of and the one it puts into (socket slots), and the flashes of the last puts */
  private armIn = new Map<number, number>(); private armOut = new Map<number, number>();
  private putFx: THREE.InstancedMesh; private putP = new Float32Array(MAX_PUT * 4); private putC = new Int32Array(MAX_PUT); private nPut = 0;
  /** supply connectors: the chute from a supply crate to the tower beside it, hatches and sockets, pipe branches, and the power drop cables */
  private chute: THREE.InstancedMesh; private chuteLight: THREE.InstancedMesh;
  private sock: THREE.InstancedMesh; private sockLight: THREE.InstancedMesh;
  private branch: THREE.InstancedMesh; private branchCore: THREE.InstancedMesh; private branchFit: THREE.InstancedMesh;
  private drops: THREE.Mesh;
  private linkRef: unknown = null; private linkLayout = -1;
  /** per crate chute: its two ends (x, y, z), and how bright its flash still is */
  private nScan = 0; private chuteA = new Float32Array(MAX_LINKS * 3); private chuteB = new Float32Array(MAX_LINKS * 3); private flash = new Float32Array(MAX_LINKS);
  /** towers ('t' + id) to the chutes of the crates beside them, to light the right one on a 'take', and each chute's crate (x, z) */
  private takers = new Map<string, number[]>(); private scanAt = new Float32Array(MAX_LINKS * 2);
  /** takers to their sockets (the hatches arms and chutes serve, and power drops), each socket's flare (see flashTaker) and whether it is a power socket */
  private sockOf = new Map<string, number[]>(); private sockFlash = new Float32Array(MAX_LINKS * 2); private sockPower = new Uint8Array(MAX_LINKS * 2);
  private nBranch = 0;
  /** items sliding down a chute after a take: link, age, colour */
  private tokens: THREE.InstancedMesh; private tokL = new Int16Array(MAX_TOKENS); private tokT = new Float32Array(MAX_TOKENS); private tokC = new Int32Array(MAX_TOKENS); private nTok = 0;
  /** the selected building's tile (the cues draw what it connects to: a pole's reach, a tunnel's partner) */
  private pvSel: { cx: number; cz: number } | null = null;
  /** per model name and level: the top of its meshes (see modelTop) */
  private tops = new Map<string, number>();
  /** level marks on upgraded buildings */
  private band: THREE.InstancedMesh; private pips: THREE.InstancedMesh; private lvlKey = -1;

  /** `deck`: the height of the deck at a world position (towers may stand on raised ground; the factory's tiles lie at 0). */
  constructor(scene: THREE.Scene, models: () => Record<string, THREE.Object3D> = () => ({}), deck: (x: number, z: number) => number = () => 0) {
    this.models = models; this.deck = deck;
    scene.add(this.group);
    // deposits: the stain decals now (they need no model), the modelled pieces when the models are there (see depModels)
    const T = (GW * GH) >> 1;
    for (const k of ORE_TYPES) {
      const b = this.depBatch('stain_' + k, G_HEXF, stainMat(k), false);
      // (the stains are see-through decals: kept out of the AO pre-pass, which would draw them as solid surfaces)
      b.mesh.layers.set(FX_LAYER);
    }
    this.bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 5, 0, TAU, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0a090d, roughness: 0.04, metalness: 0.2, envMapIntensity: 1.6 }), T * 3);
    this.bubbles.count = 0; this.bubbles.frustumCulled = false;
    this.group.add(this.bubbles);
    for (let i = 0; i < GW * GH; i++) { this.tileX[i] = cellX(i % GW, Math.floor(i / GW)); this.tileZ[i] = cellZ(Math.floor(i / GW)); }
    // the hover highlight: additive, in the ore's colour, drawn over the deck (not in the AO pass)
    const add = (o: number, vcol = false) => { const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, vertexColors: vcol }); this.hlMats.push(m); return m; };
    const hl = (g: THREE.BufferGeometry, m: THREE.Material, n: number) => { const o = new THREE.InstancedMesh(g, m, n); o.count = 0; o.frustumCulled = false; o.layers.set(FX_LAYER); o.renderOrder = 3; o.setColorAt(0, this.C.setHex(0xffffff)); scene.add(o); return o; };
    this.hlEdge = hl(G_BOX(), add(0.95), MAX_HL);
    this.hlCurtain = hl(geo('hlCurtain', () => {
      const g = new THREE.PlaneGeometry(1, 1, 1, 4).translate(0, 0.5, 0), p = g.getAttribute('position'), c = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { const k = Math.pow(1 - (p.getY(i)), 2.2); c.set([k, k, k], i * 3); }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      return g;
    }), add(0.55, true), MAX_HL);
    this.hlRing = hl(G_HEX_RING(), add(0.5), MAX_MARK);
    this.hlFill = hl(G_HEXF, add(0.2), MAX_MARK);
    // items: one instanced mesh per part of each shape
    const parts = itemParts();
    this.itemMeshes = {} as typeof this.itemMeshes; this.itemN = {} as typeof this.itemN;
    for (const s of SHAPES) {
      this.itemN[s] = 0;
      this.itemMeshes[s] = parts[s].map((p) => {
        const mesh = new THREE.InstancedMesh(p.geo, p.mat, MAX_ITEMS);
        mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
        if (p.tint) mesh.setColorAt(0, this.C.setHex(0xffffff));
        this.items.add(mesh);
        return { mesh, tint: p.tint };
      });
    }
    this.group.add(this.items);
    // cables: thin tubes (a 1-pixel line flickers and vanishes at play zoom), dark steel that catches the light along its sag
    const wireMat = new THREE.MeshStandardMaterial({ color: 0x6e665a, roughness: 0.38, metalness: 0.75 });
    this.wires = new THREE.Mesh(new THREE.BufferGeometry(), wireMat);
    this.wires.frustumCulled = false; this.wires.castShadow = true;
    this.group.add(this.wires);
    this.ghost.visible = false;
    scene.add(this.ghost);
    this.glint = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.075, 0).scale(1, 1.6, 1), new THREE.MeshBasicMaterial({ color: 0xfff0b0 }), 60);
    this.glint.count = 0; this.glint.frustumCulled = false;
    this.group.add(this.glint);
    this.tread = treadTexture();
    this.beltMats = [
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.tread, emissive: 0xe3dc92, emissiveMap: this.tread, emissiveIntensity: 0.1, roughness: 0.85, metalness: 0.05 }),
      new THREE.MeshStandardMaterial({ color: 0x5d564d, roughness: 0.42, metalness: 0.85 }),
      new THREE.MeshStandardMaterial({ color: 0x3a2a14, emissive: 0xf2a54a, emissiveIntensity: 0.32, roughness: 0.4 }),
    ];
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    this.beltBody = [this.beltMats[0], this.beltMats[1], hidden];
    this.beltLight = [hidden, hidden, this.beltMats[2]];
    // supply connectors and previews: instanced, filled when the layout changes
    const inst = (g: THREE.BufferGeometry, m: THREE.Material, n: number, shadow = false, tint = false, parent: THREE.Object3D = this.group) => {
      const o = new THREE.InstancedMesh(g, m, n);
      o.count = 0; o.frustumCulled = false; o.castShadow = shadow; o.receiveShadow = shadow;
      if (tint) o.setColorAt(0, this.C.setHex(0xffffff));
      parent.add(o);
      return o;
    };
    const steel = mat(0x6a6157, 'dark'), lit = () => new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.chute = inst(G_ARM(), steel, MAX_LINKS, true);
    this.chuteLight = inst(G_ARM_LIGHT(), lit(), MAX_LINKS, false, true);
    this.sock = inst(G_SOCK(), mat(0x37322d, 'dark'), MAX_LINKS * 2, true);
    this.sockLight = inst(G_SOCK_LIGHT(), lit(), MAX_LINKS * 2, false, true);
    this.branch = inst(G_BRANCH(), this.glass, MAX_LINKS);
    this.branchCore = inst(G_BRANCH_CORE(), this.fluid, MAX_LINKS);
    this.branchFit = inst(G_BRANCH_FIT(), this.pipeFit, MAX_LINKS, true);
    this.branch.layers.set(FX_LAYER);
    this.drops = new THREE.Mesh(new THREE.BufferGeometry(), wireMat);
    this.drops.frustumCulled = false; this.drops.castShadow = true;
    this.group.add(this.drops);
    this.tokens = inst(new THREE.OctahedronGeometry(0.075, 0), lit(), MAX_TOKENS, false, true);
    this.putFx = inst(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: putTexture(), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), MAX_PUT, false, true);
    this.putFx.layers.set(FX_LAYER); this.putFx.renderOrder = 4;
    this.band = inst(G_BAND(), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), MAX_LVL, false, true);
    this.pips = inst(G_PIP(), lit(), MAX_LVL * 3, false, true);
  }

  setSim(sim: Sim | null) {
    this.sim = sim;
    for (const v of this.vis.values()) this.drop(v);
    this.vis.clear(); this.wireKey = -1; this.itemsStill = false; this.sparks.length = 0; this.glint.count = 0; this.layout = -1; this.lastT = -1;
    for (const s of SHAPES) for (const p of this.itemMeshes[s]) p.mesh.count = 0;
    for (const b of this.deps) { b.n = 0; b.mesh.count = 0; }
    this.oilTiles.length = 0; this.bubbles.count = 0; this.cover.fill(0); this.depPose = true; this.hlKey = -2; this.setOreHover(0, 0, false);
    for (const b of this.beltBatches.values()) { b.n = 0; b.body.count = 0; b.light.count = 0; }
    this.beltDirty = true; this.nets = null; this.linkRef = null; this.linkLayout = -1; this.lvlKey = -1; this.nTok = 0; this.tokens.count = 0;
    this.pvSel = null; this.nPut = 0; this.putFx.count = 0; this.heldN = 0; this.pipeSt.clear(); this.pipeData.fill(0); this.pipeTex.needsUpdate = true;
    if (this.arms) { for (const ms of this.arms.parts) for (const m of ms) m.count = 0; this.arms.lamp.count = 0; }
    this.setGhost(null);
    if (!sim) { this.clearLinks(); this.band.count = this.pips.count = 0; return; }
    this.buildDeps(sim);
  }

  handle(evs: Ev[]) {
    for (const e of evs) {
      if (e.k === 'mats') this.sparks.push({ x: e.x, z: e.z, t: 0 });
      else if (e.k === 'take') this.took(e.who, e.x, e.z, e.it, e.id);
      else if (e.k === 'put') this.putDown(e.x, e.z, e.it);
      else if (e.k === 'lost') this.putDown(e.x, e.z, e.it, true);
    }
  }
  /** An item was taken. By an arm (who: 'f' + its id): the hatch it took it out of lights up (the arm itself is posed from
   *  its state). By a tower from the supply crate beside it: that crate's chute flashes and a token of the item's colour
   *  slides down it. */
  private took(who: string, x: number, z: number, it: ItemType, id: number) {
    if (who[0] === 'f') { const k = this.armIn.get(id); if (k !== undefined) this.sockFlash[k] = 1; return; }
    const l = this.takers.get(who);
    if (!l || !l.length) return;
    let i = l[0];
    for (const j of l) if (Math.abs(this.scanAt[j * 2] - x) < 0.01 && Math.abs(this.scanAt[j * 2 + 1] - z) < 0.01) { i = j; break; }
    this.flash[i] = 1;
    if (this.nTok >= MAX_TOKENS) return;
    const k = this.nTok++;
    this.tokL[k] = i; this.tokT[k] = 0; this.tokC[k] = ITEMS[it]?.color ?? 0xffffff;
  }
  /** The arm on (x, z) put an item down: a flash in the item's colour where it landed, and the hatch it went into lights up.
   *  `lost`: its target no longer takes the item it held (turned, sold, switched ammunition) and it let it go: a red flash, no hatch. */
  private putDown(x: number, z: number, it: ItemType, lost = false) {
    const [cx, cz] = worldToCell(x, z), a = this.sim?.factory.facAt(cx, cz), g = a && this.vis.get(a.id)?.rig;
    if (!a || !g) return;
    const k = lost ? undefined : this.armOut.get(a.id);
    if (k !== undefined) this.sockFlash[k] = 1;
    if (this.nPut >= MAX_PUT) return;
    const n = this.nPut++;
    // (on a belt the ring lies round the item; at a hatch it stands out from the wall a little, toward the arm)
    this.putP[n * 4] = g.dx; this.putP[n * 4 + 1] = g.dy + (g.dst === E_FAC || g.dst === E_TOWER ? 0.12 : 0.03); this.putP[n * 4 + 2] = g.dz; this.putP[n * 4 + 3] = 0;
    this.putC[n] = lost ? 0xff4636 : it === 'coal' ? 0x8a8378 : ITEMS[it]?.color ?? 0xffffff;
  }

  /** A supply route has just reached a tower or building ('t' + id / 'f' + id): its sockets flare (item: true the hatches
   *  arms put into and the chutes of the crates beside it, false its power socket). */
  flashTaker(key: string, item: boolean) {
    for (const i of this.sockOf.get(key) || []) if (!!this.sockPower[i] !== item) this.sockFlash[i] = 1;
    if (item) for (const i of this.takers.get(key) || []) this.flash[i] = 1;
  }
  /** The point at p (0 entry edge .. 1 exit edge) on a placed belt's path, in world x / z; false when it runs straight. */
  beltPoint(f: Fac, p: number, out: { x: number; z: number }): boolean {
    const v = this.vis.get(f.id);
    if (!v || v.k < 0 || f.type !== 'belt') { out.x = f.x + DX[f.dir] * (2 * p - 1); out.z = f.z + DZ[f.dir] * (2 * p - 1); return true; }
    const P = PATHS[v.k], pt = pathAt(P, p, this.pt), c = DX[v.e], s = DZ[v.e];
    out.x = f.x + pt.x * c - pt.z * s; out.z = f.z + pt.x * s + pt.z * c;
    return P.straight;
  }

  /** The ghost of a factory building where it would go (null hides it); what it would connect to is the cues' (CueView.setTool). */
  setGhost(type: FacType | null, cx = 0, cz = 0, dir = 0, ok = true) {
    this.ghost.visible = !!type && ok;
    if (!type) return;
    const key = type + ':' + dir + ':' + (this.modelOf(type) ? 'm' : 's');
    if (key !== this.ghostKey) {
      if (this.ghostVis) { this.ghost.remove(this.ghostVis.obj); for (const m of this.ghostVis.own) m.dispose(); }
      const v = this.build(type, dir, true);
      if (type === 'belt') this.shapeBelt(v, (dir + 3) % 6, 3, 3);
      if (pipeLike(type)) this.shapePipe(v, 0, 0, 0);
      v.obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = this.ghostMat; m.castShadow = false; } });
      if (v.pipe.length) v.pipe[1].visible = false;
      // the way it will run, which R turns: a bright chevron over the belt
      // (an arm's way is drawn by the cues: an arrow through its tile from what it would take to where it would put it)
      if (turns(type) && type !== 'arm') {
        const holder = new THREE.Group(); holder.rotation.y = yawOf(dir);
        for (const z of type === 'belt' ? [-0.45, 0.25] : [-0.75, 0.75]) { const ch = new THREE.Mesh(G_CHEV, this.ghostArrow); ch.position.set(0, type === 'belt' ? Y_RAIL + 0.04 : 1.0, z); ch.scale.setScalar(1.05); ch.renderOrder = 5; holder.add(ch); }
        v.obj.add(holder);
      }
      // (see-through: kept out of the AO pre-pass like the tower ghost, or it would shade the deck under it as a solid)
      v.obj.traverse((o) => o.layers.set(FX_LAYER));
      this.ghost.add(v.obj);
      this.ghostVis = v; this.ghostKey = key;
    }
    this.ghost.position.set(cellX(cx, cz), 0, cellZ(cz));
  }
  /** The factory building selected on a tile (on false clears it): the cues show a pole's or generator's reach and what it powers, a tunnel's partner. */
  setSelected(cx: number, cz: number, on: boolean) { this.pvSel = on ? { cx, cz } : null; }
  /** The tile of the selected building, or null. */
  selectedCell(): { cx: number; cz: number } | null { return this.pvSel; }
  /**
   * The top of a loaded model in its own units ('tower_pulse', 'fac_mine', ...): the highest point of its meshes, the parts
   * of a higher level than `lvl` and the power node's emblem left out. 0 when the model is not loaded.
   */
  modelTop(name: string, lvl = 1): number {
    const key = name + ':' + lvl, hit = this.tops.get(key);
    if (hit !== undefined) return hit;
    const m = this.models()[name];
    if (!m || !m.children.length) return 0;
    let top = 0;
    const box = new THREE.Box3();
    m.updateWorldMatrix(true, true);
    const inv = this.M.copy(m.matrixWorld).invert(), L = new THREE.Matrix4();
    m.traverse((o) => {
      const me = o as THREE.Mesh;
      if (!me.isMesh) return;
      for (let p: THREE.Object3D | null = o; p && p !== m; p = p.parent) { const l = /^lvl([23])(_|$)/.exec(p.name); if (p.name === 'node' || (l && +l[1] > lvl)) return; }
      if (!me.geometry.boundingBox) me.geometry.computeBoundingBox();
      box.copy(me.geometry.boundingBox!).applyMatrix4(L.multiplyMatrices(inv, me.matrixWorld));
      top = Math.max(top, box.max.y);
    });
    this.tops.set(key, top);
    return top;
  }

  /** The loaded model for a building type, or null (not loaded yet, or the file is missing: then an empty stand-in). */
  private modelOf(type: FacType): THREE.Object3D | null {
    const m = this.models()[MODEL_KEY[type]];
    return m && m.children.length ? m : null;
  }
  private drop(v: FVis) {
    this.group.remove(v.obj);
    for (const m of v.own) m.dispose();
  }

  /** Build the shapes of one building (a belt tunnel: as its entrance or its exit end). */
  private build(type: FacType, dir: number, ghost = false, exit = false): FVis {
    const g = new THREE.Group();
    const v: FVis = {
      obj: g, type, seen: 0, dir, model: false, spin: null, arm: null, armX: false, work: null, workY: 0, pitman: null, crank: null, ph: Math.random() * TAU, spd: 0, lamps: [], lampC: -1, lampI: -1, glows: [], own: [],
      belt: null, e: -1, k: -1, caps: -1, feeds: null, stubs: null, ex: exit, turn: null, gates: null, flare: 0, pipe: [], mask: -1, fluidKey: 0, glowK: -1, fD: 0, fMask: 0, rig: null,
    };
    // (a placed arm has no meshes of its own: syncArms draws them all instanced; only the ghost is a copy of the model)
    if (type === 'arm' && !ghost) return v;
    const src = DRAWN_HERE.has(type) ? null : this.modelOf(type);
    if (src) this.fromModel(v, src, ghost);
    else this.fromShapes(v, ghost);
    return v;
  }

  /** A building from its model: shared geometry, its own copies of the lights that change with its state. */
  private fromModel(v: FVis, src: THREE.Object3D, ghost: boolean) {
    const m = src.clone(true);
    v.obj.add(m);
    v.model = true;
    const out = MAKES[v.type]?.out;
    const mine = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || ghost) return;
      const sm = mesh.material as THREE.MeshStandardMaterial;
      if (!sm || Array.isArray(sm) || (sm.name !== 'glow_work' && sm.name !== 'glow_lamp')) return;
      let c = mine.get(sm);
      if (!c) {
        c = sm.clone(); mine.set(sm, c); v.own.push(c);
        if (sm.name === 'glow_lamp') v.lamps.push(c);
        else {
          if (out && v.type === 'press') { c.emissive.setHex(ITEMS[out].color); c.color.setHex(ITEMS[out].color).multiplyScalar(0.25); } // the press glows in the colour of its shells
          // lit bays and windows are large faces: at full strength they bloom into one blown-out block
          v.glows.push({ m: c, i0: c.emissiveIntensity * (WORK_GLOW[v.type] ?? 1) });
        }
      }
      mesh.material = c;
    });
    v.spin = m.getObjectByName('spin') || null;
    v.arm = m.getObjectByName('arm') || null; v.armX = true;
    v.pitman = m.getObjectByName('pitman') || null; v.crank = m.getObjectByName('crank') || null;
    v.work = m.getObjectByName('work') || null;
    if (v.work) v.workY = v.work.position.y;
    switch (v.type) {
      case 'arm': m.rotation.y = yawOf(v.dir); break; // (the ghost, in the model's rest pose: leaning over to where it will put things)
      case 'splitter': {
        v.turn = m.getObjectByName('turn') || null;
        v.gates = [0, 1, 2, 3, 4, 5].map((d) => m.getObjectByName('gate' + d));
        break;
      }
      case 'tunnel': {
        // the model is the entrance, its items running toward its front (+z): turned to the tunnel's way, and half round for
        // the exit; the roof chevrons of the other end are hidden, the black inside is unlit, and the ramp is the belts' own
        m.rotation.y = yawOf(v.dir) + (v.ex ? Math.PI : 0);
        const hide = m.getObjectByName(v.ex ? 'arrow_in' : 'arrow_out');
        if (hide) hide.visible = false;
        if (!ghost) m.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh && (mesh.material as THREE.Material).name === 'void') { mesh.material = VOID; mesh.castShadow = false; } });
        const holder = new THREE.Group(); holder.rotation.y = (-((v.dir + 3) % 6) * Math.PI) / 3; v.obj.add(holder);
        const ramp = new THREE.Mesh(v.ex ? RAMP_OUT() : RAMP_IN(), this.beltMats);
        ramp.castShadow = true; ramp.receiveShadow = true; holder.add(ramp);
        break;
      }
      case 'ptunnel': this.pipeParts(v); break;
    }
  }
  /** The four meshes of a pipe or pipe tunnel: glass (no shadow: it is clear), the fluid core, steel fittings, the valve;
   *  shaped by shapePipe once the neighbours are known. */
  private pipeParts(v: FVis) {
    const ms = [this.glass, this.fluid, this.pipeFit, this.pipeValve];
    for (let i = 0; i < 4; i++) { const o = new THREE.Mesh(G_HEXF, ms[i]); o.castShadow = i >= 2; o.receiveShadow = i >= 2; if (i === 0) o.layers.set(FX_LAYER); v.obj.add(o); v.pipe.push(o); }
  }

  /** A building from plain shapes (no model file). Geometry is cached, so nothing here needs freeing but the lights. */
  private fromShapes(v: FVis, ghost: boolean) {
    const { type, obj: g } = v;
    const c = FACS[type].color;
    const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = g) => {
      const o = new THREE.Mesh(geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
    };
    const cyl = (r0: number, r1: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 10, parent: THREE.Object3D = g) => {
      const o = new THREE.Mesh(geo(`c${r0},${r1},${h},${seg}`, () => new THREE.CylinderGeometry(r0, r1, h, seg)), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
    };
    const torus = (r: number, t: number, m: THREE.Material, seg = 16) => {
      const o = new THREE.Mesh(geo(`t${r},${t},${seg}`, () => new THREE.TorusGeometry(r, t, 6, seg)), m); g.add(o); return o;
    };
    const base = (h = 0.18) => { const o = cyl(HEX_SIZE * 0.86, HEX_SIZE * 0.9, h, mat(HULL, 'dark'), 0, h / 2, 0, 6); o.castShadow = false; };
    const own = (m: THREE.MeshStandardMaterial) => { if (!ghost) v.own.push(m); return m; };
    const lamp = (y: number, x = 0.42, z = 0.42) => { const m = own(new THREE.MeshStandardMaterial({ color: 0x222222, emissive: LAMP.ok, emissiveIntensity: 2 })); const o = new THREE.Mesh(G_LAMP, m); o.position.set(x, y, z); g.add(o); v.lamps.push(m); };
    const glow = (color: number, emissive: number, i0: number) => { const m = own(new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: i0 })); v.glows.push({ m, i0 }); return m; };
    switch (type) {
      case 'arm': {
        // (only the ghost comes here, while the model is not loaded: a pad, a mast and a boom toward the front)
        const h = new THREE.Group(); h.rotation.y = yawOf(v.dir); g.add(h);
        cyl(0.78, 0.8, 0.07, mat(HULL, 'dark'), 0, 0.035, 0, 6, h); cyl(0.3, 0.33, 0.2, mat(TRIM, 'dark'), 0, 0.17, 0, 12, h);
        box(0.17, 1.1, 0.14, mat(c), 0, 1.1, 0.1, h); box(0.13, 0.1, 0.9, mat(c), 0, 1.6, 0.5, h); box(0.5, 0.06, 0.1, mat(HULL, 'dark'), 0, 1.0, 0.95, h);
        break;
      }
      case 'belt': {
        // (a placed belt has no mesh of its own: syncBelts draws all of them instanced; the ghost gets one)
        if (!ghost) break;
        const mesh = new THREE.Mesh(beltGeo(3, false, false), this.beltMats);
        g.add(mesh); v.belt = mesh;
        break;
      }
      case 'pipe': case 'ptunnel': {
        this.pipeParts(v);
        break;
      }
      case 'splitter': {
        // a hex hub on a plinth with a turntable, an amber ring and a diverter blade that turns to the side it serves next
        const hub = cyl(HEX_SIZE * 0.5, HEX_SIZE * 0.56, 0.12, mat(HULL, 'dark'), 0, 0.06, 0, 6); hub.castShadow = false;
        cyl(0.42, 0.44, Y_SURF - 0.06, mat(TRIM, 'dark'), 0, 0.06 + (Y_SURF - 0.06) / 2, 0, 18);
        cyl(0.38, 0.38, 0.012, mat(0x23201d, 'dark'), 0, Y_SURF + 0.006, 0, 18);
        const ring = torus(0.43, 0.022, ghost ? mat(0xf2a54a, 'glow') : glow(0x3a2a14, 0xf2a54a, 1.4), 24); ring.rotation.x = Math.PI / 2; ring.position.y = Y_SURF + 0.01;
        const div = new THREE.Group(); div.position.y = Y_SURF; g.add(div); v.spin = div;
        box(0.07, 0.2, 0.72, mat(0xd8c48f), 0, 0.1, 0.06, div);
        box(0.09, 0.03, 0.5, mat(0xf2a54a, 'glow'), 0, 0.215, 0.1, div);
        box(0.16, 0.05, 0.16, mat(TRIM, 'dark'), 0, 0.2, 0, div);
        cyl(0.05, 0.05, 0.26, mat(TRIM, 'dark'), 0, 0.12, 0, 8, div);
        const tip = new THREE.Mesh(G_LAMP, mat(0xf2a54a, 'glow')); tip.scale.setScalar(0.45); tip.position.set(0, 0.2, 0.36); div.add(tip);
        break;
      }
      case 'tunnel': {
        // a ramp of belt down into a hooded portal (the entrance), or up out of one (the exit), facing its way; built in the
        // belts' frame (entry edge on +x, running toward -x), turned to its back side
        const holder = new THREE.Group(); holder.rotation.y = (-((v.dir + 3) % 6) * Math.PI) / 3; g.add(holder);
        const s = v.ex ? -1 : 1, ramp = new THREE.Mesh(v.ex ? RAMP_OUT() : RAMP_IN(), this.beltMats);
        ramp.castShadow = true; ramp.receiveShadow = true; holder.add(ramp);
        for (const [gm, m] of portalGeo(s)) { const o = new THREE.Mesh(gm, m === 'hood' ? mat(0x3d3832, 'dark') : m === 'trim' ? mat(TRIM, 'dark') : m === 'void' ? VOID : mat(0xf2a54a, 'glow')); o.castShadow = m !== 'void' && m !== 'glow'; o.receiveShadow = true; holder.add(o); }
        break;
      }
      case 'pole': {
        cyl(0.07, 0.1, POLE_Y - 0.1, mat(0x5a4a38), 0, (POLE_Y - 0.1) / 2, 0, 6);
        box(0.95, 0.08, 0.08, mat(TRIM, 'dark'), 0, POLE_Y - 0.18, 0);
        for (const s of [-1, 1]) cyl(0.045, 0.05, 0.14, mat(0x9ccf6a, 'glow'), s * POLE_ARM, POLE_Y - 0.07, 0, 6);
        lamp(POLE_Y + 0.05, 0, 0);
        break;
      }
      case 'mine': {
        base();
        box(1.1, 0.7, 1.1, mat(c), 0, 0.53, 0);
        box(0.3, 1.4, 0.3, mat(TRIM, 'dark'), -0.35, 1.0, -0.35); box(0.3, 1.4, 0.3, mat(TRIM, 'dark'), 0.35, 1.0, -0.35);
        box(1.0, 0.16, 0.3, mat(TRIM, 'dark'), 0, 1.7, -0.35);
        const head = new THREE.Group(); head.position.set(0, 1.1, 0.15); g.add(head); v.spin = head;
        cyl(0.24, 0.05, 0.7, mat(0xb8b0a0, 'dark'), 0, -0.3, 0, 8, head);
        for (let i = 0; i < 3; i++) { const b = box(0.06, 0.2, 0.5, mat(0xe3dc92, 'glow'), 0, 0.05, 0, head); b.rotation.y = (i * TAU) / 3; }
        lamp(1.25, 0.45, 0.45);
        break;
      }
      case 'pump': {
        base();
        box(0.5, 1.2, 0.5, mat(c), -0.35, 0.78, 0);
        const arm = new THREE.Group(); arm.position.set(-0.35, 1.45, 0); g.add(arm); v.arm = arm;
        box(1.6, 0.16, 0.2, mat(TRIM, 'dark'), 0.2, 0, 0, arm);
        box(0.3, 0.45, 0.3, mat(0x2a2620, 'dark'), 0.95, -0.25, 0, arm);
        cyl(0.18, 0.18, 0.6, mat(FLUIDS.crude.color, 'dark'), 0.45, 0.48, 0.3);
        lamp(1.0, -0.35, 0.4);
        break;
      }
      case 'smelter': {
        base();
        box(1.3, 0.9, 1.1, mat(0x7a3d26), 0, 0.63, 0);
        cyl(0.18, 0.22, 1.2, mat(HULL, 'dark'), 0.35, 1.5, -0.3, 8);
        box(0.5, 0.3, 0.06, glow(0x331a0c, 0xff7a2a, 2), 0, 0.55, 0.56);
        lamp(1.2, -0.45, 0.45);
        break;
      }
      case 'press': case 'cells': case 'missiles': {
        // a plain workshop block with a turning gear and a light in the colour of what it makes
        base();
        box(1.3, 0.8, 1.3, mat(c), 0, 0.58, 0);
        box(1.0, 0.3, 1.0, mat(HULL, 'dark'), 0, 1.13, 0);
        const gear = new THREE.Group(); gear.position.set(0, 1.4, 0); g.add(gear); v.spin = gear;
        const t = new THREE.Mesh(geo('fabGear', () => new THREE.TorusGeometry(0.34, 0.08, 6, 12)), mat(TRIM, 'dark')); t.rotation.x = Math.PI / 2; gear.add(t);
        for (let i = 0; i < 6; i++) { const b = box(0.12, 0.1, 0.18, mat(TRIM, 'dark'), Math.cos((i * TAU) / 6) * 0.44, 0, Math.sin((i * TAU) / 6) * 0.44, gear); b.rotation.y = -(i * TAU) / 6; }
        const out = MAKES[type]?.out;
        box(0.5, 0.12, 0.06, glow(0x222222, out ? ITEMS[out].color : c, 1.6), 0, 0.75, 0.66);
        lamp(1.25, 0.5, 0.5);
        break;
      }
      case 'refinery': {
        base();
        cyl(0.36, 0.36, 1.8, mat(0xb08a52), -0.3, 1.0, -0.15, 12);
        cyl(0.26, 0.26, 1.3, mat(0xb08a52), 0.38, 0.75, 0.2, 12);
        cyl(0.07, 0.07, 2.4, mat(TRIM, 'dark'), 0.3, 1.3, -0.4, 6);
        const ring = torus(0.38, 0.04, glow(0x221608, FLUIDS.petrol.color, 1.4)); ring.rotation.x = Math.PI / 2; ring.position.set(-0.3, 1.7, -0.15);
        lamp(1.3, 0.45, 0.45);
        break;
      }
      case 'generator': {
        base();
        const body = cyl(0.55, 0.62, 0.9, mat(0x3c5a55), 0, 0.63, 0, 12);
        body.rotation.y = 0.3;
        const ring = torus(0.6, 0.05, glow(0x0c2622, c, 1.6), 20); ring.rotation.x = Math.PI / 2; ring.position.y = 0.95;
        const fan = new THREE.Group(); fan.position.set(0.3, 1.12, 0.25); g.add(fan); v.spin = fan;
        for (let i = 0; i < 4; i++) { const b = box(0.5, 0.04, 0.12, mat(TRIM, 'dark'), 0, 0, 0, fan); b.rotation.y = (i * TAU) / 8; }
        // the wire terminal on the axis
        cyl(0.12, 0.16, 0.25, mat(HULL, 'dark'), 0, 1.2, 0, 8);
        cyl(0.05, 0.06, GEN_Y - 1.32, mat(0x9ccf6a, 'glow'), 0, (GEN_Y + 1.32) / 2, 0, 6);
        lamp(1.35, -0.45, 0.45);
        break;
      }
      case 'works': {
        base(0.12);
        box(1.5, 0.12, 1.3, mat(TRIM, 'dark'), 0, 0.18, 0);
        for (let i = 0; i < 4; i++) box(0.55, 0.42, 0.5, mat(0xe3dc92), (i % 2 - 0.5) * 0.62, 0.45, (Math.floor(i / 2) - 0.5) * 0.58);
        box(0.55, 0.42, 0.5, mat(0xc9b870), 0.1, 0.87, 0);
        lamp(1.2, 0.55, 0.5);
        break;
      }
      case 'crate': {
        box(1.1, 0.7, 1.1, mat(0x6b6a45), 0, 0.37, 0);
        box(1.16, 0.08, 1.16, mat(TRIM, 'dark'), 0, 0.74, 0);
        box(1.14, 0.1, 0.2, mat(0xe3dc92, 'glow'), 0, 0.4, 0.47);
        lamp(0.95, 0.4, 0.4);
        break;
      }
    }
  }


  /** Point a belt along its path (entry side e, shape k) with end drums at an open start (bit 1) and end (bit 2). */
  private shapeBelt(v: FVis, e: number, k: number, caps: number) {
    if (v.e === e && v.k === k && v.caps === caps) return;
    v.e = e; v.k = k; v.caps = caps;
    this.beltDirty = true;
    if (!v.belt) return;
    v.belt.geometry = beltGeo(k, !!(caps & 1), !!(caps & 2));
    v.belt.rotation.y = (-e * Math.PI) / 3;
  }
  private shapePipe(v: FVis, mask: number, cx: number, cz: number) {
    v.mask = mask;
    const gs = pipeGeo(mask, (cx * 2 + cz * 3) % 4 === 1, v.type === 'ptunnel', v.model);
    for (let i = 0; i < 4; i++) v.pipe[i].geometry = gs[i];
    for (const i of [2, 3]) v.pipe[i].visible = !!gs[i].getAttribute('position');
  }

  /** A number that changes when any building comes, goes or turns (the belt shapes depend on their neighbours). */
  private layoutKey(F: Factory) { return F.rev * 4096 + F.facs.length; }
  /** Feeders of a belt or splitter, keeping what was noted about the ones it had (see syncItems). */
  private feedList(F: Factory, old: Feed[] | null, fs: { d: number; q: Fac }[] | undefined): Feed[] | null {
    if (!fs) return null;
    return fs.map(({ d, q }) => {
      const was = old?.find((o) => o.id === q.id);
      return was ? { ...was, d } : { d, id: q.id, head: headOf(F, q), n: q.type === 'arm' ? +!!q.hand : q.out.length };
    });
  }
  /** Work out each belt's entry side and shape from what feeds it, where its line starts and stops, and each splitter's stubs. */
  private layoutBelts(F: Factory) {
    const pointsAt = (q: Fac, b: Fac) => { const [x, z] = neighbor(q.cx, q.cz, q.dir); return x === b.cx && z === b.cz; };
    // q hands items to b from beside it: a belt or tunnel exit pointing at it, or a splitter b leads away from (its back edge
    // touches the splitter, as Factory.leadsFrom: a belt running past a splitter gets nothing)
    const feeds = (q: Fac, b: Fac) => q.type === 'belt' || (q.type === 'tunnel' && q.exit) ? pointsAt(q, b) : q.type === 'splitter' && b.type === 'belt' && pointsAt({ ...b, dir: (b.dir + 3) % 6 }, q);
    const entry = new Map<number, number>(), multi = new Map<number, { d: number; q: Fac }[]>();
    for (const b of F.facs) {
      if (b.type !== 'belt' && b.type !== 'splitter') continue;
      const fs: { d: number; q: Fac }[] = [];
      // an arm that puts items on at a belt's start (it stands right behind it): the belt then runs straight from there
      // whatever joins it from the side (an item put on at its start has to appear at that end)
      let armed = false;
      for (let d = 0; d < 6; d++) {
        if (b.type === 'belt' && d === b.dir) continue;
        const [nx, nz] = neighbor(b.cx, b.cz, d), q = F.facAt(nx, nz);
        if (!q) continue;
        if (q.type === 'arm') { if (pointsAt(q, b)) { if (b.type === 'splitter') fs.push({ d, q }); else if (q.dir === b.dir) armed = true; } }
        else if (feeds(q, b)) fs.push({ d, q });
      }
      // (a splitter's list also holds the arms that put into it: their items come in from their side, see syncItems)
      if (b.type === 'splitter') { multi.set(b.id, fs); continue; }
      entry.set(b.id, fs.length === 1 && !armed ? fs[0].d : -1 - fs.length);
      if (fs.length > 1 || (armed && fs.length)) multi.set(b.id, fs);
    }
    for (const b of F.facs) {
      const v = this.vis.get(b.id);
      if (!v) continue;
      if (pipeLike(b.type)) { const m = F.pipeMask(b); if (m !== v.mask) this.shapePipe(v, m, b.cx, b.cz); continue; }
      if (b.type === 'splitter') {
        v.feeds = this.feedList(F, v.feeds, multi.get(b.id));
        // a stub on each side with a belt: one bringing items in, or one (or a tunnel entrance) taking them away
        const st: number[] = [];
        for (let d = 0; d < 6; d++) {
          const [nx, nz] = neighbor(b.cx, b.cz, d), q = F.facAt(nx, nz);
          if (!q) continue;
          if ((q.type === 'belt' || (q.type === 'tunnel' && q.exit)) && pointsAt(q, b)) st.push(d);
          else if ((q.type === 'belt' || (q.type === 'tunnel' && !q.exit)) && q.dir === d) st.push(d + 8); // (leading away: as Factory.leadsFrom)
        }
        if (!v.stubs || st.join() !== v.stubs.join()) { v.stubs = st; this.beltDirty = true; }
        continue;
      }
      if (b.type !== 'belt') continue;
      const en = entry.get(b.id)!, back = (b.dir + 3) % 6, e = en >= 0 ? en : back, fs = multi.get(b.id);
      // several feeders: the belt runs straight, each side feeder gets an inlet stub, and the items it hands over ride in from it
      const old = v.feeds;
      v.feeds = this.feedList(F, old, fs);
      if (!!old !== !!fs || (fs && old!.map((o) => o.d).join() !== fs.map((o) => o.d).join())) this.beltDirty = true;
      // the end is open unless the next belt takes this one in at the side facing it (its line carries on from here), or it
      // runs into a splitter or down a tunnel ramp
      const [nx, nz] = neighbor(b.cx, b.cz, b.dir), q = F.facAt(nx, nz);
      const joins = !!q && ((q.type === 'belt' && !pointsAt(q, b) && (entry.get(q.id)! >= 0 ? entry.get(q.id) === (b.dir + 3) % 6 : (q.dir + 3) % 6 === (b.dir + 3) % 6))
        || q.type === 'splitter' || (q.type === 'tunnel' && !q.exit && q.dir === b.dir));
      // the start is open (an end drum) with no feeder, or with several but none straight behind it
      const open = en === -1 || (!!fs && !fs.some((f) => f.d === back));
      this.shapeBelt(v, e, (b.dir - e + 6) % 6, (open ? 1 : 0) | (joins ? 0 : 2));
    }
  }

  /** Placed belts, their inlet stubs and the splitters' stubs into the instanced batches (when the layout changes, and every frame while they grow in). */
  private syncBelts(F: Factory, revealing: boolean) {
    if (!this.beltDirty && !revealing && !this.beltScaled) return;
    this.beltDirty = false; this.beltScaled = revealing;
    for (const b of this.beltBatches.values()) b.n = 0;
    for (const fc of F.facs) {
      const v = this.vis.get(fc.id);
      if (!v) continue;
      const sc = v.obj.scale.x;
      if (fc.type === 'splitter') {
        if (v.stubs) for (const s of v.stubs) { const d = s & 7, out = s >= 8; this.putBelt(out ? (v.model ? SPLIT_OUT_M() : SPLIT_OUT()) : v.model ? SPLIT_IN_M() : SPLIT_IN(), fc, out ? (d + 3) % 6 : d, sc); }
        // (the model's kerb closes every side no belt joins)
        if (v.gates) for (let d = 0; d < 6; d++) { const gt = v.gates[d]; if (gt) gt.visible = !v.stubs || !v.stubs.some((s) => (s & 7) === d); }
        continue;
      }
      if (fc.type !== 'belt' || v.k < 0) continue;
      const back = (fc.dir + 3) % 6;
      this.putBelt(beltGeo(v.k, !!(v.caps & 1), !!(v.caps & 2)), fc, v.e, sc);
      if (v.feeds) for (const f of v.feeds) if (f.d !== back) this.putBelt(stubGeo((f.d - fc.dir + 6) % 6), fc, f.d, sc);
    }
    for (const b of this.beltBatches.values()) for (const m of [b.body, b.light]) {
      m.count = b.n;
      m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, b.n * 16); m.instanceMatrix.needsUpdate = true;
    }
  }
  private putBelt(g: THREE.BufferGeometry, fc: Fac, e: number, sc: number) {
    let b = this.beltBatches.get(g);
    if (!b) {
      const body = new THREE.InstancedMesh(g, this.beltBody, GW * GH), light = new THREE.InstancedMesh(g, this.beltLight, GW * GH);
      body.castShadow = true; body.receiveShadow = true;
      for (const m of [body, light]) { m.count = 0; m.frustumCulled = false; this.group.add(m); }
      b = { body, light, n: 0 };
      this.beltBatches.set(g, b);
    }
    if (b.n >= GW * GH) return;
    this.M.compose(this.P.set(fc.x, 0, fc.z), this.Q.setFromAxisAngle(this.S.set(0, 1, 0), (-e * Math.PI) / 3), this.S.setScalar(sc));
    b.body.setMatrixAt(b.n, this.M); b.light.setMatrixAt(b.n, this.M);
    b.n++;
  }

  /** A deposit batch under a key, with room for every tile that can carry ore. */
  private depBatch(key: string, g: THREE.BufferGeometry, m: THREE.Material, shadow: boolean) {
    const b = new DepBatch(g, m, (GW * GH) >> 1, shadow);
    this.depB[key] = b; this.deps.push(b); this.group.add(b.mesh);
    return b;
  }
  /** The modelled pieces, once the deposit models are loaded: per kind its bodies ('v0'..) and rim rubble, and the oil pool. */
  private depModels() {
    if (this.depReady) return true;
    const models = this.models(), geo = (file: string, node: string) => { const o = models[file]?.getObjectByName(node) as THREE.Mesh | undefined; return o && o.isMesh && o.geometry.getAttribute('color') ? o.geometry : null; };
    if (!ORE_TYPES.every((k) => geo(DEP_FILE[k], 'v0') && geo(DEP_FILE[k], 'rim'))) return false;
    for (const k of ORE_TYPES) {
      const m = depMat(k);
      for (let v = 0; v < DEP_VARIANTS; v++) this.depBatch(k + v, geo(DEP_FILE[k], 'v' + v) || geo(DEP_FILE[k], 'v0')!, m, true);
      this.depBatch(k + '_rim', geo(DEP_FILE[k], 'rim')!, m, false);
    }
    const pool = geo(DEP_FILE.oil, 'pool');
    if (pool) this.depBatch('pool', pool, oilMat(this.oilT), false);
    return (this.depReady = true);
  }

  /** The deposit pieces for the map's ore, seeded per tile: which body, turned and scaled how, and a shade of its own. */
  private buildDeps(sim: Sim) {
    const ore = sim.factory.ore, M = this.M, P = this.P, Q = this.Q, S = this.S, C = this.C, b = this.depB, up = this.V1.set(0, 1, 0);
    const ready = this.depModels();
    for (let i = 0; i < GW * GH; i++) {
      if (!ore[i]) continue;
      const o = ORE_TYPES[ore[i] - 1], x = this.tileX[i], z = this.tileZ[i], oil = o === 'oil';
      let seed = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(ore[i], 0x85ebca6b)) | 0;
      const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      // the stain (keeps the tile readable from far away); it stays under every building
      M.makeRotationY(Math.floor(rnd() * 6) * (Math.PI / 3)).setPosition(x, 0.03, z);
      b['stain_' + o].add(M, C.setScalar(0.92 + rnd() * 0.16), i, 0.25, 2);
      if (!ready) continue;
      // the body: any angle, a little larger or smaller, squatter or taller (the oil plates keep their proportions)
      // (mirrored on every second tile: see depMat)
      const v = Math.floor(rnd() * DEP_VARIANTS), yaw = rnd() * TAU, sc = (0.9 + rnd() * 0.18) * DEP_SCALE[o], sy = oil ? sc : sc * (0.88 + rnd() * 0.3), sh = 0.9 + rnd() * 0.2, mir = rnd() < 0.5 ? -1 : 1;
      M.compose(P.set(x, 0, z), Q.setFromAxisAngle(up, yaw), S.set(sc * mir, sy, sc));
      b[o + v].add(M, C.setRGB(sh * (0.97 + rnd() * 0.06), sh, sh * (0.97 + rnd() * 0.06)), i, 0.5, 0);
      // the rubble round the rim (it stays round a mine or pumpjack): laid out for the hex, so turned by sixths only
      M.compose(P, Q.setFromAxisAngle(up, Math.floor(rnd() * 6) * (Math.PI / 3)), S.set(rnd() < 0.5 ? -1 : 1, 0.9 + rnd() * 0.3, 1));
      b[o + '_rim'].add(M, C.setScalar(0.9 + rnd() * 0.2), i, 0.72, 1);
      if (oil) {
        // the tar pool between the plates (with bubbles, see animBubbles)
        if (b.pool) { M.compose(P, Q.setFromAxisAngle(up, rnd() * TAU), S.set(1, 1, 1)); b.pool.add(M, C.setScalar(1), i, 0.4, 0); }
        this.oilTiles.push(i);
      }
    }
    for (const bt of this.deps) { bt.mesh.count = bt.n; bt.mesh.instanceMatrix.needsUpdate = true; if (bt.mesh.instanceColor) bt.mesh.instanceColor.needsUpdate = true; }
    this.depPose = true;
  }

  /** What stands on each deposit tile (pieces under a building are hidden; a mine or pumpjack keeps the rubble round its rim). */
  private coverDeps(F: Factory) {
    const ore = F.ore;
    for (let i = 0; i < GW * GH; i++) {
      if (!ore[i]) continue;
      const fc = F.at[i] ? F.facAt(i % GW, Math.floor(i / GW)) : undefined, c = !fc ? 0 : fc.type === 'mine' || fc.type === 'pump' ? 2 : 1;
      if (c !== this.cover[i]) { this.cover[i] = c; this.depPose = true; }
    }
  }

  /** Pose the deposit pieces: at rest, hidden under buildings, or rising with their deck tile while the map assembles (each
   *  piece a little after the tile and after the one before, scaling up from below with a small overshoot). */
  private poseDeps(reveal: ((x: number, z: number) => number) | null) {
    for (const bt of this.deps) {
      const a = bt.mesh.instanceMatrix.array as Float32Array, R = bt.rest;
      for (let i = 0; i < bt.n; i++) {
        const t = bt.tile[i], o = i * 16, cv = this.cover[t];
        let s = 1, dy = 0;
        if (cv && bt.keep[i] < (cv === 2 ? 1 : 2)) s = 0;
        else if (reveal) {
          const d = bt.del[i], k = sat01((reveal(this.tileX[t], this.tileZ[t]) - d) / (0.985 - d));
          s = k <= 0 ? 0 : backOut(k); dy = (k - 1) * 0.25;
        }
        if (s === 1) { for (let j = 0; j < 16; j++) a[o + j] = R[o + j]; continue; }
        for (let j = 0; j < 12; j++) a[o + j] = R[o + j] * s;
        a[o + 12] = R[o + 12]; a[o + 13] = R[o + 13] * s + (s > 0 ? dy : 0); a[o + 14] = R[o + 14]; a[o + 15] = 1;
      }
      bt.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Bubbles on the oil pools: each grows slowly at a spot of its own and pops, then the next one rises elsewhere. */
  private animBubbles(time: number, hide: boolean) {
    let n = 0;
    const cap = this.bubbles.instanceMatrix.count;
    if (!hide) for (const t of this.oilTiles) {
      if (this.cover[t]) continue;
      for (let b = 0; b < 3 && n < cap; b++) {
        const ph = time * (0.28 + 0.09 * b) + t * 0.618 + b * 0.37, cyc = Math.floor(ph), u = ph - cyc;
        if (u > 0.82) continue; // popped: gone until the next one
        const a = hash3(t, b, cyc, 1) * TAU, r = Math.sqrt(hash3(t, b, cyc, 2)) * BUBBLE_R, g = u / 0.82;
        const sc = (0.022 + 0.04 * hash3(t, b, cyc, 3)) * Math.sqrt(g) * (g > 0.92 ? 1 + (g - 0.92) * 3 : 1);
        this.M.makeScale(sc, sc * 0.75, sc).setPosition(this.tileX[t] + Math.cos(a) * r, POOL_Y, this.tileZ[t] + Math.sin(a) * r);
        this.bubbles.setMatrixAt(n++, this.M);
      }
    }
    if (n || this.bubbles.count) { this.bubbles.count = n; this.bubbles.instanceMatrix.needsUpdate = true; }
  }

  /**
   * Highlight the deposit under the pointer (cx, cz: grid cell) and its whole connected patch of the same kind: a thin line
   * in the ore's colour round the patch with a light curtain fading up from it, a ring on each of its tiles (brightest on the
   * hovered one). on = false (or a tile without ore) clears it.
   */
  setOreHover(cx: number, cz: number, on: boolean) {
    const ore = this.sim?.factory.ore, i = cz * GW + cx;
    const key = on && ore && inBoard(cx, cz) && ore[i] ? i : -1;
    if (key === this.hlKey) return;
    this.hlKey = key;
    if (key < 0 || !ore) { this.hlEdge.count = this.hlCurtain.count = this.hlRing.count = this.hlFill.count = 0; return; }
    // the kind's own colour, saturated (a pale one blooms to white and says nothing about the ore)
    const k = ore[i], col = new THREE.Color(DEP_ACCENT[ORE_TYPES[k - 1]]);
    // the patch: flood fill over neighbours of the same kind
    const patch = new Set<number>([i]), q = [i];
    while (q.length) {
      const t = q.pop()!;
      for (let d = 0; d < 6; d++) {
        const [nx, nz] = neighbor(t % GW, Math.floor(t / GW), d), j = nz * GW + nx;
        if (inBoard(nx, nz) && ore[j] === k && !patch.has(j)) { patch.add(j); q.push(j); }
      }
    }
    let ne = 0, nr = 0;
    const M = this.M, up = this.V1.set(0, 1, 0);
    for (const t of patch) {
      const tx = t % GW, tz = Math.floor(t / GW), x = this.tileX[t], z = this.tileZ[t];
      if (nr < MAX_MARK) {
        M.makeTranslation(x, 0.045, z); this.hlRing.setMatrixAt(nr, M); this.hlFill.setMatrixAt(nr, M);
        this.hlFill.setColorAt(nr, this.C.copy(col).multiplyScalar(t === i ? 1 : 0.55));
        this.hlRing.setColorAt(nr++, this.C.copy(col).multiplyScalar(t === i ? 1 : 0.38));
      }
      for (let d = 0; d < 6 && ne < MAX_HL; d++) {
        const [nx, nz] = neighbor(tx, tz, d);
        if (inBoard(nx, nz) && patch.has(nz * GW + nx)) continue;
        // the border between this tile and the outside neighbour: half way to its centre, across the line between them
        const dx = cellX(nx, nz) - x, dz = cellZ(nz) - z;
        this.Q.setFromAxisAngle(up, Math.atan2(dx, dz));
        M.compose(this.P.set(x + dx / 2, 0.05, z + dz / 2), this.Q, this.S.set(HEX_SIZE + 0.05, 0.03, 0.1));
        this.hlEdge.setMatrixAt(ne, M); this.hlEdge.setColorAt(ne, col);
        M.compose(this.P.set(x + dx / 2, 0.02, z + dz / 2), this.Q, this.S.set(HEX_SIZE, 0.75, 1));
        this.hlCurtain.setMatrixAt(ne, M); this.hlCurtain.setColorAt(ne++, col);
      }
    }
    this.hlEdge.count = this.hlCurtain.count = ne; this.hlRing.count = this.hlFill.count = nr;
    for (const m of [this.hlEdge, this.hlCurtain, this.hlRing, this.hlFill]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  /** While the deck assembles: scale each instance of a mesh (rebuilt this frame) about its tile's centre by that tile's reveal. */
  private revealInst(m: THREE.InstancedMesh, rv: (x: number, z: number) => number) {
    if (!m.count) return;
    const a = m.instanceMatrix.array as Float32Array;
    for (let i = 0; i < m.count; i++) {
      const o = i * 16, x = a[o + 12], z = a[o + 14], [cx, cz] = worldToCell(x, z), px = cellX(cx, cz), pz = cellZ(cz), s = rv(px, pz);
      if (s >= 1) continue;
      for (let j = 0; j < 12; j++) a[o + j] *= s;
      a[o + 12] = px + (x - px) * s; a[o + 13] *= s; a[o + 14] = pz + (z - pz) * s;
    }
    m.instanceMatrix.needsUpdate = true;
  }
  /** A cable end on fc while the deck assembles: moved with fc's scale about its foot (null while fc is still too small). */
  private rvEnd(p: [number, number, number], x: number, z: number): [number, number, number] | null {
    if (!this.rv) return p;
    const s = this.rv(x, z);
    return s < 0.03 ? null : [x + (p[0] - x) * s, p[1] * s, z + (p[2] - z) * s];
  }

  sync(dt: number, time: number, reveal: ((x: number, z: number) => number) | null) {
    const sim = this.sim;
    if (!sim) return;
    const F = sim.factory, f = ++this.frame;
    // between waves the factory stands still: items freeze on the belts and the machines idle (the lamps show the diagnosis)
    this.live = !sim.planning;
    const dg = this.live ? null : sim.diag();
    // while the deck assembles, everything here comes in with its tile: the buildings and belts grow with it, the deposits
    // rise out of it (poseDeps), and the items, cables, connectors and level marks are rebuilt every frame and scaled with
    // their tiles (revealPass); one more rebuild when it ends leaves them all at rest
    this.rv = reveal;
    if (reveal || this.rvWas) { this.linkRef = null; this.lvlKey = -1; this.wireKey = -1; }
    this.rvWas = !!reveal;
    let added = false, lk = 0;
    const facs = F.facs;
    this.aDt = dt; this.aTime = time; // (read by animate(): numbers handed to a call are boxed, one per call per building)
    for (let n = 0; n < facs.length; n++) {
      const fc = facs[n];
      let v = this.vis.get(fc.id);
      // a model that has loaded since, or a tunnel that turned or became the other end: built again
      if (v && ((!v.model && !DRAWN_HERE.has(fc.type) && fc.type !== 'arm' && this.modelOf(fc.type)) || (fc.type === 'tunnel' && (v.ex !== fc.exit || v.dir !== fc.dir)))) {
        this.drop(v); this.vis.delete(fc.id); v = undefined;
      }
      if (!v) {
        v = this.build(fc.type, fc.dir, false, fc.exit);
        v.obj.position.set(fc.x, 0, fc.z);
        this.group.add(v.obj);
        this.vis.set(fc.id, v);
        added = true;
      }
      v.seen = f;
      if (fc.lvl > 1) lk = (Math.imul(lk, 31) + fc.id * 4 + fc.lvl) | 0;
      if (reveal) v.obj.scale.setScalar(Math.max(0.001, reveal(fc.x, fc.z)));
      else if (v.obj.scale.x !== 1) v.obj.scale.setScalar(1);
      this.animate(fc, v, dg);
    }
    // (every building has its entry now: only when there are more entries than buildings has one gone)
    if (this.vis.size > facs.length) for (const [id, v] of this.vis) if (v.seen !== f) { this.drop(v); this.vis.delete(id); }
    const lay = this.layoutKey(F);
    // (any change redraws the belt batches: a belt that was removed changes no other belt's shape, but its instance has to go)
    const relaid = lay !== this.layout || added || F.pipeNets !== this.nets;
    if (relaid) { this.layout = lay; this.nets = F.pipeNets; this.layoutBelts(F); this.coverDeps(F); this.beltDirty = true; this.itemsStill = false; }
    this.syncBelts(F, !!reveal);
    // the tread and the fluids run with the sim clock, and only while the factory does
    const st = sim.time;
    this.simDt = 0;
    if (this.live && this.lastT >= 0 && st > this.lastT && st - this.lastT < 5) {
      this.simDt = st - this.lastT;
      this.run += this.simDt * BELT_SPEED * sim.mods.belt;
    }
    this.lastT = st;
    this.tread.offset.y = -((this.run * BELT_REP) % 1);
    this.syncPipes(F, dt, relaid);
    this.syncArms(F, dt, time, dg);
    // (while time stands still nothing on the belts moves: the items stay where the last pass put them until the layout
    // changes; an arm's hand may still be settling with what it holds)
    if (this.live || reveal || !this.itemsStill || this.armMoving) { this.syncItems(F); this.itemsStill = !this.live && !reveal && !this.armMoving; }
    this.syncWires(F);
    this.syncLinks(F);
    this.animLinks(dt);
    this.syncLevels(F, (lk ^ this.layout) | 0);
    if (reveal) {
      for (const s of SHAPES) for (const p of this.itemMeshes[s]) this.revealInst(p.mesh, reveal);
      for (const m of [this.chute, this.chuteLight, this.sock, this.sockLight, this.branch, this.branchCore, this.branchFit, this.band, this.pips]) this.revealInst(m, reveal);
    }
    // deposits: posed while they rise (and once more when the deck stands or buildings change), the oil bubbles, the hover glow
    if (reveal || this.depPose || this.depIntro) { this.poseDeps(reveal); this.depPose = false; this.depIntro = !!reveal; }
    this.oilT.value = time;
    this.animBubbles(time, !!reveal);
    if (this.hlKey >= 0) {
      const w = 0.5 + 0.5 * Math.sin(time * 3.6);
      this.hlMats[0].opacity = 0.75 + 0.25 * w; this.hlMats[1].opacity = 0.34 + 0.22 * w; this.hlMats[2].opacity = 0.4 + 0.25 * w; this.hlMats[3].opacity = 0.14 + 0.1 * w;
    }
    // a Frame arriving at a Depot: a short glint
    for (let i = this.sparks.length - 1; i >= 0; i--) { if ((this.sparks[i].t += dt) > GLINT_T) this.sparks.splice(i, 1); }
    let gn = 0;
    for (const sp of this.sparks) {
      const k = sp.t / GLINT_T, sc = Math.sin(Math.PI * Math.min(1, k * 1.6)) * (1 - k * 0.5);
      for (let j = 0; j < 5 && gn < 60; j++) {
        const a = (j * TAU) / 5 + k * 3, r = 0.2 + k * 0.55;
        this.Q.setFromAxisAngle(this.P.set(0, 1, 0), a);
        this.M.compose(this.P.set(sp.x + Math.cos(a) * r, 1.05 + k * 1.1 + (j & 1) * 0.15, sp.z + Math.sin(a) * r), this.Q, this.S.setScalar(Math.max(0.001, sc)));
        this.glint.setMatrixAt(gn++, this.M);
      }
    }
    if (gn || this.glint.count) { this.glint.count = gn; this.glint.instanceMatrix.needsUpdate = true; }
  }

  /** Tell which feeder handed over each item new on a belt or in a splitter (a feeder whose front item has gone, or a producer
   *  whose output queue got shorter), then note what each holds now for the next frame. */
  private trackFeeds(F: Factory, items: BeltItem[], fd: Feed[], def: number) {
    for (const it of items) {
      if (this.inSide.has(it)) continue;
      let side = def;
      // (an item new in the middle of a belt was put there by an arm beside it: it lies on the belt's own path)
      if (it.p < 0.45 || def < 0) for (const f of fd) {
        const q = F.facById(f.id);
        if (!q) continue;
        // an arm has let go of what it held (its side + 8: the item is put on the table, it does not ride in from the edge)
        if (q.type === 'arm') { const g = this.vis.get(q.id)?.rig; if (g && g.kick > 0.8) { side = f.d + 8; break; } continue; }
        if (f.head !== null && f.head.it === it.it && headOf(F, q) !== f.head) { side = f.d; f.head = null; f.n = -1; break; }
      }
      this.inSide.set(it, side < 0 ? fd[0]?.d ?? 0 : side);
    }
    for (const f of fd) { const q = F.facById(f.id); if (q) { f.head = headOf(F, q); f.n = q.type === 'arm' ? +!!q.hand : q.out.length; } }
  }
  /** One item into its instanced meshes, at (x, y, z) heading (tx, tz). */
  private putItem(it: ItemType, x: number, y: number, z: number, tx: number, tz: number) {
    const q = this.ip;
    q[0] = x; q[1] = y; q[2] = z; q[3] = tx; q[4] = tz;
    this.putIp(it);
  }
  /** putItem() with the place and heading already in this.ip (the per-item path: no numbers boxed for the call). */
  private putIp(it: ItemType) {
    const sh = SHAPE_OF[it], n = this.itemN[sh], M = this.M, q = this.ip;
    if (n >= MAX_ITEMS) return;
    M.makeRotationY(Math.atan2(q[3], q[4])).scale(this.S.setScalar(ITEM_SCALE[sh]));
    M.setPosition(q[0], q[1], q[2]);
    const ps = this.itemMeshes[sh];
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.mesh.setMatrixAt(n, M);
      if (p.tint) p.mesh.setColorAt(n, this.C.setHex(it === 'coal' ? COAL_TINT : ITEMS[it].color));
    }
    this.itemN[sh] = n + 1;
  }
  /** An item on a tunnel ramp at p (0 back edge .. 1 front edge) of tunnel tile t: down into the portal or up out of it. */
  private rampItem(t: Fac, it: ItemType, p: number, down: boolean) {
    const hx = DX[t.dir], hz = DZ[t.dir], q = Math.max(0, Math.min(1, down ? (2 * p) / 1.3 : (2 * p - 0.7) / 1.3)), e = q * q * (3 - 2 * q);
    this.putItem(it, t.x + hx * (2 * p - 1), Y_SURF - RAMP_DROP * (down ? e : 1 - e), t.z + hz * (2 * p - 1), hx, hz);
  }

  /** Belt items: placed on their belt's path, turned along it, one instanced mesh per part of each shape; also the items in
   *  splitters and near the portals of tunnels (underground they are not drawn). */
  private syncItems(F: Factory) {
    const N = this.itemN, pt = this.pt, facs = F.facs;
    for (let i = 0; i < SHAPES.length; i++) N[SHAPES[i]] = 0;
    for (let n = 0; n < facs.length; n++) {
      const fc = facs[n];
      if (!fc.items.length) continue;
      const v = this.vis.get(fc.id);
      if (!v) continue;
      if (fc.type === 'splitter') {
        // in from the side it came by to the turntable's middle, where it waits to be dealt out
        if (v.feeds) this.trackFeeds(F, fc.items, v.feeds, -1);
        for (let i = 0; i < fc.items.length; i++) {
          const it = fc.items[i], raw = this.inSide.get(it) ?? 0, sd = raw & 7, r = Math.min(raw >= 8 ? 0.6 : 1, Math.max(0, 1 - 2 * it.p)) + (i > 0 ? 0.22 : 0);
          this.putItem(it.it, fc.x + DX[sd] * r, Y_SURF + 0.012, fc.z + DZ[sd] * r, -DX[sd], -DZ[sd]);
        }
        continue;
      }
      if (fc.type === 'tunnel') {
        const e = fc.pair && !fc.exit ? F.facById(fc.pair) : undefined;
        if (!e) continue;
        const len = hexDist(fc.cx, fc.cz, e.cx, e.cz);
        for (const it of fc.items) {
          if (it.p < PORTAL_IN) this.rampItem(fc, it.it, it.p, true);
          else if (it.p > len - 1 + PORTAL_OUT) this.rampItem(e, it.it, it.p - len + 1, false);
        }
        continue;
      }
      if (fc.type !== 'belt' || v.k < 0) continue;
      const P = PATHS[v.k], c = DX[v.e], s = DZ[v.e], fd = v.feeds;
      if (fd) this.trackFeeds(F, fc.items, fd, v.e);
      const ax = DX[fc.dir], az = DZ[fc.dir];
      for (let i = 0; i < fc.items.length; i++) {
        const it = fc.items[i], side = fd ? this.inSide.get(it) ?? v.e : v.e;
        if (side === v.e) {
          pathAt(P, it.p, pt);
          const q = this.ip;
          q[0] = fc.x + pt.x * c - pt.z * s; q[1] = Y_SURF; q[2] = fc.z + pt.x * s + pt.z * c; q[3] = pt.tx * c - pt.tz * s; q[4] = pt.tx * s + pt.tz * c;
          this.putIp(it.it);
        } else {
          // in from a side: a quadratic curve from that edge's midpoint (down the inlet stub) through the tile centre and out
          // along the belt, hopping over the main belt's rail where it crosses it
          const p = it.p, a = (1 - p) * (1 - p), b2 = p * p, ex = DX[side], ez = DZ[side];
          const x = fc.x + a * ex + b2 * ax, z = fc.z + a * ez + b2 * az;
          const d = Math.abs((x - fc.x) * -az + (z - fc.z) * ax), hop = 1 - Math.abs(d - (RIN + ROUT) / 2) / 0.13;
          this.putItem(it.it, x, Y_SURF + (hop > 0 ? HOP * Math.sin((hop * Math.PI) / 2) : 0), z, -2 * (1 - p) * ex + 2 * p * ax, -2 * (1 - p) * ez + 2 * p * az);
        }
      }
    }
    // what the arms hold, in their hands
    for (let i = 0; i < this.heldN; i++) { const q = this.ip, o = i * 5, H = this.heldP; q[0] = H[o]; q[1] = H[o + 1]; q[2] = H[o + 2]; q[3] = H[o + 3]; q[4] = H[o + 4]; this.putIp(this.heldIt[i]); }
    for (const s of SHAPES) for (const p of this.itemMeshes[s]) {
      const was = p.mesh.count;
      p.mesh.count = N[s];
      if (!N[s] && !was) continue;
      // (only the slots in use go up to the GPU, not all MAX_ITEMS)
      const im = p.mesh.instanceMatrix;
      im.clearUpdateRanges(); im.addUpdateRange(0, N[s] * 16); im.needsUpdate = true;
      const ic = p.tint ? p.mesh.instanceColor : null;
      if (ic) { ic.clearUpdateRanges(); ic.addUpdateRange(0, N[s] * 3); ic.needsUpdate = true; }
    }
  }

  /** Power lines: a sagging wire between each pair of linked poles, from insulator to insulator. */
  private syncWires(F: Factory) {
    if (F.rev === this.wireRev && this.wireKey !== -1) return; // (wires only change with the layout)
    this.wireRev = F.rev;
    let h = F.wires.length;
    for (const w of F.wires) h = Math.imul(h ^ (w[0] * 65599 + w[1]), 16777619);
    if (h === this.wireKey) return;
    this.wireKey = h;
    const parts: THREE.BufferGeometry[] = [];
    for (const [a, b] of F.wires) {
      const A = F.facById(a), B = F.facById(b);
      if (!A || !B) continue;
      const ea = this.rvEnd(wireEnd(A, B.x), A.x, A.z), eb = this.rvEnd(wireEnd(B, A.x), B.x, B.z);
      if (ea && eb) parts.push(cable(ea, eb, 0.045, 0.024));
    }
    this.wires.geometry.dispose();
    this.wires.geometry = parts.length ? mergeGeometries(parts)! : new THREE.BufferGeometry();
    for (const g of parts) g.dispose();
  }

  private clearLinks() {
    for (const m of [this.chute, this.chuteLight, this.sock, this.sockLight, this.branch, this.branchCore, this.branchFit]) m.count = 0;
    this.nScan = 0; this.nBranch = 0; this.takers.clear(); this.sockOf.clear(); this.armIn.clear(); this.armOut.clear();
    this.nTok = 0; this.tokens.count = 0; // (a token in flight holds a link index of the old layout)
    this.drops.geometry.dispose(); this.drops.geometry = new THREE.BufferGeometry();
  }
  /**
   * The supply connectors, from Factory.links() (worked out again when the links or the belt shapes change):
   *  - arm: the arms themselves are the connectors (see syncArms); here only the hatch on the tower or building an arm
   *    puts into, and the one on the building or crate it takes out of, each on the side facing the arm;
   *  - crate: a chute from a supply crate down to a hatch on the tower beside it (the one hand-off without an arm);
   *  - pipe: a glass branch from the pipe tile's edge into the consumer, with a flange;
   *  - power: a drop cable from the pole's insulator (or the generator's terminal) to a socket on the consumer.
   */
  private syncLinks(F: Factory) {
    const links = F.links();
    if (links === this.linkRef && this.linkLayout === this.layout) return;
    this.linkRef = links; this.linkLayout = this.layout;
    this.clearLinks();
    let ns = 0, nk = 0, nb = 0;
    const M = this.M, cables: THREE.BufferGeometry[] = [];
    const socket = (x: number, y: number, z: number, fx: number, fz: number, c: THREE.Color, to: string): number => {
      M.compose(this.P.set(x, y, z), this.Q.setFromAxisAngle(this.S.set(0, 1, 0), Math.atan2(fx, fz)), this.S.set(1, 1, 1));
      this.sockFlash[nk] = 0; this.sockPower[nk] = c === SOCK_GREEN ? 1 : 0;
      const sl = this.sockOf.get(to);
      if (sl) sl.push(nk); else this.sockOf.set(to, [nk]);
      this.sock.setMatrixAt(nk, M); this.sockLight.setMatrixAt(nk, M); this.sockLight.setColorAt(nk, c);
      return nk++;
    };
    const plain = (key: string | undefined) => { if (!key) return false; if (key[0] === 't') return true; const q = F.facById(+key.slice(1)); return !!q && !conveyor(q.type) && q.type !== 'arm' && !pipeLike(q.type) && q.type !== 'pole'; };
    for (const l of links) {
      if (l.kind === 'arm') {
        const a = F.facById(l.from);
        if (!a || nk >= MAX_LINKS * 2 - 2) continue;
        const hx = DX[a.dir], hz = DZ[a.dir];
        if (plain(l.to) && F.acceptMask(armFront(a), a)) this.armOut.set(a.id, socket(l.tx - hx * TAKER_IN, (l.to[0] === 't' ? this.deck(l.tx, l.tz) : 0) + ARM_Y, l.tz - hz * TAKER_IN, -hx, -hz, SCAN_AMBER, l.to));
        // (the way out of a producer: keyed apart from its takers' hatches, a route arriving at it does not light this one)
        const src = l.src ? F.facById(+l.src.slice(1)) : undefined;
        if (src && l.src![0] === 'f' && plain(l.src) && (src.type === 'crate' || !!MAKES[src.type]?.out || src.type === 'mine' || src.type === 'smelter')) this.armIn.set(a.id, socket(l.x + hx * TAKER_IN, ARM_Y, l.z + hz * TAKER_IN, hx, hz, SCAN_AMBER, '>' + l.src));
      } else if (l.kind === 'crate') {
        if (ns >= MAX_LINKS || nk >= MAX_LINKS * 2 - 1) continue;
        const dl = Math.hypot(l.tx - l.x, l.tz - l.z) || 1, ux = (l.tx - l.x) / dl, uz = (l.tz - l.z) / dl, ty = this.deck(l.tx, l.tz) + ARM_Y;
        const sx = l.x + ux * 0.6, sz = l.z + uz * 0.6, ex = l.tx - ux * TAKER_IN, ez = l.tz - uz * TAKER_IN;
        const A = this.V1.set(sx, 0.58, sz), B = this.V2.set(ex, ty, ez), d = this.P.subVectors(B, A), len = d.length();
        this.Q.setFromUnitVectors(this.Z, d.multiplyScalar(1 / Math.max(1e-6, len)));
        M.compose(A, this.Q, this.S.set(1, 1, Math.max(0.01, len)));
        this.chute.setMatrixAt(ns, M); this.chuteLight.setMatrixAt(ns, M); this.chuteLight.setColorAt(ns, this.C.copy(SCAN_AMBER).multiplyScalar(0.45));
        this.chuteA.set([sx, 0.58, sz], ns * 3); this.chuteB.set([ex, ty, ez], ns * 3);
        socket(ex, ty, ez, -ux, -uz, SCAN_AMBER, l.to);
        this.scanAt[ns * 2] = l.x; this.scanAt[ns * 2 + 1] = l.z; this.flash[ns] = 0;
        const tl = this.takers.get(l.to);
        if (tl) tl.push(ns); else this.takers.set(l.to, [ns]);
        ns++;
      } else if (l.kind === 'pipe') {
        if (nb >= MAX_LINKS) continue;
        M.compose(this.P.set(l.x, 0, l.z), this.Q.setFromAxisAngle(this.S.set(0, 1, 0), Math.atan2(l.tx - l.x, l.tz - l.z)), this.S.set(1, 1, 1));
        // (the fluid in a branch is that of the pipe tile it hangs on: the material reads it from the pipe state texture)
        this.branch.setMatrixAt(nb, M); this.branchFit.setMatrixAt(nb, M); this.branchCore.setMatrixAt(nb, M);
        nb++;
      } else if (l.kind === 'power') {
        const f = F.facById(l.from);
        if (!f || nk >= MAX_LINKS * 2) continue;
        const w = wireEnd(f, l.tx), dl = Math.hypot(w[0] - l.tx, w[2] - l.tz) || 1;
        const ex = l.tx + ((w[0] - l.tx) / dl) * TAKER_IN, ez = l.tz + ((w[2] - l.tz) / dl) * TAKER_IN;
        socket(ex, SOCK_Y, ez, w[0] - ex, w[2] - ez, SOCK_GREEN, l.to);
        const ca = this.rvEnd(w, f.x, f.z), cb = this.rvEnd([ex, SOCK_Y + 0.04, ez], l.tx, l.tz);
        if (ca && cb) cables.push(cable(ca, cb, 0.07, 0.017));
      }
    }
    this.nScan = ns; this.nBranch = nb;
    this.chute.count = this.chuteLight.count = ns;
    this.sock.count = this.sockLight.count = nk;
    this.branch.count = this.branchCore.count = this.branchFit.count = nb;
    for (const m of [this.chute, this.chuteLight, this.sock, this.sockLight, this.branch, this.branchCore, this.branchFit]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    if (cables.length) { this.drops.geometry.dispose(); this.drops.geometry = mergeGeometries(cables)!; for (const g of cables) g.dispose(); }
  }
  /** Chute flashes fading, item tokens sliding down the chutes, sockets flaring, the flashes of the arms' puts. */
  private animLinks(dt: number) {
    let lit = false;
    for (let i = 0; i < this.nScan; i++) {
      if (this.flash[i] <= 0) continue;
      const k = this.flash[i];
      this.flash[i] = Math.max(0, k - dt / FLASH_T);
      this.chuteLight.setColorAt(i, this.C.copy(SCAN_AMBER).multiplyScalar(0.45 + 3 * k * k));
      lit = true;
    }
    if (lit && this.chuteLight.instanceColor) this.chuteLight.instanceColor.needsUpdate = true;
    // sockets flaring: an arm put something in or took something out, or a supply route has reached them (see flashTaker)
    let slit = false;
    for (let i = 0; i < this.sock.count; i++) {
      const k = this.sockFlash[i];
      if (k <= 0) continue;
      this.sockFlash[i] = Math.max(0, k - dt / (this.sockPower[i] ? 0.9 : 0.5));
      this.sockLight.setColorAt(i, this.C.copy(this.sockPower[i] ? SOCK_GREEN : SCAN_AMBER).multiplyScalar(1 + 5 * k * k));
      slit = true;
    }
    if (slit && this.sockLight.instanceColor) this.sockLight.instanceColor.needsUpdate = true;
    // tokens: the item's colour, a little arc from the crate to the tower
    let n = this.nTok;
    for (let i = 0; i < n; i++) {
      this.tokT[i] += dt / TOKEN_T;
      if (this.tokT[i] < 1 && this.tokL[i] < this.nScan) continue;
      n--; this.tokL[i] = this.tokL[n]; this.tokT[i] = this.tokT[n]; this.tokC[i] = this.tokC[n]; i--;
    }
    this.nTok = n;
    for (let i = 0; i < n; i++) {
      const t = this.tokT[i], j = this.tokL[i] * 3, a = this.chuteA, b = this.chuteB, s = 1 - 0.4 * t;
      this.M.makeScale(s, s, s).setPosition(a[j] + (b[j] - a[j]) * t, a[j + 1] + (b[j + 1] - a[j + 1]) * t + 0.12 + 0.1 * Math.sin(Math.PI * t), a[j + 2] + (b[j + 2] - a[j + 2]) * t);
      this.tokens.setMatrixAt(i, this.M); this.tokens.setColorAt(i, this.C.setHex(this.tokC[i]).multiplyScalar(1.6));
    }
    if (n || this.tokens.count) { this.tokens.count = n; this.tokens.instanceMatrix.needsUpdate = true; if (this.tokens.instanceColor) this.tokens.instanceColor.needsUpdate = true; }
    // puts: a ring that opens out from the spot and is gone
    let np = this.nPut;
    const P = this.putP;
    for (let i = 0; i < np; i++) {
      P[i * 4 + 3] += dt / PUT_T;
      if (P[i * 4 + 3] < 1) continue;
      np--; for (let k = 0; k < 4; k++) P[i * 4 + k] = P[np * 4 + k]; this.putC[i] = this.putC[np]; i--;
    }
    this.nPut = np;
    for (let i = 0; i < np; i++) {
      const k = P[i * 4 + 3], f = (1 - k) * (1 - k), sc = 0.32 + 0.6 * (1 - f);
      this.M.makeScale(sc, 1, sc).setPosition(P[i * 4], P[i * 4 + 1], P[i * 4 + 2]);
      this.putFx.setMatrixAt(i, this.M); this.putFx.setColorAt(i, this.C.setHex(this.putC[i]).multiplyScalar(2.4 * f));
    }
    if (np || this.putFx.count) { this.putFx.count = np; this.putFx.instanceMatrix.needsUpdate = true; if (this.putFx.instanceColor) this.putFx.instanceColor.needsUpdate = true; }
  }
  // ---------- pipes ----------
  /** Which way each pipe network runs, worked out with the layout: every pipe tile's distance from the pump (or refinery)
   *  that feeds its network, through the pipes and under the tunnels, and which of its sides lead back toward it. */
  private pipeFlow(F: Factory, nets: PNet[]) {
    const dist = new Map<number, number>();
    for (const net of nets) {
      const src = (f: Fac | undefined) => !!f && !!FLUID_OF[f.type] && net.prod.includes(f) && (!net.forced || FLUID_OF[f.type] === net.forced);
      const q: Fac[] = [];
      for (const p of net.pipes) for (let d = 0; d < 6 && !dist.has(p.id); d++) { const [nx, nz] = neighbor(p.cx, p.cz, d); if (src(F.facAt(nx, nz))) { dist.set(p.id, 0); q.push(p); } }
      // no producer on the network (its pumpjack was sold while the line still holds fluid, or a refinery's input line was
      // cut off): what is left drains toward the consumers, so the distance is counted back from them instead
      const sink = !q.length;
      if (sink) {
        const tw = net.towers as { cx: number; cz: number }[];
        for (const p of net.pipes) for (let d = 0; d < 6 && !dist.has(p.id); d++) {
          const [nx, nz] = neighbor(p.cx, p.cz, d), o = F.facAt(nx, nz);
          if ((o && net.cons.includes(o)) || tw.some((t) => t.cx === nx && t.cz === nz)) { dist.set(p.id, 0); q.push(p); }
        }
        if (!q.length && net.pipes.length) { dist.set(net.pipes[0].id, 0); q.push(net.pipes[0]); }
      }
      let far = 0;
      for (let k = 0; k < q.length; k++) {
        const p = q[k], dp = dist.get(p.id)!;
        far = Math.max(far, dp);
        const go = (o: Fac | undefined) => { if (o && pipeLike(o.type) && o.net === p.net && !dist.has(o.id)) { dist.set(o.id, dp + 1); q.push(o); } };
        for (let d = 0; d < 6; d++) { const [nx, nz] = neighbor(p.cx, p.cz, d); go(F.facAt(nx, nz)); }
        if (p.type === 'ptunnel' && p.pair) go(F.facById(p.pair));
      }
      if (sink) for (const p of net.pipes) if (dist.has(p.id)) dist.set(p.id, far - dist.get(p.id)!);
      for (const p of net.pipes) {
        const v = this.vis.get(p.id), dp = dist.get(p.id) ?? 0;
        if (!v) continue;
        let mask = 0;
        for (let d = 0; d < 6; d++) {
          const [nx, nz] = neighbor(p.cx, p.cz, d), o = F.facAt(nx, nz);
          if (o && (pipeLike(o.type) ? o.net === p.net && (dist.get(o.id) ?? 0) < dp : src(o))) mask |= 1 << d;
        }
        v.fD = dp; v.fMask = mask;
      }
    }
  }
  /**
   * The pipe state texture, every frame: per pipe tile (distance from the pump, upstream sides + 64 * fluid, the level
   * shown, how far the network's fluid has run). A network's level follows its real fill, but never shows under FLOW_FILL
   * while fluid is being pumped through it (a busy line is drained as fast as it is fed); it rises quickly, drains slowly,
   * and an emptied network keeps its fluid's look until the level shown has run out. The fluid runs (the phase advances, in
   * sim seconds) while a producer feeds the network or it is being drained, and eases to a stop with it.
   */
  private syncPipes(F: Factory, dt: number, relaid: boolean) {
    const nets = F.pipeNets as unknown as PNet[];
    if (relaid) { this.pipeData.fill(0); this.pipeFlow(F, nets); this.pipeTex.needsUpdate = true; }
    if (!nets.length) { if (this.pipeSt.size) this.pipeSt.clear(); return; }
    const D = this.pipeData;
    for (let n = 0; n < nets.length; n++) {
      const net = nets[n];
      if (!net.pipes.length) continue;
      const id = net.pipes[0].id, real = net.cap > 0 ? Math.min(1, net.amt / net.cap) : 0;
      // (a line that is drained as fast as it is fed holds next to nothing, and the factory then calls it empty: what its
      // working producer pumps into it is what it carries)
      let st = this.pipeSt.get(id), fed = false, fl = net.fluid || net.forced;
      // (keyed by the network's first pipe: when a new pipe comes first, or two networks merge, the state carries over from
      // a pipe of it that had one, so a full line does not refill on screen)
      if (!st) for (let i = 1; i < net.pipes.length; i++) {
        const o = this.pipeSt.get(net.pipes[i].id);
        if (o && o.seen !== this.frame) { st = o; this.pipeSt.delete(net.pipes[i].id); this.pipeSt.set(id, st); break; }
      }
      if (this.live) for (let i = 0; i < net.prod.length && !fed; i++) {
        const o = FLUID_OF[net.prod[i].type];
        if (o && net.prod[i].state === 'ok' && (!fl || o === fl)) { fed = true; fl = o; }
      }
      const kind = fl && (net.amt > 0.005 || fed) ? FLUID_TYPES.indexOf(fl) + 1 : 0;
      const flowing = this.live && kind > 0 && (fed || (!!st && st.last - net.amt > 1e-4));
      const tgt = flowing ? FLOW_FILL + (1 - FLOW_FILL) * real : real;
      if (!st) this.pipeSt.set(id, (st = { shown: tgt, phase: 0, act: flowing ? 1 : 0, last: net.amt, kind, seen: 0 }));
      st.shown += (tgt - st.shown) * Math.min(1, dt * (tgt > st.shown ? 2.4 : 0.8));
      st.act += ((flowing ? 1 : 0) - st.act) * Math.min(1, dt * 2.5);
      if (kind) st.kind = kind;
      // (the patterns' frequencies have no common period, so any wrap shows as a jump: it comes after 16384 tiles of flow, over
      // three hours of petrol running without a break, and a float32 phase that large is still exact to about 0.001 tile)
      st.phase = (st.phase + this.simDt * FLOW_SPEED[st.kind] * st.act) % 16384;
      st.last = net.amt; st.seen = this.frame;
      const k = st.shown > 0.004 ? st.kind : 0;
      for (let i = 0; i < net.pipes.length; i++) {
        const p = net.pipes[i], v = this.vis.get(p.id);
        if (!v || p.cx < 0 || p.cz < 0 || p.cx >= GW || p.cz >= GH) continue;
        const o = (p.cz * PT_W + 2 * p.cx + (p.cz & 1)) * 4;
        D[o] = v.fD; D[o + 1] = v.fMask + 64 * k; D[o + 2] = st.shown; D[o + 3] = st.phase;
        v.fluidKey = k;
      }
    }
    if (relaid) for (const [id, st] of this.pipeSt) if (st.seen !== this.frame) this.pipeSt.delete(id);
    this.pipeTex.needsUpdate = true;
  }

  // ---------- Transfer Arms ----------
  /** The instanced parts with room for n arms: from the model when it is loaded, else plain shapes on the same joints. */
  private armParts(n: number): ArmBatch {
    const src = this.modelOf('arm'), old = this.arms;
    if (old && old.cap >= n && old.model === !!src) return old;
    const cap = Math.max(32, n, old && old.model === !!src ? old.cap * 2 : 0);
    // (InstancedMesh.dispose frees its instance buffers; the geometries and materials are shared, except `own`)
    if (old) { for (const ms of old.parts) for (const m of ms) { this.group.remove(m); m.dispose(); } this.group.remove(old.lamp); old.lamp.dispose(); for (const o of old.own) o.dispose(); }
    const own: (THREE.BufferGeometry | THREE.Material)[] = [], parts: THREE.InstancedMesh[][] = [], dim: ArmDim = { ...ARM_DIM };
    const inst = (g: THREE.BufferGeometry, m: THREE.Material, k: number, shadow: boolean) => {
      const o = new THREE.InstancedMesh(g, m, cap * k);
      o.count = 0; o.frustumCulled = false; o.castShadow = shadow; o.receiveShadow = true; this.group.add(o);
      return o;
    };
    let lampG: THREE.BufferGeometry | null = null;
    if (src) {
      // a node's own meshes: itself, or (several materials) the meshes right under it that are not nodes of their own
      const NODES = new Set([...ARM_NODES, 'lamp', 'fingerR']);
      const meshes = (o: THREE.Object3D | undefined) => !o ? [] : (o as THREE.Mesh).isMesh ? [o as THREE.Mesh] : (o.children.filter((c) => (c as THREE.Mesh).isMesh && !NODES.has(c.name)) as THREE.Mesh[]);
      ARM_NODES.forEach((name, i) => parts.push(meshes(src.getObjectByName(name)).map((me) => inst(me.geometry, me.material as THREE.Material, i === P_FINGER ? 2 : 1, me.castShadow))));
      const lamp = src.getObjectByName('lamp');
      if (lamp) for (const me of meshes(lamp)) {
        const g = me.geometry.clone().translate(lamp.position.x, lamp.position.y, lamp.position.z);
        own.push(g);
        if ((me.material as THREE.Material).name === 'glow_lamp') lampG = g; else parts[P_BASE].push(inst(g, me.material as THREE.Material, 1, false));
      }
      const t = src.getObjectByName('turn'), u = src.getObjectByName('upper'), f = src.getObjectByName('fore'), w = src.getObjectByName('wrist'), fl = src.getObjectByName('fingerL');
      if (t && u && f && w && fl) { dim.turnY = t.position.y; dim.shY = u.position.y; dim.L1 = f.position.y; dim.L2 = w.position.y; dim.fx = fl.position.x; dim.fy = fl.position.y; }
    } else {
      const bx = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z), c = FACS.arm.color;
      const G: [THREE.BufferGeometry, THREE.Material][] = [
        [geo('armF0', () => new THREE.CylinderGeometry(0.78, 0.8, 0.07, 6).rotateY(Math.PI / 6).translate(0, 0.035, 0)), mat(HULL, 'dark')],
        [geo('armF1', () => merge([new THREE.CylinderGeometry(0.3, 0.33, 0.2, 12).translate(0, 0.1, 0), bx(0.32, 0.5, 0.2, 0, 0.3, 0)])), mat(TRIM, 'dark')],
        [geo('armF2', () => bx(0.17, dim.L1, 0.14, 0, dim.L1 / 2, 0)), mat(c)],
        [geo('armF3', () => bx(0.13, dim.L2, 0.1, 0, dim.L2 / 2, 0)), mat(c)],
        [geo('armF4', () => merge([bx(0.6, 0.055, 0.11, 0, 0.115, 0), bx(0.1, 0.12, 0.1, 0, 0.05, 0)])), mat(HULL, 'dark')],
        [geo('armF5', () => bx(0.045, 0.27, 0.1, 0, 0.15, 0)), mat(TRIM, 'dark')],
      ];
      G.forEach(([g, m], i) => parts.push([inst(g, m, i === P_FINGER ? 2 : 1, true)]));
    }
    if (!lampG) lampG = geo('armLamp', () => new THREE.SphereGeometry(0.08, 10, 6).translate(0.5, 0.63, -0.42));
    const lm = new THREE.MeshBasicMaterial({ color: 0xffffff });
    own.push(lm);
    const lamp = inst(lampG, lm, 1, false);
    lamp.setColorAt(0, this.C.setHex(0xffffff));
    for (const v of this.vis.values()) if (v.rig) { v.rig.slot = -1; v.rig.lamp = -1; }
    return (this.arms = { model: !!src, cap, parts, lamp, dim, own });
  }
  /** What stands behind and in front of an arm, and where its hand picks and puts (worked out with the layout; over a belt
   *  the pick point then follows the item it will take, see armTrack). */
  private armEnds(F: Factory, a: Fac, g: ArmRig) {
    g.rev = F.rev;
    const hx = DX[a.dir], hz = DZ[a.dir], jb = armBack(a), jf = armFront(a), P = this.P2, K = TAKER_IN + 0.1;
    const qb = jb >= 0 ? F.facAt(jb % GW, (jb / GW) | 0) : undefined, qf = jf >= 0 ? F.facAt(jf % GW, (jf / GW) | 0) : undefined;
    const bx = a.x - 2 * hx, bz = a.z - 2 * hz, fx = a.x + 2 * hx, fz = a.z + 2 * hz;
    g.q = qb || null;
    if (!qb) { g.src = E_NONE; g.px = a.x - hx * 1.2; g.py = 0.3; g.pz = a.z - hz * 1.2; }
    else if (qb.type === 'belt') { g.src = E_BELT; this.beltPoint(qb, 0.5, P); g.px = P.x; g.py = Y_SURF; g.pz = P.z; }
    else if (qb.type === 'splitter') { g.src = E_SPLIT; g.px = bx + hx * 0.1; g.py = Y_SURF + 0.012; g.pz = bz + hz * 0.1; }
    else if (qb.type === 'tunnel') { g.src = E_TUNNEL; const k = qb.exit ? 0.92 : 0; g.px = bx + DX[qb.dir] * k; g.py = Y_SURF; g.pz = bz + DZ[qb.dir] * k; }
    else if (qb.type === 'arm') { g.src = E_ARM; g.px = a.x - hx; g.py = 0.8; g.pz = a.z - hz; }
    else { g.src = E_FAC; g.px = bx + hx * K; g.py = ARM_Y - 0.12; g.pz = bz + hz * K; }
    const tw = jf >= 0 && !qf ? F.towerOn(jf) : undefined;
    if (qf && qf.type === 'belt') { g.dst = E_BELT; this.beltPoint(qf, qf.dir === a.dir ? 0.02 : 0.5, P); g.dx = P.x; g.dy = Y_SURF; g.dz = P.z; }
    else if (qf && qf.type === 'splitter') { g.dst = E_SPLIT; g.dx = fx - hx * 0.6; g.dy = Y_SURF + 0.012; g.dz = fz - hz * 0.6; }
    else if (qf && qf.type === 'tunnel') { g.dst = E_TUNNEL; g.dx = fx - DX[qf.dir] * 0.95; g.dy = Y_SURF; g.dz = fz - DZ[qf.dir] * 0.95; }
    else if (qf && qf.type === 'arm') { g.dst = E_ARM; g.dx = a.x + hx; g.dy = 0.8; g.dz = a.z + hz; }
    else if (qf || tw) { g.dst = qf ? E_FAC : E_TOWER; g.dx = fx - hx * K; g.dy = (tw ? this.deck(fx, fz) : 0) + ARM_Y - 0.12; g.dz = fz - hz * K; }
    else { g.dst = E_NONE; g.dx = a.x + hx * 1.2; g.dy = 0.42; g.dz = a.z + hz * 1.2; }
  }
  /** An empty hand over a belt follows the item it will take: the frontmost one its target accepts (as Factory.pick chooses),
   *  also while that is still coming up the tile; the middle of the tile while there is none. */
  private armTrack(F: Factory, a: Fac, g: ArmRig) {
    const q = g.q!, items = q.items;
    let mask = F.acceptMask(armFront(a), a), p = 0.5;
    if (a.only) mask &= ITEM_BIT[a.only];
    for (let i = 0; i < items.length; i++) if (mask & ITEM_BIT[items[i].it]) { p = Math.max(0.1, items[i].p); break; }
    this.beltPoint(q, p, this.P2);
    g.px = this.P2.x; g.pz = this.P2.z;
  }
  /**
   * Pose and draw every arm. The hand's target follows Fac.prog: with an item from the pick point (0) up over the tile and
   * down to the drop point (0.5), empty the same way back (0.5 .. 1); the arm always turns the same way round, tucks in
   * as it passes its own pad and lifts quickly off either end. Waiting, it hovers open over where the next item will be
   * (over a belt it follows that item); holding something its target has no room for, it holds it over the target; with
   * nothing to do for a few seconds it lets its head hang. While time stands still an idle arm leans over its target (the
   * model's rest pose), so the way every arm works reads between waves. The hand is sprung toward the target (stiffer for a
   * faster arm), a release jolts it, the fingers snap shut on a pick and open on a put.
   */
  private syncArms(F: Factory, dt: number, time: number, dg: Map<string, Diag> | null) {
    const facs = F.facs;
    let n = 0;
    for (let i = 0; i < facs.length; i++) if (facs[i].type === 'arm') n++;
    this.heldN = 0;
    if (!n) { if (this.arms) { for (const ms of this.arms.parts) for (const m of ms) m.count = 0; this.arms.lamp.count = 0; } this.armMoving = false; return; }
    const b = this.armParts(n), D = b.dim, live = this.live, M = this.M, L = this.M2, A = this.M3, S = this.S;
    if (this.heldP.length < n * 5) this.heldP = new Float32Array(n * 10);
    const sub = Math.max(1, Math.min(4, Math.ceil(dt * 90))), h = Math.min(dt, 0.05) / sub, shAbs = D.turnY + D.shY;
    const put = (part: number, slot: number, m: THREE.Matrix4) => { const ms = b.parts[part]; for (let j = 0; j < ms.length; j++) ms[j].setMatrixAt(slot, m); };
    let k = 0, moving = false, lampCh = false;
    for (let i = 0; i < facs.length; i++) {
      const a = facs[i];
      if (a.type !== 'arm') continue;
      const v = this.vis.get(a.id);
      if (!v) continue;
      const g = v.rig || (v.rig = newRig());
      if (g.rev !== F.rev) this.armEnds(F, a, g);
      if (g.slot !== k) { g.slot = k; g.lamp = -1; }
      const hand = a.hand, prog = a.prog;
      if (hand && !g.had) g.since = 0; else g.since += dt;
      if (!hand && g.had) g.kick = 1;
      g.had = hand;
      if (g.src === E_BELT && !hand) this.armTrack(F, a, g);
      // the hand's target, about the arm's axis: turn (from the back side), reach, height
      const yawB = yawOf((a.dir + 3) % 6);
      // (turned with R: the hand stays where it is in the world and swings round from there, not snapped by 60 degrees)
      if (g.dir !== a.dir) { if (g.dir >= 0 && g.init) g.yaw = wrapPi(g.yaw + yawOf((g.dir + 3) % 6) - yawB); g.dir = a.dir; }
      const offP = wrapPi(Math.atan2(g.px - a.x, g.pz - a.z) - yawB), offD = wrapPi(Math.atan2(g.dx - a.x, g.dz - a.z) - yawB - Math.PI);
      const rP = Math.hypot(g.px - a.x, g.pz - a.z), rD = Math.hypot(g.dx - a.x, g.dz - a.z);
      const idle = !hand && prog === 0;
      let ty: number, tr: number, tyaw: number;
      if (live && a.state !== 'ok') g.wait += dt; else if (live) g.wait = 0;
      if (idle && !live) { tyaw = Math.PI; tr = ARM_REST_R; ty = ARM_REST_Y; }
      else {
        const u = hand ? Math.min(1, prog * 2) : prog > 0 ? sat01((1 - prog) * 2) : 0;
        const su = sat01((u - 0.1) / 0.8), s = su * su * (3 - 2 * su), tuck = Math.sin(Math.PI * s), w = Math.pow(Math.sin(Math.PI * u), 0.6);
        tyaw = offP + (Math.PI + offD - offP) * s;
        const rl = rP + (rD - rP) * s, yl = g.py + (g.dy - g.py) * s;
        tr = rl + (0.42 - rl) * 0.7 * tuck;
        ty = yl + Math.max(0, (hand ? ARM_CARRY_Y : 0.86) - yl) * w;
        if (hand && prog >= 0.5) {
          // it cannot put it down (the target is full): it holds the item over the target
          ty += 0.16; tr -= 0.08;
          if (live) ty += 0.012 * Math.sin(time * 2.6 + a.id);
        } else if (idle) {
          const sl = a.state === 'noinput' || a.state === 'idle' ? sstep(3.4, 4.6, g.wait) : 0, bob = live ? 1 - 0.6 * sl : 0;
          ty += g.src === E_FAC ? 0.05 : 0.13;
          if (g.src === E_FAC || g.src === E_ARM) tr -= 0.16;
          tr += (ARM_SLUMP_R - tr) * sl; ty += (ARM_SLUMP_Y - ty) * sl;
          ty += 0.014 * bob * Math.sin(time * 2.1 + a.id * 1.7); tyaw += 0.018 * bob * Math.sin(time * 1.3 + a.id * 2.9);
        }
      }
      ty += 0.085 * g.kick;
      g.kick *= Math.exp(-dt * 11);
      if (g.kick < 0.002) g.kick = 0;
      if (!g.init) { g.init = true; g.yaw = tyaw; g.r = tr; g.y = ty; }
      else {
        const W = 46 + 14 * (a.lvl - 1), W2 = W * W, Z2 = 1.6 * W;
        for (let q = 0; q < sub; q++) {
          g.vyaw += (W2 * (tyaw - g.yaw) - Z2 * g.vyaw) * h; g.yaw += g.vyaw * h;
          g.vr += (W2 * (tr - g.r) - Z2 * g.vr) * h; g.r += g.vr * h;
          g.vy += (W2 * (ty - g.y) - Z2 * g.vy) * h; g.y += g.vy * h;
        }
        if (Math.abs(tyaw - g.yaw) + Math.abs(tr - g.r) + Math.abs(ty - g.y) > 0.003 || Math.abs(g.vyaw) + Math.abs(g.vr) + Math.abs(g.vy) > 0.02) moving = true;
      }
      g.open += ((hand ? 0 : 1) - g.open) * Math.min(1, dt * 28);
      // the chain: a two-link IK in the arm's plane, elbow up, the hand hanging straight down
      const sh = hand ? SHAPE_OF[hand] : null, gl = (sh && GRIP_OF[sh]) || GRIP;
      const wx = Math.max(0.1, g.r), wy = g.y + gl - shAbs;
      const d = Math.max(0.12, Math.min(D.L1 + D.L2 - 0.003, Math.hypot(wx, wy)));
      const a1 = Math.atan2(wx, wy) - Math.acos(Math.max(-1, Math.min(1, (D.L1 * D.L1 + d * d - D.L2 * D.L2) / (2 * D.L1 * d))));
      const a2 = Math.PI - Math.acos(Math.max(-1, Math.min(1, (D.L1 * D.L1 + D.L2 * D.L2 - d * d) / (2 * D.L1 * D.L2))));
      const sc = v.obj.scale.x, yw = yawB + g.yaw;
      M.makeRotationY(yawOf(a.dir));
      if (sc !== 1) M.scale(S.setScalar(sc));
      M.setPosition(a.x, 0, a.z);
      put(P_BASE, k, M); b.lamp.setMatrixAt(k, M);
      A.makeRotationY(yw);
      if (sc !== 1) A.scale(S.setScalar(sc));
      A.setPosition(a.x, D.turnY * sc, a.z);
      put(P_TURN, k, A);
      A.multiply(L.makeRotationX(a1).setPosition(0, D.shY, 0)); put(P_UPPER, k, A);
      A.multiply(L.makeRotationX(a2).setPosition(0, D.L1, 0)); put(P_FORE, k, A);
      A.multiply(L.makeRotationX(Math.PI - a1 - a2).setPosition(0, D.L2, 0)); put(P_WRIST, k, A);
      const gap = (sh ? GAP_OF[sh] : 0.2) + 0.02 + ARM_OPEN * g.open;
      M.multiplyMatrices(A, L.makeTranslation(gap, D.fy, 0)); put(P_FINGER, k * 2, M);
      M.multiplyMatrices(A, L.makeRotationY(Math.PI).setPosition(-gap, D.fy, 0)); put(P_FINGER, k * 2 + 1, M);
      // what it holds hangs between the fingers (for a moment after the pick it is still on its way up from where it lay)
      if (hand) {
        const gr = (D.L1 * Math.sin(a1) + D.L2 * Math.sin(a1 + a2)) * sc, gy = (shAbs + D.L1 * Math.cos(a1) + D.L2 * Math.cos(a1 + a2) - gl) * sc;
        const sy = Math.sin(yw), cy = Math.cos(yw), kk = sat01(g.since / 0.06), H = this.heldP, o = this.heldN * 5;
        H[o] = g.px + (a.x + sy * gr - g.px) * kk; H[o + 1] = g.py + (gy - g.py) * kk; H[o + 2] = g.pz + (a.z + cy * gr - g.pz) * kk; H[o + 3] = sy; H[o + 4] = cy;
        this.heldIt[this.heldN++] = hand;
      }
      // the lamp: the diagnosis while time stands still; in a wave green while it works (and for a few seconds between
      // items), amber once it has waited longer, red when it points at nothing that takes anything
      const dd = dg && dg.get(facKey(a.id));
      const c = dd ? (dd.ok ? LAMP.ok : LAMP.bad) : a.state === 'ok' || g.wait < 4 ? LAMP.ok : a.state === 'idle' ? LAMP.bad : LAMP.warn;
      const step = c === LAMP.ok ? 4 : Math.round(2 + 2 * Math.sin(time * 6 + a.id)), key = c * 8 + step;
      if (key !== g.lamp) { g.lamp = key; b.lamp.setColorAt(k, this.C.setHex(c).multiplyScalar(0.7 + 0.32 * step)); lampCh = true; }
      k++;
    }
    for (let p = 0; p < b.parts.length; p++) for (const m of b.parts[p]) {
      const cnt = p === P_FINGER ? k * 2 : k;
      m.count = cnt;
      m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, cnt * 16); m.instanceMatrix.needsUpdate = true;
    }
    b.lamp.count = k; b.lamp.instanceMatrix.needsUpdate = true;
    if (lampCh && b.lamp.instanceColor) b.lamp.instanceColor.needsUpdate = true;
    this.armMoving = moving;
  }

  /** Level marks: a band round the base of each upgraded building (bright for Mk3) and a pip per level on its front corner. */
  private syncLevels(F: Factory, key: number) {
    if (key === this.lvlKey) return;
    this.lvlKey = key;
    let nb = 0, np = 0;
    for (const fc of F.facs) {
      if (fc.lvl < 2 || nb >= MAX_LVL) continue;
      const c = this.C.setHex(LVL_COLOR[Math.min(3, fc.lvl)]).multiplyScalar(fc.lvl >= 3 ? 1.5 : 0.9);
      // (an arm stands on a small pad: its band lies round that, its pips low in front of it)
      const arm = fc.type === 'arm';
      if (arm) this.M.makeScale(0.775, 0.3, 0.775).setPosition(fc.x, 0, fc.z); else this.M.makeTranslation(fc.x, 0, fc.z);
      this.band.setMatrixAt(nb, this.M); this.band.setColorAt(nb++, c);
      for (let i = 0; i < fc.lvl; i++) {
        this.M.makeTranslation(fc.x + (i - (fc.lvl - 1) / 2) * 0.19, arm ? 0.16 : 0.3, fc.z + HEX_SIZE * (arm ? 0.66 : 0.8));
        this.pips.setMatrixAt(np, this.M); this.pips.setColorAt(np++, c);
      }
    }
    this.band.count = nb; this.pips.count = np;
    for (const m of [this.band, this.pips]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  private animate(fc: Fac, v: FVis, dg: Map<string, Diag> | null) {
    const dt = this.aDt, time = this.aTime;
    const sim = this.sim!, on = fc.state === 'ok' && this.live;
    if (v.lamps.length) {
      // while time stands still the lamp shows the diagnosis: green if it will get all it needs, red (blinking) if not
      const d = dg && dg.get(facKey(fc.id)), good = d ? d.ok : fc.state === 'ok';
      const c = d ? (d.ok ? LAMP.ok : LAMP.bad) : fc.state === 'ok' ? LAMP.ok : fc.state === 'nopower' || fc.state === 'nofuel' || fc.state === 'nodeposit' || fc.state === 'empty' ? LAMP.bad : LAMP.warn;
      const i = good ? 1.8 : 1.2 + 0.8 * Math.sin(time * 6 + fc.id);
      if (c !== v.lampC) { v.lampC = c; for (let k = 0; k < v.lamps.length; k++) { const m = v.lamps[k]; m.emissive.setHex(c); m.color.setHex(c).multiplyScalar(0.25); } }
      if (i !== v.lampI) { v.lampI = i; for (let k = 0; k < v.lamps.length; k++) v.lamps[k].emissiveIntensity = i; }
    }
    // working lights: lit (and flickering for the hot ones) while the building works, nearly dark while it idles
    if (v.glows.length) {
      const k = fc.type === 'splitter' ? (this.live ? 1 : 0.5) : fc.type === 'tunnel' ? (this.live ? 0.7 : 0.4) + 1.2 * v.flare : fc.type === 'ptunnel' ? (v.fluidKey > 0 ? 1 : 0.3) : !on ? 0.1 : fc.type === 'smelter' ? 1 + 0.3 * Math.sin(time * 13 + fc.id) : fc.type === 'generator' ? 1 + 0.3 * Math.sin(time * 11 + fc.id)
        : fc.type === 'press' || fc.type === 'cells' || fc.type === 'missiles' ? 1 + 0.25 * Math.sin(time * 8 + fc.id) : fc.type === 'refinery' ? 1 + 0.25 * Math.sin(time * 5) : 1;
      for (let n = 0; n < v.glows.length; n++) { const g = v.glows[n]; g.m.emissiveIntensity = g.i0 * k; }
    }
    // machines spin up over about a second and run down when they stop, instead of snapping
    v.spd += ((on ? 1 : 0) - v.spd) * Math.min(1, dt * 1.6);
    if (v.work) v.work.position.y = v.workY + 0.035 * v.spd * Math.sin(time * 5 + fc.id);
    switch (fc.type) {
      case 'mine': if (v.spin) v.spin.rotation.y += dt * 9 * v.spd; break;
      // the robot arm swings between the bay and the door, it does not whirl round
      case 'press': if (v.spin) { v.ph += dt * 1.7 * v.spd; v.spin.rotation.y = 1.15 * Math.sin(v.ph); } break;
      case 'cells': if (v.spin) v.spin.rotation.y += dt * 6 * v.spd; break; // the vat's agitator
      case 'missiles': if (v.spin) v.spin.rotation.y += dt * 0.5 * v.spd; break; // the turntable with the missiles on it: slowly
      case 'generator': if (v.spin) v.spin.rotation.y += dt * (0.5 + 13.5 * v.spd); break;
      case 'refinery': if (v.spin) v.spin.rotation.y += dt * (0.3 + 7.7 * v.spd); break;
      case 'splitter': {
        // the diverter swings round to the side the next item goes to (the model's turntable keeps turning under it)
        if (!v.spin || !this.live) break;
        if (v.turn) v.turn.rotation.y += dt * 1.3;
        let d = yawOf(fc.rr % 6) - v.spin.rotation.y;
        d -= Math.round(d / TAU) * TAU;
        v.spin.rotation.y += d * Math.min(1, dt * 9);
        break;
      }
      case 'pump': {
        if (!v.arm) break;
        v.ph += dt * 2.2 * v.spd;
        if (v.armX) pumpPose(v.arm, v.pitman, v.crank, v.ph);
        else v.arm.rotation.z = Math.sin(v.ph) * 0.32;
        break;
      }
      case 'tunnel': {
        // the mouth lights flare while an item runs through the portal (the entrance holds the items of both ends)
        if (!v.glows.length) break;
        const e = fc.exit ? sim.factory.facById(fc.pair) : fc, o = fc.exit && e ? hexDist(e.cx, e.cz, fc.cx, fc.cz) - 1 + PORTAL_OUT : PORTAL_IN;
        let hit = 0;
        if (e && this.live) for (const it of e.items) if (Math.abs(it.p - o) < 0.22) { hit = 1; break; }
        v.flare += (hit - v.flare) * Math.min(1, dt * (hit ? 14 : 5));
        break;
      }
      case 'pipe': case 'ptunnel': {
        // (the fluid itself is drawn from the pipe state texture, see syncPipes; a modelled shaft's pit light takes its colour)
        if (v.glows.length && v.glowK !== v.fluidKey) {
          const key = (v.glowK = v.fluidKey);
          for (const g of v.glows) { g.m.emissive.setHex(key ? FLUIDS[FLUID_TYPES[key - 1]].color : 0xf2a54a); g.m.color.copy(g.m.emissive).multiplyScalar(0.25); }
        }
        break;
      }
    }
  }
}

/** What a belt, splitter or tunnel exit (its entrance holds the items) has at its front, or null. */
function headOf(F: Factory, q: Fac): BeltItem | null {
  if (q.type === 'tunnel') { const e = q.exit ? F.facById(q.pair) : undefined; return e ? e.items[0] ?? null : null; }
  return q.items[0] ?? null;
}
/** A sagging cable (sag: share of the span) between two points, as a thin tube. */
function cable(a: [number, number, number], b: [number, number, number], sag: number, r: number): THREE.BufferGeometry {
  const N = 14, len = Math.hypot(b[0] - a[0], b[2] - a[2]), pts: THREE.Vector3[] = [];
  // a parabola close enough to the catenary for these spans
  for (let i = 0; i <= N; i++) { const k = i / N; pts.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k - 4 * k * (1 - k) * len * sag, a[2] + (b[2] - a[2]) * k)); }
  return strip(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), N * 2, r, 5, false));
}

/** The colour that stands for an item in the HUD. */
export const itemCss = (it: ItemType) => '#' + ITEMS[it].color.toString(16).padStart(6, '0');
export const ALL_ITEMS = ITEM_TYPES;

/** Heights and offsets of the things a supply route runs along (see cues.ts). */
export const ROUTE_GEOM = { POLE_Y, POLE_ARM, GEN_Y, PIPE_Y: PY + PR, RAIL_Y: Y_RAIL, ARM_Y, SOCK_Y, TAKER_IN, ARM_TOP: 1.05 };
/** The belt item shapes as one plain geometry each (position and normal only), for the holograms of what a tower or building lacks. */
export function holoGeos(): Partial<Record<ItemType, THREE.BufferGeometry>> {
  const parts = itemParts(), out: Partial<Record<ItemType, THREE.BufferGeometry>> = {}, mats = new Set<THREE.Material>();
  for (const it of ITEM_TYPES) {
    const ps = parts[SHAPE_OF[it]];
    out[it] = mergeGeometries(ps.map((q) => strip(q.geo.index ? q.geo.toNonIndexed() : q.geo.clone())))!;
  }
  for (const s of SHAPES) for (const q of parts[s]) { q.geo.dispose(); mats.add(q.mat); }
  for (const m of mats) m.dispose();
  return out;
}
