// Three.js view of a Sim: models, cameras (bird view + third-person hero), effects.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CELL, GW, GH, TOWERS, TOWER_TYPES, ENEMIES, ENEMY_TYPES, BOW_TIERS, cellX, cellZ } from './data.ts';
import type { TowerType, EnemyType } from './data.ts';
import { Sim, TOWER_SCALE, HERO_SCALE, SKILL_CAST, standY } from './sim.ts';
import type { Ev, Tower } from './sim.ts';
import type { GameMap } from './map.ts';
import { Fx } from './fx.ts';
import { buildWorld, noAO, FX_LAYER } from './world.ts';
import { Post } from './post.ts';
import { lightPool, glowTexture, POOL_GEO } from './tex.ts';
import { makeEnemyRig, resetEnemy, updateEnemy, makeTowerRig, updateTower, towerShot, makeHeroRig, updateHero, heroTrigger, RAIN_GAP } from './anim.ts';
import type { EnemyRig, TowerRig, HeroRig, HeroEvent } from './anim.ts';

const MODEL_NAMES = [...TOWER_TYPES.map((t) => 'tower_' + t), ...ENEMY_TYPES.map((t) => 'enemy_' + t), 'hero', 'core', 'prop_barrier', 'prop_lamp', 'prop_crate'];
const ENEMY_COLOR = 0xff4a22;
const HEAT = 0xffa24a; // hot metal sparks
const HSL = { h: 0, s: 0, l: 0 };
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), Q = new THREE.Quaternion();

interface EVis { obj: THREE.Object3D; rig: EnemyRig; sx: number; sz: number; glow: THREE.Mesh; bar: THREE.Sprite; sbar: THREE.Sprite | null; bubble: THREE.Mesh | null; type: EnemyType; phase: number; seen: number; fresh: boolean }
interface TVis { obj: THREE.Object3D; rig: TowerRig; pips: THREE.Group; buff: THREE.Mesh; type: TowerType; lvl: number; grow: number; seen: number }
interface PVis { mesh: THREE.Mesh; kind: string; seen: number; fresh: boolean }
/** tele > 0: still dissolving at the tower she is leaving; out: playing the uplink-end animation at `pos` */
interface HVis { obj: THREE.Object3D; disc: THREE.Mesh; rig: HeroRig | null; pos: THREE.Vector3; tele: number; out: boolean; shown: boolean }
interface ZVis { obj: THREE.Group; kind: string; seen: number; t: number }
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

