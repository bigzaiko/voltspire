// Pooled visual effects: heat-coloured sparks, hot-cored beams, lightning, shockwave rings,
// soft flashes, smoke puffs and short-lived ground scorch decals.
import * as THREE from 'three';
import { glowTexture, POOL_GEO } from './tex.ts';
import { FX_LAYER } from './world.ts';

const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();
const c1 = new THREE.Color();

interface Timed { mesh: THREE.Mesh; color: THREE.Color; tint: THREE.Color; life: number; max: number; r0: number; r1: number }

// View-angle based glow: bright along the axis the camera looks through, fading to nothing at the
// silhouette, with a near-white core. Gives slim beams a hot centre without a second mesh.
const GLOW_VERT = `varying vec3 vN; varying vec3 vV;
  void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const GLOW_FRAG = `uniform vec3 color; uniform float power; uniform float core; varying vec3 vN; varying vec3 vV;
  void main(){ float c = clamp(abs(dot(normalize(vN), normalize(vV))), 1e-4, 1.0);
    float peak = max(max(color.r, color.g), color.b);
    vec3 col = color * pow(c, power) + vec3(1.0, 0.95, 0.88) * peak * core * pow(c, power * 4.0);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const glowMat = (power: number, core: number) => new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color() }, power: { value: power }, core: { value: core } },
  vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
});

