// Static environment: neon board, city skyline, sky, lights.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, GW, GH, PATH_CELLS, CORE_CELL, cellX, cellZ } from './data.ts';
import { BASE_GRID } from './sim.ts';

const PX = 64;

function boardTextures() {
  const W = GW * PX, H = GH * PX;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const col = mk(), emi = mk();
  const a = col.getContext('2d')!, e = emi.getContext('2d')!;
  a.fillStyle = '#0a1022'; a.fillRect(0, 0, W, H);
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  // build tiles
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
    if (BASE_GRID[cz * GW + cx]) continue;
    const x = cx * PX, y = cz * PX;
    const g = a.createLinearGradient(x, y, x + PX, y + PX);
    g.addColorStop(0, '#22335f'); g.addColorStop(1, '#16213f');
    a.fillStyle = g;
    a.beginPath(); a.roundRect(x + 3, y + 3, PX - 6, PX - 6, 7); a.fill();
    a.strokeStyle = '#3b5aa0'; a.lineWidth = 2; a.stroke();
    // corner ticks
    for (const ctx of [a, e]) {
      ctx.strokeStyle = ctx === a ? '#5c8cf0' : '#12305e'; ctx.lineWidth = 2;
      ctx.beginPath();
      const m = 8, l = 8;
      ctx.moveTo(x + m, y + m + l); ctx.lineTo(x + m, y + m); ctx.lineTo(x + m + l, y + m);
      ctx.moveTo(x + PX - m, y + PX - m - l); ctx.lineTo(x + PX - m, y + PX - m); ctx.lineTo(x + PX - m - l, y + PX - m);
      ctx.stroke();
    }
  }
  // path
  const pts = PATH_CELLS.map(([cx, cz]) => [(cx + 0.5) * PX, (cz + 0.5) * PX]);
  const stroke = (ctx: CanvasRenderingContext2D, w: number, style: string, dash: number[] = []) => {
    ctx.lineJoin = 'round'; ctx.lineCap = 'butt'; ctx.lineWidth = w; ctx.strokeStyle = style; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke(); ctx.setLineDash([]);
  };
  stroke(a, PX * 0.98, '#19e3ff'); stroke(a, PX * 0.86, '#05070f'); stroke(a, PX * 0.8, '#0a0e1c');
  stroke(a, 3, '#ff2bd6', [14, 22]);
  stroke(e, PX * 0.98, '#19e3ff'); stroke(e, PX * 0.86, '#000'); stroke(e, 3, '#7a1466', [14, 22]);
  // core pad
  const kx = (CORE_CELL[0] + 0.5) * PX, ky = (CORE_CELL[1] + 0.5) * PX;
  for (const ctx of [a, e]) {
    ctx.fillStyle = ctx === a ? '#0a1224' : '#000';
    ctx.beginPath(); ctx.arc(kx, ky, PX * 1.45, 0, 7); ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = '#35f0ff'; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = ctx === a ? '#35f0ff' : '#1a7a88';
    ctx.beginPath(); ctx.arc(kx, ky, PX * 1.15, 0, 7); ctx.stroke();
  }
  const tex = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  return { map: tex(col), emissiveMap: tex(emi) };
}

function gridTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#04060e'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#10305a'; g.lineWidth = 2; g.strokeRect(1, 1, 254, 254);
  g.strokeStyle = '#0a1830'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(60, 60); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function windowTextures() {
  const S = 256, c = document.createElement('canvas'), e = document.createElement('canvas');
  c.width = c.height = e.width = e.height = S;
  const a = c.getContext('2d')!, b = e.getContext('2d')!;
  a.fillStyle = '#070912'; a.fillRect(0, 0, S, S);
  b.fillStyle = '#000'; b.fillRect(0, 0, S, S);
  const cols = ['#19e3ff', '#ff2bd6', '#ffd23f', '#9fd8ff', '#a35bff', '#ff8a1f'];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (x === 0 && y === 15) continue; // keep the (0,0) uv corner dark for roofs
    const lit = Math.random() < 0.42;
    const col = lit ? cols[Math.floor(Math.random() * Math.random() * cols.length)] : '#0c1020';
    a.fillStyle = col; a.fillRect(x * 16 + 3, y * 16 + 4, 10, 8);
    if (lit) { b.globalAlpha = 0.35 + Math.random() * 0.65; b.fillStyle = col; b.fillRect(x * 16 + 3, y * 16 + 4, 10, 8); b.globalAlpha = 1; }
  }
  const mk = (cv: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; return t; };
  return { map: mk(c), emissiveMap: mk(e) };
}

