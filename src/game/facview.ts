// Three.js view of the factory: deposits on the deck, the buildings, belts with the items riding on them, pipes and power
// lines. Buildings use the Blender models (public/models/fac_<type>.glb) when they are loaded and fall back to plain shapes
// otherwise; belts, pipes and items are built here, in the same warm palette as the towers.
//
// Belts: a belt tile runs from an entry edge to its output edge. The entry is the side its one feeder stands on (a belt or a
// producer whose output points at it); with no feeder or several it runs straight from the side opposite its output. The
// path between the two edge midpoints is a straight line or a circular arc tangent to both edge normals, so neighbouring
// belts meet edge to edge with the same width and heading and a turning line reads as one curved conveyor. Items ride the
// same path (see pathAt), and the tread texture scrolls along it at the belt speed.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FACS, ITEMS, FLUIDS, FLUID_TYPES, ORE_TYPES, ORES, ITEM_TYPES, GW, GH, cellX, cellZ, RECIPE_BY_ID, FAC_TYPES } from './data.ts';
import type { FacType, ItemType } from './data.ts';
import { FX_LAYER } from './world.ts';
import { HEX_SIZE, neighbor } from './hex.ts';
import type { Sim, Ev } from './sim.ts';
import type { Fac, Factory, BeltItem } from './factory.ts';
import { turns, BELT_SPEED } from './factory.ts';

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
const WORK_GLOW: Partial<Record<FacType, number>> = { fab: 0.45, depot: 0.7, smelter: 0.75 };

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
  iron_ore: 'ore', copper_ore: 'ore', coal: 'coal', iron: 'plate', copper: 'plate', frame: 'frame',
  ammo: 'crate', shell: 'shell', slug: 'slug', cell: 'cell', missile: 'missile',
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
const PY = 0.4, PR = 0.095;
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
/** Pipe geometry for a side mask: [pipe body (fluid tinted), fittings (steel), valve wheel (paint)]. */
function pipeGeo(mask: number, valve: boolean): [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry | null] {
  const key = 'pipe' + mask + +valve;
  const body = geos.get(key + 'b');
  if (body) return [body, geos.get(key + 'f')!, geos.get(key + 'v') || null];
  const sides: number[] = [];
  for (let d = 0; d < 6; d++) if (mask & (1 << d)) sides.push(d);
  const B: THREE.BufferGeometry[] = [], F: THREE.BufferGeometry[] = [], V: THREE.BufferGeometry[] = [];
  const flange = (d: number, at: number) => { F.push(along(tubeZ(PR + 0.06, 0.05, 12), d, at - 0.025, at + 0.025)); F.push(along(tubeZ(PR + 0.025, 0.1, 12), d, at - 0.11, at - 0.01)); };
  const support = (x: number, z: number, yaw: number) => {
    F.push(new THREE.BoxGeometry(0.06, PY - PR, 0.06).translate(0, (PY - PR) / 2, 0).rotateY(yaw).translate(x, 0, z));
    F.push(new THREE.BoxGeometry(0.3, 0.05, 0.08).translate(0, PY - PR - 0.02, 0).rotateY(yaw).translate(x, 0, z));
    F.push(new THREE.BoxGeometry(0.2, 0.025, 0.14).translate(0, 0.0125, 0).rotateY(yaw).translate(x, 0, z));
  };
  const wheel = (x: number, y: number, z: number) => {
    V.push(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 6).translate(x, y + 0.06, z));
    V.push(new THREE.TorusGeometry(0.085, 0.016, 6, 14).rotateX(Math.PI / 2).translate(x, y + 0.12, z));
    for (const r of [0, Math.PI / 2]) V.push(new THREE.BoxGeometry(0.17, 0.014, 0.014).rotateY(r + 0.4).translate(x, y + 0.12, z));
  };
  const hub = (r: number, h: number) => {
    B.push(new THREE.CylinderGeometry(r, r, h, 16).translate(0, PY, 0));
    for (const y of [PY - h / 2, PY + h / 2]) F.push(new THREE.CylinderGeometry(r + 0.025, r + 0.025, 0.045, 16).translate(0, y, 0));
    F.push(new THREE.CylinderGeometry(r * 0.75, r + 0.06, PY - h / 2, 16).translate(0, (PY - h / 2) / 2, 0));
    if (valve || sides.length >= 3) wheel(0, PY + h / 2, 0);
  };
  const n = sides.length;
  if (n === 0) {
    // a standpipe waiting for a neighbour
    B.push(new THREE.CylinderGeometry(0.15, 0.15, 0.56, 14).translate(0, 0.3, 0));
    F.push(new THREE.CylinderGeometry(0.22, 0.24, 0.06, 14).translate(0, 0.03, 0), new THREE.CylinderGeometry(0.19, 0.19, 0.05, 14).translate(0, 0.58, 0));
    wheel(0, 0.6, 0);
  } else if (n === 2 && (sides[1] - sides[0]) === 3) {
    // a straight run
    const d = sides[0];
    B.push(along(tubeZ(PR, 2, 14), d, -1, 1));
    flange(d, 0.95); flange((d + 3) % 6, 0.95);
    F.push(along(tubeZ(PR + 0.03, 0.08, 14), d, -0.04, 0.04));
    support(0, 0, yawOf(d));
    if (valve) wheel(0, PY + PR, 0);
  } else if (n === 2) {
    // an elbow: the same arcs as the belts, so pipe bends line up with belt bends
    let a = sides[0], k = sides[1] - sides[0];
    if (k === 5 || k === 4) { a = sides[1]; k = 6 - k; } // run the short way round
    const curve = new ElbowCurve(a, k);
    B.push(new THREE.TubeGeometry(curve, 16, PR, 12, false));
    flange(sides[0], 0.95); flange(sides[1], 0.95);
    const mid = curve.getPoint(0.5), t = curve.getTangent(0.5);
    support(mid.x, mid.z, Math.atan2(t.x, t.z));
    if (valve) wheel(mid.x, PY + PR, mid.z);
  } else {
    // one arm with a blind end, or a junction body where three or more meet
    for (const d of sides) { B.push(along(tubeZ(PR, n === 1 ? 1 : 0.85, 14), d, n === 1 ? 0 : 0.15, 1)); flange(d, 0.95); }
    if (n === 1) {
      F.push(along(tubeZ(PR + 0.06, 0.05, 14), sides[0], -0.03, 0.02), along(tubeZ(PR + 0.035, 0.05, 6), sides[0], -0.07, -0.02));
      support(DX[sides[0]] * 0.45, DZ[sides[0]] * 0.45, yawOf(sides[0]));
      if (valve) wheel(DX[sides[0]] * 0.25, PY + PR, DZ[sides[0]] * 0.25);
    } else hub(0.22, 0.38);
  }
  const mb = merge(B), mf = merge(F), mv = V.length ? merge(V) : null;
  geos.set(key + 'b', mb); geos.set(key + 'f', mf); if (mv) geos.set(key + 'v', mv);
  return [mb, mf, mv];
}