export class Fx {
  group = new THREE.Group();
  private N = 6000;
  private pos = new Float32Array(this.N * 3);
  private col = new Float32Array(this.N * 3);
  private size = new Float32Array(this.N);
  private vel = new Float32Array(this.N * 3);
  private base = new Float32Array(this.N * 3);
  private life = new Float32Array(this.N);
  private max = new Float32Array(this.N);
  private grav = new Float32Array(this.N);
  private sz0 = new Float32Array(this.N);
  private head = 0;
  private points: THREE.Points;
  private pmat: THREE.ShaderMaterial;
  // smoke
  private SN = 420;
  private spos = new Float32Array(this.SN * 3);
  private svel = new Float32Array(this.SN * 3);
  private sdat = new Float32Array(this.SN * 3); // size, alpha, shade
  private slife = new Float32Array(this.SN);
  private smax = new Float32Array(this.SN);
  private ssz = new Float32Array(this.SN);
  private shead = 0; private sactive = 0;
  private smoke_: THREE.Points;
  private smat: THREE.ShaderMaterial;
  private beams: Timed[] = [];
  private rings: Timed[] = [];
  private flashes: Timed[] = [];
  private scorches: Timed[] = [];
  private embers: Timed[] = [];
  private bi = 0; private ri = 0; private fi = 0; private si = 0; private ei = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.pmat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float scale;
        void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*scale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vC; void main(){ float d=length(gl_PointCoord-0.5)*2.0; if(d>1.0) discard; float a=1.0-d;
        gl_FragColor=vec4(vC*(a*a*a*2.4 + a*0.12),1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    this.points = new THREE.Points(g, this.pmat);
    this.points.frustumCulled = false;

    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.spos, 3));
    sg.setAttribute('dat', new THREE.BufferAttribute(this.sdat, 3));
    sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.smat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 600 } },
      vertexShader: `attribute vec3 dat; varying vec2 vD; uniform float scale;
        void main(){ vD=dat.yz; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=min(420.0, dat.x*scale/max(0.1,-mv.z)); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec2 vD; void main(){ vec2 p=gl_PointCoord-0.5; float d=length(p)*2.0; if(d>1.0) discard;
        float a=pow(max(1.0-d,0.0),1.6)*vD.x;
        // fake top-lighting: cool moonlit top, warm dark belly
        vec3 c=mix(vec3(0.085,0.062,0.05), vec3(0.2,0.235,0.3), clamp(0.5-p.y*1.3,0.0,1.0))*vD.y;
        gl_FragColor=vec4(c,a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
      depthWrite: false, transparent: true,
    });
    this.smoke_ = new THREE.Points(sg, this.smat);
    this.smoke_.frustumCulled = false;
    this.smoke_.renderOrder = 1;

    const mk = (geo: THREE.BufferGeometry, n: number, arr: Timed[], make: () => THREE.Material) => {
      for (let i = 0; i < n; i++) {
        const mat = make();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.visible = false; mesh.frustumCulled = false;
        this.group.add(mesh);
        const u = (mat as THREE.ShaderMaterial).uniforms;
        arr.push({ mesh, color: new THREE.Color(), tint: u ? u.color.value : (mat as THREE.MeshBasicMaterial).color, life: 0, max: 1, r0: 1, r1: 1 });
      }
    };
    const basic = (o: THREE.MeshBasicMaterialParameters) => () => new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false, transparent: true, fog: false, ...o });
    // ground decals first so everything else draws over them
    mk(POOL_GEO, 36, this.scorches, basic({ color: 0x000000, alphaMap: glowTexture(), opacity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    mk(POOL_GEO, 28, this.embers, basic({ map: glowTexture(), blending: THREE.AdditiveBlending }));
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    cyl.translate(0, 0.5, 0);
    mk(cyl, 260, this.beams, () => glowMat(1.8, 0.7));
    const ring = new THREE.RingGeometry(0.925, 1, 64);
    ring.rotateX(-Math.PI / 2);
    mk(ring, 70, this.rings, basic({ blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    mk(new THREE.SphereGeometry(1, 16, 12), 40, this.flashes, () => glowMat(2.6, 0.5));
    this.group.add(this.smoke_, this.points);
    this.group.traverse((o) => o.layers.set(FX_LAYER));
  }

  spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: number, grav = 0) {
    const i = this.head; this.head = (this.head + 1) % this.N;
    const j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    c1.setHex(color);
    this.base[j] = c1.r; this.base[j + 1] = c1.g; this.base[j + 2] = c1.b;
    this.life[i] = life; this.max[i] = life; this.sz0[i] = size; this.grav[i] = grav;
  }
  burst(x: number, y: number, z: number, n: number, speed: number, color: number, life = 0.5, size = 0.35, grav = 6, up = 0.4) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1), s = speed * (0.3 + Math.random() * 0.7);
      this.spark(x, y, z, Math.sin(b) * Math.cos(a) * s, Math.abs(Math.cos(b)) * s * (0.5 + up) + up * speed * 0.3, Math.sin(b) * Math.sin(a) * s, life * (0.5 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), color, grav);
    }
  }
  /** Soft drifting smoke puffs (alpha blended, unlit). */
  smoke(x: number, y: number, z: number, n = 3, size = 1, spread = 0.5, rise = 0.9) {
    for (let k = 0; k < n; k++) {
      const i = this.shead; this.shead = (this.shead + 1) % this.SN;
      const j = i * 3;
      this.spos[j] = x + (Math.random() - 0.5) * spread; this.spos[j + 1] = y + Math.random() * spread * 0.6; this.spos[j + 2] = z + (Math.random() - 0.5) * spread;
      this.svel[j] = (Math.random() - 0.5) * 0.9 + 0.25; this.svel[j + 1] = rise * (0.5 + Math.random() * 0.8); this.svel[j + 2] = (Math.random() - 0.5) * 0.9;
      this.slife[i] = this.smax[i] = 1.3 + Math.random() * 1.5;
      this.ssz[i] = size * (0.7 + Math.random() * 0.7);
      this.sdat[j + 2] = 0.6 + Math.random() * 0.6;
    }
    this.sactive = this.SN;
  }
  /** Short-lived ground decal: a dark scorch that lingers plus a hot glow that cools quickly. */
  scorch(x: number, z: number, r: number, color = 0xff7a2a, life = 6) {
    const s = this.scorches[this.si]; this.si = (this.si + 1) % this.scorches.length;
    s.mesh.position.set(x, 0.022 + this.si * 0.0006, z); s.mesh.scale.setScalar(r * 1.15); s.mesh.rotation.y = Math.random() * 6.28;
    s.life = s.max = life * (0.8 + Math.random() * 0.4); s.mesh.visible = true;
    const e = this.embers[this.ei]; this.ei = (this.ei + 1) % this.embers.length;
    e.mesh.position.set(x, 0.05 + this.ei * 0.0006, z); e.mesh.scale.setScalar(r * 0.95);
    e.color.setHex(color).lerp(c1.setHex(0xff5a14), 0.55); e.life = e.max = 0.9; e.mesh.visible = true;
  }
  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: number, width = 0.12, life = 0.2) {
    const b = this.beams[this.bi]; this.bi = (this.bi + 1) % this.beams.length;
    v1.set(bx - ax, by - ay, bz - az);
    const L = v1.length() || 0.001;
    width *= 0.7;
    b.mesh.position.set(ax, ay, az);
    b.mesh.quaternion.setFromUnitVectors(UP, v1.divideScalar(L));
    b.mesh.scale.set(width, L, width);
    b.color.setHex(color); b.life = b.max = life; b.r0 = width; b.r1 = L;
    b.mesh.visible = true;
  }
  /** Jagged lightning through a flat [x,y,z,...] list of points. */
  arc(p: number[], color: number, width = 0.07) {
    for (let i = 3; i + 2 < p.length && i < 60; i += 3) {
      let ax = p[i - 3], ay = p[i - 2], az = p[i - 1];
      const bx = p[i], by = p[i + 1], bz = p[i + 2];
      const d = Math.hypot(bx - ax, by - ay, bz - az), n = Math.max(2, Math.min(6, Math.round(d / 1.2)));
      for (let s = 1; s <= n; s++) {
        const u = s / n, j = s === n ? 0 : Math.min(0.6, d * 0.12);
        const nx = p[i - 3] + (bx - p[i - 3]) * u + (Math.random() - 0.5) * j, ny = p[i - 2] + (by - p[i - 2]) * u + (Math.random() - 0.5) * j, nz = p[i - 1] + (bz - p[i - 1]) * u + (Math.random() - 0.5) * j;
        this.beam(ax, ay, az, nx, ny, nz, color, width, 0.14 + Math.random() * 0.08);
        ax = nx; ay = ny; az = nz;
      }
      this.burst(bx, by, bz, 3, 4, color, 0.22, 0.22, 0);
    }
  }
  ring(x: number, y: number, z: number, r: number, color: number, life = 0.45, r0 = 0.15) {
    const g = this.rings[this.ri]; this.ri = (this.ri + 1) % this.rings.length;
    g.mesh.position.set(x, y, z);
    g.color.setHex(color); g.life = g.max = life; g.r0 = r * r0; g.r1 = r;
    g.mesh.visible = true;
  }
  flash(x: number, y: number, z: number, r: number, color: number, life = 0.25) {
    const g = this.flashes[this.fi]; this.fi = (this.fi + 1) % this.flashes.length;
    g.mesh.position.set(x, y, z);
    g.color.setHex(color); g.life = g.max = life; g.r0 = r * 0.3; g.r1 = r;
    g.mesh.visible = true;
  }
  /** Standard explosion: brief flash, hot sparks that cool to embers, smoke, and a scorch mark. */
  boom(x: number, y: number, z: number, r: number, color: number, small = false) {
    this.ring(x, 0.12, z, r, color, small ? 0.26 : 0.42);
    this.flash(x, y, z, r * (small ? 0.4 : 0.5), color, small ? 0.14 : 0.22);
    this.burst(x, y + 0.2, z, small ? 6 : 16, r * 4, color, small ? 0.35 : 0.6, small ? 0.24 : 0.36, 9);
    this.burst(x, y + 0.2, z, small ? 3 : 12, r * 3.2, 0xffb45a, small ? 0.4 : 0.8, 0.22, 12);
    if (!small) { this.smoke(x, y + 0.4, z, 5, r * 0.75, r * 0.7); this.scorch(x, z, r * 0.85, color); }
    else if (y < 1.5) this.scorch(x, z, r * 0.6, color, 3);
  }
  column(x: number, y: number, z: number, color: number, h = 30) {
    this.beam(x, y, z, x, y + h, z, color, 0.5, 0.55);
    this.ring(x, y + 0.1, z, 3.2, color, 0.55);
    this.burst(x, y + 1, z, 28, 8, color, 0.7, 0.34, 2, 1.2);
    this.smoke(x, y + 0.3, z, 4, 1.3, 1.6, 0.6);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, viewH: number) {
    const scale = viewH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    this.pmat.uniforms.scale.value = scale; this.smat.uniforms.scale.value = scale;
    const { pos, vel, col, base, life, max, size, sz0, grav } = this;
    for (let i = 0; i < this.N; i++) {
      if (life[i] <= 0) { if (size[i] !== 0) size[i] = 0; continue; }
      life[i] -= dt;
      const j = i * 3;
      vel[j + 1] -= grav[i] * dt;
      const dr = 1 - 1.5 * dt;
      vel[j] *= dr; vel[j + 2] *= dr;
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
      if (pos[j + 1] < 0.05 && grav[i] > 0) { pos[j + 1] = 0.05; vel[j + 1] *= -0.35; }
      // heat ramp: white-hot when fresh, the base hue mid-life, cooling toward a dull red ember
      const f = Math.max(0, life[i] / max[i]), hot = f * f * f * 0.75;
      col[j] = base[j] * f + hot; col[j + 1] = base[j + 1] * f * (0.4 + 0.6 * f) + hot * 0.85; col[j + 2] = base[j + 2] * f * (0.15 + 0.85 * f) + hot * 0.6;
      size[i] = sz0[i] * (0.3 + 0.55 * f);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true;

    if (this.sactive > 0) {
      const { spos, svel, sdat, slife, smax, ssz } = this;
      let alive = 0;
      for (let i = 0; i < this.SN; i++) {
        const j = i * 3;
        if (slife[i] <= 0) { if (sdat[j] !== 0) sdat[j] = 0; continue; }
        slife[i] -= dt; alive++;
        const f = Math.max(0, slife[i] / smax[i]), age = 1 - f;
        svel[j] *= 1 - 0.8 * dt; svel[j + 2] *= 1 - 0.8 * dt;
        spos[j] += svel[j] * dt; spos[j + 1] += svel[j + 1] * dt; spos[j + 2] += svel[j + 2] * dt;
        sdat[j] = ssz[i] * (0.7 + age * 2.1);
        sdat[j + 1] = Math.min(1, age * 7) * f * f * 0.5;
      }
      this.sactive = alive;
      const sg = this.smoke_.geometry;
      sg.attributes.position.needsUpdate = true; sg.attributes.dat.needsUpdate = true;
    }
    this.smoke_.visible = this.sactive > 0;

    for (const b of this.beams) {
      if (!b.mesh.visible) continue;
      b.life -= dt;
      if (b.life <= 0) { b.mesh.visible = false; continue; }
      const f = b.life / b.max;
      b.tint.copy(b.color).multiplyScalar(f * f * 1.6);
      b.mesh.scale.set(b.r0 * (0.25 + 0.75 * f), b.r1, b.r0 * (0.25 + 0.75 * f));
    }
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      const f = r.life / r.max, s = r.r0 + (r.r1 - r.r0) * (1 - f * f);
      r.tint.copy(r.color).multiplyScalar(f * f * 1.3);
      r.mesh.scale.setScalar(s);
    }
    for (const r of this.flashes) {
      if (!r.mesh.visible) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      const f = r.life / r.max;
      r.tint.copy(r.color).multiplyScalar(f * 1.5);
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * (1 - f));
    }
    for (const s of this.scorches) {
      if (!s.mesh.visible) continue;
      s.life -= dt;
      if (s.life <= 0) { s.mesh.visible = false; continue; }
      const f = s.life / s.max;
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, f * 2.2) * 0.62;
    }
    for (const e of this.embers) {
      if (!e.mesh.visible) continue;
      e.life -= dt;
      if (e.life <= 0) { e.mesh.visible = false; continue; }
      const f = e.life / e.max;
      e.tint.copy(e.color).multiplyScalar(f * f * 1.1);
    }
  }
}
