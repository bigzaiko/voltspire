// Three.js view of a Sim: models, cameras (bird view + third-person hero), effects.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CELL, GW, GH, TOWERS, TOWER_TYPES, ENEMIES, ENEMY_TYPES, BOW_TIERS, cellX, cellZ } from './data.ts';
import type { TowerType, EnemyType } from './data.ts';
import { Sim, CORE_POS } from './sim.ts';
import type { Ev, Tower } from './sim.ts';
import { Fx } from './fx.ts';
import { buildWorld } from './world.ts';

const MODEL_NAMES = [...TOWER_TYPES.map((t) => 'tower_' + t), ...ENEMY_TYPES.map((t) => 'enemy_' + t), 'hero', 'core', 'prop_barrier', 'prop_lamp', 'prop_crate'];
const ENEMY_COLOR = 0xff4a22;
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), Q = new THREE.Quaternion();

interface EVis { obj: THREE.Object3D; spins: THREE.Object3D[]; bar: THREE.Sprite; sbar: THREE.Sprite | null; bubble: THREE.Mesh | null; type: EnemyType; phase: number; seen: number; fresh: boolean }
interface TVis { obj: THREE.Object3D; turret: THREE.Object3D | null; spins: THREE.Object3D[]; pips: THREE.Group; buff: THREE.Mesh; type: TowerType; lvl: number; grow: number; seen: number }
interface PVis { mesh: THREE.Mesh; kind: string; seen: number; fresh: boolean }
interface ZVis { obj: THREE.Group; kind: string; seen: number; t: number }

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
  composer: EffectComposer;
  bloom: UnrealBloomPass;
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
  private heroes: { obj: THREE.Object3D; disc: THREE.Mesh }[] = [];
  private coreSpins: THREE.Object3D[] = [];
  private coreObj: THREE.Object3D | null = null;
  private dyn = new THREE.Group();
  private barMats: THREE.SpriteMaterial[];
  private projGeo: Record<string, THREE.BufferGeometry>;
  private projMat: Record<string, THREE.Material>;
  private rangeRing: THREE.Mesh; private cellMark: THREE.Mesh; private ghost = new THREE.Group(); private ghostType = '';
  private selRing: THREE.Mesh; private teleMark: THREE.Group; private hoverMark: THREE.Mesh;
  private bowMats: THREE.MeshStandardMaterial[] = [];
  private padGeo = new THREE.CircleGeometry(1.25, 28).rotateX(-Math.PI / 2);
  private world: ReturnType<typeof buildWorld>;
  private topPos = new THREE.Vector3(); private topQ = new THREE.Quaternion();
  private heroPos = new THREE.Vector3(); private heroQ = new THREE.Quaternion();
  private dummy = new THREE.PerspectiveCamera();
  private lastHeroAnchor = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.7, 0.55, 0.8);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.world = buildWorld(this.scene);
    this.scene.add(this.dyn, this.fx.group);

    this.barMats = [0x5dff8f, 0xffd23f, 0xff4a3a, 0x59b8ff].map((c) => new THREE.SpriteMaterial({ color: c, depthWrite: false, fog: false }));
    const arrow = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5); arrow.rotateX(Math.PI / 2);
    const bolt = new THREE.SphereGeometry(0.16, 8, 6); bolt.scale(1, 1, 2.6);
    this.projGeo = { arrow, bolt, shell: new THREE.SphereGeometry(0.3, 10, 8) };
    this.projMat = {
      bolt: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x19e3ff).multiplyScalar(2.5) }),
      shell: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff8a1f).multiplyScalar(2.5) }),
    };
    BOW_TIERS.forEach((b, i) => { this.projMat['arrow' + i] = new THREE.MeshBasicMaterial({ color: new THREE.Color(b.color).multiplyScalar(2.6) }); });

    const flat = (geo: THREE.BufferGeometry, color: number, opacity = 1) => {
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false; this.scene.add(m);
      return m;
    };
    this.rangeRing = flat(new THREE.RingGeometry(0.975, 1, 96), 0xffffff, 0.9); this.rangeRing.position.y = 0.06;
    this.selRing = flat(new THREE.RingGeometry(0.9, 1.05, 40), 0xffffff, 0.9); this.selRing.position.y = 0.08;
    this.cellMark = flat(new THREE.PlaneGeometry(CELL * 0.92, CELL * 0.92), 0x5dff8f, 0.3); this.cellMark.position.y = 0.04;
    this.hoverMark = flat(new THREE.RingGeometry(0.98, 1.12, 4, 1, Math.PI / 4), 0x9fd8ff, 0.55); this.hoverMark.position.y = 0.05;
    this.ghost.visible = false; this.scene.add(this.ghost);
    this.teleMark = new THREE.Group();
    const tm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x35f0ff).multiplyScalar(2), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const dia = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), tm); dia.position.y = 1.6; this.teleMark.add(dia);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 40, 6), tm); col.position.y = 21; this.teleMark.add(col);
    const tr = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.05, 6, 32), tm); tr.rotation.x = Math.PI / 2; tr.position.y = 0.3; this.teleMark.add(tr);
    this.teleMark.visible = false; this.scene.add(this.teleMark);
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
        if (mat && name === 'hero' && mat.name === 'paint') mat.color.multiplyScalar(0.62);
        if (mat && mat.name && mat.name.startsWith('glow')) {
          mat.emissiveIntensity = name === 'core' ? 1.3 : Math.min(4, Math.max(mat.emissiveIntensity || 0, 2.2));
          if (mat.emissive.getHex() === 0) mat.emissive.copy(mat.color);
          m.castShadow = false;
          if (name === 'hero' && !mat.name.startsWith('glow_bow')) mat.emissiveIntensity = 1.6;
          if (name === 'hero' && mat.name.startsWith('glow_bow') && !this.bowMats.includes(mat)) this.bowMats.push(mat);
        }
      });
      this.models[name] = obj;
      onProgress(++done / MODEL_NAMES.length);
    }));
    // core + props are static scenery
    const core = this.models.core.clone();
    core.position.set(CORE_POS.x, 0, CORE_POS.z);
    core.traverse((o) => { if (o.name.startsWith('spin')) this.coreSpins.push(o); });
    this.coreObj = core;
    this.scene.add(core);
    const hx = (GW * CELL) / 2, hz = (GH * CELL) / 2;
    for (let i = 0; i < 12; i++) {
      for (const s of [-1, 1]) {
        const l = this.models.prop_lamp.clone();
        l.position.set(-hx + 2 + i * ((hx * 2 - 4) / 11), 0, s * (hz + 1.6)); l.rotation.y = s > 0 ? Math.PI : 0;
        this.scene.add(l);
      }
    }
    const gate = this.world.gate.position;
    [[-1.5, 4.2, 0.3, 'prop_barrier'], [-1.2, -4.4, -0.2, 'prop_barrier'], [1.4, 4.6, 1.2, 'prop_crate'], [2.3, 4.2, 0.4, 'prop_crate'], [1.8, 4.4, 2.1, 'prop_crate']].forEach(([dx, dz, r, n], i) => {
      const o = this.models[n as string].clone();
      o.position.set(gate.x + (dx as number), i === 4 ? 0.9 : 0, gate.z + (dz as number)); o.rotation.y = r as number;
      this.scene.add(o);
    });
  }

  setSim(sim: Sim | null, me = 0) {
    this.sim = sim; this.me = me;
    for (const [id, v] of this.ev) { v.obj.visible = false; (this.epool[v.type] ||= []).push(v); this.ev.delete(id); }
    for (const [id, v] of this.tv) { this.dyn.remove(v.obj); this.tv.delete(id); }
    for (const [id, v] of this.pv) { v.mesh.visible = false; (this.ppool[v.kind] ||= []).push(v); this.pv.delete(id); }
    for (const [id, v] of this.zv) { this.dyn.remove(v.obj); this.zv.delete(id); }
    for (const h of this.heroes) h.obj.visible = false;
    this.heroBlend = 0;
    this.setGhost(null); this.setSelected(null); this.setTele(null);
  }

  setQuality(q: 'high' | 'low') {
    this.quality = q;
    this.bloom.enabled = q === 'high';
    this.renderer.shadowMap.enabled = q === 'high';
    this.world.sun.castShadow = q === 'high';
    this.renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1);
    this.resize();
  }

  resize() {
    const c = this.renderer.domElement, w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
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
      if (u < 5 || u > best) continue;
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
  handle(evs: Ev[]) {
    const fx = this.fx;
    for (const e of evs) {
      switch (e.k) {
        case 'shot': fx.burst(e.x, e.y, e.z, 3, 3, TOWERS[e.t as TowerType]?.color ?? 0xffffff, 0.15, 0.3, 0); break;
        case 'hit': fx.burst(e.x, e.y, e.z, 5, 5, e.c, 0.25, 0.28, 8); break;
        case 'cryo':
          fx.beam(e.x, e.y, e.z, e.tx, e.ty, e.tz, 0x9fd8ff, 0.16, 0.22);
          fx.ring(e.tx, 0.1, e.tz, e.r, 0x9fd8ff, 0.4);
          fx.burst(e.tx, e.ty, e.tz, 10, 4, 0xdff4ff, 0.5, 0.25, 1);
          break;
        case 'arc': if (Array.isArray(e.p)) fx.arc(e.p, e.c); break;
        case 'rail':
          fx.beam(e.x, e.y, e.z, e.tx, e.ty, e.tz, e.c, e.big ? 0.45 : 0.22, e.big ? 0.5 : 0.35);
          fx.beam(e.x, e.y, e.z, e.tx, e.ty, e.tz, 0xffffff, e.big ? 0.16 : 0.08, e.big ? 0.35 : 0.22);
          if (e.big) { this.shake = Math.max(this.shake, 0.35); for (let i = 0; i < 16; i++) { const u = Math.random(); fx.burst(e.x + (e.tx - e.x) * u, e.y + (e.ty - e.y) * u, e.z + (e.tz - e.z) * u, 2, 3, e.c, 0.5, 0.3, 0); } }
          break;
        case 'boom': fx.boom(e.x, e.y, e.z, e.r, e.c, !!e.s); if (!e.s) this.shake = Math.max(this.shake, 0.12); break;
        case 'die': {
          const big = e.t === 'boss', mid = e.t === 'brute' || e.t === 'shield';
          fx.burst(e.x, e.y, e.z, big ? 120 : mid ? 26 : 12, big ? 16 : 7, ENEMY_COLOR, big ? 1.4 : 0.6, big ? 0.7 : 0.38, 10);
          fx.burst(e.x, e.y, e.z, big ? 40 : 4, big ? 10 : 4, 0xffd23f, 0.5, 0.3, 6);
          fx.flash(e.x, e.y, e.z, big ? 6 : mid ? 1.8 : 1.1, ENEMY_COLOR, big ? 0.5 : 0.2);
          if (big) { fx.ring(e.x, 0.15, e.z, 9, ENEMY_COLOR, 0.9); fx.column(e.x, 0, e.z, 0xffd23f); this.shake = 0.8; }
          break;
        }
        case 'shieldbreak': fx.burst(e.x, e.y, e.z, 18, 7, 0x59b8ff, 0.5, 0.3, 3); fx.flash(e.x, e.y, e.z, 1.6, 0x59b8ff, 0.2); break;
        case 'build': fx.ring(e.x, 0.1, e.z, 2.2, e.c, 0.5); fx.burst(e.x, 0.3, e.z, 22, 5, e.c, 0.7, 0.3, -3, 1); break;
        case 'sell': fx.burst(e.x, 0.8, e.z, 20, 5, 0xffd23f, 0.6, 0.3, 6); break;
        case 'heroOn': fx.column(e.x, e.y, e.z, BOW_TIERS[this.sim ? this.sim.tier : 0].color); this.shake = Math.max(this.shake, 0.4); break;
        case 'heroOff': fx.column(e.x, e.y, e.z, 0x9fd8ff, 18); break;
        case 'tele': fx.column(e.fx, e.fy, e.fz, 0x9fd8ff, 12); fx.column(e.x, e.y, e.z, BOW_TIERS[this.sim ? this.sim.tier : 0].color, 22); break;
        case 'skill': fx.ring(e.x, 0.15, e.z, 5, e.c, 0.5, 1.4); break;
        case 'leak': fx.ring(CORE_POS.x, 0.2, CORE_POS.z, 6, 0xff3b3b, 0.7); fx.burst(CORE_POS.x, 2, CORE_POS.z, 30, 9, 0xff3b3b, 0.8, 0.4, 5); this.shake = Math.max(this.shake, 0.3); break;
        case 'lose': fx.column(CORE_POS.x, 0, CORE_POS.z, 0xff3b3b, 40); fx.boom(CORE_POS.x, 2.5, CORE_POS.z, 12, 0xff5a2a); this.shake = 1.2; break;
      }
    }
  }

  // ---------- per-frame sync ----------
  private enemyVis(type: EnemyType): EVis {
    const pool = this.epool[type];
    if (pool && pool.length) { const v = pool.pop()!; v.obj.visible = true; v.fresh = true; return v; }
    const obj = this.models['enemy_' + type].clone();
    if (type === 'grunt' || type === 'runner' || type === 'drone') obj.scale.setScalar(1.3);
    const spins: THREE.Object3D[] = [];
    obj.traverse((o) => { if (o.name.startsWith('spin')) spins.push(o); });
    const d = ENEMIES[type];
    const bar = new THREE.Sprite(this.barMats[0]);
    bar.position.y = (type === 'drone' ? 0.8 : d.y * 2 + 0.7); bar.visible = false;
    obj.add(bar);
    let sbar: THREE.Sprite | null = null, bubble: THREE.Mesh | null = null;
    if (d.shield) {
      sbar = new THREE.Sprite(this.barMats[3]); sbar.position.y = bar.position.y + 0.2; obj.add(sbar);
      bubble = new THREE.Mesh(new THREE.SphereGeometry(d.r * 1.7, 18, 12), new THREE.MeshBasicMaterial({ color: 0x2f8cff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
      bubble.position.y = d.y; obj.add(bubble);
    }
    this.dyn.add(obj);
    return { obj, spins, bar, sbar, bubble, type, phase: Math.random() * 6.28, seen: 0, fresh: true };
  }

  private sync(dt: number) {
    const sim = this.sim;
    if (!sim) return;
    const f = ++this.frame, k = 1 - Math.exp(-dt * 18);
    // enemies
    for (const e of sim.enemies) {
      let v = this.ev.get(e.id);
      if (!v) { v = this.enemyVis(e.type); this.ev.set(e.id, v); }
      v.seen = f;
      const fly = e.type === 'drone';
      const y = fly ? e.y + Math.sin(this.time * 3 + v.phase) * 0.25 : Math.abs(Math.sin(this.time * (e.type === 'runner' ? 14 : e.type === 'boss' ? 3 : 8) + v.phase)) * (e.type === 'boss' ? 0.12 : 0.1);
      if (v.fresh) { v.obj.position.set(e.x, y, e.z); v.obj.rotation.y = e.yaw; v.fresh = false; }
      else {
        v.obj.position.x += (e.x - v.obj.position.x) * k; v.obj.position.z += (e.z - v.obj.position.z) * k; v.obj.position.y = y;
        let d = e.yaw - v.obj.rotation.y;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        v.obj.rotation.y += d * Math.min(1, dt * 8);
      }
      v.obj.rotation.z = fly ? 0 : Math.sin(this.time * 8 + v.phase) * 0.05;
      for (const s of v.spins) s.rotateY(dt * 22);
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
        const spins: THREE.Object3D[] = [];
        obj.traverse((o) => { if (o.name.startsWith('spin')) spins.push(o); });
        const pips = new THREE.Group(); obj.add(pips);
        const pad = new THREE.Mesh(this.padGeo, new THREE.MeshBasicMaterial({ color: TOWERS[t.type].color, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false }));
        pad.position.y = 0.03; obj.add(pad);
        const buff = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.035, 5, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5dff8f).multiplyScalar(1.6) }));
        buff.rotation.x = Math.PI / 2; buff.position.y = 0.06; obj.add(buff);
        obj.position.set(t.x, 0, t.z);
        this.dyn.add(obj);
        v = { obj, turret: obj.getObjectByName('turret') || null, spins, pips, buff, type: t.type, lvl: 0, grow: 0, seen: f };
        this.tv.set(t.id, v);
      }
      v.seen = f;
      if (v.grow < 1) { v.grow = Math.min(1, v.grow + dt * 3.5); const s = 1 - Math.pow(1 - v.grow, 3); v.obj.scale.set(s, s, s); }
      if (v.lvl !== t.lvl) {
        v.lvl = t.lvl; v.pips.clear();
        const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(TOWERS[t.type].color).multiplyScalar(1.8) });
        for (let i = 0; i < t.lvl; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.93 - i * 0.02, 0.04, 5, 32), m); r.rotation.x = Math.PI / 2; r.position.y = 0.2 + i * 0.16; v.pips.add(r); }
      }
      v.buff.visible = t.buff > 0;
      if (v.turret && t.type !== 'beacon' && t.type !== 'arc') v.turret.rotation.y = t.yaw;
      for (const s of v.spins) s.rotateY(dt * 2.5);
    }
    for (const [id, v] of this.tv) if (v.seen !== f) { this.dyn.remove(v.obj); this.tv.delete(id); }

    // projectiles
    for (const p of sim.projs) {
      let v = this.pv.get(p.id);
      if (!v) {
        const pool = this.ppool[p.kind];
        if (pool && pool.length) { v = pool.pop()!; v.mesh.visible = true; v.fresh = true; }
        else { const mesh = new THREE.Mesh(this.projGeo[p.kind], this.projMat[p.kind] || this.projMat.arrow0); mesh.frustumCulled = false; this.dyn.add(mesh); v = { mesh, kind: p.kind, seen: 0, fresh: true }; }
        if (p.kind === 'arrow') v.mesh.material = this.projMat['arrow' + p.tier] || this.projMat.arrow0;
        this.pv.set(p.id, v);
      }
      v.seen = f;
      v.mesh.position.set(p.x, p.y, p.z);
      if (p.vx || p.vy || p.vz) { V.set(p.x + p.vx, p.y + p.vy, p.z + p.vz); v.mesh.lookAt(V); }
      if (p.kind === 'arrow') this.fx.spark(p.x, p.y, p.z, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0.28, 0.32, BOW_TIERS[p.tier].color);
      else if (p.kind === 'shell') this.fx.spark(p.x, p.y, p.z, 0, 0.5, 0, 0.4, 0.45, 0xff8a1f);
    }
    for (const [id, v] of this.pv) if (v.seen !== f) { v.mesh.visible = false; (this.ppool[v.kind] ||= []).push(v); this.pv.delete(id); }

    // zones
    for (const z of sim.zones) {
      let v = this.zv.get(z.id);
      if (!v) {
        const obj = new THREE.Group();
        const c = z.kind === 'burn' ? 0xff6a1f : z.kind === 'rain' ? BOW_TIERS[sim.tier].color : 0xff2bd6;
        const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: z.kind === 'burn' ? 0.28 : 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
        disc.rotation.x = -Math.PI / 2; disc.scale.setScalar(z.r); obj.add(disc);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 5, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2) }));
        ring.rotation.x = Math.PI / 2; ring.scale.set(z.r, z.r, 1); obj.add(ring);
        if (z.kind === 'sing') {
          const hole = new THREE.Mesh(new THREE.SphereGeometry(1.1, 20, 14), new THREE.MeshBasicMaterial({ color: 0x000000 })); hole.position.y = 2; obj.add(hole);
          const halo = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.09, 6, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2bd6).multiplyScalar(2.5) })); halo.position.y = 2; halo.rotation.x = 1.2; halo.name = 'halo'; obj.add(halo);
        }
        obj.position.set(z.x, 0.07, z.z);
        this.dyn.add(obj);
        v = { obj, kind: z.kind, seen: f, t: 0 };
        this.zv.set(z.id, v);
      }
      v.seen = f; v.t += dt;
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
      let h = this.heroes[i];
      if (!h) {
        const obj = this.models.hero.clone();
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.7, 0.07, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x35f0ff), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
        disc.position.y = -0.05; obj.add(disc);
        this.dyn.add(obj);
        h = this.heroes[i] = { obj, disc };
      }
      const t = p.heroActive ? sim.towerById(p.heroTower) : undefined;
      h.obj.visible = !!t;
      if (!t) return;
      h.obj.position.set(t.x, t.h + 0.3 + Math.sin(this.time * 2.2) * 0.04, t.z);
      h.obj.rotation.y = i === this.me ? this.yaw : p.yaw;
      (h.disc.material as THREE.MeshBasicMaterial).color.setHex(tier.color);
      if (Math.random() < 0.5) this.fx.spark(t.x + (Math.random() - 0.5) * 1.4, t.h + 0.3, t.z + (Math.random() - 0.5) * 1.4, 0, 1.5, 0, 0.7, 0.22, tier.color, -0.5);
    });
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
    if (t) this.lastHeroAnchor.lerp(V.set(t.x, t.h + 0.3, t.z), this.heroBlend < 0.05 ? 1 : 1 - Math.exp(-dt * 14));
    const cy = Math.cos(this.pitch), fx = Math.sin(this.yaw) * cy, fy = Math.sin(this.pitch), fz = Math.cos(this.yaw) * cy;
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    this.heroPos.set(this.lastHeroAnchor.x - fx * 4.6 + rx * 1.15, this.lastHeroAnchor.y + 2.5 - fy * 3.2, this.lastHeroAnchor.z - fz * 4.6 + rz * 1.15);
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
    if (this.coreObj && this.sim) { const hurt = this.sim.lives <= 6; if (hurt && Math.random() < 0.3) this.fx.spark(CORE_POS.x + (Math.random() - 0.5) * 3, 1 + Math.random() * 3, CORE_POS.z + (Math.random() - 0.5) * 3, 0, 2, 0, 0.5, 0.4, 0xff3b3b); }
    this.world.arch.scale.setScalar(1 + Math.sin(this.time * 3) * 0.03);
    if (this.teleMark.visible) this.teleMark.children[0].rotation.y += dt * 3;
    this.selRing.rotation.y += dt;
    this.fx.update(dt, this.camera, this.renderer.domElement.height);
    if (this.quality === 'high') this.composer.render(dt); else this.renderer.render(this.scene, this.camera);
  }
}

export { Q };