// ---------- the view ----------
interface Glow { m: THREE.MeshStandardMaterial; i0: number }
interface FVis {
  obj: THREE.Group; type: FacType; seen: number; dir: number; recipe: string;
  /** built from the model file (false: from plain shapes) */
  model: boolean;
  /** parts that move: a drill head or fan (spin, about y), a pump beam (arm: rocks about x for models, z for shapes), a bobbing part */
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
  /** a belt with several feeders: each feeder's side (an inlet stub is drawn there unless it is the straight-on back side), its
   *  id, and what it held last frame (a belt's front item, a producer's output count) to tell which one handed over a new item */
  feeds: { d: number; id: number; head: BeltItem | null; n: number }[] | null;
  /** producers: the output arrow on the deck (hidden while a belt stands there to show the way) */
  arrow: THREE.Object3D | null;
  /** pipes: the three meshes, the side mask they were built for, the fluid state they show (see pipeKey) */
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
  private pt: PathPt = { x: 0, z: 0, tx: 0, tz: 0 };
  /** belts: the tread texture, its materials, how far it has run (tiles), and the layout the belt shapes were worked out for */
  private tread: THREE.Texture;
  private beltMats: THREE.Material[];
  /** placed belts and their inlet stubs, one instanced pair per geometry: the body (tread and frame, casts shadows) and the
   *  rail light (no shadow); a hidden material stands in for the other pair's groups, which the renderer then skips */
  private beltBody: THREE.Material[]; private beltLight: THREE.Material[];
  private beltBatches = new Map<THREE.BufferGeometry, { body: THREE.InstancedMesh; light: THREE.InstancedMesh; n: number }>();
  private beltDirty = true; private beltScaled = false;
  /** the side each side-loaded item came in by (items on a belt with several feeders) */
  private inSide = new WeakMap<BeltItem, number>();
  private run = 0; private lastT = -1; private layout = -1;
  private pipeFit = mat(0x77706a, 'dark'); private pipeValve = new THREE.MeshStandardMaterial({ color: 0x9a2f1e, roughness: 0.45, metalness: 0.4 });
  /** pipe bodies: one shared material per fluid state (see pipeMat), their flow pulse clock, and the pipe networks last seen */
  private pipeMats = new Map<number, THREE.MeshStandardMaterial>(); private flowT = { value: 0 }; private nets: unknown = null;

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
    this.wires = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0x6e665a, roughness: 0.38, metalness: 0.75 }));
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
  }

  setSim(sim: Sim | null) {
    this.sim = sim;
    for (const v of this.vis.values()) this.drop(v);
    this.vis.clear(); this.wireKey = -1; this.sparks.length = 0; this.glint.count = 0; this.layout = -1; this.lastT = -1;
    for (const s of SHAPES) for (const p of this.itemMeshes[s]) p.mesh.count = 0;
    this.ores.count = 0; this.pools.count = 0; this.rocks.count = 0;
    for (const b of this.beltBatches.values()) { b.n = 0; b.body.count = 0; b.light.count = 0; }
    this.beltDirty = true; this.nets = null;
    this.setGhost(null);
    if (!sim) return;
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
    for (const e of evs) if (e.k === 'mats') this.sparks.push({ x: e.x, z: e.z, t: 0 });
  }

  /** The ghost of a factory building where it would go (null hides it). */
  setGhost(type: FacType | null, cx = 0, cz = 0, dir = 0, ok = true) {
    this.ghost.visible = !!type && ok;
    if (!type) return;
    const key = type + ':' + dir + ':' + (this.modelOf(type) ? 'm' : 's');
    if (key !== this.ghostKey) {
      if (this.ghostVis) { this.ghost.remove(this.ghostVis.obj); for (const m of this.ghostVis.own) m.dispose(); }
      const v = this.build(type, dir, 'ammo', true);
      if (type === 'belt') this.shapeBelt(v, (dir + 3) % 6, 3, 3);
      if (type === 'pipe') this.shapePipe(v, 0, 0, 0);
      v.obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = this.ghostMat; m.castShadow = false; } });
      // the way it will face, which R turns: a bright chevron over a belt, and the producers' output arrow kept lit
      if (type === 'belt') {
        const holder = new THREE.Group(); holder.rotation.y = yawOf(dir);
        for (const z of [-0.45, 0.25]) { const ch = new THREE.Mesh(G_CHEV, this.ghostArrow); ch.position.set(0, Y_RAIL + 0.04, z); ch.scale.setScalar(1.05); ch.renderOrder = 5; holder.add(ch); }
        v.obj.add(holder);
      }
      // (drawn after the see-through body and just above its plinth, or the plinth's ghost hides it)
      if (v.arrow) v.arrow.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = this.ghostArrow; m.scale.setScalar(1.1); m.position.y = 0.36; m.renderOrder = 5; } });
      // (see-through: kept out of the AO pre-pass like the tower ghost, or it would shade the deck under it as a solid)
      v.obj.traverse((o) => o.layers.set(FX_LAYER));
      this.ghost.add(v.obj);
      this.ghostVis = v; this.ghostKey = key;
    }
    this.ghost.position.set(cellX(cx, cz), 0, cellZ(cz));
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

  /** Build the shapes of one building. */
  private build(type: FacType, dir: number, recipe: string, ghost = false): FVis {
    const g = new THREE.Group();
    const v: FVis = {
      obj: g, type, seen: 0, dir, recipe, model: false, spin: null, arm: null, armX: false, work: null, workY: 0, pitman: null, crank: null, ph: Math.random() * TAU, spd: 0, lamps: [], glows: [], own: [],
      belt: null, e: -1, k: -1, caps: -1, feeds: null, arrow: null, pipe: [], mask: -1, fluidKey: -1,
    };
    const src = type === 'belt' || type === 'pipe' ? null : this.modelOf(type);
    if (src) this.fromModel(v, src, ghost);
    else this.fromShapes(v, ghost);
    // the output side of a producer: a sand arrow on the deck at the edge it hands its items over
    if (turns(type) && type !== 'belt') {
      const holder = new THREE.Group(); holder.rotation.y = yawOf(dir);
      const ch = new THREE.Mesh(G_CHEV, mat(0xe3dc92, 'glow')); ch.position.set(0, 0.2, 0.86); ch.scale.setScalar(0.7);
      holder.add(ch); g.add(holder); v.arrow = holder;
    }
    return v;
  }

  /** A building from its model: shared geometry, its own copies of the lights that change with its state. */
  private fromModel(v: FVis, src: THREE.Object3D, ghost: boolean) {
    const m = src.clone(true);
    if (turns(v.type)) m.rotation.y = yawOf(v.dir);
    v.obj.add(m);
    v.model = true;
    const out = v.type === 'fab' ? RECIPE_BY_ID[v.recipe]?.out : undefined;
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
          if (out) { c.emissive.setHex(ITEMS[out].color); c.color.setHex(ITEMS[out].color).multiplyScalar(0.25); } // the fabricator's lights show what it makes
          // the fabricator's lit bay and window are large faces: at full strength they bloom into one blown-out block
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
    const { type, dir, recipe, obj: g } = v;
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
      case 'pipe': {
        for (const m of [this.pipeMat(0), this.pipeFit, this.pipeValve]) { const o = new THREE.Mesh(G_HEXF, m); o.castShadow = true; o.receiveShadow = true; g.add(o); v.pipe.push(o); }
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
      case 'fab': {
        base();
        box(1.3, 0.8, 1.3, mat(c), 0, 0.58, 0);
        box(1.0, 0.3, 1.0, mat(HULL, 'dark'), 0, 1.13, 0);
        const gear = new THREE.Group(); gear.position.set(0, 1.4, 0); g.add(gear); v.spin = gear;
        const t = new THREE.Mesh(geo('fabGear', () => new THREE.TorusGeometry(0.34, 0.08, 6, 12)), mat(TRIM, 'dark')); t.rotation.x = Math.PI / 2; gear.add(t);
        for (let i = 0; i < 6; i++) { const b = box(0.12, 0.1, 0.18, mat(TRIM, 'dark'), Math.cos((i * TAU) / 6) * 0.44, 0, Math.sin((i * TAU) / 6) * 0.44, gear); b.rotation.y = -(i * TAU) / 6; }
        const out = RECIPE_BY_ID[recipe]?.out;
        const light = box(0.5, 0.12, 0.06, glow(0x222222, out ? ITEMS[out].color : c, 1.6), 0, 0.75, 0.66);
        // the face with the light looks to the output side
        const face = new THREE.Group(); face.rotation.y = yawOf(dir); g.remove(light); face.add(light); g.add(face);
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
      case 'depot': {
        base(0.12);
        box(1.5, 0.12, 1.3, mat(TRIM, 'dark'), 0, 0.18, 0);
        for (let i = 0; i < 4; i++) box(0.55, 0.42, 0.5, mat(0xe3dc92), (i % 2 - 0.5) * 0.62, 0.45, (Math.floor(i / 2) - 0.5) * 0.58);
        box(0.55, 0.42, 0.5, mat(0xc9b870), 0.1, 0.87, 0);
        lamp(1.2, 0.55, 0.5);
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
  /** The body material for pipes showing a fluid state (0 empty, else fluid index * 16 + fill in tenths), shared by all of them. */
  private pipeMat(key: number): THREE.MeshStandardMaterial {
    let m = this.pipeMats.get(key);
    if (m) return m;
    m = new THREE.MeshStandardMaterial({ color: 0x6f7b82, roughness: 0.32, metalness: 0.85, emissive: 0x000000 });
    if (key) {
      // painted steel in the fluid's colour (not a glowing tube), with a slow pulse running through it in world space
      const c = FLUIDS[FLUID_TYPES[(key >> 4) - 1]].color, T = this.flowT;
      m.color.lerp(new THREE.Color(c), 0.32); m.emissive.setHex(c); m.emissiveIntensity = 0.05 + 0.13 * ((key & 15) / 10);
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uFlowT = T;
        sh.vertexShader = 'varying vec2 vFlowW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n\tvFlowW = (modelMatrix * vec4(transformed, 1.0)).xz;');
        sh.fragmentShader = 'uniform float uFlowT;\nvarying vec2 vFlowW;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= 0.7 + 0.3 * sin(uFlowT * 3.0 - (vFlowW.x * 0.9 + vFlowW.y * 0.6));');
      };
      m.customProgramCacheKey = () => 'pipeflow';
    }
    this.pipeMats.set(key, m);
    return m;
  }
  private shapePipe(v: FVis, mask: number, cx: number, cz: number) {
    v.mask = mask;
    const [b, f, w] = pipeGeo(mask, (cx * 2 + cz * 3) % 4 === 1);
    v.pipe[0].geometry = b; v.pipe[1].geometry = f;
    v.pipe[2].visible = !!w; if (w) v.pipe[2].geometry = w;
  }

  /** A number that changes when any building comes, goes or turns (the belt shapes depend on their neighbours). */
  private layoutKey(F: Factory) {
    let h = F.facs.length | 0;
    for (const f of F.facs) h = Math.imul(h ^ (f.id * 977 + f.dir * 131 + f.cx * 7919 + f.cz * 104729 + FAC_TYPES.indexOf(f.type)), 16777619);
    return h;
  }
  /** Work out each belt's entry side and shape from what feeds it, and where its line starts and stops. */
  private layoutBelts(F: Factory) {
    const pointsAt = (q: Fac, b: Fac) => { const [x, z] = neighbor(q.cx, q.cz, q.dir); return x === b.cx && z === b.cz; };
    const entry = new Map<number, number>(), multi = new Map<number, { d: number; q: Fac }[]>();
    for (const b of F.facs) {
      if (b.type !== 'belt') continue;
      const fs: { d: number; q: Fac }[] = [];
      for (let d = 0; d < 6; d++) {
        if (d === b.dir) continue;
        const [nx, nz] = neighbor(b.cx, b.cz, d), q = F.facAt(nx, nz);
        if (!q || !turns(q.type) || !pointsAt(q, b)) continue;
        fs.push({ d, q });
      }
      entry.set(b.id, fs.length === 1 ? fs[0].d : -1 - fs.length);
      if (fs.length > 1) multi.set(b.id, fs);
    }
    for (const b of F.facs) {
      const v = this.vis.get(b.id);
      if (!v) continue;
      if (b.type === 'pipe') { const m = F.pipeMask(b); if (m !== v.mask) this.shapePipe(v, m, b.cx, b.cz); continue; }
      // a producer's arrow gives way to the belt that takes its output (not to one there that points back into it: the sim
      // never hands output to that one, so the arrow has to keep showing where the building waits to put its items)
      if (v.arrow) { const [nx, nz] = neighbor(b.cx, b.cz, b.dir), q = F.facAt(nx, nz); v.arrow.visible = !q || q.type !== 'belt' || pointsAt(q, b); }
      if (b.type !== 'belt') continue;
      const en = entry.get(b.id)!, back = (b.dir + 3) % 6, e = en >= 0 ? en : back, fs = multi.get(b.id);
      // several feeders: the belt runs straight, each side feeder gets an inlet stub, and the items it hands over ride in from it
      const old = v.feeds;
      v.feeds = fs ? fs.map(({ d, q }) => {
        const was = old?.find((o) => o.id === q.id);
        return was ? { ...was, d } : { d, id: q.id, head: q.type === 'belt' ? q.items[0] ?? null : null, n: q.out.length };
      }) : null;
      if (!!old !== !!fs || (fs && old!.map((o) => o.d).join() !== fs.map((o) => o.d).join())) this.beltDirty = true;
      // the end is open unless the next belt takes this one in at the side facing it (its line carries on from here)
      const [nx, nz] = neighbor(b.cx, b.cz, b.dir), q = F.facAt(nx, nz);
      const joins = !!q && q.type === 'belt' && !pointsAt(q, b) && (entry.get(q.id)! >= 0 ? entry.get(q.id) === (b.dir + 3) % 6 : (q.dir + 3) % 6 === (b.dir + 3) % 6);
      // the start is open (an end drum) with no feeder, or with several but none straight behind it
      const open = en === -1 || (!!fs && !fs.some((f) => f.d === back));
      this.shapeBelt(v, e, (b.dir - e + 6) % 6, (open ? 1 : 0) | (joins ? 0 : 2));
    }
  }

  /** Placed belts and their inlet stubs into the instanced batches (when the layout changes, and every frame while they grow in). */
  private syncBelts(F: Factory, revealing: boolean) {
    if (!this.beltDirty && !revealing && !this.beltScaled) return;
    this.beltDirty = false; this.beltScaled = revealing;
    for (const b of this.beltBatches.values()) b.n = 0;
    for (const fc of F.facs) {
      if (fc.type !== 'belt') continue;
      const v = this.vis.get(fc.id);
      if (!v || v.k < 0) continue;
      const sc = v.obj.scale.x, back = (fc.dir + 3) % 6;
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
    // while the deck assembles, the deposits and the items wait for their tiles (the buildings grow with them)
    this.ores.visible = this.pools.visible = this.rocks.visible = this.items.visible = this.wires.visible = !reveal;
    let added = false;
    for (const fc of F.facs) {
      let v = this.vis.get(fc.id);
      // a producer turned, a fabricator given a new recipe, or a model that has loaded since: built again
      if (v && ((fc.type !== 'belt' && turns(fc.type) && v.dir !== fc.dir) || (fc.type === 'fab' && v.recipe !== fc.recipe) || (!v.model && fc.type !== 'belt' && fc.type !== 'pipe' && this.modelOf(fc.type)))) {
        this.drop(v); this.vis.delete(fc.id); v = undefined;
      }
      if (!v) {
        v = this.build(fc.type, fc.dir, fc.recipe);
        v.obj.position.set(fc.x, 0, fc.z);
        this.group.add(v.obj);
        this.vis.set(fc.id, v);
        added = true;
      }
      v.seen = f;
      if (reveal) v.obj.scale.setScalar(Math.max(0.001, reveal(fc.x, fc.z)));
      else if (v.obj.scale.x !== 1) v.obj.scale.setScalar(1);
      this.animate(fc, v, dt, time);
    }
    for (const [id, v] of this.vis) if (v.seen !== f) { this.drop(v); this.vis.delete(id); }
    const lk = this.layoutKey(F);
    if (lk !== this.layout || added || F.pipeNets !== this.nets) { this.layout = lk; this.nets = F.pipeNets; this.layoutBelts(F); this.coverRocks(F); }
    this.syncBelts(F, !!reveal);
    this.flowT.value = time;
    // the tread runs with the sim clock at the belt speed (it stops when the game pauses)
    const st = sim.time;
    if (this.lastT >= 0 && st > this.lastT && st - this.lastT < 5) this.run += (st - this.lastT) * BELT_SPEED * sim.mods.belt;
    this.lastT = st;
    this.tread.offset.y = -((this.run * BELT_REP) % 1);
    this.syncItems(F);
    this.syncWires(F);
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

  /** Belt items: placed on their belt's path, turned along it, one instanced mesh per part of each shape. */
  private syncItems(F: Factory) {
    const N = this.itemN, pt = this.pt, M = this.M;
    for (const s of SHAPES) N[s] = 0;
    for (const fc of F.facs) {
      if (fc.type !== 'belt' || !fc.items.length) continue;
      const v = this.vis.get(fc.id);
      if (!v || v.k < 0) continue;
      const P = PATHS[v.k], c = DX[v.e], s = DZ[v.e], fd = v.feeds;
      // a belt with several feeders: tell which one handed over each new item (a feeder belt whose front item has gone, or a
      // producer whose output queue got shorter), then note what each holds now for the next frame
      if (fd) {
        for (const it of fc.items) {
          if (this.inSide.has(it)) continue;
          let side = v.e;
          for (const f of fd) {
            const q = F.facById(f.id);
            if (!q) continue;
            if (q.type === 'belt' ? f.head !== null && f.head.it === it.it && q.items[0] !== f.head : q.out.length < f.n) { side = f.d; f.head = null; f.n = -1; break; }
          }
          this.inSide.set(it, side);
        }
        for (const f of fd) { const q = F.facById(f.id); if (q) { f.head = q.type === 'belt' ? q.items[0] ?? null : null; f.n = q.out.length; } }
      }
      const ax = DX[fc.dir], az = DZ[fc.dir];
      for (const it of fc.items) {
        const sh = SHAPE_OF[it.it], n = N[sh];
        if (n >= MAX_ITEMS) continue;
        const side = fd ? this.inSide.get(it) ?? v.e : v.e;
        let x: number, z: number, tx: number, tz: number, y = Y_SURF;
        if (side === v.e) {
          pathAt(P, it.p, pt);
          x = fc.x + pt.x * c - pt.z * s; z = fc.z + pt.x * s + pt.z * c; tx = pt.tx * c - pt.tz * s; tz = pt.tx * s + pt.tz * c;
        } else {
          // in from a side: a quadratic curve from that edge's midpoint (down the inlet stub) through the tile centre and out
          // along the belt, hopping over the main belt's rail where it crosses it
          const p = it.p, a = (1 - p) * (1 - p), b2 = p * p, ex = DX[side], ez = DZ[side];
          x = fc.x + a * ex + b2 * ax; z = fc.z + a * ez + b2 * az;
          tx = -2 * (1 - p) * ex + 2 * p * ax; tz = -2 * (1 - p) * ez + 2 * p * az;
          const d = Math.abs((x - fc.x) * -az + (z - fc.z) * ax), hop = 1 - Math.abs(d - (RIN + ROUT) / 2) / 0.13;
          if (hop > 0) y += HOP * Math.sin((hop * Math.PI) / 2);
        }
        M.makeRotationY(Math.atan2(tx, tz)).scale(this.S.setScalar(ITEM_SCALE[sh]));
        M.setPosition(x, y, z);
        for (const p of this.itemMeshes[sh]) {
          p.mesh.setMatrixAt(n, M);
          if (p.tint) p.mesh.setColorAt(n, this.C.setHex(it.it === 'coal' ? COAL_TINT : ITEMS[it.it].color));
        }
        N[sh] = n + 1;
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
    const end = (A: Fac, B: Fac): [number, number, number] => {
      if (A.type !== 'pole') return [A.x, GEN_Y, A.z];
      return [A.x + (B.x >= A.x ? POLE_ARM : -POLE_ARM), POLE_Y, A.z];
    };
    const parts: THREE.BufferGeometry[] = [];
    for (const [a, b] of F.wires) {
      const A = F.facById(a), B = F.facById(b);
      if (!A || !B) continue;
      const [ax, ay, az] = end(A, B), [bx, by, bz] = end(B, A), N = 14, len = Math.hypot(bx - ax, bz - az);
      // a parabola close enough to the catenary for these spans, sagging 4.5% of the span at the middle
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= N; i++) { const k = i / N; pts.push(new THREE.Vector3(ax + (bx - ax) * k, ay + (by - ay) * k - 4 * k * (1 - k) * len * 0.045, az + (bz - az) * k)); }
      parts.push(strip(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), N * 2, 0.024, 5, false)));
    }
    this.wires.geometry.dispose();
    this.wires.geometry = parts.length ? mergeGeometries(parts)! : new THREE.BufferGeometry();
    for (const g of parts) g.dispose();
  }

  private animate(fc: Fac, v: FVis, dt: number, time: number) {
    const sim = this.sim!, on = fc.state === 'ok';
    if (v.lamps.length) {
      const c = fc.state === 'ok' ? LAMP.ok : fc.state === 'nopower' || fc.state === 'nofuel' || fc.state === 'nodeposit' ? LAMP.bad : LAMP.warn;
      const i = fc.state === 'ok' ? 1.8 : 1.2 + 0.8 * Math.sin(time * 6 + fc.id);
      for (const m of v.lamps) { m.emissive.setHex(c); m.color.setHex(c).multiplyScalar(0.25); m.emissiveIntensity = i; }
    }
    // working lights: lit (and flickering for the hot ones) while the building works, nearly dark while it idles
    if (v.glows.length) {
      const k = !on ? 0.1 : fc.type === 'smelter' ? 1 + 0.3 * Math.sin(time * 13 + fc.id) : fc.type === 'generator' ? 1 + 0.3 * Math.sin(time * 11 + fc.id)
        : fc.type === 'fab' ? 1 + 0.25 * Math.sin(time * 8) : fc.type === 'refinery' ? 1 + 0.25 * Math.sin(time * 5) : 1;
      for (const g of v.glows) g.m.emissiveIntensity = g.i0 * k;
    }
    // machines spin up over about a second and run down when they stop, instead of snapping
    v.spd += ((on ? 1 : 0) - v.spd) * Math.min(1, dt * 1.6);
    if (v.work) v.work.position.y = v.workY + 0.035 * v.spd * Math.sin(time * 5 + fc.id);
    switch (fc.type) {
      case 'mine': if (v.spin) v.spin.rotation.y += dt * 9 * v.spd; break;
      // the robot arm swings between the bay and the door, it does not whirl round
      case 'fab': if (v.spin) { v.ph += dt * 1.7 * v.spd; v.spin.rotation.y = 1.15 * Math.sin(v.ph); } break;
      case 'generator': if (v.spin) v.spin.rotation.y += dt * (0.5 + 13.5 * v.spd); break;
      case 'refinery': if (v.spin) v.spin.rotation.y += dt * (0.3 + 7.7 * v.spd); break;
      case 'pump': {
        if (!v.arm) break;
        v.ph += dt * 2.2 * v.spd;
        if (v.armX) pumpPose(v.arm, v.pitman, v.crank, v.ph);
        else v.arm.rotation.z = Math.sin(v.ph) * 0.32;
        break;
      }
      case 'pipe': {
        // the network's fluid and how full it is pick a shared material (its side mask is set with the layout, see layoutBelts)
        const net = sim.factory.pipeNets[fc.net];
        const key = net && net.fluid ? (FLUID_TYPES.indexOf(net.fluid) + 1) * 16 + Math.round((net.cap > 0 ? net.amt / net.cap : 0) * 10) : 0;
        if (key !== v.fluidKey && v.pipe.length) { v.fluidKey = key; v.pipe[0].material = this.pipeMat(key); }
        break;
      }
    }
  }
}

/** The colour that stands for an item in the HUD. */
export const itemCss = (it: ItemType) => '#' + ITEMS[it].color.toString(16).padStart(6, '0');
export const ALL_ITEMS = ITEM_TYPES;
