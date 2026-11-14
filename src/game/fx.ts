// Pooled visual effects: particles, beams, lightning, shockwave rings, flashes.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();
const c1 = new THREE.Color();

interface Timed { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; max: number; r0: number; r1: number; color: THREE.Color }

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
  private beams: Timed[] = [];
  private rings: Timed[] = [];
  private flashes: Timed[] = [];
  private bi = 0; private ri = 0; private fi = 0;

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
      fragmentShader: `varying vec3 vC; void main(){ float d=length(gl_PointCoord-0.5)*2.0; if(d>1.0) discard; float a=(1.0-d); gl_FragColor=vec4(vC*a*a*1.6,1.0); }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    this.points = new THREE.Points(g, this.pmat);
    this.points.frustumCulled = false;
    this.group.add(this.points);

    const mk = (geo: THREE.BufferGeometry, n: number, arr: Timed[], side: THREE.Side = THREE.FrontSide) => {
      for (let i = 0; i < n; i++) {
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side, fog: false });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.visible = false; mesh.frustumCulled = false;
        this.group.add(mesh);
        arr.push({ mesh, mat, life: 0, max: 1, r0: 1, r1: 1, color: new THREE.Color() });
      }
    };
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    cyl.translate(0, 0.5, 0);
    mk(cyl, 260, this.beams, THREE.DoubleSide);
    const ring = new THREE.RingGeometry(0.86, 1, 56);
    ring.rotateX(-Math.PI / 2);
    mk(ring, 70, this.rings, THREE.DoubleSide);
    mk(new THREE.SphereGeometry(1, 14, 10), 40, this.flashes);
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
  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: number, width = 0.12, life = 0.2) {
    const b = this.beams[this.bi]; this.bi = (this.bi + 1) % this.beams.length;
    v1.set(bx - ax, by - ay, bz - az);
    const L = v1.length() || 0.001;
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
        this.beam(ax, ay, az, nx, ny, nz, color, width, 0.16 + Math.random() * 0.08);
        ax = nx; ay = ny; az = nz;
      }
      this.burst(bx, by, bz, 4, 4, color, 0.25, 0.25, 0);
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
  /** Standard explosion. */
  boom(x: number, y: number, z: number, r: number, color: number, small = false) {
    this.ring(x, 0.12, z, r, color, small ? 0.3 : 0.5);
    this.flash(x, y, z, r * 0.6, color, small ? 0.16 : 0.28);
    this.burst(x, y + 0.2, z, small ? 8 : 26, r * 4, color, small ? 0.35 : 0.7, small ? 0.3 : 0.5, 9);
    if (!small) this.burst(x, y + 0.2, z, 10, r * 2, 0xffffff, 0.3, 0.3, 4);
  }
  column(x: number, y: number, z: number, color: number, h = 30) {
    this.beam(x, y, z, x, y + h, z, color, 0.7, 0.6);
    this.beam(x, y, z, x, y + h, z, 0xffffff, 0.25, 0.45);
    this.ring(x, y + 0.1, z, 3.5, color, 0.6);
    this.burst(x, y + 1, z, 40, 9, color, 0.8, 0.45, 2, 1.2);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, viewH: number) {
    this.pmat.uniforms.scale.value = viewH / (2 * Math.tan((camera.fov * Math.PI) / 360));
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
      const f = Math.max(0, life[i] / max[i]);
      col[j] = base[j] * f; col[j + 1] = base[j + 1] * f; col[j + 2] = base[j + 2] * f;
      size[i] = sz0[i] * (0.4 + 0.6 * f);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true;
    for (const b of this.beams) {
      if (!b.mesh.visible) continue;
      b.life -= dt;
      if (b.life <= 0) { b.mesh.visible = false; continue; }
      const f = b.life / b.max;
      b.mat.color.copy(b.color).multiplyScalar(f * 1.5);
      b.mesh.scale.set(b.r0 * (0.3 + 0.7 * f), b.r1, b.r0 * (0.3 + 0.7 * f));
    }
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      const f = r.life / r.max, s = r.r0 + (r.r1 - r.r0) * (1 - f * f);
      r.mat.color.copy(r.color).multiplyScalar(f * 1.8);
      r.mesh.scale.setScalar(s);
    }
    for (const r of this.flashes) {
      if (!r.mesh.visible) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      const f = r.life / r.max;
      r.mat.color.copy(r.color).multiplyScalar(f * 1.2);
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * (1 - f));
    }
  }
}
