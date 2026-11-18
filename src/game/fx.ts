// Pooled visual effects: heat-coloured sparks, hot-cored beams, lightning, shockwave rings,
// soft flashes, smoke puffs and short-lived ground scorch decals. Everything takes world coordinates;
// ground effects take the deck height where they happen (roads can be raised).
import * as THREE from 'three';
import { glowTexture, POOL_GEO } from './tex.ts';
import { FX_LAYER } from './world.ts';

const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
const M4 = new THREE.Matrix4(), Q4 = new THREE.Quaternion(), QT = new THREE.Quaternion();
const c1 = new THREE.Color();
const BEAM_GEO = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0);

interface Timed { mesh: THREE.Mesh; color: THREE.Color; tint: THREE.Color; life: number; max: number; r0: number; r1: number }

// View-angle based glow: bright along the axis the camera looks through, fading to nothing at the
// silhouette, with a hot core. Gives slim beams a hot centre without a second mesh.
// The core is a paler shade of the beam's own colour, not white, and the whole is rolled off before it is
// tone mapped: a hot beam stays pink, red or violet under the bloom instead of burning out to the same white.
const GLOW_VERT = `varying vec3 vN; varying vec3 vV;
  void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const GLOW_FRAG = `uniform vec3 color; uniform float power; uniform float core; varying vec3 vN; varying vec3 vV;
  void main(){ float c = clamp(abs(dot(normalize(vN), normalize(vV))), 1e-4, 1.0);
    float peak = max(max(color.r, color.g), color.b);
    vec3 hot = mix(color, vec3(1.0, 0.95, 0.88) * peak, 0.42);
    vec3 col = color * pow(c, power) + hot * core * pow(c, power * 4.0);
    col /= 1.0 + 0.3 * max(col.r, max(col.g, col.b));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const glowMat = (power: number, core: number) => new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color() }, power: { value: power }, core: { value: core } },
  vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
});

/** A projectile that glows of its own (a turret bolt, a mortar shell): the same hot-cored glow as the beams, in its colour. */
export function boltMat(color: number, gain: number, core = 0.9, power = 1.5) {
  const m = glowMat(power, core);
  (m.uniforms.color.value as THREE.Color).setHex(color).multiplyScalar(gain);
  return m;
}
/** A beam the caller keeps and places every frame (a Lance holding its target). Dispose its material when done. */
export function makeBeam(): THREE.Mesh {
  const m = new THREE.Mesh(BEAM_GEO, glowMat(1.8, 0.7));
  m.frustumCulled = false; m.visible = false; m.layers.set(FX_LAYER);
  return m;
}
/** Place a kept beam from a to b. core 0..1 = how white-hot the centre is. */
export function placeBeam(m: THREE.Mesh, ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, color: number, gain: number, core = 0.7) {
  v1.set(bx - ax, by - ay, bz - az);
  const L = v1.length() || 0.001, u = (m.material as THREE.ShaderMaterial).uniforms;
  m.position.set(ax, ay, az);
  m.quaternion.setFromUnitVectors(UP, v1.divideScalar(L));
  m.scale.set(width, L, width);
  (u.color.value as THREE.Color).setHex(color).multiplyScalar(gain);
  u.core.value = core;
  m.visible = true;
}

// ---------- fire, reticles ----------
/** One clock for every sheet of fire (the view advances it). */
export const FIRE_CLOCK = { value: 0 };
const UV_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
/**
 * A sheet of fire. uv.x runs along the sheet, uv.y up it. len = its length in world units (keeps the tongues the same
 * size on a short and a long wall), heat 0..1 = how hot it burns (an Inferno), on 0..1 fades the whole sheet,
 * ends = 1 lets it die away toward both ends (a wall), 0 keeps it whole (a closed ring).
 */