function fallbackModel(name: string): THREE.Object3D {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0x1b2030, roughness: 0.45, metalness: 0.6 });
  const glow = (c: number) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 3, name: 'glow_main' });
  if (name.startsWith('tower_')) {
    const t = name.slice(6) as TowerType, c = TOWERS[t].color;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 1.2, 8), hull); base.position.y = 0.6; g.add(base);
    const tur = new THREE.Group(); tur.name = 'turret'; tur.position.y = 1.5;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 1.0), hull); tur.add(head);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.9), glow(c)); bar.position.z = 0.8; tur.add(bar);
    g.add(tur);
  } else if (name.startsWith('enemy_')) {
    const t = name.slice(6) as EnemyType, d = ENEMIES[t];
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(d.r * 0.7, d.r, 4, 10), new THREE.MeshStandardMaterial({ color: 0x3a0c14, roughness: 0.5, metalness: 0.5 }));
    b.position.y = t === 'drone' ? 0 : d.r * 1.2; g.add(b);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(d.r * 0.3, 8, 6), glow(ENEMY_COLOR)); eye.position.set(0, b.position.y + d.r * 0.3, d.r * 0.6); g.add(eye);
  } else if (name === 'hero') {
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1, 4, 10), new THREE.MeshStandardMaterial({ color: 0xd8fff6 })); b.position.y = 0.9; g.add(b);
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.04, 6, 20, Math.PI), glow(0x35f0ff)); bow.name = 'bow'; bow.position.set(-0.3, 1.2, 0.5); bow.rotation.set(0, Math.PI / 2, Math.PI / 2); (bow.material as THREE.Material).name = 'glow_bow'; g.add(bow);
  } else if (name === 'core') {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.3, 1, 12), hull); b.position.y = 0.5; g.add(b);
    const s = new THREE.Mesh(new THREE.SphereGeometry(1.3, 20, 14), glow(0x35f0ff)); s.position.y = 2.8; g.add(s);
  } else {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), hull); b.position.y = 0.4; g.add(b);
  }
  return g;
}

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
  private rangeRing: THREE.Mesh; private cellMark: THREE.Mesh; private ghost = new THREE.Group(); private ghostType = '';
  private selRing: THREE.Mesh; private teleMark: THREE.Group; private hoverMark: THREE.Mesh;
  private bowMats: THREE.MeshStandardMaterial[] = [];
  private enemyGlow = new THREE.MeshBasicMaterial({ map: glowTexture(), color: new THREE.Color(ENEMY_COLOR).multiplyScalar(0.55), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  private world: ReturnType<typeof buildWorld>;
  private topPos = new THREE.Vector3(); private topQ = new THREE.Quaternion();
  private heroPos = new THREE.Vector3(); private heroQ = new THREE.Quaternion();
  private dummy = new THREE.PerspectiveCamera();
  private lastHeroAnchor = new THREE.Vector3();
  private core = { x: 0, z: 0 };
  private scenery = new THREE.Group();
  private mapDef: unknown = null;
  private later: Later[] = [];
  /** Skill zones whose visuals wait for the cast pose: [x, z, delay]. */
  private zoneWait: number[][] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.camera.layers.enable(FX_LAYER);
    this.post = new Post(this.renderer, this.scene, this.camera, FX_LAYER);

    this.world = buildWorld(this.scene, this.renderer);
    this.scene.add(this.dyn, this.fx.group);

    this.barMats = [0x74d98c, 0xe6b84a, 0xe8523c, 0x6aa8e6].map((c) => new THREE.SpriteMaterial({ color: c, depthWrite: false, fog: false }));
    const arrow = new THREE.CylinderGeometry(0.035, 0.035, 2.6, 5); arrow.rotateX(Math.PI / 2);
    const bolt = new THREE.SphereGeometry(0.11, 8, 6); bolt.scale(1, 1, 4.2);
    this.projGeo = { arrow, bolt, shell: new THREE.SphereGeometry(0.2, 14, 10) };
    this.projMat = {
      bolt: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6fe6f5).multiplyScalar(2.2) }),
      shell: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff9a3a).multiplyScalar(2.2) }),
    };
    BOW_TIERS.forEach((b, i) => { this.projMat['arrow' + i] = new THREE.MeshBasicMaterial({ color: new THREE.Color(b.color).lerp(new THREE.Color(0xffffff), 0.25).multiplyScalar(2.3) }); });

    const flat = (geo: THREE.BufferGeometry, color: number, opacity = 1) => {
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false; m.layers.set(FX_LAYER); this.scene.add(m);
      return m;
    };
    this.rangeRing = flat(new THREE.RingGeometry(0.982, 1, 128), 0xffffff, 0.8); this.rangeRing.position.y = 0.06;
    this.selRing = flat(new THREE.RingGeometry(0.95, 1.03, 48), 0xffffff, 0.85); this.selRing.position.y = 0.08;
    this.cellMark = flat(new THREE.PlaneGeometry(CELL * 0.92, CELL * 0.92), 0x5dff8f, 0.22); this.cellMark.position.y = 0.04;
    this.hoverMark = flat(new THREE.RingGeometry(1.02, 1.1, 4, 1, Math.PI / 4), 0xb8dcf0, 0.6); this.hoverMark.position.y = 0.05;
    this.ghost.visible = false; this.scene.add(this.ghost);
    this.teleMark = new THREE.Group();
    const tm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x35f0ff).multiplyScalar(2), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const dia = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), tm); dia.position.y = 1.6; this.teleMark.add(dia);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 40, 6), tm); col.position.y = 21; this.teleMark.add(col);
    const tr = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.05, 6, 32), tm); tr.rotation.x = Math.PI / 2; tr.position.y = 0.3; this.teleMark.add(tr);
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
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true; m.receiveShadow = !name.startsWith('enemy_');
        const mat = m.material as THREE.MeshStandardMaterial;
        if (!mat || !mat.isMeshStandardMaterial) return;
        if (mat.name && mat.name.startsWith('glow')) {
          m.castShadow = false;
          if (mat.userData.tuned) return;
          mat.userData.tuned = true;
          if (mat.emissive.getHex() === 0) mat.emissive.copy(mat.color);
          // emissive accents: bright enough to cross the bloom threshold, capped so they never white out
          const enemy = name.startsWith('enemy_');
          mat.emissiveIntensity = name === 'core' ? 1.5 : name === 'hero' ? 1.7 : name.startsWith('prop_') ? 1.6 : enemy ? 3.4 : 2.4;
          if (name === 'prop_lamp') { mat.emissive.setHex(0xffb070); mat.color.setHex(0xffb070); mat.emissiveIntensity = 2.6; } // sodium lamps
          else if (!enemy && !mat.name.startsWith('glow_bow')) { mat.emissive.getHSL(HSL); mat.emissive.setHSL(HSL.h, HSL.s * 0.82, HSL.l); }
          mat.color.multiplyScalar(0.25);
          if (name === 'hero' && mat.name.startsWith('glow_bow') && !this.bowMats.includes(mat)) this.bowMats.push(mat);
          return;
        }
        if (mat.userData.tuned) return;
        mat.userData.tuned = true;
        mat.envMapIntensity = 1;
        mat.color.getHSL(HSL);
        if (mat.name === 'paint') {
          // team / type colour becomes a muted coated-metal accent instead of flat toy paint
          const enemy = name.startsWith('enemy_');
          mat.color.setHSL(HSL.h, HSL.s * (enemy ? 0.8 : 0.62), Math.min(HSL.l, enemy ? 0.2 : 0.3) * (enemy ? 1 : 0.95));
          mat.metalness = Math.max(mat.metalness, 0.55); mat.roughness = enemy ? 0.6 : 0.42; mat.envMapIntensity = 1.15;
        } else if (mat.name === 'hull') {
          // near-black hulls vanish against the dark deck: lift them to gunmetal and let reflections do the work
          mat.color.setHSL(HSL.h, HSL.s * 0.5, Math.max(HSL.l, name.startsWith('enemy_') ? 0.07 : 0.1));
          mat.metalness = 0.85; mat.roughness = name.startsWith('enemy_') ? 0.58 : 0.36; mat.envMapIntensity = 1.35;
          // the spire's platform floor fills the bottom of the third-person view: keep it matte or it mirrors the sky into the bloom
          if (name === 'tower_spire') { mat.metalness = 0.6; mat.roughness = 0.7; mat.envMapIntensity = 0.55; }
        } else if (mat.name === 'trim') {
          mat.color.setHSL(HSL.h, HSL.s * 0.6, Math.min(0.5, Math.max(HSL.l, 0.3)));
          // enemy plates swing through the sun as they walk: a mirror finish there blooms to a white flash
          const en = name.startsWith('enemy_');
          mat.metalness = en ? 0.8 : 0.95; mat.roughness = en ? 0.55 : 0.24; mat.envMapIntensity = en ? 1.1 : 1.5;
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
    const hx = (GW * CELL) / 2, hz = (GH * CELL) / 2;
    for (let i = 0; i < 12; i++) {
      for (const s of [-1, 1]) {
        const l = this.models.prop_lamp.clone();
        l.position.set(-hx + 2 + i * ((hx * 2 - 4) / 11), 0, s * (hz + 1.6)); l.rotation.y = s > 0 ? Math.PI : 0;
        this.scene.add(l);
        if (i % 2 === (s > 0 ? 0 : 1)) { // every other lamp is lit: warm sodium pools along the deck edge
          const pool = noAO(lightPool(4.2, 0xff9a4a, 0.34)); pool.position.set(l.position.x, 0.035, s * (hz - 0.4)); this.scene.add(pool);
          const spill = noAO(lightPool(3.2, 0xff9a4a, 0.3)); spill.position.set(l.position.x, -0.4, s * (hz + 2.4)); this.scene.add(spill);
        } else l.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh && (mm.material as THREE.Material).name.startsWith('glow')) { mm.material = (mm.material as THREE.MeshStandardMaterial).clone(); (mm.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05; } });
      }
    }
  }

  setSim(sim: Sim | null, me = 0) {
    this.sim = sim; this.me = me;
    for (const [id, v] of this.ev) { v.obj.visible = false; (this.epool[v.type] ||= []).push(v); this.ev.delete(id); }
    for (const [id, v] of this.tv) { this.dyn.remove(v.obj); this.tv.delete(id); }
    for (const [id, v] of this.pv) { v.mesh.visible = false; (this.ppool[v.kind] ||= []).push(v); this.pv.delete(id); }
    for (const [id, v] of this.zv) { this.dyn.remove(v.obj); this.zv.delete(id); }
    for (const h of this.heroes) { h.obj.visible = false; h.out = false; h.shown = false; h.tele = 0; }
    this.later.length = 0; this.zoneWait.length = 0;
    this.heroBlend = 0;
    this.setGhost(null); this.setSelected(null); this.setTele(null);
    this.hoverMark.visible = false;
    if (sim && sim.map.def !== this.mapDef && this.coreObj) {
      // dress the deck for this map: road, gates, core position, wreckage on blocked tiles
      this.mapDef = sim.map.def;
      this.world.setMap(sim.map);
      this.core = sim.map.core;
      this.coreObj.position.set(this.core.x, 0, this.core.z);
      this.scenery.clear();
      sim.map.def.blocked.forEach(([cx, cz], i) => {
        const k = (cx * 7 + cz * 13 + i) % 5;
        const o = this.models[k < 2 ? 'prop_crate' : 'prop_barrier'].clone();
        o.position.set(cellX(cx) + ((k % 3) - 1) * 0.15, 0, cellZ(cz) + ((k % 2) - 0.5) * 0.2);
        o.rotation.y = k * 1.3 + cx; o.scale.setScalar(k < 2 ? 1.35 : 1.0);
        this.scenery.add(o);
        if (k === 0) { const o2 = this.models.prop_crate.clone(); o2.position.set(o.position.x + 0.1, 1.2, o.position.z - 0.1); o2.rotation.y = cz; o2.scale.setScalar(0.9); this.scenery.add(o2); }
      });
    }
  }

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

  // ---------- picking ----------
  groundPoint(clientX: number, clientY: number, out = new THREE.Vector3()) {
    const r = this.renderer.domElement.getBoundingClientRect();
    V.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    const u = V.y < -1e-4 ? -this.camera.position.y / V.y : 200;
    return out.copy(this.camera.position).addScaledVector(V, u);
  }
  /** Point the crosshair is on: nearest enemy along the view ray, else the ground. */
  aimPoint(out = new THREE.Vector3()) {
    const o = this.heroPos, d = V.set(0, 0, -1).applyQuaternion(this.heroQ);
    let best = 95;
    if (d.y < -0.01) best = Math.min(best, (0.5 - o.y) / d.y);
    if (this.sim) for (const e of this.sim.enemies) {
      const ex = e.x - o.x, ey = e.y - o.y, ez = e.z - o.z, u = ex * d.x + ey * d.y + ez * d.z;
      if (u < 3.4 || u > best) continue;
      if (Math.hypot(ex - d.x * u, ey - d.y * u, ez - d.z * u) < e.r + 0.5) best = u;
    }
    return out.copy(o).addScaledVector(d, best);
  }
  /** Tower under the crosshair (teleport target), or 0. */
  aimTower(): number {
    if (!this.sim) return 0;
    const p = this.sim.players[this.me], d = V.set(0, 0, -1).applyQuaternion(this.heroQ);
    let best = 0, ba = 0.1;
    for (const t of this.sim.towers) {
      if (t.id === p.heroTower) continue;
      V2.set(t.x, t.h + 0.5, t.z).sub(this.heroPos);
      const L = V2.length();
      const a = Math.acos(Math.min(1, V2.dot(d) / L)) * (1 + L * 0.004);
      if (a < ba) { ba = a; best = t.id; }
    }
    return best;
  }
  project(x: number, y: number, z: number): [number, number, boolean] {
    V.set(x, y, z).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return [(V.x * 0.5 + 0.5) * r.width, (-V.y * 0.5 + 0.5) * r.height, V.z < 1 && Math.abs(V.x) < 1.1 && Math.abs(V.y) < 1.1];
  }

  setGhost(type: TowerType | null, cx = 0, cz = 0, ok = true, range = 0) {
    this.ghost.visible = this.cellMark.visible = !!type;
    if (!type) { if (!this.selRing.visible) this.rangeRing.visible = false; return; }
    if (this.ghostType !== type) { this.ghost.clear(); this.ghost.add(this.models['tower_' + type].clone()); this.ghostType = type; }
    const x = cellX(cx), z = cellZ(cz);
    this.ghost.position.set(x, 0, z);
    this.ghost.visible = ok;
    this.cellMark.position.set(x, 0.04, z);
    (this.cellMark.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0x5dff8f : 0xff3b3b);
    this.rangeRing.visible = true; this.rangeRing.position.set(x, 0.06, z); this.rangeRing.scale.setScalar(range);
    (this.rangeRing.material as THREE.MeshBasicMaterial).color.setHex(ok ? TOWERS[type].color : 0xff3b3b);
  }
  setSelected(t: Tower | null, range = 0) {
    this.selRing.visible = !!t;
    if (!t) { if (!this.ghost.visible && !this.cellMark.visible) this.rangeRing.visible = false; return; }
    this.selRing.position.set(t.x, 0.08, t.z); this.selRing.scale.setScalar(1.25);
    this.rangeRing.visible = true; this.rangeRing.position.set(t.x, 0.06, t.z); this.rangeRing.scale.setScalar(range);
    (this.rangeRing.material as THREE.MeshBasicMaterial).color.setHex(TOWERS[t.type].color);
  }
  setHover(cx: number, cz: number, show: boolean) {
    this.hoverMark.visible = show;
    if (show) { this.hoverMark.position.set(cellX(cx), 0.05, cellZ(cz)); this.hoverMark.scale.setScalar(CELL * 0.62); }
  }
  setTele(t: Tower | null) {
    this.teleMark.visible = !!t;
    if (t) this.teleMark.position.set(t.x, t.h, t.z);
  }

  // ---------- events → effects ----------
  /** Route a sim event to player p's hero rig. */
  private heroAnim(p: unknown, ev: HeroEvent) {
    const h = this.heroes[p as number];
    if (h && h.rig) heroTrigger(h.rig, ev);
  }

  handle(evs: Ev[]) {
    const fx = this.fx;
    for (const e of evs) {
      switch (e.k) {
        case 'shot': { fx.burst(e.x, e.y, e.z, 2, 3, TOWERS[e.t as TowerType]?.color ?? 0xffffff, 0.12, 0.24, 0); const tv = this.tv.get(e.id); if (tv) towerShot(tv.rig, +e.d || 0); break; }
        case 'hit': fx.burst(e.x, e.y, e.z, 3, 4, e.c, 0.2, 0.22, 6); fx.burst(e.x, e.y, e.z, 2, 5, HEAT, 0.35, 0.16, 12); break;
        case 'cryo': {
          const tv = this.tv.get(e.id); if (tv) towerShot(tv.rig);
          fx.beam(e.x, e.y, e.z, e.tx, e.ty, e.tz, 0x9fd8ff, 0.16, 0.22);
          fx.ring(e.tx, 0.1, e.tz, e.r, 0x9fd8ff, 0.4);
          fx.burst(e.tx, e.ty, e.tz, 8, 3.5, 0xdff4ff, 0.5, 0.2, 1);
          fx.smoke(e.tx, 0.3, e.tz, 1, 1.1, e.r * 0.5, 0.25);
          break;
        }
        case 'arc': if (Array.isArray(e.p)) fx.arc(e.p, e.c); break;
        case 'rail': {
          const hero = e.big && e.p !== undefined && this.heroes[+e.p] && this.heroes[+e.p].rig;
          const fire = () => {
            let x = e.x, y = e.y, z = e.z;
            if (hero) { // leaves from the bow, not from the middle of her body
              const dx = e.tx - x, dy = e.ty - y, dz = e.tz - z, L = Math.hypot(dx, dy, dz) || 1;
              x += dx / L * 0.5; y += dy / L * 0.5 + 0.1; z += dz / L * 0.5;
            }
            fx.beam(x, y, z, e.tx, e.ty, e.tz, e.c, e.big ? (hero ? 0.3 : 0.42) : 0.2, e.big ? 0.5 : 0.32);
            fx.burst(e.tx, e.ty, e.tz, e.big ? 14 : 5, 6, HEAT, 0.45, 0.2, 10);
            if (e.big) { this.shake = Math.max(this.shake, 0.35); for (let i = 0; i < 12; i++) { const u = Math.random(); fx.burst(x + (e.tx - x) * u, y + (e.ty - y) * u, z + (e.tz - z) * u, 2, 2.5, e.c, 0.45, 0.22, 0); } }
          };
          // Rail Shot: the pose winds up first, the beam leaves on the release beat
          if (hero) { this.heroAnim(e.p, 'rail'); this.later.push({ t: SKILL_CAST[0], fn: fire }); } else fire();
          break;
        }
        case 'boom': fx.boom(e.x, e.y, e.z, e.r, e.c, !!e.s); if (!e.s) this.shake = Math.max(this.shake, 0.12); break;
        case 'die': {
          const big = e.t === 'boss', mid = e.t === 'brute' || e.t === 'shield';
          fx.burst(e.x, e.y, e.z, big ? 70 : mid ? 14 : 6, big ? 15 : 6, ENEMY_COLOR, big ? 1.2 : 0.5, big ? 0.5 : 0.28, 10);
          fx.burst(e.x, e.y, e.z, big ? 50 : mid ? 10 : 5, big ? 11 : 5, HEAT, big ? 1.3 : 0.7, 0.2, 14);
          fx.flash(e.x, e.y, e.z, big ? 5 : mid ? 1.5 : 0.9, ENEMY_COLOR, big ? 0.45 : 0.16);
          fx.smoke(e.x, e.y + 0.2, e.z, big ? 12 : mid ? 3 : 1, big ? 2.6 : mid ? 1.2 : 0.8, big ? 3 : 0.6);
          if (e.y < 2 && (big || mid || Math.random() < 0.35)) fx.scorch(e.x, e.z, big ? 5 : mid ? 1.7 : 1.1, ENEMY_COLOR, big ? 10 : 5);
          if (big) { fx.ring(e.x, 0.15, e.z, 9, ENEMY_COLOR, 0.9); fx.column(e.x, 0, e.z, 0xffc86a); this.shake = 0.8; }
          break;
        }
        case 'shieldbreak': fx.burst(e.x, e.y, e.z, 14, 7, 0x7fbcff, 0.5, 0.24, 3); fx.flash(e.x, e.y, e.z, 1.5, 0x59b8ff, 0.18); break;
        case 'build': fx.ring(e.x, 0.1, e.z, 2.2, e.c, 0.5); fx.burst(e.x, 0.3, e.z, 12, 4, e.c, 0.6, 0.24, -3, 1); fx.smoke(e.x, 0.2, e.z, 3, 1, 1.6, 0.35); break;
        case 'sell': fx.burst(e.x, 0.8, e.z, 12, 5, 0xffc860, 0.6, 0.24, 9); fx.smoke(e.x, 0.4, e.z, 3, 1.1, 1.2, 0.5); break;
        case 'arrow': this.heroAnim(e.p, 'arrow'); break;
        case 'heroOn': { const h = this.hero(+e.p); h.out = false; h.tele = 0; h.pos.set(e.x, e.y, e.z); this.heroAnim(e.p, 'on'); }
          // a slim shaft of light: the wide column hid the whole materialise animation from the camera behind her
          fx.beam(e.x, e.y, e.z, e.x, e.y + 30, e.z, BOW_TIERS[this.sim ? this.sim.tier : 0].color, 0.2, 0.45); this.shake = Math.max(this.shake, 0.4); break;
        case 'heroOff': { const h = this.heroes[+e.p]; if (h && h.rig && h.shown) { h.out = true; h.tele = 0; h.pos.set(e.x, e.y, e.z); heroTrigger(h.rig, 'off'); } }
          fx.beam(e.x, e.y, e.z, e.x, e.y + 18, e.z, 0x9fd8ff, 0.2, 0.5); break;
        case 'tele': { const h = this.heroes[+e.p]; if (h && h.rig) { h.tele = 0.13; h.pos.set(e.fx, e.fy, e.fz); heroTrigger(h.rig, 'teleOut'); } }
          fx.beam(e.fx, e.fy, e.fz, e.fx, e.fy + 12, e.fz, 0x9fd8ff, 0.2, 0.4); fx.beam(e.x, e.y, e.z, e.x, e.y + 22, e.z, BOW_TIERS[this.sim ? this.sim.tier : 0].color, 0.2, 0.45); break;
        case 'skill': {
          const rain = e.s === 1, wait = SKILL_CAST[rain ? 1 : 2];
          this.heroAnim(e.p, rain ? 'rain' : 'sing');
          this.zoneWait.push([e.x, e.z, wait]);
          this.later.push({ t: wait, fn: () => fx.ring(e.x, 0.15, e.z, 5, e.c, 0.5, 1.4) });
          if (rain) for (let i = 0; i < 3; i++) this.later.push({ t: wait + i * RAIN_GAP, fn: () => this.rainTracer(+e.p, e.c) });
          break;
        }
        case 'leak': fx.ring(this.core.x, 0.2, this.core.z, 6, 0xff3b3b, 0.7); fx.burst(this.core.x, 2, this.core.z, 24, 9, 0xff3b3b, 0.8, 0.3, 8); this.shake = Math.max(this.shake, 0.3); break;
        case 'lose': fx.column(this.core.x, 0, this.core.z, 0xff3b3b, 40); fx.boom(this.core.x, 2.5, this.core.z, 12, 0xff5a2a); this.shake = 1.2; break;
      }
    }
  }

  // ---------- per-frame sync ----------
  private enemyVis(type: EnemyType): EVis {
    const pool = this.epool[type];
    if (pool && pool.length) { const v = pool.pop()!; v.obj.visible = true; v.fresh = true; return v; }
    const obj = this.models['enemy_' + type].clone();
    if (type === 'boss') obj.scale.setScalar(1.25);
    const rig = makeEnemyRig(obj, type);
    const d = ENEMIES[type];
    const bar = new THREE.Sprite(this.barMats[0]);
    bar.position.y = (type === 'drone' ? 0.8 : d.y * 2 + 0.7); bar.visible = false; bar.layers.set(FX_LAYER);
    obj.add(bar);
    // red-orange light spill on the ground: enemies stay easy to pick out on the dark roadway
    const glow = new THREE.Mesh(POOL_GEO, this.enemyGlow); glow.scale.setScalar((d.r * 2.2 + 0.9) / obj.scale.x); glow.layers.set(FX_LAYER);
    obj.add(glow);
    let sbar: THREE.Sprite | null = null, bubble: THREE.Mesh | null = null;
    if (d.shield) {
      sbar = new THREE.Sprite(this.barMats[3]); sbar.position.y = bar.position.y + 0.2; sbar.layers.set(FX_LAYER); obj.add(sbar);
      bubble = new THREE.Mesh(new THREE.SphereGeometry(d.r * 1.7, 18, 12), new THREE.MeshBasicMaterial({ color: 0x3a86d8, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
      bubble.position.y = d.y; bubble.layers.set(FX_LAYER); obj.add(bubble);
    }
    this.dyn.add(obj);
    return { obj, rig, sx: 0, sz: 0, bar, sbar, bubble, glow, type, phase: Math.random() * 6.28, seen: 0, fresh: true };
  }

  private sync(dt: number) {
    const sim = this.sim;
    if (!sim) return;
    const f = ++this.frame, k = 1 - Math.exp(-dt * 18);
    for (let i = 0; i < this.later.length; i++) { const l = this.later[i]; if ((l.t -= dt) <= 1e-6) { this.later.splice(i--, 1); l.fn(); } }
    if (this.zoneWait.length > 8) this.zoneWait.shift();
    // enemies
    for (const e of sim.enemies) {
      let v = this.ev.get(e.id);
      if (!v) { v = this.enemyVis(e.type); this.ev.set(e.id, v); }
      v.seen = f;
      // visual pose: the sim walks hard-cornered lanes; the view rounds every corner into an arc and limits the turn rate
      let d = e.dist, lane = e.lane, off = e.off;
      if (sim.replica) { // replicas only know x / z: recover the lane position from them
        if (v.fresh) { v.sx = e.x; v.sz = e.z; } else { v.sx += (e.x - v.sx) * k; v.sz += (e.z - v.sz) * k; }
        let bd = 1e9;
        for (let l = 0; l < sim.map.lanes.length; l++) {
          const nd = sim.map.nearest(l, v.sx, v.sz);
          sim.map.pos(l, nd, PO);
          const dd = Math.hypot(PO.x - v.sx, PO.z - v.sz);
          if (dd < bd - 1e-6) { bd = dd; d = nd; lane = l; off = -(v.sx - PO.x) * PO.dz + (v.sz - PO.z) * PO.dx; }
        }
      }
      roundedPose(sim.map, lane, d, off, TURN_A[e.type], PO);
      const y = e.type === 'drone' ? e.y : (PO.y || 0);
      if (v.fresh) { v.obj.position.set(PO.x, y, PO.z); v.obj.rotation.y = PO.yaw; v.fresh = false; resetEnemy(v.rig); }
      else {
        v.obj.position.set(PO.x, y, PO.z);
        let dy = PO.yaw - v.obj.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        const lim = TURN_RATE[e.type] * dt;
        v.obj.rotation.y += Math.max(-lim, Math.min(lim, dy));
      }
      let look = NaN;
      if (e.type === 'boss') { // the colossus' turret head tracks the nearest tower
        let bd = 400;
        for (const t of sim.towers) { const d = (t.x - e.x) * (t.x - e.x) + (t.z - e.z) * (t.z - e.z); if (d < bd) { bd = d; look = Math.atan2(t.x - e.x, t.z - e.z); } }
      }
      updateEnemy(v.rig, dt, e.hp / e.maxHp, e.sing > 0, e.frz > 0 && e.type !== 'boss', look);
      v.glow.position.y = (0.05 - y) / v.obj.scale.y;
      const r = Math.max(0, e.hp / e.maxHp);
      v.bar.visible = r < 0.999;
      if (v.bar.visible) { v.bar.material = this.barMats[r > 0.6 ? 0 : r > 0.3 ? 1 : 2]; v.bar.scale.set(Math.max(0.05, r) * (0.9 + e.r), 0.11, 1); }
      if (v.sbar && v.bubble) {
        const on = e.shield > 0;
        v.bubble.visible = on; v.sbar.visible = on && e.maxShield > 0;
        if (on) { v.sbar.scale.set(Math.max(0.05, Math.min(1, e.shield / (e.maxShield > 1 ? e.maxShield : e.shield))) * (0.9 + e.r), 0.09, 1); (v.bubble.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(this.time * 5 + v.phase) * 0.05; }
      }
    }
    for (const [id, v] of this.ev) if (v.seen !== f) { v.obj.visible = false; (this.epool[v.type] ||= []).push(v); this.ev.delete(id); }

    // towers
    for (const t of sim.towers) {
      let v = this.tv.get(t.id);
      if (!v) {
        const obj = this.models['tower_' + t.type].clone();
        const rig = makeTowerRig(obj, t.type);
        const pips = new THREE.Group(); obj.add(pips);
        // soft pool of the tower's own light on the deck: grounds it and keeps it readable from the bird view
        const pad = lightPool(2.3, TOWERS[t.type].color, 0.34); pad.layers.set(FX_LAYER);
        pad.position.y = 0.04; obj.add(pad);
        const buff = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.028, 5, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6fe89a).multiplyScalar(1.4) }));
        buff.rotation.x = Math.PI / 2; buff.position.y = 0.06; buff.layers.set(FX_LAYER); obj.add(buff);
        obj.position.set(t.x, 0, t.z);
        this.dyn.add(obj);
        v = { obj, rig, pips, buff, type: t.type, lvl: 0, grow: 0, seen: f };
        this.tv.set(t.id, v);
      }
      v.seen = f;
      if (v.grow < 1) { v.grow = Math.min(1, v.grow + dt * 3.5); const s = (1 - Math.pow(1 - v.grow, 3)) * TOWER_SCALE; v.obj.scale.set(s, s, s); }
      if (v.lvl !== t.lvl) {
        v.lvl = t.lvl; v.pips.clear();
        const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(TOWERS[t.type].color).multiplyScalar(1.5) });
        for (let i = 0; i < t.lvl; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.93 - i * 0.02, 0.028, 5, 40), m); r.rotation.x = Math.PI / 2; r.position.y = 0.2 + i * 0.16; r.layers.set(FX_LAYER); v.pips.add(r); }
      }
      v.buff.visible = t.buff > 0;
      updateTower(v.rig, t.yaw, t.cd, t.type === 'beacon' ? 0 : sim.towerRate(t), dt);
    }
    for (const [id, v] of this.tv) if (v.seen !== f) { this.dyn.remove(v.obj); this.tv.delete(id); }

    // projectiles
    for (const p of sim.projs) {
      let v = this.pv.get(p.id);
      if (!v) {
        const pool = this.ppool[p.kind];
        if (pool && pool.length) { v = pool.pop()!; v.mesh.visible = true; v.fresh = true; }
        else { const mesh = new THREE.Mesh(this.projGeo[p.kind], this.projMat[p.kind] || this.projMat.arrow0); mesh.frustumCulled = false; mesh.layers.set(FX_LAYER); this.dyn.add(mesh); v = { mesh, kind: p.kind, seen: 0, fresh: true }; }
        if (p.kind === 'arrow') v.mesh.material = this.projMat['arrow' + p.tier] || this.projMat.arrow0;
        this.pv.set(p.id, v);
      }
      v.seen = f;
      v.mesh.position.set(p.x, p.y, p.z);
      if (p.vx || p.vy || p.vz) { V.set(p.x + p.vx, p.y + p.vy, p.z + p.vz); v.mesh.lookAt(V); }
      if (p.kind === 'arrow') this.fx.spark(p.x, p.y, p.z, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0.26, 0.2, BOW_TIERS[p.tier].color);
      else if (p.kind === 'shell') this.fx.spark(p.x, p.y, p.z, 0, 0.5, 0, 0.4, 0.3, 0xff8a1f);
    }
    for (const [id, v] of this.pv) if (v.seen !== f) { v.mesh.visible = false; (this.ppool[v.kind] ||= []).push(v); this.pv.delete(id); }

    // zones
    for (const z of sim.zones) {
      let v = this.zv.get(z.id);
      if (!v) {
        const obj = new THREE.Group();
        const c = z.kind === 'burn' ? 0xff6a1f : z.kind === 'rain' ? BOW_TIERS[sim.tier].color : 0xff2bd6;
        const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: z.kind === 'burn' ? 0.2 : 0.1, blending: THREE.AdditiveBlending, depthWrite: false }));
        disc.rotation.x = -Math.PI / 2; disc.scale.setScalar(z.r); obj.add(disc);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.02, 5, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.6) }));
        ring.rotation.x = Math.PI / 2; ring.scale.set(z.r, z.r, 1); obj.add(ring);
        if (z.kind === 'sing') {
          const hole = new THREE.Mesh(new THREE.SphereGeometry(1.1, 20, 14), new THREE.MeshBasicMaterial({ color: 0x000000 })); hole.position.y = 2; obj.add(hole);
          const halo = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.09, 6, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2bd6).multiplyScalar(2.5) })); halo.position.y = 2; halo.rotation.x = 1.2; halo.name = 'halo'; obj.add(halo);
        }
        obj.position.set(z.x, 0.07, z.z);
        this.dyn.add(noAO(obj));
        v = { obj, kind: z.kind, seen: f, t: 0 };
        // a zone thrown by the hero shows up when her pose releases it
        for (let i = this.zoneWait.length - 1; i >= 0; i--) { const w = this.zoneWait[i]; if (Math.abs(w[0] - z.x) < 0.01 && Math.abs(w[1] - z.z) < 0.01) { v.t = -w[2]; this.zoneWait.splice(i, 1); break; } }
        this.zv.set(z.id, v);
      }
      v.seen = f; v.t += dt;
      v.obj.visible = v.t >= 0;
      if (v.t < 0) continue;
      const c = z.kind === 'rain' ? BOW_TIERS[sim.tier].color : 0xff2bd6;
      if (z.kind === 'rain') {
        for (let i = 0; i < 2; i++) {
          const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * z.r, x = z.x + Math.cos(a) * r, zz = z.z + Math.sin(a) * r;
          this.fx.beam(x + 1.5, 14, zz + 0.8, x, 0, zz, c, 0.035, 0.12);
          this.fx.burst(x, 0.1, zz, 2, 3, c, 0.25, 0.25, 6);
        }
      } else if (z.kind === 'sing') {
        const halo = v.obj.getObjectByName('halo'); if (halo) { halo.rotation.z += dt * 6; halo.rotation.x = 1.2 + Math.sin(v.t * 3) * 0.4; }
        for (let i = 0; i < 4; i++) { const a = Math.random() * 6.28, r = z.r * (0.6 + Math.random() * 0.4); this.fx.spark(z.x + Math.cos(a) * r, 0.3 + Math.random() * 3, z.z + Math.sin(a) * r, -Math.cos(a) * r * 2.2, 0.5, -Math.sin(a) * r * 2.2, 0.45, 0.4, c); }
      } else if (Math.random() < 0.6) {
        const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * z.r;
        this.fx.spark(z.x + Math.cos(a) * r, 0.1, z.z + Math.sin(a) * r, 0, 2 + Math.random() * 2, 0, 0.6, 0.45, 0xff8a1f, -1);
      }
    }
    for (const [id, v] of this.zv) if (v.seen !== f) { this.dyn.remove(v.obj); this.zv.delete(id); }

    // heroes
    const tier = BOW_TIERS[sim.tier];
    for (const m of this.bowMats) { m.color.setHex(tier.color); m.emissive.setHex(tier.color); }
    sim.players.forEach((p, i) => {
      const h = this.hero(i);
      const t = p.heroActive ? sim.towerById(p.heroTower) : undefined;
      if (t) h.out = false;
      h.obj.visible = h.shown = !!t || h.out;
      if (!h.shown) return;
      const yaw = i === this.me ? this.yaw : p.yaw, pitch = i === this.me ? this.pitch : p.pitch;
      if (h.tele > 0) { h.tele -= dt; if (h.tele <= 0 && h.rig) heroTrigger(h.rig, 'teleIn'); }
      if (t && h.tele <= 0) h.pos.set(t.x, standY(t), t.z);
      h.obj.position.copy(h.pos);
      h.obj.rotation.y = yaw;
      // the rig owns scale (squash / materialise) and the teleport flicker
      if (h.rig) { if (!updateHero(h.rig, yaw, pitch, dt, HERO_SCALE)) { h.out = false; h.obj.visible = h.shown = false; } }
      (h.disc.material as THREE.MeshBasicMaterial).color.setHex(tier.color).multiplyScalar(0.5);
      if (t && Math.random() < 0.5) this.fx.spark(t.x + (Math.random() - 0.5) * 1.0, standY(t) - 0.12, t.z + (Math.random() - 0.5) * 1.0, 0, -1.2, 0, 0.5, 0.1, tier.color, 0);
    });
  }

  private hero(i: number): HVis {
    let h = this.heroes[i];
    if (!h) {
      const obj = this.models.hero.clone();
      obj.scale.setScalar(HERO_SCALE); obj.visible = false;
      const disc = lightPool(1.7, 0x35f0ff, 0.5); disc.position.y = -0.02; disc.layers.set(FX_LAYER); obj.add(disc);
      this.dyn.add(obj);
      h = this.heroes[i] = { obj, disc, rig: makeHeroRig(obj), pos: new THREE.Vector3(), tele: 0, out: false, shown: false };
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
    // third person
    if (t) this.lastHeroAnchor.lerp(V.set(t.x, standY(t), t.z), this.heroBlend < 0.05 ? 1 : 1 - Math.exp(-dt * 14));
    const cy = Math.cos(this.pitch), fx = Math.sin(this.yaw) * cy, fy = Math.sin(this.pitch), fz = Math.cos(this.yaw) * cy;
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    this.heroPos.set(this.lastHeroAnchor.x - fx * 2.9 + rx * 0.68, this.lastHeroAnchor.y + 1.5 - fy * 1.9, this.lastHeroAnchor.z - fz * 2.9 + rz * 0.68);
    this.dummy.position.copy(this.heroPos); this.dummy.lookAt(V.set(this.heroPos.x + fx, this.heroPos.y + fy, this.heroPos.z + fz)); this.heroQ.copy(this.dummy.quaternion);
    const b = this.heroBlend, s = b * b * (3 - 2 * b);
    this.camera.position.lerpVectors(this.topPos, this.heroPos, s);
    this.camera.position.y += Math.sin(s * Math.PI) * 6;
    this.camera.quaternion.slerpQuaternions(this.topQ, this.heroQ, s);
    const fov = (this.orbit ? 50 : 42) + (68 - 42) * s;
    if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    if (this.shake > 0.001) {
      const a = this.shake * (0.3 + s);
      this.camera.position.x += (Math.random() - 0.5) * a; this.camera.position.y += (Math.random() - 0.5) * a; this.camera.position.z += (Math.random() - 0.5) * a;
      this.shake *= Math.exp(-dt * 7);
    }
  }

  render(dt: number) {
    this.time += dt;
    this.sync(dt);
    this.updateCamera(dt);
    for (let i = 0; i < this.coreSpins.length; i++) this.coreSpins[i].rotateY(dt * (i % 2 ? -1.1 : 0.8));
    if (this.coreObj && this.sim) { const hurt = this.sim.lives <= 6; if (hurt && Math.random() < 0.3) this.fx.spark(this.core.x + (Math.random() - 0.5) * 3, 1 + Math.random() * 3, this.core.z + (Math.random() - 0.5) * 3, 0, 2, 0, 0.5, 0.4, 0xff3b3b); }
    if (this.teleMark.visible) this.teleMark.children[0].rotation.y += dt * 3;
    this.selRing.rotation.y += dt;
    this.fx.update(dt, this.camera, this.renderer.domElement.height);
    this.world.update(this.time);
    if (this.quality === 'high') this.post.render(dt, this.time); else this.renderer.render(this.scene, this.camera);
  }
}

export { Q };
