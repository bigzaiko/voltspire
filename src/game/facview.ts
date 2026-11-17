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
// Pipes are glass with the fluid visible inside (its level follows the network's fill, light pulses run along it). Splitters
// and tunnels are built here too. The supply connectors come from Factory.links(): a scanner arch over a belt where a tower
// or building draws from it (it flashes on every take), a glass branch from a pipe into its consumer, a drop cable from a
// pole to what it powers. Between waves the factory stands still, so nothing moves here either; the status lamps then show
// the supply diagnosis (Sim.diag), and the placement previews show what a pole or tunnel would connect to.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FACS, ITEMS, FLUIDS, FLUID_TYPES, ORE_TYPES, ORES, ITEM_TYPES, GW, GH, cellX, cellZ, MAKES, needsOf } from './data.ts';
import type { FacType, ItemType } from './data.ts';
import { FX_LAYER } from './world.ts';
import { HEX_SIZE, neighbor, hexDist, lineDir, disc, inBoard } from './hex.ts';
import type { Sim, Ev } from './sim.ts';
import type { Fac, Factory, BeltItem, Diag } from './factory.ts';
import { BELT_SPEED, POLE_REACH, SUPPLY, TUNNEL_REACH, pipeLike, turns } from './factory.ts';

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
/** A deposit chunk: a rough low-poly lump (built once the helpers below exist). */
let G_ROCK: THREE.BufferGeometry | null = null;
const G_CHEV = (() => {
  // a flat chevron pointing along +z
  const s = new THREE.Shape();
  s.moveTo(-0.32, -0.12); s.lineTo(0, 0.16); s.lineTo(0.32, -0.12); s.lineTo(0.32, -0.26); s.lineTo(0, 0.02); s.lineTo(-0.32, -0.26); s.closePath();
  // (laying the shape flat turns its +y to -z; the half turn about y points it along +z and keeps it facing up)
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2).rotateY(Math.PI);
})();
const G_LAMP = new THREE.SphereGeometry(0.1, 8, 6);
const MAX_ITEMS = 900, MAX_ROCKS = GW * GH * 3;

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
const WORK_GLOW: Partial<Record<FacType, number>> = { press: 0.45, works: 0.7, smelter: 0.75, cells: 0.6, missiles: 0.6 };

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

/**
 * A deposit's mark on the deck, white so each tile tints it with its ore colour: a mottled stain of blotches and veins that
 * fades out before the tile edge, inside a thin rim that keeps the deposit's outline readable at play zoom. The oil version
 * is a blobby pool, dense in the middle, for a glossy material.
 */