export const fireMat = () => new THREE.ShaderMaterial({
  uniforms: { time: FIRE_CLOCK, len: { value: 4 }, heat: { value: 0 }, on: { value: 1 }, ends: { value: 1 }, seed: { value: Math.random() * 40 } },
  vertexShader: UV_VERT,
  fragmentShader: `uniform float time, len, heat, on, ends, seed; varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
    void main(){
      float x = vUv.x * len + seed, y = vUv.y;
      float n = vn(vec2(x * 2.1, y * 2.2 - time * 2.9)) * 0.6 + vn(vec2(x * 4.7 + 7.0, y * 4.6 - time * 5.2)) * 0.4;
      // solid at the foot, torn into tongues toward the top; a hot wall stands taller
      float f = n * (1.2 + 0.4 * heat) + 0.22 - y * (1.5 - 0.4 * heat);
      float edge = mix(1.0, smoothstep(0.0, 0.3, vUv.x * len) * smoothstep(0.0, 0.3, (1.0 - vUv.x) * len), ends);
      float a = smoothstep(0.0, 0.16, f) * edge * on;
      // deep rust at the tips, apricot in the body, pale sand only in the hottest part of the foot
      vec3 c = mix(vec3(0.75, 0.16, 0.03), vec3(1.0, 0.36, 0.07), smoothstep(0.0, 0.4, f));
      c = mix(c, vec3(1.25, 0.8, 0.34), smoothstep(0.55, 1.1, f) * (0.45 + 0.35 * heat));
      gl_FragColor = vec4(c * a * (1.0 + 0.2 * heat), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, side: THREE.DoubleSide,
});
/**
 * A target reticle on a unit quad (PlaneGeometry(2, 2), facing the camera): a ring that fills clockwise with `fill`,
 * a fine inner ring, a centre pip (both go with the uniform `inner` at 0, for a ring round something of its own; `thin` at 1 draws finer lines for a large one) and `ticks` bracket
 * marks outside the ring that turn with `spin` and fade with `mark`.
 */
export const reticleMat = (ticks = 4, depthTest = true) => new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color() }, fill: { value: 1 }, gain: { value: 1 }, mark: { value: 0 }, spin: { value: 0 }, ticks: { value: ticks }, inner: { value: 1 }, thin: { value: 0 } },
  vertexShader: UV_VERT,
  fragmentShader: `uniform vec3 color; uniform float fill, gain, mark, spin, ticks, inner, thin; varying vec2 vUv;
    void main(){
      vec2 p = vUv * 2.0 - 1.0; float r = length(p) * 1.25, w = fwidth(r) * 1.2;
      float ang = atan(p.x, p.y);
      float a = fract(ang / 6.2831853);
      float band = smoothstep(0.76 + 0.08 * thin - w, 0.76 + 0.08 * thin, r) * (1.0 - smoothstep(0.9, 0.9 + w, r));
      float v = band * mix(0.1, 1.0, step(a, fill));
      v += smoothstep(0.5 - w, 0.5, r) * (1.0 - smoothstep(0.535, 0.535 + w, r)) * (0.16 + 0.5 * mark) * inner;
      v += (1.0 - smoothstep(0.1, 0.1 + w, r)) * (0.25 + 0.75 * mark) * inner;
      // bracket marks: short bars pointing at the centre
      float t = abs(fract((ang + spin) / 6.2831853 * ticks) - 0.5) * 2.0;
      v += mark * step(0.86 + 0.07 * thin, t) * smoothstep(0.97 - w, 0.97, r) * (1.0 - smoothstep(1.2 - 0.08 * thin, 1.2 - 0.08 * thin + w, r));
      gl_FragColor = vec4(color * v * gain, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  blending: THREE.AdditiveBlending, depthWrite: false, depthTest, transparent: true, fog: false, side: THREE.DoubleSide,
});

// ---------- ice ----------
const ICE_NOISE = `
  float ih(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(ih(i), ih(i + vec3(1,0,0)), f.x), mix(ih(i + vec3(0,1,0)), ih(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(ih(i + vec3(0,0,1)), ih(i + vec3(1,0,1)), f.x), mix(ih(i + vec3(0,1,1)), ih(i + vec3(1,1,1)), f.x), f.y), f.z); }`;
// what a facet of ice shows: the cold sky in its mirror, a pale rim where it turns away, one hard glint
const ICE_SHADE = `
  vec3 iceShade(vec3 n, vec3 v, float front, out float fres, out float spec){
    float ndv = clamp(dot(n, v), 0.0, 1.0);
    fres = pow(1.0 - ndv, 2.6);
    vec3 r = reflect(-v, n);
    float sky = smoothstep(-0.35, 0.8, r.y);
    spec = pow(max(dot(n, normalize(vec3(-0.35, 0.8, 0.5) + v)), 0.0), 56.0) * front;
    vec3 c = mix(vec3(0.045, 0.2, 0.37), vec3(0.3, 0.62, 0.88), sky * 0.75 + 0.1);
    return mix(c, vec3(0.74, 0.92, 1.0), fres);
  }`;
/**
 * The shell a Flash Freeze leaves round a machine: a lump of ice that hugs the hull with crystals driven through it.
 * One geometry for all of them; the instance's seed turns it and gives every crystal its own length, so no two match.
 * aShard = the crystal's axis and its number (0 = the lump).
 */
function iceGeometry() {
  const pos: number[] = [], nor: number[] = [], sh: number[] = [];
  let rs = 20240613;
  const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), M = new THREE.Vector3(), X = new THREE.Vector3();
  // a triangle whose flat normal points away from the axis of its crystal (or from the centre, for the lump)
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ax: THREE.Vector3 | null, id: number) => {
    N.copy(b).sub(a).cross(X.copy(c).sub(a)).normalize();
    M.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    if (ax) M.addScaledVector(ax, -M.dot(ax));
    const flip = N.dot(M) < 0;
    if (flip) N.negate();
    for (const q of flip ? [a, c, b] : [a, b, c]) { pos.push(q.x, q.y, q.z); nor.push(N.x, N.y, N.z); sh.push(ax ? ax.x : 0, ax ? ax.y : 0, ax ? ax.z : 0, id); }
  };
  // the lump: a knocked-about icosphere
  const ico = new THREE.IcosahedronGeometry(1, 1), ip = ico.attributes.position;
  const jit = (v: THREE.Vector3) => { const h = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719) * 43758.5453; return v.multiplyScalar(0.72 + 0.22 * (h - Math.floor(h))); };
  for (let i = 0; i < ip.count; i += 3) tri(jit(A.fromBufferAttribute(ip, i)).clone(), jit(B.fromBufferAttribute(ip, i + 1)).clone(), jit(C.fromBufferAttribute(ip, i + 2)).clone(), null, 0);
  ico.dispose();
  // the crystals: a few standing up out of the top, most leaning out of the flanks, two low down
  const EL = [1.2, 0.85, 0.62, 0.45, 0.3, 0.2, 0.02, -0.1];
  for (let k = 0; k < EL.length; k++) {
    const az = (k * 2.39996) + rnd() * 0.7, el = EL[k] + (rnd() - 0.5) * 0.2, sides = rnd() < 0.5 ? 5 : 6;
    const ax = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    const u = new THREE.Vector3(0, 1, 0).cross(ax); if (u.lengthSq() < 0.01) u.set(1, 0, 0); u.normalize();
    const w = new THREE.Vector3().crossVectors(ax, u);
    const L = 0.92 + rnd() * 0.24, w0 = 0.27 + rnd() * 0.15, t1 = 0.3, t2 = L * (0.6 + rnd() * 0.14), ph = rnd() * 6.28;
    const ring = (t: number, r: number) => Array.from({ length: sides }, (_, i) => { const a = ph + (i / sides) * 6.2832, rr = r * (0.82 + 0.36 * rnd()); return new THREE.Vector3().copy(ax).multiplyScalar(t).addScaledVector(u, Math.cos(a) * rr).addScaledVector(w, Math.sin(a) * rr); });
    const r1 = ring(t1, w0 * 0.8), r2 = ring(t2, w0), tail = ax.clone().multiplyScalar(0.05);
    const tip = ax.clone().multiplyScalar(L).addScaledVector(u, (rnd() - 0.5) * w0 * 0.5).addScaledVector(w, (rnd() - 0.5) * w0 * 0.5);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      tri(tail, r1[i], r1[j], ax, k + 1);
      tri(r1[i], r2[i], r2[j], ax, k + 1); tri(r1[i], r2[j], r1[j], ax, k + 1);
      tri(r2[i], tip, r2[j], ax, k + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aShard', new THREE.Float32BufferAttribute(sh, 4));
  return g;
}
/**
 * Every ice shell on the board in one instanced draw (drawn twice: far faces, then near ones, so the far wall of the
 * shell shows through the near one). Per frame: begin(), add() for each frozen machine, end().
 */
export class IceField {
  mesh: THREE.InstancedMesh;
  private state: THREE.InstancedBufferAttribute;
  private n = 0;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private p = new THREE.Vector3(); private s = new THREE.Vector3();
  constructor(private cap = 96) {
    const g = iceGeometry();
    this.state = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.state.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aState', this.state);
    const mat = new THREE.ShaderMaterial({
      vertexShader: `attribute vec4 aShard; attribute vec4 aState; varying vec3 vN, vV, vP; varying vec4 vS;
        void main(){
          vec3 p = position;
          // every crystal has its own length, and they are driven out one after another as the shell forms
          float h = fract(sin(aShard.w * 12.9898 + aState.x * 78.233) * 43758.5453);
          // (round a big machine the crystals stay short: at its size long ones would stand over the towers; such a shell is marked by a seed above 90)
          float k = mix(0.78, mix(1.24, 0.9, step(90.0, aState.x)), h) * smoothstep(0.0, 1.0, aState.z * 1.5 - h * 0.5);
          if (aShard.w > 0.5) p += aShard.xyz * dot(p, aShard.xyz) * (k - 1.0);
          else p *= 0.55 + 0.45 * smoothstep(0.0, 0.6, aState.z);
          vP = p; vS = aState;
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
          vN = normalMatrix * mat3(instanceMatrix) * normal; vV = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying vec3 vN, vV, vP; varying vec4 vS;
        ${ICE_NOISE}
        ${ICE_SHADE}
        vec3 h33(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
        // distance to the nearest and second nearest cell point: their difference is small along the cell walls (the cracks)
        vec2 cells(vec3 p){ vec3 i = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0;
          for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
            vec3 g = vec3(float(x), float(y), float(z)), d = g + h33(i + g) - f; float dd = dot(d, d);
            if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd; }
          return sqrt(vec2(d1, d2)); }
        void main(){
          float front = gl_FrontFacing ? 1.0 : 0.0;
          vec3 n = normalize(vN) * (front * 2.0 - 1.0), v = normalize(vV);
          float fres, spec;
          vec3 col = iceShade(n, v, front, fres, spec);
          // what is inside: frozen-in cloud, seen displaced through each facet as if the facet bent the light
          vec3 q = vP * 2.5 + n * 0.6 + vS.x;
          float fr = vn3(q) * 0.62 + vn3(q * 2.7 + 4.0) * 0.38;
          float cloud = smoothstep(0.42, 0.8, fr), vein = smoothstep(0.06, 0.0, abs(fr - 0.5));
          col += vec3(0.62, 0.84, 1.0) * (cloud * 0.26 + vein * 0.16);
          float a = mix(0.1, 0.84, fres) + cloud * 0.17 + vein * 0.1;
          // the far wall, seen through the shell: deeper blue, fainter
          if (front < 0.5) { col *= vec3(0.42, 0.7, 1.0); a = a * 0.45 + 0.04; }
          col += vec3(0.7, 0.78, 0.85) * spec; a += spec * 0.5;
          // the freeze is running out: cracks start in a few places and run through the whole shell
          if (vS.y > 0.004) {
            // (the cell walls are bent by noise so the net does not read as a honeycomb: hairlines with a faint bruise of frost along them)
            vec3 cp = vP * 1.75 + vS.x * 3.0; cp += (vec3(vn3(cp * 1.9), vn3(cp * 1.9 + 11.0), vn3(cp * 1.9 + 23.0)) - 0.5) * 0.32;
            vec2 w = cells(cp);
            float m = vn3(vP * 1.2 + vS.x * 5.0), rev = smoothstep(vS.y * 1.3, vS.y * 1.3 - 0.16, m);
            float dw = w.y - w.x, line = (1.0 - smoothstep(0.0, 0.02 + 0.022 * vS.y, dw)) * rev;
            float bruise = (1.0 - smoothstep(0.0, 0.2, dw)) * rev * 0.22;
            col = mix(col, vec3(0.8, 0.93, 1.02), max(line, bruise)); a = max(a, max(line * 0.95, a + bruise * 0.5));
            a += rev * 0.12 * vS.y; col += vec3(0.5, 0.7, 0.9) * rev * 0.1 * vS.y;
          }
          col += vec3(0.75, 0.92, 1.0) * vS.w;
          gl_FragColor = vec4(col, clamp(a + vS.w * 0.5, 0.0, 1.0));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    this.mesh = new THREE.InstancedMesh(g, mat, cap);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.layers.set(FX_LAYER); this.mesh.renderOrder = 2;
  }
  begin() { this.n = 0; }
  /** seed 0..40 per machine, crack 0..1 how far the cracks have run, grow 0..1 as the shell forms, flash 0..1 its first frost-white instant */
  add(x: number, y: number, z: number, rx: number, ry: number, yaw: number, seed: number, crack: number, grow: number, flash: number) {
    if (this.n >= this.cap) return;
    const i = this.n++, a = this.state.array as Float32Array;
    this.m4.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e.set(Math.sin(seed * 3.1) * 0.22, yaw + seed, Math.cos(seed * 5.3) * 0.22, 'YXZ')), this.s.set(rx, ry, rx));
    this.mesh.setMatrixAt(i, this.m4);
    a[i * 4] = seed; a[i * 4 + 1] = crack; a[i * 4 + 2] = grow; a[i * 4 + 3] = flash;
  }
  end() {
    this.mesh.count = this.n; this.mesh.visible = this.n > 0;
    if (this.n) { this.mesh.instanceMatrix.needsUpdate = true; this.state.needsUpdate = true; }
  }
}
/** A splinter of ice: a long irregular sliver, flat faced. */
function shardGeometry() {
  const top = [0, 0.62, 0], bot = [0.05, -0.38, 0.03], mid = [[0.2, 0.02, 0.04], [-0.07, 0.1, 0.17], [-0.15, -0.06, -0.12], [0.06, -0.02, -0.16]];
  const pos: number[] = [], nor: number[] = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const tri = (p: number[], q: number[], r: number[]) => {
    a.fromArray(p); b.fromArray(q); c.fromArray(r);
    const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize(), flip = n.dot(a.clone().add(b).add(c)) < 0;
    if (flip) n.negate();
    for (const v of flip ? [p, r, q] : [p, q, r]) { pos.push(v[0], v[1], v[2]); nor.push(n.x, n.y, n.z); }
  };
  for (let i = 0; i < 4; i++) { tri(top, mid[i], mid[(i + 1) % 4]); tri(bot, mid[(i + 1) % 4], mid[i]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/**
 * The power node on top of a tower, on a unit quad that faces the camera: a glass ball whose charge stands in it like a
 * liquid (fill 0..1), lit from inside in the tower's colour. ready 0..1 = fully charged: the whole ball burns and breathes.
 * dead 0..1 = offline: the glass goes dull. The ball's radius is 0.8 of the quad's half width.
 */
export const orbMat = (clock: { value: number }) => new THREE.ShaderMaterial({
  uniforms: { time: clock, color: { value: new THREE.Color() }, fill: { value: 0 }, ready: { value: 0 }, flash: { value: 0 }, dead: { value: 0 }, seed: { value: Math.random() * 40 } },
  vertexShader: UV_VERT,
  fragmentShader: `uniform vec3 color; uniform float time, fill, ready, flash, dead, seed; varying vec2 vUv;
    void main(){
      vec2 p = (vUv * 2.0 - 1.0) / 0.8; float r = length(p), w = fwidth(r) * 1.3;
      float disc = 1.0 - smoothstep(1.0 - w, 1.0, r);
      float z = sqrt(max(0.0, 1.0 - r * r));
      float fres = pow(1.0 - z, 2.4);
      // the charge: it stands in the ball up to its level, with a slow swell on its surface
      float lvl = mix(-1.02, 1.02, fill);
      float y = p.y - (0.045 * sin(p.x * 5.0 + time * 2.4 + seed) + 0.025 * sin(p.x * 11.0 - time * 3.3 + seed)) * (1.0 - ready);
      float inl = smoothstep(lvl + 0.035, lvl - 0.035, y) * step(0.004, fill);
      float sw = 0.5 + 0.5 * sin(p.x * 4.0 + sin(p.y * 5.0 + time * 1.3 + seed) * 2.0 + time * 0.9);
      float beat = 0.5 + 0.5 * sin(time * 4.2 + seed);
      vec3 hue = color / max(max(color.r, max(color.g, color.b)), 0.001);
      vec3 liquid = hue * (0.3 + 0.2 * sw) * (0.32 + 0.78 * z * z) * (1.0 + ready * (0.35 + 0.2 * beat));
      // a hot heart when it is full: lighter, never white, so the tower's colour carries
      liquid += mix(hue, vec3(1.0), 0.3) * ready * (0.16 + 0.14 * beat) * pow(z, 4.0);
      vec3 glass = hue * 0.035 + vec3(0.012, 0.014, 0.018);
      vec3 col = mix(glass, liquid, inl);
      // the surface of the charge: a bright line across the ball
      float men = exp(-pow((y - lvl) / 0.05, 2.0)) * step(0.004, fill) * (1.0 - ready);
      col += hue * men * 0.75 * (0.4 + 0.6 * z);
      col = mix(col, vec3(0.05, 0.035, 0.03) + hue * 0.05 * inl, dead * 0.8);
      // the glass: a fine bright rim in the reticle's line weight, a window glint high on one side, a faint bounce below
      float rim = smoothstep(0.9 - w, 0.955, r) * disc;
      col += hue * (fres * 0.3 + rim * (0.5 + 0.5 * ready)) * (1.0 - 0.6 * dead);
      vec2 g1 = p - vec2(-0.36, 0.42), g2 = p - vec2(0.3, -0.5);
      float glint = exp(-dot(g1 * vec2(1.0, 1.5), g1 * vec2(1.0, 1.5)) * 26.0) * 0.85 + exp(-dot(g2, g2) * 14.0) * 0.1;
      col += vec3(1.0) * glint * (1.0 - 0.5 * dead);
      col += hue * flash * (0.4 + 0.55 * z);
      // premultiplied: the dark glass hides what is behind it, the light adds on top
      float a = disc * (0.78 + 0.22 * max(inl, fres));
      // a breath of light just outside the glass when it is full
      float halo = (1.0 - disc) * exp(-(r - 1.0) * 11.0) * (ready * (0.16 + 0.12 * beat) + flash * 0.4);
      gl_FragColor = vec4(col * disc + hue * halo, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  depthWrite: false, transparent: true, fog: false, side: THREE.DoubleSide,
});

// ---------- the kit of the tower specials ----------
// Everything below is instanced and pooled: one draw per kind however many are alive, nothing allocated after start-up.
const WHITE = new THREE.Color(0xffffff);
const NOISE2 = `
  float h21(vec2 p){ p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; } return s; }`;
const PREMULT = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor } as const;

/**
 * Bolts: every segment of the specials' lightning, tracers and pillars of light in ONE instanced draw (the short-lived beams
 * of Fx.beam are a mesh each). A segment may wait before it shows (`delay`): a leader that steps its way down, a chain that
 * runs from machine to machine. Same hot-cored glow as the beams.
 */
class Bolts {
  mesh: THREE.InstancedMesh;
  private col: THREE.InstancedBufferAttribute;
  private base: Float32Array; private life: Float32Array; private max: Float32Array; private wait: Float32Array;
  private head = 0; private live = 0;
  constructor(private cap = 768) {
    const g = BEAM_GEO.clone();
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.col.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aCol', this.col);
    this.base = new Float32Array(cap * 3); this.life = new Float32Array(cap); this.max = new Float32Array(cap); this.wait = new Float32Array(cap);
    this.mesh = new THREE.InstancedMesh(g, new THREE.ShaderMaterial({
      vertexShader: `attribute vec4 aCol; varying vec3 vN, vV, vC;
        void main(){ vec3 p = position; p.xz *= step(0.001, aCol.a) * (0.25 + 0.75 * aCol.a);
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0); vN = normalMatrix * mat3(instanceMatrix) * normal; vV = -mv.xyz;
          vC = aCol.rgb * aCol.a * aCol.a * 1.6; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vN, vV, vC;
        void main(){ float c = clamp(abs(dot(normalize(vN), normalize(vV))), 1e-4, 1.0);
          float peak = max(max(vC.r, vC.g), vC.b);
          vec3 hot = mix(vC, vec3(1.0, 0.95, 0.88) * peak, 0.42);
          vec3 col = vC * pow(c, 1.8) + hot * 0.8 * pow(c, 7.2);
          col /= 1.0 + 0.3 * max(col.r, max(col.g, col.b));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
    }), cap);
    this.mesh.count = 0; this.mesh.visible = false; this.mesh.frustumCulled = false;
  }
  add(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: number, width: number, life: number, delay: number, gain: number) {
    const i = this.head; this.head = (this.head + 1) % this.cap;
    v1.set(bx - ax, by - ay, bz - az);
    const L = v1.length() || 0.001;
    M4.compose(v2.set(ax, ay, az), Q4.setFromUnitVectors(UP, v1.divideScalar(L)), v1.set(width * 0.7, L, width * 0.7));
    this.mesh.setMatrixAt(i, M4); this.mesh.instanceMatrix.needsUpdate = true;
    c1.setHex(color);
    this.base[i * 3] = c1.r * gain; this.base[i * 3 + 1] = c1.g * gain; this.base[i * 3 + 2] = c1.b * gain;
    this.life[i] = this.max[i] = life; this.wait[i] = delay;
    (this.col.array as Float32Array)[i * 4 + 3] = 0;
    this.live = this.cap;
  }
  update(dt: number) {
    if (this.live <= 0) { this.mesh.visible = false; return; }
    const a = this.col.array as Float32Array, { life, max, wait, base } = this;
    let hi = 0;
    for (let i = 0; i < this.cap; i++) {
      if (life[i] <= 0) continue;
      const k = i * 4;
      if (wait[i] > 0) { wait[i] -= dt; a[k + 3] = 0; hi = i + 1; continue; }
      life[i] -= dt;
      if (life[i] <= 0) { a[k + 3] = 0; continue; }
      a[k] = base[i * 3]; a[k + 1] = base[i * 3 + 1]; a[k + 2] = base[i * 3 + 2]; a[k + 3] = life[i] / max[i];
      hi = i + 1;
    }
    this.live = hi; this.mesh.count = hi; this.mesh.visible = hi > 0;
    this.col.needsUpdate = true;
  }
}

/** What a Decals instance draws (aA.y). */
const D_SHOCK = 0, D_FROST = 1, D_LICHT = 2, D_CRATER = 3, D_MARK = 4, D_SHADE = 5, D_GLOW = 6, D_HOOP = 7;
/**
 * Decals: flat marks of the specials in one instanced draw, each a quad with a little shader of its own kind. On the deck:
 * a shock band, a front of frost that leaves rime behind, the branching burn of a lightning strike, a crater, a target
 * mark, a patch of shadow, a pool of light. Standing free at any angle: a hoop (a thin ring that grows or closes).
 * Premultiplied: a mark can darken the deck and glow on top of it at once.
 */
class Decals {
  mesh: THREE.InstancedMesh;
  private a: THREE.InstancedBufferAttribute; private b: THREE.InstancedBufferAttribute; private c: THREE.InstancedBufferAttribute;
  private life: Float32Array; private max: Float32Array; private wait: Float32Array;
  private head = 0; private live = 0;
  constructor(private cap = 128) {
    const g = new THREE.PlaneGeometry(2, 2);
    const attr = (n: number) => { const x = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n); x.setUsage(THREE.DynamicDrawUsage); return x; };
    this.a = attr(4); this.b = attr(4); this.c = attr(3);
    g.setAttribute('aA', this.a); g.setAttribute('aB', this.b); g.setAttribute('aC', this.c);
    this.life = new Float32Array(cap); this.max = new Float32Array(cap); this.wait = new Float32Array(cap);
    this.mesh = new THREE.InstancedMesh(g, new THREE.ShaderMaterial({
      vertexShader: `attribute vec4 aA, aB; attribute vec3 aC; varying vec2 vUv; varying vec4 vA, vB; varying vec3 vC;
        void main(){ vUv = uv; vA = aA; vB = aB; vC = aC;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position * step(0.0, aA.x), 1.0); }`,
      fragmentShader: `varying vec2 vUv; varying vec4 vA, vB; varying vec3 vC;
        ${NOISE2}
        float ridge(float v, float p){ return pow(1.0 - abs(2.0 * v - 1.0), p); }
        void main(){
          vec2 p = vUv * 2.0 - 1.0; float r = length(p);
          if (r > 1.0) discard;
          float t = vA.x, kind = vA.y, seed = vA.z, gain = vA.w, ang = atan(p.y, p.x);
          vec3 add = vec3(0.0); float a = 0.0, edge = 1.0 - smoothstep(0.9, 1.0, r);
          if (kind < 0.5) {
            // shock band: a soft-backed front that runs out from vB.x of the radius, vB.y wide
            float R = mix(vB.x, 0.97, 1.0 - (1.0 - t) * (1.0 - t)), w = vB.y;
            float band = smoothstep(R - w, R, r) * (1.0 - smoothstep(R, R + 0.012, r));
            add = vC * band * band * (1.0 - t) * (1.0 - t) * gain; edge = 1.0;
          } else if (kind < 1.5) {
            // frost: the front races out in the first vB.x of its life, needles of rime shoot ahead of it and stay behind it
            float R = min(1.0, t / vB.x); R = (1.0 - (1.0 - R) * (1.0 - R)) * 0.96;
            float needles = ridge(vn(vec2(ang * 9.0 + seed, r * 2.0 + seed)), 5.0), fine = ridge(vn(vec2(ang * 31.0 - seed, r * 7.0)), 7.0);
            float lead = smoothstep(R - 0.14 - 0.12 * needles, R, r) * (1.0 - smoothstep(R, R + 0.015, r));
            float inside = 1.0 - smoothstep(R - 0.03, R, r);
            float rime = inside * (0.14 + 0.62 * needles + 0.5 * fine) * smoothstep(1.0, 0.4, t) * smoothstep(0.0, 0.12, r);
            add = vC * (lead * (1.0 - smoothstep(vB.x * 0.9, vB.x * 1.7, t)) * 1.0 + rime * 0.5) * gain;
          } else if (kind < 2.5) {
            // the burn of a strike: branches that run out from the middle white-hot and cool to a char
            float w1 = fbm(vec2(ang * 1.9 + seed, r * 2.4 + seed * 0.37));
            float v = ridge(fbm(vec2(ang * 3.0 + w1 * 2.6 + seed, r * 1.7 - w1)), 10.0), f2 = ridge(fbm(vec2(ang * 7.0 - seed, r * 4.0 + w1 * 3.0)), 14.0);
            float lines = (v * pow(1.0 - r, 0.7) + f2 * (1.0 - r) * 0.5) * smoothstep(0.0, 0.1, t * 7.0 + 0.15 - r);
            float heat = pow(1.0 - t, 3.0);
            add = vC * (lines * (heat * 2.4 + 0.14 * (1.0 - t)) + pow(1.0 - r, 3.0) * heat * 0.55) * gain;
            a = clamp(lines * 0.8 + pow(1.0 - r, 2.0) * 0.32, 0.0, 0.85) * smoothstep(1.0, 0.7, t);
          } else if (kind < 3.5) {
            // crater: a charred bowl with a torn edge, cracks that glow while it is fresh
            float n = fbm(p * 3.0 + seed);
            float disc = 1.0 - smoothstep(0.3 + 0.3 * n, 0.95, r);
            float cracks = ridge(fbm(vec2(ang * 2.5 + seed, r * 2.0 + n)), 22.0) * (1.0 - smoothstep(0.4, 0.95, r));
            float heat = pow(1.0 - t, 9.0);
            add = vC * (cracks * (heat * 2.4 + 0.05 * (1.0 - t)) + disc * heat * 0.45) * gain;
            a = clamp(disc * 0.74 + cracks * 0.3, 0.0, 0.88) * smoothstep(1.0, 0.75, t);
          } else if (kind < 4.5) {
            // target mark: a ring that closes on the spot, four brackets turning round it, a cross in the middle
            float R = mix(1.0, 0.7, smoothstep(0.0, 0.3, t)), w = 0.035;
            float ring = smoothstep(R - w - 0.02, R - w, r) * (1.0 - smoothstep(R - 0.02, R, r));
            float tk = abs(fract((ang + t * 5.0 + seed) / 6.2831853 * 4.0) - 0.5) * 2.0;
            float ticks = step(0.78, tk) * smoothstep(R - 0.32, R - 0.3, r) * (1.0 - smoothstep(R - 0.1, R - 0.08, r));
            float cross = (1.0 - smoothstep(0.0, 0.025, min(abs(p.x), abs(p.y)))) * (1.0 - smoothstep(0.1, 0.24, r));
            add = vC * (ring + ticks * 0.8 + cross) * (0.65 + 0.35 * sin(t * 70.0)) * smoothstep(1.0, 0.9, t) * smoothstep(0.0, 0.04, t) * gain;
            edge = 1.0;
          } else if (kind < 5.5) {
            // shadow: the light goes out of a patch of deck
            a = pow(1.0 - r, 1.3) * gain * smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.6, t);
          } else if (kind < 6.5) {
            add = vC * pow(1.0 - r, 2.0) * (1.0 - t) * (1.0 - t) * gain;
          } else {
            // hoop: a thin ring from vB.x to vB.y of the quad's radius, vB.z thick
            float R = mix(vB.x, vB.y, 1.0 - (1.0 - t) * (1.0 - t)), w = vB.z;
            float ring = smoothstep(R - w, R - w * 0.5, r) * (1.0 - smoothstep(R - w * 0.5, R, r));
            add = vC * ring * min(1.0, (1.0 - t) * 3.0) * gain * 1.5; edge = 1.0;
          }
          gl_FragColor = vec4(add * edge, a * edge);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      ...PREMULT, depthWrite: false, transparent: true, fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }), cap);
    this.mesh.count = 0; this.mesh.visible = false; this.mesh.frustumCulled = false;
  }
  /** (nx, ny, nz): the way the mark faces (0, 1, 0 for one on the deck). p0..p2: per kind (see the shader). */
  add(kind: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number, color: number, life: number, gain: number, p0: number, p1: number, p2: number, delay: number) {
    const i = this.head; this.head = (this.head + 1) % this.cap;
    Q4.setFromUnitVectors(v1.set(0, 0, 1), v2.set(nx, ny, nz).normalize());
    if (kind !== D_HOOP) Q4.multiply(QT.setFromAxisAngle(v1, Math.random() * 6.283));
    M4.compose(v2.set(x, y, z), Q4, v1.set(r, r, r));
    this.mesh.setMatrixAt(i, M4); this.mesh.instanceMatrix.needsUpdate = true;
    const a = this.a.array as Float32Array, b = this.b.array as Float32Array, c = this.c.array as Float32Array;
    a[i * 4] = delay > 0 ? -1 : 0; a[i * 4 + 1] = kind; a[i * 4 + 2] = Math.random() * 40; a[i * 4 + 3] = gain;
    b[i * 4] = p0; b[i * 4 + 1] = p1; b[i * 4 + 2] = p2;
    c1.setHex(color); c[i * 3] = c1.r; c[i * 3 + 1] = c1.g; c[i * 3 + 2] = c1.b;
    this.life[i] = this.max[i] = life; this.wait[i] = delay;
    this.a.needsUpdate = this.b.needsUpdate = this.c.needsUpdate = true;
    this.live = this.cap;
  }
  update(dt: number) {
    if (this.live <= 0) { this.mesh.visible = false; return; }
    const a = this.a.array as Float32Array, { life, max, wait } = this;
    let hi = 0;
    for (let i = 0; i < this.cap; i++) {
      if (life[i] <= 0) continue;
      if (wait[i] > 0) { wait[i] -= dt; a[i * 4] = -1; hi = i + 1; continue; }
      life[i] -= dt;
      if (life[i] <= 0) { a[i * 4] = -1; continue; }
      a[i * 4] = 1 - life[i] / max[i]; hi = i + 1;
    }
    this.live = hi; this.mesh.count = hi; this.mesh.visible = hi > 0;
    this.a.needsUpdate = true;
  }
}

/** A crystal of ice standing on its base: six-sided, a shoulder two thirds up, the tip a little off its axis. */
function spikeGeometry() {
  const pos: number[] = [], nor: number[] = [], A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
  const tri = (a: number[], b: number[], c: number[]) => {
    A.fromArray(a); B.fromArray(b); C.fromArray(c);
    N.copy(B).sub(A).cross(C.clone().sub(A)).normalize();
    const flip = N.x * (A.x + B.x + C.x) + N.z * (A.z + B.z + C.z) < 0;
    if (flip) N.negate();
    for (const v of flip ? [a, c, b] : [a, b, c]) { pos.push(v[0], v[1], v[2]); nor.push(N.x, N.y, N.z); }
  };
  const ring = (y: number, r: number) => Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * 6.2832 + 0.3, k = 0.85 + 0.3 * ((i * 7) % 3) / 2; return [Math.cos(a) * r * k, y, Math.sin(a) * r * k]; });
  const r0 = ring(0, 1), r1 = ring(0.62, 0.78), tip = [0.12, 1, -0.08];
  for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; tri(r0[i], r1[i], r1[j]); tri(r0[i], r1[j], r0[j]); tri(r1[i], tip, r1[j]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
/** Spikes of ice that are driven up out of the deck, stand a while and sink back: one instanced draw. */
class Spikes {
  mesh: THREE.InstancedMesh;
  private st: THREE.InstancedBufferAttribute;
  private life: Float32Array; private max: Float32Array; private wait: Float32Array;
  private head = 0; private live = 0;
  constructor(private cap = 192) {
    const g = spikeGeometry();
    this.st = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    this.st.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aS', this.st);
    this.life = new Float32Array(cap); this.max = new Float32Array(cap); this.wait = new Float32Array(cap);
    this.mesh = new THREE.InstancedMesh(g, new THREE.ShaderMaterial({
      vertexShader: `attribute vec2 aS; varying vec3 vN, vV; varying vec2 vS;
        void main(){ vec3 p = position; p.y *= aS.x; p.xz *= 0.35 + 0.65 * min(1.0, aS.x); vS = aS;
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0); vN = normalMatrix * mat3(instanceMatrix) * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vN, vV; varying vec2 vS;
        ${ICE_SHADE}
        void main(){ float fres, spec; vec3 col = iceShade(normalize(vN), normalize(vV), 1.0, fres, spec);
          col += vec3(1.3, 1.45, 1.6) * spec + vec3(0.55, 0.8, 1.0) * vS.y;
          gl_FragColor = vec4(col, clamp(0.62 + 0.38 * fres + spec + vS.y, 0.0, 1.0) * step(0.004, vS.x));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, fog: false,
    }), cap);
    this.mesh.count = 0; this.mesh.visible = false; this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
  }
  /** h tall, w wide at the foot, leaning `lean` rad toward heading `yaw`. */
  add(x: number, y: number, z: number, h: number, w: number, lean: number, yaw: number, life: number, delay: number) {
    const i = this.head; this.head = (this.head + 1) % this.cap;
    Q4.setFromAxisAngle(v1.set(Math.cos(yaw), 0, -Math.sin(yaw)), lean).multiply(QT.setFromAxisAngle(UP, Math.random() * 6.283));
    M4.compose(v2.set(x, y, z), Q4, v1.set(w, h, w));
    this.mesh.setMatrixAt(i, M4); this.mesh.instanceMatrix.needsUpdate = true;
    this.life[i] = this.max[i] = life; this.wait[i] = delay;
    (this.st.array as Float32Array)[i * 2] = 0;
    this.live = this.cap;
  }
  update(dt: number) {
    if (this.live <= 0) { this.mesh.visible = false; return; }
    const a = this.st.array as Float32Array, { life, max, wait } = this;
    let hi = 0;
    for (let i = 0; i < this.cap; i++) {
      if (life[i] <= 0) continue;
      if (wait[i] > 0) { wait[i] -= dt; a[i * 2] = 0; hi = i + 1; continue; }
      life[i] -= dt;
      if (life[i] <= 0) { a[i * 2] = 0; continue; }
      const age = max[i] - life[i], u = Math.min(1, age / 0.14), c = 1.70158, e = 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2);   // out with a little overshoot
      a[i * 2] = Math.max(0.005, e * Math.min(1, life[i] / 0.35)); a[i * 2 + 1] = Math.max(0, 1 - age / 0.3) * 0.7;
      hi = i + 1;
    }
    this.live = hi; this.mesh.count = hi; this.mesh.visible = hi > 0;
    this.st.needsUpdate = true;
  }
}

/**
 * Chunks: small solid bits that are thrown, tumble, bounce on the deck and fade (spent brass, splinters of deck plate):
 * one instanced draw, flown on the CPU like the splinters of ice.
 */
class Chunks {
  mesh: THREE.InstancedMesh;
  private col: THREE.InstancedBufferAttribute;
  private pos: Float32Array; private vel: Float32Array; private axis: Float32Array; private dat: Float32Array; private base: Float32Array; private gy: Float32Array;
  private head = 0; private live = 0;
  constructor(private cap = 256) {
    const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.col.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aK', this.col);
    this.pos = new Float32Array(cap * 3); this.vel = new Float32Array(cap * 3); this.axis = new Float32Array(cap * 3); this.base = new Float32Array(cap * 4);
    this.dat = new Float32Array(cap * 6); // angle, turn rate, size, life, max life, stretch
    this.gy = new Float32Array(cap);
    this.mesh = new THREE.InstancedMesh(g, new THREE.ShaderMaterial({
      vertexShader: `attribute vec4 aK; varying vec3 vN; varying vec4 vK;
        void main(){ vK = aK; vN = normalMatrix * mat3(instanceMatrix) * normal; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vN; varying vec4 vK;
        void main(){ vec3 n = normalize(vN); float l = 0.3 + 0.7 * max(0.0, dot(n, normalize(vec3(0.3, 0.8, 0.5))));
          float s = pow(max(0.0, dot(n, normalize(vec3(0.2, 0.6, 0.77)))), 18.0);
          gl_FragColor = vec4(vK.rgb * l + vK.rgb * s * 1.5, min(1.0, vK.a * 4.0));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, fog: false,
    }), cap);
    this.mesh.count = 0; this.mesh.visible = false; this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
  }
  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, stretch: number, life: number, color: number, gain: number, gy: number) {
    const i = this.head; this.head = (this.head + 1) % this.cap;
    const j = i * 3, k = i * 6;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z; this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    v1.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.axis[j] = v1.x; this.axis[j + 1] = v1.y; this.axis[j + 2] = v1.z;
    this.dat[k] = Math.random() * 6.28; this.dat[k + 1] = (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 16); this.dat[k + 2] = size; this.dat[k + 3] = this.dat[k + 4] = life; this.dat[k + 5] = stretch;
    c1.setHex(color);
    this.base[i * 4] = c1.r * gain; this.base[i * 4 + 1] = c1.g * gain; this.base[i * 4 + 2] = c1.b * gain;
    this.gy[i] = gy;
    this.live = this.cap;
  }
  update(dt: number) {
    if (this.live <= 0) { this.mesh.visible = false; return; }
    const { pos, vel, axis, dat, gy, base } = this, col = this.col.array as Float32Array;
    let n = 0;
    for (let i = 0; i < this.cap; i++) {
      const k = i * 6;
      if (dat[k + 3] <= 0) continue;
      dat[k + 3] -= dt;
      const j = i * 3, f = Math.max(0, dat[k + 3] / dat[k + 4]);
      vel[j + 1] -= 16 * dt;
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
      const floor = gy[i] + dat[k + 2] * 0.5;
      if (pos[j + 1] < floor && vel[j + 1] < 0) { pos[j + 1] = floor; vel[j + 1] *= -0.4; vel[j] *= 0.55; vel[j + 2] *= 0.55; dat[k + 1] *= 0.5; }
      dat[k] += dat[k + 1] * dt;
      M4.compose(v1.set(pos[j], pos[j + 1], pos[j + 2]), Q4.setFromAxisAngle(v2.set(axis[j], axis[j + 1], axis[j + 2]), dat[k]), v2.set(dat[k + 2], dat[k + 2] * dat[k + 5], dat[k + 2]));
      this.mesh.setMatrixAt(n, M4);
      col[n * 4] = base[i * 4]; col[n * 4 + 1] = base[i * 4 + 1]; col[n * 4 + 2] = base[i * 4 + 2]; col[n * 4 + 3] = f;
      n++;
    }
    this.live = n; this.mesh.count = n; this.mesh.visible = n > 0;
    if (n) { this.mesh.instanceMatrix.needsUpdate = true; this.col.needsUpdate = true; }
  }
}

/**
 * Flares: points of light that face the camera with a lens star round them (a hot core, a soft halo, a long level streak,
 * four fine rays): one instanced draw. A flare given a key is one light that is fed every frame (an emitter that burns for
 * seconds, a ball of lightning that crawls along the road): the same key moves and re-lights the same flare.
 */
class Flares {
  mesh: THREE.InstancedMesh;
  private p: THREE.InstancedBufferAttribute; private f: THREE.InstancedBufferAttribute;
  private life: Float32Array; private max: Float32Array; private gain: Float32Array; private key: Int32Array;
  private head = 0; private live = 0;
  constructor(private cap = 48) {
    const g = new THREE.PlaneGeometry(2, 2);
    const attr = (n: number) => { const x = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n); x.setUsage(THREE.DynamicDrawUsage); return x; };
    this.p = attr(4); this.f = attr(4);
    g.setAttribute('aP', this.p); g.setAttribute('aF', this.f);
    this.life = new Float32Array(cap); this.max = new Float32Array(cap); this.gain = new Float32Array(cap); this.key = new Int32Array(cap).fill(-1);
    this.mesh = new THREE.InstancedMesh(g, new THREE.ShaderMaterial({
      vertexShader: `attribute vec4 aP, aF; varying vec2 vUv; varying vec4 vF;
        void main(){ vUv = uv; vF = aF; vec4 mv = modelViewMatrix * vec4(aP.xyz, 1.0); mv.xy += position.xy * aP.w * step(0.0001, aF.a); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec2 vUv; varying vec4 vF;
        void main(){ vec2 p = vUv * 2.0 - 1.0; float r = length(p);
          float core = exp(-r * r * 46.0), halo = exp(-r * 6.5) * 0.22;
          float streak = exp(-abs(p.y) * 52.0) * exp(-abs(p.x) * 3.4) * 0.75;
          float rays = (exp(-abs(p.x + p.y) * 44.0) + exp(-abs(p.x - p.y) * 44.0)) * exp(-r * 6.0) * 0.3;
          float box = 1.0 - smoothstep(0.82, 1.0, max(abs(p.x), abs(p.y)));
          vec3 col = vF.rgb * (halo + streak + rays) * 0.7 + mix(vF.rgb, vec3(1.0, 0.97, 0.92) * max(vF.r, max(vF.g, vF.b)), 0.5) * core * 1.1;
          gl_FragColor = vec4(col * vF.a * box, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
    }), cap);
    this.mesh.count = 0; this.mesh.visible = false; this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
  }
  add(x: number, y: number, z: number, size: number, color: number, life: number, gain: number, key: number) {
    let i = -1;
    if (key >= 0) for (let k = 0; k < this.cap; k++) if (this.key[k] === key && this.life[k] > 0) { i = k; break; }
    if (i < 0) {
      for (let n = 0; n < this.cap; n++) { const k = (this.head + n) % this.cap; if (this.life[k] <= 0) { i = k; break; } }
      if (i < 0) i = this.head;
      this.head = (i + 1) % this.cap;
    }
    const p = this.p.array as Float32Array, f = this.f.array as Float32Array;
    p[i * 4] = x; p[i * 4 + 1] = y; p[i * 4 + 2] = z; p[i * 4 + 3] = size;
    c1.setHex(color); f[i * 4] = c1.r; f[i * 4 + 1] = c1.g; f[i * 4 + 2] = c1.b;
    this.life[i] = this.max[i] = life; this.gain[i] = gain; this.key[i] = key;
    this.p.needsUpdate = true;
    this.live = this.cap;
  }
  update(dt: number) {
    if (this.live <= 0) { this.mesh.visible = false; return; }
    const f = this.f.array as Float32Array, { life, max, gain, key } = this;
    let hi = 0;
    for (let i = 0; i < this.cap; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) { f[i * 4 + 3] = 0; key[i] = -1; continue; }
      // a fed flare (keyed) holds its light and only dies away when it is no longer fed; a single one fades over its life
      f[i * 4 + 3] = gain[i] * (key[i] >= 0 ? Math.min(1, life[i] / (max[i] * 0.6)) : (life[i] / max[i]) * (life[i] / max[i]));
      hi = i + 1;
    }
    this.live = hi; this.mesh.count = hi; this.mesh.visible = hi > 0;
    this.f.needsUpdate = true;
  }
}

/**
 * A storm cell: three decks of slowly turning cloud, one above the other, with an eye in the middle and lightning that
 * flickers inside it (uniform flash). One draw per cell; two cells are kept (two pylons may fire at once).
 */
class Storm {
  mesh: THREE.Mesh; mat: THREE.ShaderMaterial;
  life = 0; max = 1; flash = 0;
  constructor(clock: { value: number }) {
    const pos: number[] = [], uv: number[] = [], lay: number[] = [], idx: number[] = [];
    for (let l = 0; l < 3; l++) {
      const r = [1, 0.84, 0.6][l], y = l * 0.5, o = l * 4;
      pos.push(-r, y, -r, r, y, -r, r, y, r, -r, y, r); uv.push(0, 0, 1, 0, 1, 1, 0, 1); lay.push(l, l, l, l); idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aL', new THREE.Float32BufferAttribute(lay, 1));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { time: clock, on: { value: 0 }, flash: { value: 0 }, seed: { value: Math.random() * 40 }, color: { value: new THREE.Color() } },
      vertexShader: 'attribute float aL; varying vec2 vUv; varying float vL; void main(){ vUv = uv; vL = aL; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float time, on, flash, seed; uniform vec3 color; varying vec2 vUv; varying float vL;
        ${NOISE2}
        void main(){
          vec2 p = vUv * 2.0 - 1.0; float r = length(p);
          if (r > 1.0) discard;
          // the decks turn at different speeds and wind tighter toward the eye
          float ang = atan(p.y, p.x) + time * (0.5 + 0.22 * vL) + (1.0 - r) * (2.4 - 0.5 * vL);
          vec2 q = vec2(cos(ang), sin(ang)) * r * (2.4 + 0.9 * vL) + seed + vL * 7.3;
          float d = fbm(q + vec2(time * 0.15, 0.0));
          float mask = (1.0 - smoothstep(0.5, 1.0, r)) * smoothstep(0.06, 0.34 - 0.07 * vL, r);
          float dens = smoothstep(0.3, 0.68, d * 1.3) * mask * on;
          vec3 col = mix(vec3(0.02, 0.018, 0.045), vec3(0.15, 0.14, 0.25), smoothstep(0.42, 0.9, d) * (0.35 + 0.33 * vL));
          float fl = flash * (0.3 + 0.7 * vn(q * 1.9 + time * 4.0));
          gl_FragColor = vec4(col * dens * 0.9 + color * fl * dens * (0.25 + 0.9 * smoothstep(0.45, 0.85, d)), dens * 0.8);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      ...PREMULT, depthWrite: false, transparent: true, fog: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.visible = false; this.mesh.frustumCulled = false; this.mesh.renderOrder = 4;
  }
  start(x: number, y: number, z: number, r: number, life: number, color: number) {
    this.mesh.position.set(x, y, z); this.mesh.scale.set(r, r * 0.42, r); this.mesh.visible = true;
    this.life = this.max = life; this.flash = 0;
    (this.mat.uniforms.color.value as THREE.Color).setHex(color); this.mat.uniforms.seed.value = Math.random() * 40;
  }
  update(dt: number) {
    if (this.life <= 0) return;
    this.life -= dt;
    if (this.life <= 0) { this.mesh.visible = false; return; }
    const age = this.max - this.life;
    this.mat.uniforms.on.value = Math.min(1, age / 0.3) * Math.min(1, this.life / 0.9);
    this.flash *= Math.exp(-dt * 9);
    this.mat.uniforms.flash.value = this.flash;
  }
}

export class Fx {
  group = new THREE.Group();
  /** 1 on high quality, less on low: the specials scale their particle counts (Fx.n) and their camera shake by it */
  detail = 1;
  /** less motion asked for (prefers-reduced-motion, set by the view): flashes are smaller and shorter, glows on the deck half as bright */
  calm = false;
  private bolts = new Bolts(); private decals = new Decals(); private spikes = new Spikes(); private chunks = new Chunks(); private flares = new Flares();
  private clock = { value: 0 };
  /** three cells (three Arc Pylons firing together, before a Colossus), and a start count per slot so a cell taken over
   *  by a newer storm no longer flashes for the old one's late strikes (see thunder()) */
  private storms = [new Storm(this.clock), new Storm(this.clock), new Storm(this.clock)];
  private stormGen = [0, 0, 0];
  private N = 6000;
  private pos = new Float32Array(this.N * 3);
  private col = new Float32Array(this.N * 3);
  private size = new Float32Array(this.N);
  private vel = new Float32Array(this.N * 3);
  private base = new Float32Array(this.N * 3);
  private life = new Float32Array(this.N);
  private max = new Float32Array(this.N);
  private grav = new Float32Array(this.N);
  private cold = new Uint8Array(this.N);
  private sz0 = new Float32Array(this.N);
  private heat = new Float32Array(this.N).fill(1);
  private head = 0;
  private points: THREE.Points;
  private pmat: THREE.ShaderMaterial;
  // smoke
  private SN = 900;
  private spos = new Float32Array(this.SN * 3);
  private svel = new Float32Array(this.SN * 3);
  private sdat = new Float32Array(this.SN * 3); // size, alpha, shade
  private slife = new Float32Array(this.SN);
  private smax = new Float32Array(this.SN);
  private ssz = new Float32Array(this.SN);
  private salpha = new Float32Array(this.SN).fill(1);
  private shead = 0; private sactive = 0;
  private smoke_: THREE.Points;
  private smat: THREE.ShaderMaterial;
  private beams: Timed[] = [];
  private rings: Timed[] = [];
  private flashes: Timed[] = [];
  private scorches: Timed[] = [];
  private embers: Timed[] = [];
  private bi = 0; private ri = 0; private fi = 0; private si = 0; private ei = 0;
  // splinters of ice: one instanced mesh, flown on the CPU
  private HN = 512;
  private hpos = new Float32Array(this.HN * 3);
  private hvel = new Float32Array(this.HN * 3);
  private haxis = new Float32Array(this.HN * 3);
  private hdat = new Float32Array(this.HN * 5); // angle, turn rate, size, life, max life
  private hgy = new Float32Array(this.HN);
  private hfade: THREE.InstancedBufferAttribute;
  private hhead = 0; private hactive = 0;
  private shards: THREE.InstancedMesh;

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
        // fake top lighting: cool moonlit top, warm dark belly
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
    mk(BEAM_GEO, 300, this.beams, () => glowMat(1.8, 0.7));
    // a fine line: the tile-border ripple in the deck shader carries the area, not this
    const ring = new THREE.RingGeometry(0.968, 1, 96);
    ring.rotateX(-Math.PI / 2);
    mk(ring, 70, this.rings, basic({ blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    mk(new THREE.SphereGeometry(1, 16, 12), 40, this.flashes, () => glowMat(2.6, 0.34));
    const hg = shardGeometry();
    this.hfade = new THREE.InstancedBufferAttribute(new Float32Array(this.HN), 1);
    this.hfade.setUsage(THREE.DynamicDrawUsage);
    hg.setAttribute('aFade', this.hfade);
    this.shards = new THREE.InstancedMesh(hg, new THREE.ShaderMaterial({
      vertexShader: `attribute float aFade; varying vec3 vN, vV; varying float vF;
        void main(){ vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0); vN = normalMatrix * mat3(instanceMatrix) * normal; vV = -mv.xyz; vF = aFade; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vN, vV; varying float vF;
        ${ICE_SHADE}
        void main(){ float fres, spec; vec3 col = iceShade(normalize(vN), normalize(vV), 1.0, fres, spec);
          col += vec3(1.5, 1.6, 1.7) * spec + vec3(0.2, 0.3, 0.4) * vF;
          gl_FragColor = vec4(col, clamp(0.5 + 0.5 * fres + spec, 0.0, 1.0) * min(1.0, vF * 3.0));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, fog: false,
    }), this.HN);
    this.shards.count = 0; this.shards.visible = false; this.shards.frustumCulled = false; this.shards.renderOrder = 2;
    this.group.add(this.decals.mesh, this.smoke_, this.shards, this.spikes.mesh, this.chunks.mesh, this.points, this.bolts.mesh, ...this.storms.map((s) => s.mesh), this.flares.mesh);
    this.group.traverse((o) => o.layers.set(FX_LAYER));
  }

  /** heat: how white-hot the particle starts (1 = sparks; fire uses less so a stream of it does not burn out to white). */
  spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: number, grav = 0, heat = 1) {
    const i = this.head; this.head = (this.head + 1) % this.N;
    const j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    c1.setHex(color);
    this.base[j] = c1.r; this.base[j + 1] = c1.g; this.base[j + 2] = c1.b;
    this.life[i] = life; this.max[i] = life; this.sz0[i] = size; this.grav[i] = grav; this.heat[i] = heat;
    // cold colours (the Static, frost) fade as they are; warm ones cool down like hot metal
    this.cold[i] = c1.b > c1.r ? 1 : 0;
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
      this.salpha[i] = 1;
    }
    this.sactive = this.SN;
  }
  /** One small puff with a set lifetime (missile trails, vents). */
  puff(x: number, y: number, z: number, size: number, life: number, rise = 0.3) {
    const i = this.shead; this.shead = (this.shead + 1) % this.SN;
    const j = i * 3;
    this.spos[j] = x; this.spos[j + 1] = y; this.spos[j + 2] = z;
    this.svel[j] = (Math.random() - 0.5) * 0.5; this.svel[j + 1] = rise; this.svel[j + 2] = (Math.random() - 0.5) * 0.5;
    this.slife[i] = this.smax[i] = life;
    this.ssz[i] = size;
    this.sdat[j + 2] = 0.7 + Math.random() * 0.5;
    this.salpha[i] = 1;
    this.sactive = this.SN;
  }
  /** Cold mist: pale, thin, hugging the deck (what is left in the air when ice breaks). */
  mist(x: number, y: number, z: number, size: number, life = 1.1, alpha = 0.45) {
    const i = this.shead; this.shead = (this.shead + 1) % this.SN;
    const j = i * 3;
    this.spos[j] = x; this.spos[j + 1] = y; this.spos[j + 2] = z;
    this.svel[j] = (Math.random() - 0.5) * 1.1; this.svel[j + 1] = 0.12 + Math.random() * 0.25; this.svel[j + 2] = (Math.random() - 0.5) * 1.1;
    this.slife[i] = this.smax[i] = life * (0.8 + Math.random() * 0.4);
    this.ssz[i] = size;
    this.sdat[j + 2] = 2.6 + Math.random() * 0.5;
    this.salpha[i] = alpha;
    this.sactive = this.SN;
  }
  /** One splinter of ice, tumbling; it bounces once or twice on the deck at gy and melts away. */
  shard(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, gy = 0) {
    const i = this.hhead; this.hhead = (this.hhead + 1) % this.HN;
    const j = i * 3, k = i * 5;
    this.hpos[j] = x; this.hpos[j + 1] = y; this.hpos[j + 2] = z;
    this.hvel[j] = vx; this.hvel[j + 1] = vy; this.hvel[j + 2] = vz;
    v1.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.haxis[j] = v1.x; this.haxis[j + 1] = v1.y; this.haxis[j + 2] = v1.z;
    this.hdat[k] = Math.random() * 6.28; this.hdat[k + 1] = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 12); this.hdat[k + 2] = size; this.hdat[k + 3] = this.hdat[k + 4] = life;
    this.hgy[i] = gy;
    this.hactive = this.HN;
  }
  /** An ice shell of radius r bursts: splinters thrown outward, a puff of cold mist, a few frost sparks. gy = deck height under it. */
  shatter(x: number, y: number, z: number, r: number, gy = 0) {
    const n = Math.max(7, Math.min(18, Math.round(5 + r * 10)));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, up = Math.random() * 0.9 - 0.1, c = Math.sqrt(Math.max(0, 1 - up * up)), dx = Math.cos(a) * c, dz = Math.sin(a) * c, sp = 1.6 + Math.random() * 3.2;
      this.shard(x + dx * r * 0.7, y + up * r * 0.7, z + dz * r * 0.7, dx * sp, up * sp + 1.6 + Math.random() * 2.2, dz * sp, r * (i < 3 ? 0.3 + Math.random() * 0.16 : 0.1 + Math.random() * 0.14), 0.75 + Math.random() * 0.6, gy);
    }
    this.mist(x, y, z, r * 1.7, 0.9, 0.8);
    for (let i = 0; i < 2; i++) this.mist(x + (Math.random() - 0.5) * r * 1.4, gy + 0.2, z + (Math.random() - 0.5) * r * 1.4, r * 2.1, 1.6, 0.55);
    this.burst(x, y, z, 12, 2.6 + r, 0xbfe6ff, 0.5, 0.13, 6);
    if (r > 0.85) this.ring(x, gy + 0.1, z, r * 2.2, 0x9fd4f0, 0.4, 0.3, 0.7);
  }
  /** Sparks thrown in a cone round a direction (what an arrow knocks out of the far side of a hull). */
  spray(x: number, y: number, z: number, dx: number, dy: number, dz: number, n: number, speed: number, color: number, life = 0.35, size = 0.2, spread = 0.4) {
    for (let i = 0; i < n; i++) {
      const sp = speed * (0.35 + Math.random() * 0.65);
      this.spark(x, y, z, (dx + (Math.random() - 0.5) * 2 * spread) * sp, (dy + (Math.random() - 0.5) * 2 * spread) * sp + 0.8, (dz + (Math.random() - 0.5) * 2 * spread) * sp,
        life * (0.5 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), color, 9);
    }
  }
  /** Short straight rays out of one point (a weak-point hit). */
  star(x: number, y: number, z: number, r: number, color: number, n = 6, life = 0.22) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1), l = r * (0.6 + Math.random() * 0.6);
      const dx = Math.sin(b) * Math.cos(a), dy = Math.cos(b), dz = Math.sin(b) * Math.sin(a);
      this.beam(x + dx * r * 0.15, y + dy * r * 0.15, z + dz * r * 0.15, x + dx * l, y + dy * l, z + dz * l, color, 0.07, life * (0.7 + Math.random() * 0.6));
    }
  }
  /** Short-lived ground decal: a dark scorch that lingers plus a hot glow that cools quickly. gy = deck height. */
  scorch(x: number, z: number, r: number, color = 0xff7a2a, life = 6, gy = 0) {
    const s = this.scorches[this.si]; this.si = (this.si + 1) % this.scorches.length;
    s.mesh.position.set(x, gy + 0.022 + this.si * 0.0006, z); s.mesh.scale.setScalar(r * 1.15); s.mesh.rotation.y = Math.random() * 6.28;
    s.life = s.max = life * (0.8 + Math.random() * 0.4); s.mesh.visible = true;
    const e = this.embers[this.ei]; this.ei = (this.ei + 1) % this.embers.length;
    e.mesh.position.set(x, gy + 0.05 + this.ei * 0.0006, z); e.mesh.scale.setScalar(r * 0.95);
    e.color.setHex(color).lerp(c1.setHex(0xff5a14), 0.55); e.life = e.max = 0.9; e.mesh.visible = true;
  }
  /** Rime on the deck: a pale cold bloom that stays a moment where the cold struck. gy = deck height. */
  frost(x: number, z: number, r: number, life = 1.4, gy = 0, gain = 0.5) {
    const e = this.embers[this.ei]; this.ei = (this.ei + 1) % this.embers.length;
    e.mesh.position.set(x, gy + 0.05 + this.ei * 0.0006, z); e.mesh.scale.setScalar(r);
    e.color.setHex(0x6fb8e8).multiplyScalar(gain); e.life = e.max = life; e.mesh.visible = true;
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
  /** Flat ring that runs from r * r0 to r (r0 above 1 makes it close in instead of spreading). */
  ring(x: number, y: number, z: number, r: number, color: number, life = 0.45, r0 = 0.15, gain = 1) {
    const g = this.rings[this.ri]; this.ri = (this.ri + 1) % this.rings.length;
    g.mesh.position.set(x, y, z);
    g.color.setHex(color).multiplyScalar(gain); g.life = g.max = life; g.r0 = r * r0; g.r1 = r;
    g.mesh.visible = true;
  }
  flash(x: number, y: number, z: number, r: number, color: number, life = 0.25) {
    if (this.calm) { r *= 0.6; life *= 0.7; }
    const g = this.flashes[this.fi]; this.fi = (this.fi + 1) % this.flashes.length;
    g.mesh.position.set(x, y, z);
    g.color.setHex(color); g.life = g.max = life; g.r0 = r * 0.3; g.r1 = r;
    g.mesh.visible = true;
  }
  /** Standard explosion: brief flash, hot sparks that cool to embers, smoke, and a scorch mark. gy = deck height under it. */
  boom(x: number, y: number, z: number, r: number, color: number, small = false, gy = 0) {
    this.ring(x, gy + 0.12, z, r, color, small ? 0.26 : 0.42);
    this.flash(x, y, z, r * (small ? 0.4 : 0.5), color, small ? 0.14 : 0.22);
    this.burst(x, y + 0.2, z, small ? 6 : 16, r * 4, color, small ? 0.35 : 0.6, small ? 0.24 : 0.36, 9);
    this.burst(x, y + 0.2, z, small ? 3 : 12, r * 3.2, 0xffb45a, small ? 0.4 : 0.8, 0.22, 12);
    if (!small) { this.smoke(x, y + 0.4, z, 5, r * 0.75, r * 0.7); this.scorch(x, z, r * 0.85, color, 6, gy); }
    else if (y - gy < 1.5) this.scorch(x, z, r * 0.6, color, 3, gy);
  }
  column(x: number, y: number, z: number, color: number, h = 30) {
    this.beam(x, y, z, x, y + h, z, color, 0.5, 0.55);
    this.ring(x, y + 0.1, z, 3.2, color, 0.55);
    this.burst(x, y + 1, z, 28, 8, color, 0.7, 0.34, 2, 1.2);
    this.smoke(x, y + 0.3, z, 4, 1.3, 1.6, 0.6);
  }

  // ---------- the specials' kit ----------
  /** A count scaled by the quality setting (never below 1). */
  n(n: number) { return Math.max(1, Math.round(n * this.detail)); }
  /** One straight segment of light (instanced). delay: seconds before it shows. */
  bolt(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: number, width = 0.1, life = 0.2, delay = 0, gain = 1) {
    this.bolts.add(ax, ay, az, bx, by, bz, color, width, life, delay, gain);
  }
  /**
   * A bolt of lightning from a to b: a jagged path with forks, drawn with a hot core. step = seconds between one segment
   * and the next (0: all at once; above 0 it steps its way from a to b like a leader), jag = how wild the path is,
   * forks = how many side branches to expect. Returns the delay at which its far end shows.
   */
  lightning(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: number, width = 0.12, life = 0.25, delay = 0, step = 0, jag = 1, forks = 2, core = true, depth = 0): number {
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz) || 0.001, n = Math.max(3, Math.min(22, Math.round(L / 0.85)));
    const tx = dx / L, ty = dy / L, tz = dz / L;
    // two directions across the path
    let ux: number, uy: number, uz: number;
    if (Math.abs(ty) < 0.9) { const l = Math.hypot(tz, tx) || 1; ux = tz / l; uy = 0; uz = -tx / l; } else { ux = 1; uy = 0; uz = 0; }
    const wx = ty * uz - tz * uy, wy = tz * ux - tx * uz, wz = tx * uy - ty * ux;
    const amp = jag * Math.min(0.85, L * 0.075), hot = core ? c1.setHex(color).lerp(WHITE, 0.6).getHex() : 0;
    let px = ax, py = ay, pz = az, ou = 0, ow = 0;
    for (let s = 1; s <= n; s++) {
      const t = s / n, taper = s === n ? 0 : Math.pow(Math.sin(Math.PI * t), 0.6), d = delay + s * step;
      ou = ou * 0.55 + (Math.random() - 0.5) * 2 * amp; ow = ow * 0.55 + (Math.random() - 0.5) * 2 * amp;
      const nx = ax + dx * t + (ux * ou + wx * ow) * taper, ny = ay + dy * t + (uy * ou + wy * ow) * taper, nz = az + dz * t + (uz * ou + wz * ow) * taper;
      this.bolts.add(px, py, pz, nx, ny, nz, color, width, life, d, 1);
      if (core) this.bolts.add(px, py, pz, nx, ny, nz, hot, width * 0.34, life * 0.85, d, 1.5);
      if (forks > 0 && depth < 2 && s < n && Math.random() < forks / n) {
        // a side branch: off to one side and a little downward, shorter and thinner, branching again now and then
        const fl = L * (0.14 + Math.random() * 0.24) * (1 - t * 0.5), a = (Math.random() - 0.5) * 1.7, b = (Math.random() - 0.5) * 1.7;
        let fx = tx * 0.6 + ux * a + wx * b, fy = ty * 0.6 + uy * a + wy * b - 0.35, fz = tz * 0.6 + uz * a + wz * b;
        const l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
        this.lightning(nx, ny, nz, nx + fx * fl, Math.max(0.05, ny + fy * fl), nz + fz * fl, color, width * 0.5, life * 0.8, d, step, jag, forks * 0.6, false, depth + 1);
      }
      px = nx; py = ny; pz = nz;
    }
    return delay + n * step;
  }
  /** A soft-backed shock front on the deck that runs out to r (width = its share of r). */
  wave(x: number, y: number, z: number, r: number, color: number, life = 0.5, r0 = 0.1, width = 0.14, gain = 1, delay = 0) { this.decals.add(D_SHOCK, x, y, z, 0, 1, 0, r, color, life, gain, r0, width, 0, delay); }
  /** A front of frost that races out to r within `front` seconds and leaves needles of rime behind it for the rest of `life`. */
  frostWave(x: number, y: number, z: number, r: number, life = 3, gain = 1, front = 0.35) { this.decals.add(D_FROST, x, y + 0.04, z, 0, 1, 0, r, 0x86cdf6, life, gain, Math.max(0.02, front / life), 0, 0, 0); }
  /** The burn a lightning strike leaves on the deck: branches that glow and cool to a char. */
  lichten(x: number, y: number, z: number, r: number, color: number, life = 5, gain = 1, delay = 0) { this.decals.add(D_LICHT, x, y + 0.03, z, 0, 1, 0, r, color, life, gain, 0, 0, 0, delay); }
  /** A crater: a charred bowl with cracks that glow while it is fresh. */
  crater(x: number, y: number, z: number, r: number, color: number, life = 7, gain = 1) { this.decals.add(D_CRATER, x, y + 0.03, z, 0, 1, 0, r, color, life, gain, 0, 0, 0, 0); }
  /** A target mark on the deck: a ring that closes on the spot, turning brackets, a cross. */
  mark(x: number, y: number, z: number, r: number, color: number, life = 0.9, gain = 1) { this.decals.add(D_MARK, x, y + 0.05, z, 0, 1, 0, r, color, life, gain, 0, 0, 0, 0); }
  /** The light goes out of a patch of deck for a while (gain: how dark). */
  shade(x: number, y: number, z: number, r: number, life: number, gain = 0.6) { this.decals.add(D_SHADE, x, y + 0.04, z, 0, 1, 0, r, 0, life, gain, 0, 0, 0, 0); }
  /** A pool of light on the deck that dies away. */
  glow(x: number, y: number, z: number, r: number, color: number, life = 0.4, gain = 1, delay = 0) { if (this.calm) gain *= 0.5; this.decals.add(D_GLOW, x, y + 0.05, z, 0, 1, 0, r, color, life, gain, 0, 0, 0, delay); }
  /** A thin ring facing (nx, ny, nz) that runs from radius r0 to r1 (r1 below r0: it closes). */
  hoop(x: number, y: number, z: number, nx: number, ny: number, nz: number, r0: number, r1: number, color: number, life = 0.4, thick = 0.07, gain = 1, delay = 0) {
    const R = Math.max(r0, r1, 0.001);
    this.decals.add(D_HOOP, x, y, z, nx, ny, nz, R / 0.97, color, life, gain, (r0 / R) * 0.97, (r1 / R) * 0.97, Math.min(0.4, thick / R), delay);
  }
  /** A spike of ice driven up out of the deck: h tall, w wide, leaning `lean` rad toward heading `yaw`; it stands `life` seconds. */
  spike(x: number, y: number, z: number, h: number, w: number, lean = 0, yaw = 0, life = 2.5, delay = 0) { this.spikes.add(x, y, z, h, w, lean, yaw, life, delay); }
  /** A small solid bit that tumbles and bounces on the deck at gy (stretch above 1: a casing, 1: a lump). gain above 1 makes it glow. */
  chunk(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, color: number, gy = 0, stretch = 1, gain = 1) { this.chunks.add(x, y, z, vx, vy, vz, size, stretch, life, color, gain, gy); }
  /** A point of light with a lens star. key at or above 0: one light fed every frame (it moves and holds instead of stacking). */
  flare(x: number, y: number, z: number, size: number, color: number, life = 0.2, gain = 1, key = -1) { this.flares.add(x, y, z, size, color, life, gain, key); }
  /** A storm cell of radius r with its base at height y, for `life` seconds (in the free slot, else the one with least
   *  life left). Returns a handle for thunder(): the slot and its start count. */
  storm(x: number, y: number, z: number, r: number, life: number, color: number): number {
    let i = 0;
    for (let k = 1; k < this.storms.length; k++) if (this.storms[k].life < this.storms[i].life) i = k;
    this.storms[i].start(x, y, z, r, life, color);
    return i + 4 * ++this.stormGen[i];
  }
  /** Lightning flickers inside the storm cell `h` (from storm()); nothing once its slot holds a newer storm. */
  thunder(h: number, amount = 1) { const i = h & 3, s = this.storms[i]; if (s && h >> 2 === this.stormGen[i] && s.life > 0) s.flash = Math.max(s.flash, amount); }

  update(dt: number, camera: THREE.PerspectiveCamera, viewH: number) {
    this.clock.value += dt;
    this.bolts.update(dt); this.decals.update(dt); this.spikes.update(dt); this.chunks.update(dt); this.flares.update(dt);
    for (const s of this.storms) s.update(dt);
    const scale = viewH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    this.pmat.uniforms.scale.value = scale; this.smat.uniforms.scale.value = scale;
    const { pos, vel, col, base, life, max, size, sz0, grav, cold, heat } = this;
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
      const f = Math.max(0, life[i] / max[i]), hot = f * f * f * 0.75 * heat[i];
      if (cold[i]) { col[j] = base[j] * f + hot * 0.8; col[j + 1] = base[j + 1] * f + hot * 0.9; col[j + 2] = base[j + 2] * f + hot; }
      else { col[j] = base[j] * f + hot; col[j + 1] = base[j + 1] * f * (0.4 + 0.6 * f) + hot * 0.85; col[j + 2] = base[j + 2] * f * (0.15 + 0.85 * f) + hot * 0.6; }
      size[i] = sz0[i] * (0.3 + 0.55 * f);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true;

    if (this.sactive > 0) {
      const { spos, svel, sdat, slife, smax, ssz, salpha } = this;
      let alive = 0;
      for (let i = 0; i < this.SN; i++) {
        const j = i * 3;
        if (slife[i] <= 0) { if (sdat[j] !== 0) sdat[j] = 0; continue; }
        slife[i] -= dt; alive++;
        const f = Math.max(0, slife[i] / smax[i]), age = 1 - f;
        svel[j] *= 1 - 0.8 * dt; svel[j + 2] *= 1 - 0.8 * dt;
        spos[j] += svel[j] * dt; spos[j + 1] += svel[j + 1] * dt; spos[j + 2] += svel[j + 2] * dt;
        sdat[j] = ssz[i] * (0.7 + age * 2.1);
        sdat[j + 1] = Math.min(1, age * 7) * f * f * 0.5 * salpha[i];
      }
      this.sactive = alive;
      const sg = this.smoke_.geometry;
      sg.attributes.position.needsUpdate = true; sg.attributes.dat.needsUpdate = true;
    }
    this.smoke_.visible = this.sactive > 0;

    if (this.hactive > 0) {
      const { hpos, hvel, haxis, hdat, hgy } = this, fade = this.hfade.array as Float32Array;
      let n = 0;
      for (let i = 0; i < this.HN; i++) {
        const k = i * 5;
        if (hdat[k + 3] <= 0) continue;
        hdat[k + 3] -= dt;
        const j = i * 3, f = Math.max(0, hdat[k + 3] / hdat[k + 4]);
        hvel[j + 1] -= 13 * dt;
        hpos[j] += hvel[j] * dt; hpos[j + 1] += hvel[j + 1] * dt; hpos[j + 2] += hvel[j + 2] * dt;
        const floor = hgy[i] + hdat[k + 2] * 0.2;
        if (hpos[j + 1] < floor && hvel[j + 1] < 0) { hpos[j + 1] = floor; hvel[j + 1] *= -0.38; hvel[j] *= 0.55; hvel[j + 2] *= 0.55; hdat[k + 1] *= 0.5; }
        hdat[k] += hdat[k + 1] * dt;
        M4.compose(v1.set(hpos[j], hpos[j + 1], hpos[j + 2]), Q4.setFromAxisAngle(v2.set(haxis[j], haxis[j + 1], haxis[j + 2]), hdat[k]), v2.setScalar(hdat[k + 2] * (0.35 + 0.65 * Math.min(1, f * 2.5))));
        this.shards.setMatrixAt(n, M4); fade[n] = f; n++;
      }
      this.hactive = n; this.shards.count = n;
      if (n) { this.shards.instanceMatrix.needsUpdate = true; this.hfade.needsUpdate = true; }
    }
    this.shards.visible = this.hactive > 0;

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
      r.tint.copy(r.color).multiplyScalar(f * f * 0.7);
      r.mesh.scale.setScalar(s);
    }
    for (const r of this.flashes) {
      if (!r.mesh.visible) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      const f = r.life / r.max;
      r.tint.copy(r.color).multiplyScalar(f * 1.25);
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
