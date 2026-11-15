// Post-processing chain for the 'high' quality path:
//   scene (HDR, MSAA) -> [GTAO] -> restrained bloom -> tone map + sRGB -> grade / vignette / grain.
// The 'low' path never touches this file's passes: View renders straight to the canvas.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

/** Final display-space pass: filmic grade (split tone, gentle S-curve, slight desaturation), vignette, grain. */
const GradeShader = {
  name: 'EmberGrade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    res: { value: new THREE.Vector2(1, 1) },
    grain: { value: 0.035 },
    vignette: { value: 0.42 },
    saturation: { value: 0.9 },
    contrast: { value: 0.32 },
    shadowTint: { value: new THREE.Vector3(0.0, 0.012, 0.03) },
    highTint: { value: new THREE.Vector3(1.04, 1.0, 0.94) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, grain, vignette, saturation, contrast; uniform vec2 res;
    uniform vec3 shadowTint, highTint; varying vec2 vUv;
    float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      // a whisper of lens fringing, only toward the corners
      vec2 o = d * r2 * 0.0045;
      vec3 c = vec3(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation);
      // split tone: cool shadows, warm highlights
      c += shadowTint * (1.0 - smoothstep(0.0, 0.45, l));
      c *= mix(vec3(1.0), highTint, smoothstep(0.35, 0.95, l));
      // gentle S-curve
      c = mix(c, c * c * (3.0 - 2.0 * c), contrast);
      // vignette (aspect-aware, soft)
      vec2 v = d * vec2(1.0, res.y / res.x * 1.25 + 0.2);
      c *= 1.0 - vignette * smoothstep(0.12, 0.62, dot(v, v));
      // film grain, stronger in the mid-shadows; also dithers the dark gradients
      float n = hash(gl_FragCoord.xy + fract(time * 7.13) * 311.0) - 0.5;
      c += n * grain * (1.0 - l * 0.6);
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

export class Post {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  ao: GTAOPass | null = null;
  grade: ShaderPass;
  /** Rolling average of the frame time on the high path; AO switches itself off if the GPU cannot keep up. */
  private slow = 0;
  private last = 0;
  aoAllowed = true;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, fxLayer: number) {
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));

    const ao = new GTAOPass(scene, camera, 4, 4);
    ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 1.2, scale: 1.25, samples: 8, screenSpaceRadius: false });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1.5, rings: 2, samples: 8 });
    ao.blendIntensity = 0.85;
    // The AO pre-pass re-renders the scene with a normal material: keep transparent / unlit
    // effects (beams, particles, bars, decals, sky) out of it by dropping their layer for its duration.
    const baseRender = ao.render.bind(ao);
    ao.render = (...args: Parameters<GTAOPass['render']>) => {
      const mask = camera.layers.mask;
      camera.layers.disable(fxLayer);
      const bg = scene.background; scene.background = null;
      try { baseRender(...args); } finally { camera.layers.mask = mask; scene.background = bg; }
    };
    this.ao = ao;
    this.composer.addPass(ao);

    // threshold is in linear HDR: lit surfaces stay under it, only emissives / fx cross it
    this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.42, 0.62, 1.05);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  setAO(on: boolean) { this.aoAllowed = on; if (this.ao) this.ao.enabled = on; }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    (this.grade.uniforms.res.value as THREE.Vector2).set(w * pr, h * pr);
    // ambient occlusion is low frequency: half resolution is plenty and costs a quarter
    if (this.ao) this.ao.setSize(Math.max(2, Math.round((w * pr) / 2)), Math.max(2, Math.round((h * pr) / 2)));
  }

  render(dt: number, time: number) {
    this.grade.uniforms.time.value = time;
    // wall-clock guard: shed AO if we sit below ~45 fps for a few seconds (tab switches are ignored)
    const now = performance.now(), real = (now - this.last) / 1000;
    this.last = now;
    if (this.ao && this.ao.enabled && real < 0.25) {
      this.slow = real > 0.022 ? this.slow + real : Math.max(0, this.slow - real * 0.5);
      if (this.slow > 4) { this.ao.enabled = false; this.aoAllowed = false; }
    }
    this.composer.render(dt);
  }
}
