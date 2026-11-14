// Small procedural-texture helpers shared by world / fx / render. Everything is generated
// at runtime on 2D canvases: no external assets.
import * as THREE from 'three';

/** Deterministic PRNG (Park-Miller) so the generated art is identical every run. */
export function rng(seed: number) {
  let s = seed % 2147483647; if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** Trace a pointy-top hexagon (corners up and down) with circumradius r into the current path. */
export function hexPath(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (i) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.closePath();
}

/** Tileable grey value-noise canvas (used as an overlay for grit). */
export function noiseCanvas(size: number, seed: number, contrast = 1): HTMLCanvasElement {
  const [c, g] = canvas(size, size), r = rng(seed);
  const img = g.createImageData(size, size), d = img.data;
  for (let i = 0; i < size * size; i++) {
    const v = Math.max(0, Math.min(255, 128 + (r() + r() + r() - 1.5) * 110 * contrast));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Soft cloudy noise: several octaves of upscaled noise blended together (not tileable). */
export function cloudCanvas(size: number, seed: number): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  g.fillStyle = '#808080'; g.fillRect(0, 0, size, size);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  let n = 4;
  for (let o = 0; o < 5; o++, n *= 2) {
    const src = noiseCanvas(n, seed + o * 17, 1.6);
    g.globalAlpha = 0.5 / (o * 0.7 + 1);
    g.drawImage(src, 0, 0, n, n, 0, 0, size, size);
  }
  g.globalAlpha = 1;
  return c;
}

/** Tangent-space normal map from a greyscale height canvas (Sobel). */
export function normalFromHeight(src: HTMLCanvasElement, strength: number, wrap = false): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const s = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h), d = img.data;
  const at = (x: number, y: number) => {
    if (wrap) { x = (x + w) % w; y = (y + h) % h; } else { x = x < 0 ? 0 : x >= w ? w - 1 : x; y = y < 0 ? 0 : y >= h ? h - 1 : y; }
    return s[(y * w + x) * 4];
  };
  const k = strength / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * k, dy = (at(x, y + 1) - at(x, y - 1)) * k;
    const l = 1 / Math.sqrt(dx * dx + dy * dy + 1), i = (y * w + x) * 4;
    d[i] = (-dx * l * 0.5 + 0.5) * 255; d[i + 1] = (dy * l * 0.5 + 0.5) * 255; d[i + 2] = (l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Pack two greyscale canvases into one texture canvas: G = roughness, B = metalness (three's ORM layout). */
export function packRM(rough: HTMLCanvasElement, metal: HTMLCanvasElement): HTMLCanvasElement {
  const w = rough.width, h = rough.height;
  const [c, g] = canvas(w, h);
  const [t, tg] = canvas(w, h);
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  for (const [src, tint] of [[rough, '#00ff00'], [metal, '#0000ff']] as [HTMLCanvasElement, string][]) {
    tg.globalCompositeOperation = 'source-over'; tg.drawImage(src, 0, 0);
    tg.globalCompositeOperation = 'multiply'; tg.fillStyle = tint; tg.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter'; g.drawImage(t, 0, 0);
  }
  return c;
}

let glowTex: THREE.Texture | null = null;
/** Soft radial falloff (white centre -> black edge) for additive light pools and glows. */
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.15, '#b9b9b9'); gr.addColorStop(0.4, '#484848'); gr.addColorStop(0.7, '#101010'); gr.addColorStop(1, '#000000');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/** Flat additive ground light pool. No fog: fog on an additive material tints the whole quad and shows its square outline. */
export function lightPool(radius: number, color: THREE.ColorRepresentation, intensity = 1): THREE.Mesh {
  const m = new THREE.Mesh(POOL_GEO, new THREE.MeshBasicMaterial({ map: glowTexture(), color: new THREE.Color(color).multiplyScalar(intensity), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: true, fog: false }));
  m.scale.setScalar(radius);
  return m;
}
const POOL_GEO = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
export { POOL_GEO };