function oreTexture(oil: boolean): THREE.Texture {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!, m = S / 2;
  let seed = oil ? 7 : 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // the geometry's uv maps the hex's circumradius to the canvas half-width; corners point along +-v
  const hex = (r: number) => { g.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; g.lineTo(m + Math.cos(a) * r, m + Math.sin(a) * r); } g.closePath(); };
  const blob = (x: number, y: number, r: number, a: number, v = 255) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${v},${v},${v},${a})`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  };
  g.save(); hex(m * 0.95); g.clip();
  if (oil) {
    // a stained ground in the field's colour, and on it a dark pool (the map darkens the tint there) that the gloss shows off
    blob(m, m, m * 1.05, 0.62);
    for (let i = 0; i < 16; i++) { const a = rnd() * TAU, d = rnd() * m * 0.42; blob(m + Math.cos(a) * d, m + Math.sin(a) * d, m * (0.26 + rnd() * 0.22), 0.9, 120); }
    blob(m, m, m * 0.5, 0.85, 96);
  } else {
    blob(m, m, m * 0.98, 0.42);
    for (let i = 0; i < 46; i++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * m * 0.8; blob(m + Math.cos(a) * d, m + Math.sin(a) * d, 6 + rnd() * 24, 0.25 + rnd() * 0.45); }
    // veins: short random walks
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineCap = 'round';
    for (let v = 0; v < 7; v++) {
      let a = rnd() * TAU, d = rnd() * m * 0.5, x = m + Math.cos(a) * d, y = m + Math.sin(a) * d;
      g.lineWidth = 1.5 + rnd() * 2.5; g.beginPath(); g.moveTo(x, y);
      a = rnd() * TAU;
      for (let k = 0; k < 6; k++) { a += (rnd() - 0.5) * 1.3; x += Math.cos(a) * 12; y += Math.sin(a) * 12; g.lineTo(x, y); }
      g.stroke();
    }
  }
  g.restore();
  // the rim
  hex(m * 0.93); g.strokeStyle = `rgba(255,255,255,${oil ? 0.7 : 0.62})`; g.lineWidth = 4; g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

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
/** Pipe axis height, the glass tube's radius and the fluid core's radius inside it. */
const PY = 0.4, PR = 0.105, KR = 0.05;
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
function pipeGeo(mask: number, valve: boolean, shaft = false): THREE.BufferGeometry[] {
  const key = (shaft ? 'shaft' : 'pipe') + mask + +valve;
  const have = geos.get(key + 'b');
  if (have) return [have, geos.get(key + 'k')!, geos.get(key + 'f')!, geos.get(key + 'v')!];
  const sides: number[] = [];
  for (let d = 0; d < 6; d++) if (mask & (1 << d)) sides.push(d);
  const B: THREE.BufferGeometry[] = [], K: THREE.BufferGeometry[] = [], F: THREE.BufferGeometry[] = [], V: THREE.BufferGeometry[] = [];
  const arm = (d: number, from: number, to: number) => { B.push(along(tubeZ(PR, to - from, 14), d, from, to)); K.push(along(tubeZ(KR, to - from, 10), d, from, to)); };
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
  if (shaft) {
    // the shaft: a steel collar on a dark plinth with a cap; each arm runs into its side and a glass well in the cap shows
    // the fluid going down
    F.push(new THREE.CylinderGeometry(HEX_SIZE * 0.5, HEX_SIZE * 0.56, 0.06, 6).rotateY(Math.PI / 6).translate(0, 0.03, 0));
    F.push(new THREE.CylinderGeometry(0.27, 0.31, 0.5, 16).translate(0, 0.31, 0));
    F.push(new THREE.CylinderGeometry(0.33, 0.33, 0.05, 16).translate(0, 0.585, 0));
    F.push(new THREE.TorusGeometry(0.2, 0.025, 6, 18).rotateX(Math.PI / 2).translate(0, 0.62, 0));
    B.push(new THREE.CylinderGeometry(0.17, 0.17, 0.16, 16).translate(0, 0.68, 0));
    K.push(new THREE.CylinderGeometry(0.13, 0.13, 0.15, 12).translate(0, 0.675, 0));
    F.push(new THREE.CylinderGeometry(0.19, 0.19, 0.03, 16).translate(0, 0.77, 0));
    // a red hazard band round the collar
    V.push(new THREE.CylinderGeometry(0.315, 0.315, 0.06, 16, 1, true).translate(0, 0.45, 0));
    for (const d of sides) { arm(d, 0.26, 1); flange(d, 0.95); F.push(along(tubeZ(PR + 0.05, 0.05, 12), d, 0.27, 0.32)); }
  } else if (n === 0) {
    // a standpipe waiting for a neighbour
    B.push(new THREE.CylinderGeometry(0.15, 0.15, 0.56, 14).translate(0, 0.3, 0));
    K.push(new THREE.CylinderGeometry(0.11, 0.11, 0.5, 12).translate(0, 0.3, 0));
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
    K.push(new THREE.TubeGeometry(curve, 16, KR, 8, false));
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
      K.push(new THREE.CylinderGeometry(r * 0.8, r * 0.8, h * 0.9, 14).translate(0, PY, 0));
      for (const y of [PY - h / 2, PY + h / 2]) F.push(new THREE.CylinderGeometry(r + 0.025, r + 0.025, 0.045, 16).translate(0, y, 0));
      F.push(new THREE.CylinderGeometry(r * 0.75, r + 0.06, PY - h / 2, 16).translate(0, (PY - h / 2) / 2, 0));
      wheel(0, PY + h / 2, 0);
    }
  }
  const out = [merge(B), merge(K), merge(F), V.length ? merge(V) : new THREE.BufferGeometry()];
  ['b', 'k', 'f', 'v'].forEach((s, i) => geos.set(key + s, out[i]));
  return out;
}
/**
 * The fluid inside the glass: the fluid's colour, cut off level at `level` (world height: a part-full pipe shows a liquid
 * surface), and pulses of light that travel along the pipes (in world space, so they run on across tile joins).
 * level null: always full (the branch pipes into consumers).
 */
function fluidMat(color: number, level: number | null, clock: { value: number }, inst = false): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: inst ? 0xffffff : color, roughness: 0.18, metalness: 0.2, side: THREE.DoubleSide });
  const L = { value: level ?? 99 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFlowT = clock; sh.uniforms.uLevel = L;
    sh.vertexShader = 'varying vec3 vFlowW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n\tvFlowW = (modelMatrix * ' + (inst ? 'instanceMatrix * ' : '') + 'vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform float uFlowT;\nuniform float uLevel;\nvarying vec3 vFlowW;\n' + sh.fragmentShader
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n\tif (vFlowW.y > uLevel) discard;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\tfloat fw = 0.5 + 0.5 * sin(uFlowT * 3.2 - (vFlowW.x * 3.4 + vFlowW.z * 2.2));\n\ttotalEmissiveRadiance += diffuseColor.rgb * 0.18 + normalize(diffuseColor.rgb + 0.001) * (0.02 + 1.3 * pow(fw, 10.0));');
  };
  m.customProgramCacheKey = () => 'fluidcore' + +inst;
  return m;
}
/** Glass: nearly clear face-on, brighter and more solid at grazing angles, so the tube's outline reads round the fluid. */
function glassMat(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xcfe6ec, roughness: 0.04, metalness: 0.05, transparent: true, opacity: 0.08, depthWrite: false });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
      'float fres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2);\n\tdiffuseColor.a = mix(diffuseColor.a, 0.62, fres);\n\toutgoingLight += vec3(0.5, 0.66, 0.74) * fres * 0.34;\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'glass';
  return m;
}

// ---------- splitters and tunnels ----------
/** Types built here from plain shapes even when a model file exists. */
const DRAWN_HERE: ReadonlySet<FacType> = new Set<FacType>(['belt', 'pipe', 'splitter', 'tunnel', 'ptunnel']);
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
function wireEnd(q: Fac, x: number): [number, number, number] {
  return q.type === 'pole' ? [q.x + (x >= q.x ? POLE_ARM : -POLE_ARM), POLE_Y, q.z] : [q.x, GEN_Y, q.z];
}
/** The tunnel a new one at (cx, cz) would pair with (as Factory.pairTunnels does): for a belt tunnel the nearest unpaired one
 *  facing the same way ahead (or behind), for a pipe tunnel the nearest unpaired one in a straight line, within TUNNEL_REACH. */
function tunnelMate(F: Factory, type: FacType, cx: number, cz: number, dir: number): Fac | undefined {
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
/** Scanner over a belt (local frame: the belt runs along +z): half its width, its inner height and half its length. */
const SC_W = 0.53, SC_H = 0.48, SC_D = 0.3;
/** Height of the chute from a scanner to its taker, of a power socket on a building or tower, and how far in from the taker's centre either ends. */
const ARM_Y = 0.5, SOCK_Y = 0.78, TAKER_IN = 0.66;
/** Seconds a scanner's light flashes for a take, and an item token takes down the chute. */
const FLASH_T = 0.45, TOKEN_T = 0.32;
const MAX_LINKS = 512, MAX_TOKENS = 64, MAX_DASH = 900, MAX_MARK = 96, MAX_LVL = 256;
const SCAN_AMBER = new THREE.Color(0xf2a54a), SOCK_GREEN = new THREE.Color(0x9ccf6a);
/** The scanner's body: a housing the belt runs through (an airport scanner), with a frame round both openings and strips of
 *  curtain hanging in them that the items push through. */
const G_SCAN = () => geo('scan', () => {
  const p: THREE.BufferGeometry[] = [
    new THREE.BoxGeometry(SC_W * 2 + 0.08, 0.06, SC_D * 2).translate(0, SC_H + 0.03, 0),
    new THREE.BoxGeometry(0.62, 0.09, SC_D * 2 - 0.18).translate(0, SC_H + 0.105, 0),
  ];
  for (const s of [-1, 1]) {
    p.push(new THREE.BoxGeometry(0.06, SC_H, SC_D * 2).translate(s * SC_W, SC_H / 2, 0));
    p.push(new THREE.BoxGeometry(SC_W * 2 + 0.14, 0.08, 0.07).translate(0, SC_H + 0.04, s * SC_D));
    for (const x of [-1, 1]) p.push(new THREE.BoxGeometry(0.09, SC_H, 0.07).translate(x * (SC_W + 0.01), SC_H / 2, s * SC_D));
    for (let i = 0; i < 6; i++) p.push(new THREE.BoxGeometry(0.15, 0.2, 0.012).translate((i - 2.5) * 0.165, SC_H - 0.1, s * (SC_D - 0.045)));
  }
  return merge(p);
});
/** The scanner's light: a strip along the top of both walls and a scan line across the roof. */
const G_SCAN_LIGHT = () => geo('scanLight', () => merge([
  ...[-1, 1].map((s) => new THREE.BoxGeometry(0.035, 0.035, SC_D * 2 - 0.12).translate(s * (SC_W + 0.035), SC_H - 0.05, 0)),
  new THREE.BoxGeometry(0.5, 0.025, 0.09).translate(0, SC_H + 0.155, 0),
]));
/** A chute along +z from the origin, one unit long (scaled to its length), and the socket at either end of a link. */
const G_ARM = () => geo('arm', () => merge([new THREE.BoxGeometry(0.17, 0.11, 1).translate(0, 0, 0.5), ...[-1, 1].map((s) => new THREE.BoxGeometry(0.03, 0.05, 1).translate(s * 0.085, 0.065, 0.5))]));
const G_ARM_LIGHT = () => geo('armLight', () => new THREE.BoxGeometry(0.07, 0.02, 0.92).translate(0, 0.06, 0.5));
const G_SOCK = () => geo('sock', () => merge([new THREE.BoxGeometry(0.22, 0.22, 0.1).translate(0, 0, 0.05), new THREE.BoxGeometry(0.28, 0.05, 0.14).translate(0, -0.13, 0.04)]));
const G_SOCK_LIGHT = () => geo('sockLight', () => new THREE.BoxGeometry(0.12, 0.06, 0.03).translate(0, 0.04, 0.11));
/** The branch from a pipe tile's edge into the consumer beside it (along +z from the pipe tile's centre): glass, core, steel. */
const BR_A = 0.96, BR_B = 1.36;
const G_BRANCH = () => geo('branch', () => merge([lying(new THREE.CylinderGeometry(PR, PR, BR_B - BR_A, 14)).translate(0, PY, (BR_A + BR_B) / 2)]));
const G_BRANCH_CORE = () => geo('branchCore', () => merge([lying(new THREE.CylinderGeometry(KR, KR, BR_B - BR_A, 10)).translate(0, PY, (BR_A + BR_B) / 2)]));
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
  /** pipes and pipe tunnels: the four meshes (glass, core, fittings, valve), the side mask they were built for, the fluid state they show (see animate) */
  pipe: THREE.Mesh[]; mask: number; fluidKey: number;
}

export class FacView {
  private group = new THREE.Group();
  private sim: Sim | null = null;
  private models: () => Record<string, THREE.Object3D>;
  private vis = new Map<number, FVis>();
  private frame = 0;
  private ores: THREE.InstancedMesh; private pools: THREE.InstancedMesh; private rocks: THREE.InstancedMesh;
  /** each deposit chunk's tile and its matrix (chunks on a built tile are hidden: they would poke through a belt) */
  private rockTile = new Int32Array(MAX_ROCKS); private rockM = new Float32Array(MAX_ROCKS * 16); private zero = new THREE.Matrix4().makeScale(0, 0, 0);
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
  private pt: PathPt = { x: 0, z: 0, tx: 0, tz: 0 };
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
  /** whether the factory runs this frame (it stands still between waves: nothing moves on the belts, machines idle) */
  private live = true;
  private pipeFit = mat(0x77706a, 'dark'); private pipeValve = new THREE.MeshStandardMaterial({ color: 0x9a2f1e, roughness: 0.45, metalness: 0.4 });
  /** pipes: the glass, the fluid core per fluid state (see coreMat), the flow clock (stops with the factory), the networks last seen */
  private glass = glassMat(); private coreMats = new Map<number, THREE.MeshStandardMaterial>(); private flowT = { value: 0 }; private nets: unknown = null;
  /** supply connectors: belt scanners with their light and chute, sockets, pipe branches, and the power drop cables */
  private scan: THREE.InstancedMesh; private scanLight: THREE.InstancedMesh; private chute: THREE.InstancedMesh; private chuteLight: THREE.InstancedMesh;
  private sock: THREE.InstancedMesh; private sockLight: THREE.InstancedMesh;
  private branch: THREE.InstancedMesh; private branchCore: THREE.InstancedMesh; private branchFit: THREE.InstancedMesh;
  private drops: THREE.Mesh;
  private linkRef: unknown = null; private linkLayout = -1;
  /** per belt link: its scanner's light slot, the chute's two ends (x, y, z), and how bright its flash still is */
  private nScan = 0; private chuteA = new Float32Array(MAX_LINKS * 3); private chuteB = new Float32Array(MAX_LINKS * 3); private flash = new Float32Array(MAX_LINKS);
  /** takers ('t' + id / 'f' + id) to their belt links, to light the right scanner on a 'take' */
  private takers = new Map<string, number[]>(); private scanAt = new Float32Array(MAX_LINKS * 2);
  /** per pipe branch: the pipe it hangs on and the fluid state it shows */
  private brFrom = new Int32Array(MAX_LINKS); private brKey = new Int32Array(MAX_LINKS); private nBranch = 0;
  /** items sliding down a chute after a take: link, age, colour */
  private tokens: THREE.InstancedMesh; private tokL = new Int16Array(MAX_TOKENS); private tokT = new Float32Array(MAX_TOKENS); private tokC = new Int32Array(MAX_TOKENS); private nTok = 0;
  /** placement and selection previews: tile fills, tile rings and dashes (wires to be, tunnel pairs) */
  private pvFill: THREE.InstancedMesh; private pvRing: THREE.InstancedMesh; private pvDash: THREE.InstancedMesh;
  private pvGhost: { type: FacType; cx: number; cz: number; dir: number } | null = null; private pvSel: { cx: number; cz: number } | null = null;
  private pvKey = ''; private pvRev = -1;
  /** level marks on upgraded buildings */
  private band: THREE.InstancedMesh; private pips: THREE.InstancedMesh; private lvlKey = -1;

  constructor(scene: THREE.Scene, models: () => Record<string, THREE.Object3D> = () => ({})) {
    this.models = models;
    scene.add(this.group);
    // deposits: a mottled stain in the ore's colour with a thin rim (it marks the tile without painting over the deck), a glossy
    // pool for oil, and chunks of ore and rock lying on it
    const stain = oreTexture(false), pool = oreTexture(true);
    const decal = (map: THREE.Texture, rough: number, metal: number) => new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: rough, metalness: metal, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.ores = new THREE.InstancedMesh(G_HEXF, decal(stain, 0.8, 0.25), GW * GH);
    this.pools = new THREE.InstancedMesh(G_HEXF, decal(pool, 0.1, 0.15), GW * GH);
    G_ROCK ??= flat(rough(new THREE.DodecahedronGeometry(0.2, 0), 0.3, 11));
    this.rocks = new THREE.InstancedMesh(G_ROCK, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.35 }), MAX_ROCKS);
    for (const m of [this.ores, this.pools, this.rocks]) { m.count = 0; m.frustumCulled = false; this.group.add(m); }
    this.rocks.castShadow = true; this.rocks.receiveShadow = true; this.ores.receiveShadow = this.pools.receiveShadow = true;
    // (the stains are see-through decals: kept out of the AO pre-pass, which would draw them as solid surfaces)
    this.ores.layers.set(FX_LAYER); this.pools.layers.set(FX_LAYER);
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
    this.scan = inst(G_SCAN(), steel, MAX_LINKS, true);
    this.scanLight = inst(G_SCAN_LIGHT(), lit(), MAX_LINKS, false, true);
    this.chute = inst(G_ARM(), steel, MAX_LINKS, true);
    this.chuteLight = inst(G_ARM_LIGHT(), lit(), MAX_LINKS, false, true);
    this.sock = inst(G_SOCK(), mat(0x37322d, 'dark'), MAX_LINKS * 2, true);
    this.sockLight = inst(G_SOCK_LIGHT(), lit(), MAX_LINKS * 2, false, true);
    this.branch = inst(G_BRANCH(), this.glass, MAX_LINKS);
    this.branchCore = inst(G_BRANCH_CORE(), fluidMat(0xffffff, null, this.flowT, true), MAX_LINKS, false, true);
    this.branchFit = inst(G_BRANCH_FIT(), this.pipeFit, MAX_LINKS, true);
    this.branch.layers.set(FX_LAYER);
    this.drops = new THREE.Mesh(new THREE.BufferGeometry(), wireMat);
    this.drops.frustumCulled = false; this.drops.castShadow = true;
    this.group.add(this.drops);
    this.tokens = inst(new THREE.OctahedronGeometry(0.075, 0), lit(), MAX_TOKENS, false, true);
    const see = (o: number) => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: o, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.pvFill = inst(G_HEXF, see(0.11), MAX_MARK, false, true, scene);
    this.pvRing = inst(G_HEX_RING(), see(0.9), MAX_MARK, false, true, scene);
    this.pvDash = inst(G_BOX(), see(0.85), MAX_DASH, false, true, scene);
    for (const m of [this.pvFill, this.pvRing, this.pvDash]) { m.layers.set(FX_LAYER); m.renderOrder = 4; }
    this.band = inst(G_BAND(), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), MAX_LVL, false, true);
    this.pips = inst(G_PIP(), lit(), MAX_LVL * 3, false, true);
  }

  setSim(sim: Sim | null) {
    this.sim = sim;
    for (const v of this.vis.values()) this.drop(v);
    this.vis.clear(); this.wireKey = -1; this.sparks.length = 0; this.glint.count = 0; this.layout = -1; this.lastT = -1;
    for (const s of SHAPES) for (const p of this.itemMeshes[s]) p.mesh.count = 0;
    this.ores.count = 0; this.pools.count = 0; this.rocks.count = 0;
    for (const b of this.beltBatches.values()) { b.n = 0; b.body.count = 0; b.light.count = 0; }
    this.beltDirty = true; this.nets = null; this.linkRef = null; this.linkLayout = -1; this.lvlKey = -1; this.nTok = 0; this.tokens.count = 0;
    this.pvGhost = null; this.pvSel = null; this.pvKey = '';
    this.setGhost(null);
    this.syncPreview();
    if (!sim) { this.clearLinks(); this.band.count = this.pips.count = 0; return; }
    // deposits: a stain (or for oil a pool) turned at random so neighbouring tiles do not repeat, and a cluster of chunks on it
    const ore = sim.factory.ore;
    let n = 0, np = 0, r = 0, seed = 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < GW * GH; i++) {
      if (!ore[i]) continue;
      const cx = i % GW, cz = Math.floor(i / GW), x = cellX(cx, cz), z = cellZ(cz), o = ORE_TYPES[ore[i] - 1], c = ORES[o].color;
      this.M.makeRotationY(Math.floor(rnd() * 6) * (Math.PI / 3)).setPosition(x, 0.03, z);
      if (o === 'oil') { this.pools.setMatrixAt(np, this.M); this.pools.setColorAt(np, this.C.setHex(c)); np++; }
      else { this.ores.setMatrixAt(n, this.M); this.ores.setColorAt(n, this.C.setHex(c).multiplyScalar(o === 'coal' ? 0.95 : 0.85)); n++; }
      // chunks: ore-coloured lumps among dark matrix rock (coal: all glossy black); oil only has a few seeps
      const k = o === 'oil' ? 0 : 5, a0 = rnd() * TAU;
      for (let j = 0; j < k && r < MAX_ROCKS; j++) {
        const a = a0 + j * 2.4 + rnd() * 0.6, d = 0.12 + rnd() * 0.5, big = j < 2, s = big ? 0.85 + rnd() * 0.45 : 0.4 + rnd() * 0.35;
        this.P.set(x + Math.cos(a) * d, 0.03 + s * 0.04, z + Math.sin(a) * d);
        this.Q.setFromEuler(this.E.set(rnd() * 3, rnd() * 3, rnd() * 3));
        this.S.set(s, s * (0.55 + rnd() * 0.25), s * (0.8 + rnd() * 0.4));
        this.M.compose(this.P, this.Q, this.S);
        this.rocks.setMatrixAt(r, this.M); this.M.toArray(this.rockM, r * 16); this.rockTile[r] = i;
        if (o === 'coal') this.C.setHex(0x1b1917).multiplyScalar(0.8 + rnd() * 0.5);
        else if (j % 3 === 2) this.C.setHex(0x3b3631).multiplyScalar(0.8 + rnd() * 0.4);
        else this.C.setHex(c).multiplyScalar(1.05 + rnd() * 0.35);
        this.rocks.setColorAt(r, this.C);
        r++;
      }
    }
    this.ores.count = n; this.pools.count = np; this.rocks.count = r;
    for (const m of [this.ores, this.pools, this.rocks]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  handle(evs: Ev[]) {
    for (const e of evs) {
      if (e.k === 'mats') this.sparks.push({ x: e.x, z: e.z, t: 0 });
      else if (e.k === 'take') this.took(e.who, e.x, e.z, e.it);
    }
  }
  /** A tower or building took an item off a belt: flash the scanner over that belt (the one on that tile, else any of its
   *  taker's) and send a token of the item's colour down its chute. */
  private took(who: string, x: number, z: number, it: ItemType) {
    const l = this.takers.get(who);
    if (!l || !l.length) return;
    let i = l[0];
    for (const j of l) if (Math.abs(this.scanAt[j * 2] - x) < 0.01 && Math.abs(this.scanAt[j * 2 + 1] - z) < 0.01) { i = j; break; }
    this.flash[i] = 1;
    if (this.nTok >= MAX_TOKENS) return;
    const k = this.nTok++;
    this.tokL[k] = i; this.tokT[k] = 0; this.tokC[k] = ITEMS[it]?.color ?? 0xffffff;
  }

  /** The ghost of a factory building where it would go (null hides it), with what it would connect to (see syncPreview). */
  setGhost(type: FacType | null, cx = 0, cz = 0, dir = 0, ok = true) {
    this.ghost.visible = !!type && ok;
    const g = this.pvGhost;
    if (!type || !ok) { if (g) { this.pvGhost = null; this.syncPreview(); } }
    else if (!g || g.type !== type || g.cx !== cx || g.cz !== cz || g.dir !== dir) { this.pvGhost = { type, cx, cz, dir }; this.syncPreview(); }
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
      if (turns(type)) {
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
  /** The factory building selected on a tile (on false clears it): a pole or generator shows its reach and what it powers, a tunnel its partner. */
  setSelected(cx: number, cz: number, on: boolean) {
    const s = this.pvSel;
    if (!on) { if (s) { this.pvSel = null; this.syncPreview(); } return; }
    if (!s || s.cx !== cx || s.cz !== cz) { this.pvSel = { cx, cz }; this.syncPreview(); }
  }

  /**
   * Placement and selection previews, worked out again when the ghost moves, the selection changes or the layout does:
   *  - a pole or generator: the tiles it powers (SUPPLY), dashed wires to every pole or generator it joins (POLE_REACH), and
   *    a ring on each building or tower it powers (for a placed one: what it does power, with a dashed drop to each);
   *  - a belt or pipe tunnel: a dashed line on the deck to the end it pairs with and a ring there, or (no partner) faint
   *    rings on the tiles a partner could stand on.
   */
  private syncPreview() {
    const sim = this.sim, g = this.pvGhost, s = this.pvSel;
    const F = sim?.factory, sel = s && F ? F.facAt(s.cx, s.cz) : undefined;
    const key = !F ? '' : g ? `g${g.type}:${g.cx}:${g.cz}:${g.dir}` : sel ? `s${sel.id}` : '';
    if (key === this.pvKey && (!F || F.rev === this.pvRev)) return;
    this.pvKey = key; this.pvRev = F ? F.rev : -1;
    let nf = 0, nr = 0, nd = 0;
    const fill = (cx: number, cz: number, c: number) => {
      if (nf >= MAX_MARK || !inBoard(cx, cz)) return;
      this.M.makeTranslation(cellX(cx, cz), 0.05, cellZ(cz)); this.pvFill.setMatrixAt(nf, this.M); this.pvFill.setColorAt(nf++, this.C.setHex(c));
    };
    const ring = (x: number, z: number, c: number, sc = 1) => {
      if (nr >= MAX_MARK) return;
      this.M.makeScale(sc, 1, sc).setPosition(x, 0.07, z); this.pvRing.setMatrixAt(nr, this.M); this.pvRing.setColorAt(nr++, this.C.setHex(c));
    };
    /** a dashed line from a to b, sagging by `sag` in the middle (0 for a line on the deck) */
    const dash = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, sag: number, c: number, w = 0.06) => {
      const len = Math.hypot(bx - ax, by - ay, bz - az), n = Math.max(1, Math.round(len / 0.36));
      for (let i = 0; i < n && nd < MAX_DASH; i++) {
        const k0 = (i + 0.15) / n, k1 = (i + 0.85) / n;
        const p0 = this.V1.set(ax + (bx - ax) * k0, ay + (by - ay) * k0 - 4 * k0 * (1 - k0) * sag, az + (bz - az) * k0);
        const p1 = this.V2.set(ax + (bx - ax) * k1, ay + (by - ay) * k1 - 4 * k1 * (1 - k1) * sag, az + (bz - az) * k1);
        const d = this.P.subVectors(p1, p0), l = d.length();
        this.Q.setFromUnitVectors(this.Z, d.multiplyScalar(1 / Math.max(1e-6, l)));
        this.M.compose(p0.add(p1).multiplyScalar(0.5), this.Q, this.S.set(w, w, l));
        this.pvDash.setMatrixAt(nd, this.M); this.pvDash.setColorAt(nd++, this.C.setHex(c));
      }
    };
    if (F && sim && (g || sel)) {
      const type = g ? g.type : sel!.type, cx = g ? g.cx : sel!.cx, cz = g ? g.cz : sel!.cz, x = cellX(cx, cz), z = cellZ(cz);
      const GREEN = 0x9ccf6a, AMBER = 0xf2a54a;
      if (type === 'pole' || type === 'generator') {
        for (const [tx, tz] of disc(cx, cz, SUPPLY)) fill(tx, tz, GREEN);
        const top = type === 'pole' ? POLE_Y : GEN_Y;
        if (g) {
          // the wires it would get, and what it would power
          for (const q of F.facs) {
            if ((q.type !== 'pole' && q.type !== 'generator') || hexDist(q.cx, q.cz, cx, cz) > POLE_REACH || (q.cx === cx && q.cz === cz)) continue;
            const [qx, qy, qz] = wireEnd(q, x);
            dash(x + (type === 'pole' ? (qx >= x ? POLE_ARM : -POLE_ARM) : 0), top, z, qx, qy, qz, Math.hypot(qx - x, qz - z) * 0.045, GREEN, 0.05);
          }
          for (const q of F.facs) if (FACS[q.type].power && hexDist(q.cx, q.cz, cx, cz) <= SUPPLY) ring(q.x, q.z, GREEN);
          for (const t of sim.towers) if (needsOf(t).power && hexDist(t.cx, t.cz, cx, cz) <= SUPPLY) ring(t.x, t.z, GREEN);
        } else {
          for (const l of F.links()) {
            if (l.kind !== 'power' || l.from !== sel!.id) continue;
            ring(l.tx, l.tz, GREEN);
            dash(l.x, top + 0.1, l.z, l.tx, SOCK_Y + 0.4, l.tz, 0, GREEN, 0.045);
          }
        }
        ring(x, z, GREEN, 1.08);
      } else if (type === 'tunnel' || type === 'ptunnel') {
        let mate: Fac | undefined;
        if (sel) mate = sel.pair ? F.facById(sel.pair) : undefined;
        else mate = tunnelMate(F, type, cx, cz, g!.dir);
        if (mate) {
          dash(x, 0.09, z, mate.x, 0.09, mate.z, 0, GREEN, 0.09);
          ring(mate.x, mate.z, GREEN);
        } else {
          // no partner: where one could go
          const dirs = type === 'tunnel' ? [g ? g.dir : sel!.dir] : [0, 1, 2, 3, 4, 5];
          for (const d of dirs) {
            let c: [number, number] = [cx, cz];
            for (let k = 1; k <= TUNNEL_REACH; k++) { c = neighbor(c[0], c[1], d); if (inBoard(c[0], c[1])) ring(cellX(c[0], c[1]), cellZ(c[1]), AMBER, k === TUNNEL_REACH ? 0.8 : 0.55); }
          }
        }
      }
    }
    this.pvFill.count = nf; this.pvRing.count = nr; this.pvDash.count = nd;
    for (const m of [this.pvFill, this.pvRing, this.pvDash]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  /** The loaded model for a building type, or null (not loaded yet, or the file is missing: then an empty stand-in). */
  private modelOf(type: FacType): THREE.Object3D | null {
    const m = this.models()['fac_' + type];
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
      obj: g, type, seen: 0, dir, model: false, spin: null, arm: null, armX: false, work: null, workY: 0, pitman: null, crank: null, ph: Math.random() * TAU, spd: 0, lamps: [], glows: [], own: [],
      belt: null, e: -1, k: -1, caps: -1, feeds: null, stubs: null, ex: exit, pipe: [], mask: -1, fluidKey: -1,
    };
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
      case 'belt': {
        // (a placed belt has no mesh of its own: syncBelts draws all of them instanced; the ghost gets one)
        if (!ghost) break;
        const mesh = new THREE.Mesh(beltGeo(3, false, false), this.beltMats);
        g.add(mesh); v.belt = mesh;
        break;
      }
      case 'pipe': case 'ptunnel': {
        // glass (no shadow: it is clear), the fluid core, steel fittings, the valve; shaped by shapePipe once the neighbours are known
        const ms = [this.glass, this.coreMat(0, false), this.pipeFit, this.pipeValve];
        for (let i = 0; i < 4; i++) { const o = new THREE.Mesh(G_HEXF, ms[i]); o.castShadow = i >= 2; o.receiveShadow = i !== 0; if (i === 0) o.layers.set(FX_LAYER); g.add(o); v.pipe.push(o); }
        v.pipe[1].visible = false;
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
  /** The fluid core material for a fluid state (0 empty, else fluid index * 16 + fill in tenths), shared by all pipes showing
   *  it; a shaft's core sits higher (in the glass well on its cap), so it has its own. */
  private coreMat(key: number, shaft: boolean): THREE.MeshStandardMaterial {
    const k = key * 2 + +shaft;
    let m = this.coreMats.get(k);
    if (m) return m;
    // (a part-full pipe still shows a thin stream, or a trickle would not show at all)
    const fill = Math.max(0.3, (key & 15) / 10), c = new THREE.Color(key ? FLUIDS[FLUID_TYPES[(key >> 4) - 1]].color : 0);
    // (a dark fluid, crude, is lifted a little or it would read as an empty dark tube)
    if (c.getHSL({ h: 0, s: 0, l: 0 }).l < 0.25) c.multiplyScalar(1.3);
    m = fluidMat(c.getHex(), shaft ? 0.6 + 0.16 * fill : PY - KR + 2 * KR * fill, this.flowT);
    this.coreMats.set(k, m);
    return m;
  }
  private shapePipe(v: FVis, mask: number, cx: number, cz: number) {
    v.mask = mask;
    const gs = pipeGeo(mask, (cx * 2 + cz * 3) % 4 === 1, v.type === 'ptunnel');
    for (let i = 0; i < 4; i++) v.pipe[i].geometry = gs[i];
    v.pipe[3].visible = !!gs[3].getAttribute('position');
  }

  /** A number that changes when any building comes, goes or turns (the belt shapes depend on their neighbours). */
  private layoutKey(F: Factory) { return F.rev * 4096 + F.facs.length; }
  /** Feeders of a belt or splitter, keeping what was noted about the ones it had (see syncItems). */
  private feedList(F: Factory, old: Feed[] | null, fs: { d: number; q: Fac }[] | undefined): Feed[] | null {
    if (!fs) return null;
    return fs.map(({ d, q }) => {
      const was = old?.find((o) => o.id === q.id);
      return was ? { ...was, d } : { d, id: q.id, head: headOf(F, q), n: q.out.length };
    });
  }
  /** Work out each belt's entry side and shape from what feeds it, where its line starts and stops, and each splitter's stubs. */
  private layoutBelts(F: Factory) {
    const pointsAt = (q: Fac, b: Fac) => { const [x, z] = neighbor(q.cx, q.cz, q.dir); return x === b.cx && z === b.cz; };
    // q hands items to b from beside it: a belt or tunnel exit pointing at it, or a splitter (that b does not point back into)
    const feeds = (q: Fac, b: Fac) => q.type === 'belt' || (q.type === 'tunnel' && q.exit) ? pointsAt(q, b) : q.type === 'splitter' && b.type === 'belt' && !pointsAt(b, q);
    const entry = new Map<number, number>(), multi = new Map<number, { d: number; q: Fac }[]>();
    for (const b of F.facs) {
      if (b.type !== 'belt' && b.type !== 'splitter') continue;
      const fs: { d: number; q: Fac }[] = [];
      for (let d = 0; d < 6; d++) {
        if (b.type === 'belt' && d === b.dir) continue;
        const [nx, nz] = neighbor(b.cx, b.cz, d), q = F.facAt(nx, nz);
        if (q && feeds(q, b)) fs.push({ d, q });
      }
      if (b.type === 'splitter') { multi.set(b.id, fs); continue; }
      entry.set(b.id, fs.length === 1 ? fs[0].d : -1 - fs.length);
      if (fs.length > 1) multi.set(b.id, fs);
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
          else if (q.type === 'belt' || (q.type === 'tunnel' && !q.exit && q.dir === d)) st.push(d + 8);
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
        if (v.stubs) for (const s of v.stubs) { const d = s & 7, out = s >= 8; this.putBelt(out ? SPLIT_OUT() : SPLIT_IN(), fc, out ? (d + 3) % 6 : d, sc); }
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

  private coverRocks(F: Factory) {
    for (let r = 0; r < this.rocks.count; r++) {
      if (F.at[this.rockTile[r]]) this.rocks.setMatrixAt(r, this.zero);
      else { this.M.fromArray(this.rockM, r * 16); this.rocks.setMatrixAt(r, this.M); }
    }
    this.rocks.instanceMatrix.needsUpdate = true;
  }

  sync(dt: number, time: number, reveal: ((x: number, z: number) => number) | null) {
    const sim = this.sim;
    if (!sim) return;
    const F = sim.factory, f = ++this.frame;
    // between waves the factory stands still: items freeze on the belts and the machines idle (the lamps show the diagnosis)
    this.live = !sim.planning;
    const dg = this.live ? null : sim.diag();
    // while the deck assembles, the deposits, the items and the connectors wait for their tiles (the buildings grow with them)
    this.ores.visible = this.pools.visible = this.rocks.visible = this.items.visible = this.wires.visible = !reveal;
    for (const m of [this.scan, this.scanLight, this.chute, this.chuteLight, this.sock, this.sockLight, this.branch, this.branchCore, this.branchFit, this.drops, this.tokens, this.band, this.pips]) m.visible = !reveal;
    let added = false, lk = 0;
    for (const fc of F.facs) {
      let v = this.vis.get(fc.id);
      // a model that has loaded since, or a tunnel that turned or became the other end: built again
      if (v && ((!v.model && !DRAWN_HERE.has(fc.type) && this.modelOf(fc.type)) || (fc.type === 'tunnel' && (v.ex !== fc.exit || v.dir !== fc.dir)))) {
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
      this.animate(fc, v, dt, time, dg);
    }
    for (const [id, v] of this.vis) if (v.seen !== f) { this.drop(v); this.vis.delete(id); }
    const lay = this.layoutKey(F);
    // (any change redraws the belt batches: a belt that was removed changes no other belt's shape, but its instance has to go)
    if (lay !== this.layout || added || F.pipeNets !== this.nets) { this.layout = lay; this.nets = F.pipeNets; this.layoutBelts(F); this.coverRocks(F); this.beltDirty = true; }
    this.syncBelts(F, !!reveal);
    // the tread and the fluid pulses run with the sim clock at the belt speed, and only while the factory does
    const st = sim.time;
    if (this.live && this.lastT >= 0 && st > this.lastT && st - this.lastT < 5) {
      this.run += (st - this.lastT) * BELT_SPEED * sim.mods.belt;
      this.flowT.value += st - this.lastT;
    }
    this.lastT = st;
    this.tread.offset.y = -((this.run * BELT_REP) % 1);
    this.syncItems(F);
    this.syncWires(F);
    this.syncLinks(F);
    this.animLinks(F, dt);
    this.syncLevels(F, (lk ^ this.layout) | 0);
    if (this.pvKey && F.rev !== this.pvRev) this.syncPreview();
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
      for (const f of fd) {
        const q = F.facById(f.id);
        if (!q) continue;
        const conv = q.type === 'belt' || q.type === 'splitter' || q.type === 'tunnel';
        if (conv ? f.head !== null && f.head.it === it.it && headOf(F, q) !== f.head : q.out.length < f.n) { side = f.d; f.head = null; f.n = -1; break; }
      }
      this.inSide.set(it, side);
    }
    for (const f of fd) { const q = F.facById(f.id); if (q) { f.head = headOf(F, q); f.n = q.out.length; } }
  }
  /** One item into its instanced meshes, at (x, y, z) heading (tx, tz). */
  private putItem(it: ItemType, x: number, y: number, z: number, tx: number, tz: number) {
    const sh = SHAPE_OF[it], n = this.itemN[sh], M = this.M;
    if (n >= MAX_ITEMS) return;
    M.makeRotationY(Math.atan2(tx, tz)).scale(this.S.setScalar(ITEM_SCALE[sh]));
    M.setPosition(x, y, z);
    for (const p of this.itemMeshes[sh]) {
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
    const N = this.itemN, pt = this.pt;
    for (const s of SHAPES) N[s] = 0;
    for (const fc of F.facs) {
      if (!fc.items.length) continue;
      const v = this.vis.get(fc.id);
      if (!v) continue;
      if (fc.type === 'splitter') {
        // in from the side it came by to the turntable's middle, where it waits to be dealt out
        if (v.feeds) this.trackFeeds(F, fc.items, v.feeds, v.feeds[0]?.d ?? 0);
        for (let i = 0; i < fc.items.length; i++) {
          const it = fc.items[i], sd = this.inSide.get(it) ?? 0, r = Math.max(0, 1 - 2 * it.p) + (i > 0 ? 0.22 : 0);
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
      for (const it of fc.items) {
        const side = fd ? this.inSide.get(it) ?? v.e : v.e;
        if (side === v.e) {
          pathAt(P, it.p, pt);
          this.putItem(it.it, fc.x + pt.x * c - pt.z * s, Y_SURF, fc.z + pt.x * s + pt.z * c, pt.tx * c - pt.tz * s, pt.tx * s + pt.tz * c);
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
    let h = F.wires.length;
    for (const w of F.wires) h = Math.imul(h ^ (w[0] * 65599 + w[1]), 16777619);
    if (h === this.wireKey) return;
    this.wireKey = h;
    const parts: THREE.BufferGeometry[] = [];
    for (const [a, b] of F.wires) {
      const A = F.facById(a), B = F.facById(b);
      if (!A || !B) continue;
      parts.push(cable(wireEnd(A, B.x), wireEnd(B, A.x), 0.045, 0.024));
    }
    this.wires.geometry.dispose();
    this.wires.geometry = parts.length ? mergeGeometries(parts)! : new THREE.BufferGeometry();
    for (const g of parts) g.dispose();
  }

  private clearLinks() {
    for (const m of [this.scan, this.scanLight, this.chute, this.chuteLight, this.sock, this.sockLight, this.branch, this.branchCore, this.branchFit]) m.count = 0;
    this.nScan = 0; this.nBranch = 0; this.takers.clear();
    this.nTok = 0; this.tokens.count = 0; // (a token in flight holds a link index of the old layout)
    this.drops.geometry.dispose(); this.drops.geometry = new THREE.BufferGeometry();
  }
  /**
   * The supply connectors, from Factory.links() (worked out again when the links or the belt shapes change):
   *  - belt: a scanner arch over the belt where the taker draws from it, on the side facing the taker (near the front edge
   *    when the taker stands at the end of the line), with a chute from it to a socket on the taker;
   *  - pipe: a glass branch from the pipe tile's edge into the consumer, with a flange and a socket;
   *  - power: a drop cable from the pole's insulator (or the generator's terminal) to a socket on the consumer.
   */
  private syncLinks(F: Factory) {
    const links = F.links();
    if (links === this.linkRef && this.linkLayout === this.layout) return;
    this.linkRef = links; this.linkLayout = this.layout;
    this.clearLinks();
    let ns = 0, nk = 0, nb = 0;
    const pt = this.pt, M = this.M, cables: THREE.BufferGeometry[] = [];
    const socket = (x: number, y: number, z: number, fx: number, fz: number, c: THREE.Color) => {
      M.compose(this.P.set(x, y, z), this.Q.setFromAxisAngle(this.S.set(0, 1, 0), Math.atan2(fx, fz)), this.S.set(1, 1, 1));
      this.sock.setMatrixAt(nk, M); this.sockLight.setMatrixAt(nk, M); this.sockLight.setColorAt(nk++, c);
    };
    for (const l of links) {
      if (l.kind === 'belt') {
        const f = F.facById(l.from);
        if (!f || ns >= MAX_LINKS) continue;
        const v = this.vis.get(f.id), ul = Math.hypot(l.tx - f.x, l.tz - f.z) || 1, ux = (l.tx - f.x) / ul, uz = (l.tz - f.z) / ul;
        // the scanner: over the belt's middle, heading along it
        let px = f.x, pz = f.z, hx = ux, hz = uz;
        if (f.type === 'belt' && v && v.k >= 0) {
          pathAt(PATHS[v.k], 0.5, pt);
          const c = DX[v.e], s = DZ[v.e];
          px += pt.x * c - pt.z * s; pz += pt.x * s + pt.z * c; hx = pt.tx * c - pt.tz * s; hz = pt.tx * s + pt.tz * c;
          if (hx * ux + hz * uz > 0.8) { px += hx * 0.42; pz += hz * 0.42; }
        } else if (f.type === 'tunnel') { hx = DX[f.dir]; hz = DZ[f.dir]; px += hx * 0.5; pz += hz * 0.5; }
        else { px += ux * 0.5; pz += uz * 0.5; }
        M.compose(this.P.set(px, 0, pz), this.Q.setFromAxisAngle(this.S.set(0, 1, 0), Math.atan2(hx, hz)), this.S.set(1, 1, 1));
        this.scan.setMatrixAt(ns, M); this.scanLight.setMatrixAt(ns, M); this.scanLight.setColorAt(ns, this.C.copy(SCAN_AMBER).multiplyScalar(0.85));
        // the chute leaves from the scanner's wall on the taker's side (its front opening when the taker is ahead)
        const ax = hz, az = -hx, side = ux * ax + uz * az, ahead = hx * ux + hz * uz;
        let sx: number, sz: number;
        if (Math.abs(side) < 0.5) { const k = Math.sign(ahead || 1) * (SC_D + 0.03); sx = px + hx * k; sz = pz + hz * k; }
        else { const k = Math.sign(side) * (SC_W + 0.06); sx = px + ax * k; sz = pz + az * k; }
        const dl = Math.hypot(l.tx - sx, l.tz - sz) || 1, ex = l.tx - ((l.tx - sx) / dl) * TAKER_IN, ez = l.tz - ((l.tz - sz) / dl) * TAKER_IN;
        const A = this.V1.set(sx, SC_H - 0.12, sz), B = this.V2.set(ex, ARM_Y, ez), d = this.P.subVectors(B, A), len = d.length();
        this.Q.setFromUnitVectors(this.Z, d.multiplyScalar(1 / Math.max(1e-6, len)));
        M.compose(A, this.Q, this.S.set(1, 1, Math.max(0.01, len)));
        this.chute.setMatrixAt(ns, M); this.chuteLight.setMatrixAt(ns, M); this.chuteLight.setColorAt(ns, this.C.copy(SCAN_AMBER).multiplyScalar(0.45));
        this.chuteA.set([sx, SC_H - 0.12, sz], ns * 3); this.chuteB.set([ex, ARM_Y, ez], ns * 3);
        socket(ex, ARM_Y, ez, sx - ex, sz - ez, SCAN_AMBER);
        this.scanAt[ns * 2] = f.x; this.scanAt[ns * 2 + 1] = f.z; this.flash[ns] = 0;
        const tl = this.takers.get(l.to);
        if (tl) tl.push(ns); else this.takers.set(l.to, [ns]);
        ns++;
      } else if (l.kind === 'pipe') {
        if (nb >= MAX_LINKS) continue;
        M.compose(this.P.set(l.x, 0, l.z), this.Q.setFromAxisAngle(this.S.set(0, 1, 0), Math.atan2(l.tx - l.x, l.tz - l.z)), this.S.set(1, 1, 1));
        this.branch.setMatrixAt(nb, M); this.branchFit.setMatrixAt(nb, M); this.branchCore.setMatrixAt(nb, this.zero);
        this.brFrom[nb] = l.from; this.brKey[nb] = -1;
        nb++;
      } else {
        const f = F.facById(l.from);
        if (!f || nk >= MAX_LINKS * 2) continue;
        const w = wireEnd(f, l.tx), dl = Math.hypot(w[0] - l.tx, w[2] - l.tz) || 1;
        const ex = l.tx + ((w[0] - l.tx) / dl) * TAKER_IN, ez = l.tz + ((w[2] - l.tz) / dl) * TAKER_IN;
        socket(ex, SOCK_Y, ez, w[0] - ex, w[2] - ez, SOCK_GREEN);
        cables.push(cable(w, [ex, SOCK_Y + 0.04, ez], 0.07, 0.017));
      }
    }
    this.nScan = ns; this.nBranch = nb;
    this.scan.count = this.scanLight.count = this.chute.count = this.chuteLight.count = ns;
    this.sock.count = this.sockLight.count = nk;
    this.branch.count = this.branchCore.count = this.branchFit.count = nb;
    for (const m of [this.scan, this.scanLight, this.chute, this.chuteLight, this.sock, this.sockLight, this.branch, this.branchCore, this.branchFit]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    if (cables.length) { this.drops.geometry.dispose(); this.drops.geometry = mergeGeometries(cables)!; for (const g of cables) g.dispose(); }
  }
  /** Scanner flashes fading, item tokens sliding down the chutes, and the fluid shown in the pipe branches. */
  private animLinks(F: Factory, dt: number) {
    let lit = false;
    for (let i = 0; i < this.nScan; i++) {
      if (this.flash[i] <= 0) continue;
      const k = this.flash[i];
      this.flash[i] = Math.max(0, k - dt / FLASH_T);
      this.scanLight.setColorAt(i, this.C.copy(SCAN_AMBER).multiplyScalar(0.85 + 4 * k * k));
      this.chuteLight.setColorAt(i, this.C.copy(SCAN_AMBER).multiplyScalar(0.45 + 3 * k * k));
      lit = true;
    }
    if (lit) for (const m of [this.scanLight, this.chuteLight]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    // tokens: the item's colour, a little arc from the scanner to the taker
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
    // pipe branches: the core shows the network's fluid (none while it is empty)
    let ch = false;
    for (let i = 0; i < this.nBranch; i++) {
      const p = F.facById(this.brFrom[i]), net = p ? F.pipeNets[p.net] : undefined;
      const key = net && net.fluid && net.amt > 0.01 ? FLUID_TYPES.indexOf(net.fluid) + 1 : 0;
      if (key === this.brKey[i]) continue;
      this.brKey[i] = key; ch = true;
      if (!key) { this.branchCore.setMatrixAt(i, this.zero); continue; }
      this.branch.getMatrixAt(i, this.M);
      this.branchCore.setMatrixAt(i, this.M); this.branchCore.setColorAt(i, this.C.setHex(FLUIDS[FLUID_TYPES[key - 1]].color));
    }
    if (ch) { this.branchCore.instanceMatrix.needsUpdate = true; if (this.branchCore.instanceColor) this.branchCore.instanceColor.needsUpdate = true; }
  }
  /** Level marks: a band round the base of each upgraded building (bright for Mk3) and a pip per level on its front corner. */
  private syncLevels(F: Factory, key: number) {
    if (key === this.lvlKey) return;
    this.lvlKey = key;
    let nb = 0, np = 0;
    for (const fc of F.facs) {
      if (fc.lvl < 2 || nb >= MAX_LVL) continue;
      const c = this.C.setHex(LVL_COLOR[Math.min(3, fc.lvl)]).multiplyScalar(fc.lvl >= 3 ? 1.5 : 0.9);
      this.M.makeTranslation(fc.x, 0, fc.z); this.band.setMatrixAt(nb, this.M); this.band.setColorAt(nb++, c);
      for (let i = 0; i < fc.lvl; i++) {
        this.M.makeTranslation(fc.x + (i - (fc.lvl - 1) / 2) * 0.19, 0.3, fc.z + HEX_SIZE * 0.8);
        this.pips.setMatrixAt(np, this.M); this.pips.setColorAt(np++, c);
      }
    }
    this.band.count = nb; this.pips.count = np;
    for (const m of [this.band, this.pips]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  private animate(fc: Fac, v: FVis, dt: number, time: number, dg: Map<string, Diag> | null) {
    const sim = this.sim!, on = fc.state === 'ok' && this.live;
    if (v.lamps.length) {
      // while time stands still the lamp shows the diagnosis: green if it will get all it needs, red (blinking) if not
      const d = dg && dg.get('f' + fc.id), good = d ? d.ok : fc.state === 'ok';
      const c = d ? (d.ok ? LAMP.ok : LAMP.bad) : fc.state === 'ok' ? LAMP.ok : fc.state === 'nopower' || fc.state === 'nofuel' || fc.state === 'nodeposit' || fc.state === 'empty' ? LAMP.bad : LAMP.warn;
      const i = good ? 1.8 : 1.2 + 0.8 * Math.sin(time * 6 + fc.id);
      for (const m of v.lamps) { m.emissive.setHex(c); m.color.setHex(c).multiplyScalar(0.25); m.emissiveIntensity = i; }
    }
    // working lights: lit (and flickering for the hot ones) while the building works, nearly dark while it idles
    if (v.glows.length) {
      const k = fc.type === 'splitter' ? (this.live ? 1 : 0.5) : !on ? 0.1 : fc.type === 'smelter' ? 1 + 0.3 * Math.sin(time * 13 + fc.id) : fc.type === 'generator' ? 1 + 0.3 * Math.sin(time * 11 + fc.id)
        : fc.type === 'press' || fc.type === 'cells' || fc.type === 'missiles' ? 1 + 0.25 * Math.sin(time * 8 + fc.id) : fc.type === 'refinery' ? 1 + 0.25 * Math.sin(time * 5) : 1;
      for (const g of v.glows) g.m.emissiveIntensity = g.i0 * k;
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
        // the diverter swings round to the side the next item goes to
        if (!v.spin || !this.live) break;
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
      case 'pipe': case 'ptunnel': {
        // the network's fluid and how full it is pick a shared core material (the side mask is set with the layout, see layoutBelts)
        const net = sim.factory.pipeNets[fc.net], fill = net && net.cap > 0 ? net.amt / net.cap : 0;
        const key = net && net.fluid && fill > 0.005 ? (FLUID_TYPES.indexOf(net.fluid) + 1) * 16 + Math.round(fill * 10) : 0;
        if (key !== v.fluidKey && v.pipe.length) { v.fluidKey = key; v.pipe[1].visible = key > 0; if (key) v.pipe[1].material = this.coreMat(key, fc.type === 'ptunnel'); }
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