function skyline() {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const geos: THREE.BufferGeometry[] = [], neon: THREE.BufferGeometry[] = [];
  const hx = (GW * CELL) / 2, hz = (GH * CELL) / 2;
  for (let i = 0; i < 230; i++) {
    const ang = rnd() * Math.PI * 2, rad = 34 + rnd() * rnd() * 170;
    // place on an expanding rounded rectangle around the board
    const x = Math.cos(ang) * (hx + rad), z = Math.sin(ang) * (hz + rad);
    const w = 8 + rnd() * 16, d = 8 + rnd() * 16, h = 6 + rnd() * rnd() * 70 + (rad - 34) * 0.3;
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const ou = Math.floor(rnd() * 16) / 16, ov = Math.floor(rnd() * 16) / 16;
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
      const k = f * 4 + v;
      if (f === 2 || f === 3) { uv.setXY(k, 0.01, 0.01); continue; }
      const fw = f < 2 ? d : w;
      uv.setXY(k, ou + (uv.getX(k) * Math.round(fw / 0.9)) / 16, ov + (uv.getY(k) * Math.round(h / 1.3)) / 16);
    }
    g.translate(x, h / 2 - 1, z);
    geos.push(g);
    if (rnd() < 0.45) {
      const n = new THREE.BoxGeometry(w * (0.3 + rnd() * 0.7), 0.5 + rnd() * 1.2, 0.4);
      const col = new THREE.Color([0x19e3ff, 0xff2bd6, 0xffd23f, 0xa35bff][Math.floor(rnd() * 4)]);
      const ca = new Float32Array(n.attributes.position.count * 3);
      for (let k = 0; k < ca.length; k += 3) { ca[k] = col.r; ca[k + 1] = col.g; ca[k + 2] = col.b; }
      n.setAttribute('color', new THREE.BufferAttribute(ca, 3));
      n.lookAt(new THREE.Vector3(-x, 0, -z).normalize());
      const s = Math.max(w, d) / 2 + 0.3, len = Math.hypot(x, z);
      n.translate(x - (x / len) * s, h * (0.35 + rnd() * 0.6), z - (z / len) * s);
      neon.push(n);
    }
  }
  const mat = new THREE.MeshStandardMaterial({ ...windowTextures(), emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.6, metalness: 0.3 });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mergeGeometries(geos), mat));
  g.add(new THREE.Mesh(mergeGeometries(neon), new THREE.MeshBasicMaterial({ vertexColors: true })));
  return g;
}

export function buildWorld(scene: THREE.Scene) {
  scene.fog = new THREE.FogExp2(0x0a0820, 0.0075);
  scene.background = new THREE.Color(0x05040f);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(600, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; void main(){ float h=normalize(vP).y; vec3 lo=vec3(0.30,0.05,0.34), mid=vec3(0.05,0.04,0.16), hi=vec3(0.01,0.01,0.04);
        vec3 c=mix(lo,mid,smoothstep(-0.05,0.22,h)); c=mix(c,hi,smoothstep(0.2,0.8,h)); gl_FragColor=vec4(c,1.0); }`,
    }),
  );
  scene.add(sky);

  scene.add(new THREE.HemisphereLight(0x8fa8ff, 0x2a1040, 1.5));
  const sun = new THREE.DirectionalLight(0xcfe0ff, 2.2);
  sun.position.set(-22, 46, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -34; sc.right = 34; sc.top = 26; sc.bottom = -26; sc.near = 5; sc.far = 120;
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xff3bd0, 0.45);
  fill.position.set(30, 18, -24);
  scene.add(fill);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ map: gridTexture(), roughness: 0.75, metalness: 0.15, color: 0x8899bb }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.42; ground.receiveShadow = true;
  scene.add(ground);

  const bw = GW * CELL, bh = GH * CELL;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(bw + 1.2, 0.4, bh + 1.2), new THREE.MeshStandardMaterial({ color: 0x0c1226, roughness: 0.4, metalness: 0.7 }));
  slab.position.y = -0.21; slab.receiveShadow = true;
  scene.add(slab);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(bw + 1.5, 0.08, bh + 1.5), new THREE.MeshBasicMaterial({ color: 0x19e3ff }));
  edge.position.y = -0.36;
  scene.add(edge);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshStandardMaterial({ ...boardTextures(), emissive: 0xffffff, emissiveIntensity: 1.25, roughness: 0.5, metalness: 0.35 }));
  board.rotation.x = -Math.PI / 2; board.receiveShadow = true;
  scene.add(board);

  scene.add(skyline());

  // spawn gate
  const gx = cellX(-0.6), gz = cellZ(PATH_CELLS[0][1]);
  const gate = new THREE.Group();
  const gm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3b1f).multiplyScalar(2.2) });
  const arch = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.12, 8, 40), gm);
  arch.rotation.y = Math.PI / 2; arch.position.y = 1.3;
  gate.add(arch);
  const veil = new THREE.Mesh(new THREE.CircleGeometry(1.65, 32), new THREE.MeshBasicMaterial({ color: 0x55100a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  veil.rotation.y = Math.PI / 2; veil.position.y = 1.3;
  gate.add(veil);
  const hull = new THREE.MeshStandardMaterial({ color: 0x14161f, roughness: 0.4, metalness: 0.8 });
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.4, 0.7), hull); p.position.set(0, 1.5, s * 1.95); p.castShadow = true; gate.add(p); }
  gate.position.set(gx, 0, gz);
  scene.add(gate);

  return { sun, gate, arch };
}
