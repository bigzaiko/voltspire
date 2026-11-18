// In-world feedback for placing things and for the state of their supply, drawn in the language of the range ring and the
// reticles: thin luminous lines, additive, on the effects layer. Three instanced meshes, one draw call each, and nothing
// is written per frame: every cue carries its own start and end time and the shaders animate it from one clock (the
// view's own, so it runs while the factory stands still between waves).
//
//  - rings (a flat quad per cue on the deck, the shape drawn in the fragment shader): the hex pulse of a placement, the
//    calm green ring of something supplied, the broken rust ring of something that lacks an input, amber arrows running
//    off a building nobody takes from, the brackets on a route's source, the lock that closes when a route arrives, belt
//    end caps, the tutorial's "build here" target and path chevrons, the tiles a pole or generator reaches (a soft fill a
//    scan line sweeps over), the brackets that close on what it will power, and the crackling ring of a tower that is
//    stunned or jammed;
//  - lines (screen-space ribbons along a polyline): the pulse that runs along the real supply route (from the producer
//    through the Transfer Arms and along the belts between them, pipes through the network to the pump, wires pole to
//    pole to the generator), and the flowing dashes of the route a ghost would get (wires to be, the pipe network a pipe
//    would join, a tunnel's hidden run, the way an arm would carry things), the outline of a reach. A second, faint pass
//    draws the pulses and routes where a tower or building hides them;
//  - holograms (the belt item shapes, a bolt, a drop, a mite): what is missing or what holds a tower down, floating over it.
//
// What a tower or building needs and what it lacks comes from Sim.diag(); the routes are walked here over the factory's
// public layout (the same rules as Factory.carry / links, read backwards from the taker: items only ever move through a
// Transfer Arm, so a route is producer > arm > (belts > arm >) taker, see preds()).
//
// A Transfer Arm about to be placed (or selected) shows what it would do before the click: an arrow through its tile from
// the tile behind it to the tile in front, the item it would take floating over the source, and the target bracketed:
// green when it accepts that, rust when it does not (what it would take instead floats over it), amber when nothing
// stands behind the arm to take from. armWould() gives the same answer in words for the HUD.
import * as THREE from 'three';
import { TOWERS, FACS, ITEMS, ITEM_TYPES, FLUIDS, MAKES, needsOf, cellX, cellZ, GW } from './data.ts';
import type { TowerType, FacType, ItemType, FluidType, TowerNeeds } from './data.ts';
import { neighbor, hexDist, inBoard, worldToCell, disc, lineDir } from './hex.ts';
import { SUPPLY, POLE_REACH, TUNNEL_REACH, armBack, armFront } from './factory.ts';
import type { Factory, Fac, Diag } from './factory.ts';
import { TOWER_SCALE, NODE_R } from './sim.ts';
import type { Sim, Ev, Tower } from './sim.ts';
import { FX_LAYER } from './world.ts';
import { wireEnd, ROUTE_GEOM, holoGeos, tunnelMate } from './facview.ts';
import type { FacView } from './facview.ts';

/** What the player is about to place (the ghost): a tower or a factory building on a tile, and whether it may go there. */
export interface CueTool { tower?: TowerType; fac?: FacType; cx: number; cz: number; dir: number; ok: boolean }
/** A tutorial pointer: 'here' = build on this tile, 'path' = a tile of the belt line to lay (i: its place in the line, nx / nz: the next tile). */
export interface CueGuide { x: number; y: number; z: number; kind: 'here' | 'path'; i?: number; nx?: number; nz?: number }

// palette (linear-ish, lifted for additive drawing)
const GREEN = 0x6fe0c8, RUST = 0xff6a3a, AMBER = 0xf2a54a, SAND = 0xe3dc92, POWER = 0xa6e070, APRICOT = 0xf68b56;
// (the Static's cold blue for a tower its Titan has stunned, the mites' violet for one they have jammed: as the view's own sparks)
const STATIC = 0x8fd0ff, VIOLET = 0xa08fff;
const ITEM_LIT: Record<ItemType, number> = { iron_ore: 0x5f97ee, copper_ore: 0xf07c2e, coal: 0xb89a6a, iron: 0xa3c4f7, copper: 0xff9550, shell: 0xf68b56, cell: 0x5ff0d0, missile: 0xe6a04a };
const FLUID_LIT: Record<FluidType, number> = { crude: 0x9a6cf5, petrol: 0xffb02e };

// ring styles (see the fragment shader)
const S_PULSE = 0, S_OK = 1, S_MISS = 2, S_OUT = 3, S_SRC = 4, S_ARRIVE = 5, S_CAP = 6, S_HERE = 7, S_CHEV = 8, S_AREA = 9, S_LOCK = 10, S_OPEN = 11, S_SLOT = 12, S_HELD = 13, S_PCAP = 14, S_TURN = 15;
// line modes (see the fragment shader)
const L_FLOW = 1, L_EDGE = 3; // (0: a pulse, 2: a tether)
// hologram shapes
const H_ORE = 0, H_COAL = 1, H_PLATE = 2, H_SHELL = 3, H_CELL = 4, H_MISSILE = 5, H_BOLT = 6, H_DROP = 7, H_ARROW = 8, H_LINK = 9, H_UP = 10, H_MITE = 11;
const ITEM_HOLO: Record<ItemType, number> = { iron_ore: H_ORE, copper_ore: H_ORE, coal: H_COAL, iron: H_PLATE, copper: H_PLATE, shell: H_SHELL, cell: H_CELL, missile: H_MISSILE };

const MAX_RING = 384, MAX_SEG = 2048, MAX_ICON = 128;
/** Slots only the ghost and the tutorial may fill, so a board full of lacking things can never crowd out what the player is placing or being shown. */
const RESV_RING = 24, RESV_ICON = 6;
const NEVER = 1e9;
/** Seconds a ring or hologram takes to fade once its cue has gone, the supplied ring stays after something became supplied,
 *  a new placement's hex pulse runs before its routes start, and the route pulse's speed (world units a second) and bounds. */
const FADE = 0.4, OK_SHOW = 4.5, PLACE_LEAD = 0.32, ROUTE_SPEED = 11, ROUTE_MIN = 0.7, ROUTE_MAX = 2.4, ROUTE_TAIL = 1.3;
const MAX_PULSES = 8;
/** Seconds (of the sim) a tower has to stand dry in a wave before it gets the missing cue. */
const DRY_GRACE = 2.5;
/** How far over the top of a model a hologram's middle floats (the shapes are one unit tall and bob a little). */
const SEAT = 0.72;
const NO_DIAG = new Map<string, Diag>();

const RING_VERT = `
  attribute vec4 iPos, iCol, iPar;
  varying vec2 vP, vW; varying vec4 vCol; varying vec4 vPar;
  void main(){
    float st = iPar.x;
    float ext = (st < 0.5 || abs(st - 5.0) < 0.5) ? 2.75 : abs(st - 9.0) < 0.5 ? 1.16 : 1.9;
    vP = position.xz * ext; vCol = iCol; vPar = iPar;
    vec3 w = iPos.xyz + vec3(vP.x, 0.0, vP.y) * iPos.w;
    vW = w.xz;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }`;
const RING_FRAG = `
  uniform float time;
  varying vec2 vP, vW; varying vec4 vCol; varying vec4 vPar;
  const float TAU = 6.2831853;
  float hash(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
  float hexd(vec2 p){ p = abs(p); return max(p.x, p.x * 0.5 + p.y * 0.8660254); }
  // an anti-aliased line of half-width h about x = 0, never thinner than a pixel, with a soft skirt of light
  float ln(float x, float h, float w){ h = max(h, w * 0.7); return 1.0 - smoothstep(h, h + w, abs(x)); }
  float glow(float x, float k){ return exp(-abs(x) * k); }
  // a chevron pointing along +a: two strokes meeting at a = c
  float chev(float a, float s, float c, float half_, float w){ return ln(a + abs(s) * 0.75 - c, 0.03, w) * (1.0 - smoothstep(half_, half_ + w, abs(s))); }
  void main(){
    float st = vPar.x, age = time - vPar.y, seed = vPar.w;
    vec2 p = vP;
    float d = hexd(p), r = length(p), a = atan(p.y, p.x), w = fwidth(d) * 1.25;
    // corners of a pointy-top hex: where the angle is half-way between two flat sides
    float corner = 1.0 - smoothstep(0.2, 0.3, abs(fract(a / (TAU / 6.0)) - 0.5) * 2.0);
    float fin = smoothstep(0.0, 0.28, age), fout = 1.0 - smoothstep(0.0, ${FADE.toFixed(2)}, time - vPar.z);
    float v = 0.0, white = 0.0, gain = vCol.a;
    if (st < 0.5) {
      // placement: a hex ring racing outward with a fainter echo behind it, and the tile flashing under it
      float u = clamp(age / 0.75, 0.0, 1.0), e = 1.0 - (1.0 - u) * (1.0 - u) * (1.0 - u);
      float rr = mix(0.55, 2.45, e), r2 = mix(0.4, 1.75, clamp((age - 0.1) / 0.75, 0.0, 1.0));
      float k = (1.0 - u) * (1.0 - u);
      v = (ln(d - rr, 0.02, w) * 1.5 + glow(d - rr, 9.0) * 0.5 + smoothstep(rr - 0.9, rr, d) * step(d, rr) * 0.22) * k;
      v += (ln(d - r2, 0.012, w) * 0.6) * k * step(0.1, age);
      v += (1.0 - smoothstep(0.9, 1.0, d)) * 0.4 * exp(-age * 9.0);
      white = exp(-age * 7.0) * 0.6;
      v *= step(0.0, age); fin = 1.0; fout = 1.0;
    } else if (st < 1.5) {
      // supplied: a calm thin ring, one highlight travelling round it
      float h = fract(a / TAU - time * 0.16 + seed), comet = pow(1.0 - h, 7.0);
      float line = ln(d - 0.94, 0.018, w);
      v = line * (0.42 + 1.5 * comet) + glow(d - 0.94, 16.0) * (0.08 + 0.45 * comet);
      v += ln(d - 0.86, 0.006, w) * 0.12 * corner;
      white = comet * 0.45;
    } else if (st < 2.5) {
      // lacking: a broken ring turning slowly, beating, and an alarm ring falling in on it
      float n = 9.0, ph = fract(a / TAU * n + time * 0.11 + seed);
      float dash = smoothstep(0.0, 0.07, ph) * (1.0 - smoothstep(0.52, 0.59, ph));
      float beat = 0.62 + 0.38 * sin(time * 4.4 + seed * 6.0);
      v = (ln(d - 0.985, 0.032, w) * 1.3 + glow(d - 0.985, 10.0) * 0.5) * dash * beat;
      float q = fract(time * 0.72 + seed), r2 = 0.985 + 0.5 * (1.0 - q) * (1.0 - q);
      v += ln(d - r2, 0.01, w) * 0.75 * q * (1.0 - q) * 3.0 * step(0.5, fract(a / TAU * n * 2.0 - time * 0.11));
      v += ln(d - 0.84, 0.006, w) * 0.2;
    } else if (st < 3.5) {
      // nothing takes its output: dim chevrons leaving through the six sides and dying away
      float k = floor(a / (TAU / 6.0) + 0.5), ka = k * (TAU / 6.0);
      vec2 nrm = vec2(cos(ka), sin(ka));
      float al = dot(p, nrm), sd = dot(p, vec2(-nrm.y, nrm.x));
      for (int i = 0; i < 2; i++) {
        float q = fract(time * 0.42 + float(i) * 0.5 + seed);
        v += chev(al, sd, 0.92 + 0.52 * q, 0.2, w) * sin(q * 3.14159) * (1.0 - q * 0.4);
      }
      v = v * 0.8 + ln(d - 0.9, 0.006, w) * 0.16;
    } else if (st < 4.5) {
      // the source of a route: corner brackets breathing on its tile
      float b = 0.5 + 0.5 * sin(time * 3.2);
      float rr = 1.0 + 0.05 * b;
      v = (ln(d - rr, 0.028, w) * 1.2 + glow(d - rr, 12.0) * 0.3) * corner * (0.7 + 0.3 * b) + ln(d - 0.9, 0.007, w) * 0.3;
    } else if (st < 5.5) {
      // a route arriving: brackets closing on the tile, then the ring flares and settles
      float u = clamp(age / 0.3, 0.0, 1.0), e = 1.0 - (1.0 - u) * (1.0 - u);
      float rr = mix(1.9, 0.94, e), fl = step(0.3, age) * exp(-(age - 0.3) * 3.4);
      v = (ln(d - rr, 0.03, w) * 1.3 + glow(d - rr, 10.0) * 0.4) * mix(corner, 1.0, u * u) * (1.0 - smoothstep(0.3, 0.42, age)) * u;
      v += (ln(d - 0.94, 0.02, w) * 2.2 + glow(d - 0.94, 6.0) * 0.8 + (1.0 - smoothstep(0.7, 0.95, d)) * 0.22) * fl;
      white = fl * 0.6;
      v *= step(0.0, age); fin = 1.0; fout = 1.0;
    } else if (st < 6.5) {
      // the end of a belt line: a small node, closed when the line reaches a taker (seed 0), open and searching when not
      float open = step(0.5, seed);
      float gap = mix(1.0, step(0.3, fract(a / TAU * 4.0 + time * 0.35)), open);
      float b = 0.75 + 0.25 * sin(time * 5.0);
      v = (ln(r - 0.42, 0.035, w) * 1.3 + glow(r - 0.42, 12.0) * 0.35) * gap * b;
      v += (1.0 - smoothstep(0.09, 0.09 + w, r)) * (1.0 - open) * 0.9;
      float q = fract(time * 0.9);
      v += ln(r - (0.42 + 0.5 * q), 0.01, w) * (1.0 - q) * 0.7 * open;
    } else if (st < 7.5) {
      // build here: the tile lit faintly, its ring, and brackets falling in on it again and again
      float q = fract(time * 0.85), e = 1.0 - (1.0 - q) * (1.0 - q);
      float rr = mix(1.55, 0.97, e);
      v = (ln(d - rr, 0.03, w) * 1.4 + glow(d - rr, 10.0) * 0.35) * corner * sin(q * 3.14159);
      v += ln(d - 0.93, 0.016, w) * (0.75 + 0.35 * sin(time * 5.2)) + glow(d - 0.93, 14.0) * 0.22;
      v += (1.0 - smoothstep(0.86, 0.93, d)) * (0.07 + 0.05 * sin(time * 5.2));
    } else if (st > 8.5 && st < 9.5) {
      // a tile in reach of a pole or generator: a soft fill, the tile's own faint outline, and a scan line that sweeps the
      // whole reach as one (it is placed in the world, not on the tile); fine lines run with it like a hologram's
      float inside = 1.0 - smoothstep(0.955, 0.985, d);
      float sw = fract((vW.x * 0.5 + vW.y * 0.8660254) * 0.085 - time * 0.21 + seed);
      float band = exp(-(sw - 0.5) * (sw - 0.5) * 1400.0), wake = smoothstep(0.34, 0.5, sw) * step(sw, 0.5);
      float fine = 0.5 + 0.5 * sin((vW.x * 0.5 + vW.y * 0.8660254) * 15.0 - time * 3.0);
      fine = mix(0.5, fine, clamp(1.0 - fwidth(vW.y) * 6.0, 0.0, 1.0));
      v = inside * (0.018 + 0.014 * fine + 0.26 * band + 0.05 * wake * wake);
      v += ln(d - 0.93, 0.004, w * 0.8) * (0.022 + 0.6 * band + 0.14 * wake * wake);
      white = band * 0.4;
    } else if (st > 9.5 && st < 10.5) {
      // it will be powered (fed): brackets fall in on the tile and lock, the ring flashes once, the brackets stay and breathe
      float u = clamp(age / 0.34, 0.0, 1.0), e = 1.0 - (1.0 - u) * (1.0 - u) * (1.0 - u);
      float rr = mix(1.85, 1.1, e), b = 0.5 + 0.5 * sin(time * 3.2 + seed * 6.0);
      float fl = step(0.34, age) * exp(-(age - 0.34) * 5.0);
      v = (ln(d - rr, 0.04, w) * 1.6 + glow(d - rr, 9.0) * 0.45) * corner * (0.72 + 0.28 * b) * (0.35 + 0.65 * u);
      v += ln(d - 0.97, 0.008, w) * 0.4 * u + (1.0 - smoothstep(0.9, 0.97, d)) * (0.07 + 0.05 * b) * u;
      v += (ln(d - 1.1, 0.022, w) * 1.5 + glow(d - 1.1, 8.0) * 0.5) * fl;
      white = fl * 0.6;
      v *= step(0.0, age); fin = 1.0;
    } else if (st > 10.5 && st < 11.5) {
      // out of reach: brackets that reach for the tile, stop short and fall back
      float q = fract(time * 0.55 + seed), e = sin(q * 3.14159);
      float rr = mix(1.62, 1.3, e * e);
      v = (ln(d - rr, 0.024, w) * 1.1 + glow(d - rr, 12.0) * 0.25) * corner * (0.3 + 0.6 * e);
    } else if (st > 11.5 && st < 12.5) {
      // a tile a tunnel's other end could stand on: a small dotted hex, turning
      float ph = fract(a / TAU * 6.0 + time * 0.25 + seed);
      float dot_ = smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.42, 0.5, ph));
      v = (ln(d - 0.62, 0.03, w) * 1.1 + glow(d - 0.62, 10.0) * 0.25) * dot_ + (1.0 - smoothstep(0.06, 0.06 + w, r)) * 0.6;
    } else if (st > 14.5) {
      // it can be turned: two arcs creeping round the tile, each ending in an arrowhead
      float seg = fract((a + time * 0.55) / 3.14159);
      v = ln(r - 1.13, 0.012, w) * smoothstep(0.0, 0.06, seg) * step(seg, 0.5) * 0.8;
      v += (1.0 - smoothstep(0.0, w, abs(r - 1.13) - 0.085 * (1.0 - (seg - 0.5) * 9.0))) * step(0.5, seg) * step(seg, 0.61);
    } else if (st > 13.5) {
      // a pipe to be: its tile ringed, closed and calm with a node on every corner when the line runs from a source to a
      // taker (seed 0), broken, turning and searching outward when it leads nowhere yet
      float open = step(0.5, seed);
      float gap = mix(1.0, step(0.38, fract(a / TAU * 6.0 + 0.19 + time * 0.3)), open);
      float b = 0.78 + 0.22 * sin(time * 5.0);
      v = (ln(d - 1.07, 0.024, w) * 1.3 + glow(d - 1.07, 11.0) * 0.35) * gap * b;
      v += corner * ln(d - 1.07, 0.06, w) * (1.0 - open) * 0.9;
      float q = fract(time * 0.9);
      v += ln(d - (1.07 + 0.55 * q), 0.01, w) * (1.0 - q) * 0.7 * open;
    } else if (st > 12.5) {
      // held down (seed under 0.5: stunned, over: jammed): a ring that crackles, arcs of it jumping on and off, and
      // (stunned) a bright fault racing round it; (jammed) short ticks crawling round the tile like legs
      float jam = step(0.5, seed), n = mix(14.0, 22.0, jam);
      float cell = floor(a / TAU * n + 0.5 + jam * time * 1.3), tick = floor(time * mix(17.0, 9.0, jam));
      float on = step(mix(0.45, 0.5, jam), hash(cell * 3.1 + tick * 7.7 + seed * 91.0));
      float h = fract(a / TAU - time * 0.9 + seed), comet = pow(1.0 - h, 9.0) * (1.0 - jam);
      float legs = jam * ln(fract(a / TAU * n + time * 1.3) - 0.5, 0.11, 0.05) * (1.0 - smoothstep(0.0, 0.14, abs(d - 1.03)));
      v = (ln(d - 0.97, 0.026, w) * 1.3 + glow(d - 0.97, 9.0) * 0.45) * (0.16 + 0.84 * on) * (1.0 - jam * 0.45) + legs * 0.9;
      v += (ln(d - 0.97, 0.03, w) * 2.0 + glow(d - 0.97, 5.0) * 0.8) * comet;
      v += ln(d - 0.84, 0.006, w) * 0.22;
      white = comet * 0.6 + on * 0.12;
    } else {
      // a tile of the line to lay: a chevron on the deck pointing at the next tile, lit in turn down the line
      float c = cos(seed), s = sin(seed);
      float al = p.x * c + p.y * s, sd = -p.x * s + p.y * c;
      float lit = pow(0.5 + 0.5 * sin(time * 4.2 - vCol.a * 0.9), 3.0);
      v = (chev(al, sd, 0.28, 0.42, w) + chev(al, sd, -0.14, 0.42, w) * 0.55) * (0.3 + 1.1 * lit);
      v += ln(d - 0.9, 0.006, w) * 0.2;
      gain = 1.0;
    }
    vec3 c = mix(vCol.rgb, vec3(1.0), clamp(white, 0.0, 1.0) * 0.6);
    gl_FragColor = vec4(c * v * gain * fin * fout, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const LINE_VERT = `
  attribute vec3 iA, iB; attribute vec4 iS, iC; attribute vec2 iD;
  uniform vec2 res; uniform float dpr;
  varying float vS, vX; varying vec4 vS4, vC; varying vec2 vD;
  void main(){
    // (drawn a hand's breadth nearer the eye than it lies, so it rides on the belt, pipe or cable it follows instead of fighting it)
    vec4 va = viewMatrix * vec4(iA, 1.0), vb = viewMatrix * vec4(iB, 1.0);
    va.xyz -= normalize(va.xyz) * 0.09; vb.xyz -= normalize(vb.xyz) * 0.09;
    vec4 ca = projectionMatrix * va, cb = projectionMatrix * vb;
    vec2 sa = ca.xy / ca.w * res, sb = cb.xy / cb.w * res;
    vec2 dir = sb - sa; float l = length(dir); dir = l > 1e-4 ? dir / l : vec2(1.0, 0.0);
    vec2 n = vec2(-dir.y, dir.x);
    vec4 c = mix(ca, cb, position.y);
    // the core is about 0.05 of a tile wide, but never under a pixel and a half nor fat when zoomed in; the quad is 4.5 cores wide for the glow
    float ppu = projectionMatrix[1][1] * res.y * 0.5 / c.w;
    float core = clamp(0.055 * ppu, 1.3 * dpr, 3.2 * dpr);
    vec2 off = n * position.x * core * 4.5 + dir * (position.y * 2.0 - 1.0) * core * 0.6;
    c.xy += off / res * 2.0 * c.w;
    gl_Position = c;
    vS = iS.x + iS.y * position.y; vX = position.x * 4.5; vS4 = iS; vC = iC; vD = iD;
  }`;
const LINE_FRAG = `
  uniform float time, xray;
  varying float vS, vX; varying vec4 vS4, vC; varying vec2 vD;
  void main(){
    float x = abs(vX), prof = (1.0 - smoothstep(0.55, 1.15, x)) + exp(-x * x * 0.42) * 0.32;
    float age = time - vS4.w, total = vS4.z, mode = vC.a, v = 0.0, white = 0.0;
    if (mode < 0.5) {
      // the pulse: a hot head running down the route, a tail of ticks behind it, the whole route glowing on for a moment after
      float dur = vD.x, sh = age / dur * (total + ${ROUTE_TAIL.toFixed(1)}), ds = sh - vS;
      float head = exp(-ds * ds * 5.5), back = step(0.0, ds);
      float tail = back * exp(-ds * 0.5) * (0.55 + 0.45 * step(0.45, fract(vS * 1.9 - time * 2.6)));
      float after = back * 0.3 * (1.0 - smoothstep(dur, dur + 1.1, age));
      v = (head * 2.6 + tail * 1.1 + after) * step(0.0, age) * (1.0 - smoothstep(dur + 0.5, dur + 1.2, age));
      white = head;
    } else if (mode < 1.5) {
      // a route to be: dashes flowing toward the taker
      float f = fract(vS * 1.5 - time * 1.5);
      float dash = smoothstep(0.0, 0.1, f) * (1.0 - smoothstep(0.5, 0.6, f));
      v = (0.16 + 0.95 * dash) * smoothstep(0.0, 0.2, age) * (1.0 - smoothstep(0.0, 0.25, time - vD.y));
    } else if (mode < 2.5) {
      // a tether: a faint steady thread with a slow shimmer (a hologram's projector beam)
      v = (0.2 + 0.16 * sin(vS * 26.0 - time * 7.0)) * smoothstep(0.0, 0.3, age) * (1.0 - smoothstep(0.0, ${FADE.toFixed(2)}, time - vD.y));
    } else {
      // the edge of a reach: a thin steady line, one highlight travelling round it
      float h = fract(vS / max(total, 0.001) - time * 0.07), comet = pow(1.0 - h, 10.0);
      v = (0.34 + 1.5 * comet) * smoothstep(0.0, 0.3, age) * (1.0 - smoothstep(0.0, 0.25, time - vD.y));
      white = comet * 0.5;
    }
    // (the second pass, where something stands in front: pulses and routes only, and faint)
    if (xray > 0.5) { if (mode > 1.5) discard; v *= mode < 0.5 ? 0.3 : 0.2; prof = 1.0 - smoothstep(0.4, 1.0, x); }
    vec3 c = mix(vC.rgb, vec3(1.0), clamp(white, 0.0, 1.0) * 0.65);
    gl_FragColor = vec4(c * v * prof, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const HOLO_VERT = `
  attribute float shape; attribute vec4 iPos, iCol, iPar;
  uniform float time, minPx; uniform vec2 res;
  varying vec3 vN, vV; varying vec3 vCol; varying float vL, vF, vPh, vSg;
  void main(){
    float on = step(abs(shape - iCol.w), 0.5);
    // never smaller on screen than minPx (a phone, or the camera pulled right back): it grows to stay readable
    vec4 cc = projectionMatrix * viewMatrix * vec4(iPos.xyz, 1.0);
    float grow = clamp(minPx / (projectionMatrix[1][1] * res.y * 0.5 / cc.w), 1.0, 2.4);
    float fin = smoothstep(0.0, 0.35, time - iPar.x) * (1.0 - smoothstep(0.0, ${FADE.toFixed(2)}, time - iPar.y));
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    // an item turns slowly on the spot; a sign (phase below zero: an arrow, the upgrade chevrons) keeps facing the eye and only sways
    float sign_ = step(iPar.z, 0.0), ph = abs(iPar.z);
    float ang = mix(time * 0.9 + ph * 6.0, atan(right.z, right.x) * -1.0 + 0.5 * sin(time * 1.3 + ph * 6.0), sign_), ca = cos(ang), sa = sin(ang);
    vec3 p = position * iPos.w * grow * on * (0.55 + 0.45 * fin);
    p.xz = vec2(p.x * ca + p.z * sa, -p.x * sa + p.z * ca);
    vec3 n = normal; n.xz = vec2(n.x * ca + n.z * sa, -n.x * sa + n.z * ca);
    vec3 w = iPos.xyz + p + right * iPar.w * grow;
    w.y += (0.09 * sin(time * 1.9 + ph * 9.0) + 0.5 * (grow - 1.0)) * iPos.w;
    // a hologram that drops a few lines now and then
    float g = step(0.955, fract(time * 0.37 + ph)) * step(0.5, fract(position.y * 9.0 + time * 13.0)) * (1.0 - sign_);
    w += right * g * 0.09 * iPos.w;
    vec4 mv = viewMatrix * vec4(w, 1.0);
    vN = mat3(viewMatrix) * n; vV = -mv.xyz; vCol = iCol.rgb; vL = position.y; vF = fin; vPh = ph; vSg = sign_;
    gl_Position = projectionMatrix * mv;
  }`;
const HOLO_FRAG = `
  uniform float time;
  varying vec3 vN, vV; varying vec3 vCol; varying float vL, vF, vPh, vSg;
  void main(){
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float rim = f * f;
    // scan lines are counted in pixels, so they stay a hologram's at any zoom; one bright band climbs through the shape
    float scan = 0.62 + 0.38 * sin(gl_FragCoord.y * 2.0 - time * 7.0);
    float q = fract(time * 0.42 + vPh) * 1.7 - 0.85, band = exp(-(vL - q) * (vL - q) * 60.0);
    float flick = 0.88 + 0.12 * sin(time * 31.0 + vPh * 40.0);
    // (a sign faces the eye, so it has no rim to speak of: its face is lit instead)
    float v = (mix(0.26, 0.5, vSg) + 0.8 * rim + 0.7 * band) * scan * flick * vF;
    vec3 c = mix(vCol, vec3(1.0), clamp(band * 0.28, 0.0, 0.4));
    gl_FragColor = vec4(c * v, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

type Need = { k: 'item'; it: ItemType | 'ore' } | { k: 'fluid'; fl: FluidType } | { k: 'power' } | { k: 'grid' };
/** What a factory building has to be given, in the order its diagnosis lists it. */
function facNeeds(type: FacType): Need[] {
  const out: Need[] = [];
  if (type === 'generator') out.push({ k: 'item', it: 'coal' });
  else if (type === 'smelter') out.push({ k: 'item', it: 'ore' }, { k: 'item', it: 'coal' });
  else if (type === 'pole') out.push({ k: 'grid' });
  else if (type === 'refinery') out.push({ k: 'fluid', fl: 'crude' });
  const rec = MAKES[type];
  if (rec) { for (const it in rec.inp) out.push({ k: 'item', it: it as ItemType }); if (rec.fluid) out.push({ k: 'fluid', fl: rec.fluid[0] }); }
  if (FACS[type].power) out.push({ k: 'power' });
  return out;
}
function towerNeeds(n: TowerNeeds): Need[] {
  const out: Need[] = [];
  if (n.item) out.push({ k: 'item', it: n.item });
  if (n.fluid) out.push({ k: 'fluid', fl: n.fluid });
  if (n.power) out.push({ k: 'power' });
  return out;
}
const fluidName = (fl: FluidType) => FLUIDS[fl].name.toLowerCase();
/** Whether a diagnosis says this need is not met. */
function lacks(n: Need, d: Diag): boolean {
  if (n.k === 'item') return d.missing.includes(n.it === 'ore' ? 'iron or copper ore' : ITEMS[n.it].short);
  if (n.k === 'fluid') return d.missing.includes(fluidName(n.fl));
  if (n.k === 'power') return d.missing.includes('power');
  return d.missing.some((m) => m.startsWith('a Generator') || m.startsWith('coal for'));
}
const SHORT_ITEM = new Map<string, ItemType>((Object.keys(ITEMS) as ItemType[]).map((it) => [ITEMS[it].short, it]));
/** The hologram for one phrase of a diagnosis: [shape, colour], or null for what has no picture (a taker for its output). */
function holoOf(m: string): [number, number] | null {
  const it = SHORT_ITEM.get(m);
  if (it) return [ITEM_HOLO[it], ITEM_LIT[it]];
  if (m === 'power' || m.startsWith('a Generator')) return [H_BOLT, POWER];
  if (m === fluidName('crude') || m === 'an oil field') return [H_DROP, FLUID_LIT.crude];
  if (m === fluidName('petrol')) return [H_DROP, FLUID_LIT.petrol];
  if (m === 'iron or copper ore' || m === 'an ore deposit') return [H_ORE, ITEM_LIT.iron_ore];
  if (m.startsWith('coal for')) return [H_COAL, ITEM_LIT.coal];
  if (m.startsWith('a second') || m === 'a target' || m === 'something to take' || m === 'an arm at its end') return [H_LINK, AMBER];
  return null;
}
const needHolo = (n: Need): [number, number] => n.k === 'item' ? (n.it === 'ore' ? [H_ORE, ITEM_LIT.iron_ore] : [ITEM_HOLO[n.it], ITEM_LIT[n.it]]) : n.k === 'fluid' ? [H_DROP, FLUID_LIT[n.fl]] : [H_BOLT, POWER];
const needColor = (n: Need, via?: ItemType) => n.k === 'item' ? ITEM_LIT[n.it === 'ore' ? via || 'iron_ore' : n.it] : n.k === 'fluid' ? FLUID_LIT[n.fl] : POWER;

const conveyor = (t: FacType) => t === 'belt' || t === 'splitter' || t === 'tunnel';
const pipeLike = (t: FacType) => t === 'pipe' || t === 'ptunnel';
const pointsAt = (b: Fac, cx: number, cz: number) => { const [x, z] = neighbor(b.cx, b.cz, b.dir); return x === cx && z === cz; };
function makesIt(q: Fac, it: ItemType | 'ore'): ItemType | null {
  if (it === 'ore') return makesIt(q, 'iron_ore') || makesIt(q, 'copper_ore');
  switch (q.type) {
    case 'mine': return q.ore === it ? it : null;
    case 'crate': return q.left > 0 && q.hold === it ? it : null;
    case 'smelter': return it === 'iron' || it === 'copper' ? it : null;
    default: return MAKES[q.type]?.out === it ? it : null;
  }
}
const FLUID_SRC: Record<FluidType, FacType> = { crude: 'pump', petrol: 'refinery' };
/** A producer counts as working when it lacks nothing but (maybe) a taker: the thing asking would be one. */
const works = (q: Fac, dg: Map<string, Diag>) => { const d = dg.get('f' + q.id); return !d || d.missing.every((m) => m.startsWith('a taker')); };

const tileOf = (f: { cx: number; cz: number }) => f.cz * GW + f.cx;
const facOn = (F: Factory, j: number) => (j >= 0 ? F.facAt(j % GW, (j / GW) | 0) : undefined);
/** Every item a producer puts out (a smelter: both plates; what it really makes depends on what it is fed). */
function makesAll(q: Fac): ItemType[] {
  if (q.type === 'mine') return q.ore && q.ore !== 'oil' ? [q.ore as ItemType] : [];
  if (q.type === 'crate') return q.left > 0 && q.hold ? [q.hold] : [];
  if (q.type === 'smelter') return ['iron', 'copper'];
  const o = MAKES[q.type]?.out;
  return o ? [o] : [];
}
/** The Transfer Arms of a layout by the tile in front of them (where they put) and by the tile behind them (where they take). */
interface ArmMaps { front: Map<number, Fac[]>; back: Map<number, Fac[]> }
function armMaps(F: Factory): ArmMaps {
  const front = new Map<number, Fac[]>(), back = new Map<number, Fac[]>();
  const add = (m: Map<number, Fac[]>, j: number, a: Fac) => { if (j < 0) return; const l = m.get(j); if (l) l.push(a); else m.set(j, [a]); };
  for (const a of F.facs) if (a.type === 'arm') { add(front, armFront(a), a); add(back, armBack(a), a); }
  return { front, back };
}
/**
 * What hands items to c, one step upstream (the rules of factory.ts read backwards). An arm: what stands behind it (a
 * producer, a conveyor, or an arm that hands into it). A tunnel exit: its entrance. A belt, splitter or tunnel entrance:
 * the arms that put onto it, and the conveyors that run into it. A producer: nothing (its own inputs are another route).
 */
function preds(F: Factory, c: Fac, arms: ArmMaps): Fac[] {
  const out: Fac[] = [];
  if (c.type === 'arm') {
    const q = facOn(F, armBack(c));
    if (q && (q.type === 'arm' ? armFront(q) === tileOf(c) : !(q.type === 'tunnel' && !q.exit))) out.push(q);
    return out;
  }
  if (c.type === 'tunnel' && c.exit) { const e = F.facById(c.pair); if (e) out.push(e); return out; }
  if (!conveyor(c.type)) return out;
  for (const a of arms.front.get(tileOf(c)) || []) out.push(a);
  for (let d = 0; d < 6; d++) {
    const [nx, nz] = neighbor(c.cx, c.cz, d), q = F.facAt(nx, nz);
    if (!q || !conveyor(q.type)) continue;
    // (as Factory.passOn: nothing moves between two belts or a tunnel exit and a belt that point into each other; a splitter feeds a belt or a tunnel entrance leading away from it: its back edge touches the splitter, as Factory.leadsFrom)
    if (q.type === 'belt' && pointsAt(q, c.cx, c.cz) && !((c.type === 'tunnel' || c.type === 'belt') && pointsAt(c, q.cx, q.cz))) out.push(q);
    else if (q.type === 'splitter' && (c.type === 'belt' || (c.type === 'tunnel' && !c.exit)) && c.dir === (d + 3) % 6) out.push(q);
    else if (q.type === 'tunnel' && q.exit && pointsAt(q, c.cx, c.cz) && c.type !== 'tunnel') out.push(q);
  }
  return out;
}
/** The items that can come out of what stands on a tile, for an arm standing in front of it (a producer's own, or what the producers upstream of a conveyor or arm make). */
function offeredAt(F: Factory, j: number, arms: ArmMaps): ItemType[] {
  const q = facOn(F, j), out = new Set<ItemType>();
  if (!q || pipeLike(q.type) || (q.type === 'tunnel' && !q.exit)) return [];
  const seen = new Set<number>([q.id]), queue = [q];
  for (let k = 0; k < queue.length && k < 400; k++) {
    const c = queue[k];
    if (c.type !== 'arm' && !conveyor(c.type)) { for (const it of makesAll(c)) out.add(it); continue; }
    for (const o of preds(F, c, arms)) if (!seen.has(o.id)) { seen.add(o.id); queue.push(o); }
  }
  return ITEM_TYPES.filter((it) => out.has(it));
}
/**
 * What a Transfer Arm on tile (cx, cz) facing `dir` would do, placed or not: `offered` what the tile behind it can give,
 * `accepts` what the tile in front takes, `take` what it would carry (both), and how that stands: 'ok', 'nosource'
 * (nothing behind it to take from), 'notarget' (it points at an empty tile), 'refuse' (what stands in front takes no
 * items), 'mismatch' (it takes items, but none the source gives). `why` says it in words (empty when ok).
 */
export interface ArmWould { state: 'ok' | 'nosource' | 'notarget' | 'refuse' | 'mismatch'; take: ItemType[]; offered: ItemType[]; accepts: ItemType[]; why: string; back: [number, number]; front: [number, number] }
export function armWould(sim: Sim, cx: number, cz: number, dir: number): ArmWould {
  const F = sim.factory, back = neighbor(cx, cz, (dir + 3) % 6), front = neighbor(cx, cz, dir);
  const jb = inBoard(back[0], back[1]) ? back[1] * GW + back[0] : -1, jf = inBoard(front[0], front[1]) ? front[1] * GW + front[0] : -1;
  // (the arm to be, as far as the factory's questions look at it)
  const fake = { id: -1, type: 'arm', cx, cz, dir, only: null } as unknown as Fac;
  const here = F.facAt(cx, cz), me = here && here.type === 'arm' && here.dir === dir ? here : fake;
  const mask = jf >= 0 ? F.acceptMask(jf, me) : 0;
  const accepts = ITEM_TYPES.filter((_, i) => mask & (1 << i)), offered = jb >= 0 ? offeredAt(F, jb, armMaps(F)).filter((it) => !me.only || it === me.only) : [];
  const take = offered.filter((it) => accepts.includes(it));
  const qb = facOn(F, jb), qf = facOn(F, jf), tw = jf >= 0 && !qf ? F.towerOn(jf) : undefined;
  const srcOk = !!qb && (qb.type === 'arm' ? armFront(qb) === cz * GW + cx : qb.type === 'belt' || qb.type === 'splitter' || (qb.type === 'tunnel' && qb.exit) || makesAll(qb).length > 0 || qb.type === 'crate' || !!MAKES[qb.type]?.out || qb.type === 'mine' || qb.type === 'smelter');
  const nameB = qb ? FACS[qb.type].name : '', nameF = qf ? FACS[qf.type].name : tw ? TOWERS[tw.type].name : '';
  let state: ArmWould['state'] = 'ok', why = '';
  if (!qf && !tw) { state = 'notarget'; why = 'points at an empty tile'; }
  else if (!mask) { state = 'refuse'; why = `the ${nameF} takes no items${qf && qf.type === 'tunnel' ? ' from this side' : ''}`; }
  else if (!srcOk) { state = 'nosource'; why = qb ? `nothing to take from the ${nameB}` : 'nothing behind it to take from'; }
  else if (!take.length && offered.length) { state = 'mismatch'; why = `the ${nameF} does not take ${offered.map((it) => ITEMS[it].short).join(' or ')}`; }
  else if (!take.length) { state = 'nosource'; why = `nothing reaches the ${nameB} yet`; }
  return { state, take, offered, accepts, why, back, front };
}

/** A supply route: the polyline (x, y, z triples) from its source to the taker, the source, whether the source will deliver, and for an item the one found. */
interface Route { pts: number[]; src: Fac | null; ok: boolean; it?: ItemType; node?: Fac }

interface Ring { key: string; st: number; x: number; y: number; z: number; R: number; col: number; gain: number; t0: number; t1: number; rot: number; seen: boolean; keep: boolean }
interface Icon { key: string; x: number; y: number; z: number; sc: number; col: number; shape: number; t0: number; t1: number; ph: number; slot: number; seen: boolean }
interface Line { key: string; pts: number[]; col: number; mode: number; t0: number; t1: number; dur: number; seen: boolean; keep: boolean }
interface Later { t: number; fn: () => void }

function instanced(base: THREE.BufferGeometry, attrs: [string, number, number][]): [THREE.InstancedBufferGeometry, Record<string, THREE.InstancedBufferAttribute>] {
  const g = new THREE.InstancedBufferGeometry(), out: Record<string, THREE.InstancedBufferAttribute> = {};
  g.index = base.index;
  for (const k of Object.keys(base.attributes)) g.setAttribute(k, base.attributes[k]);
  for (const [name, size, n] of attrs) { const a = new THREE.InstancedBufferAttribute(new Float32Array(size * n), size); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); out[name] = a; }
  g.instanceCount = 0;
  return [g, out];
}
/** The hologram shapes in one geometry: each fits a unit box about the origin, and every vertex knows which shape it belongs to. */
function holoGeometry(): THREE.BufferGeometry {
  const items = holoGeos();
  const upright = (g: THREE.BufferGeometry) => g.rotateX(-Math.PI / 2); // shells and missiles lie along the belt: stand them up
  const bolt = (() => {
    const s = new THREE.Shape(), P = [[9.6, 0.6], [3, 9], [6.7, 9], [5.5, 15.4], [12.8, 7], [8.9, 7]];
    P.forEach(([x, y], i) => (i ? s.lineTo(x - 8, 8 - y) : s.moveTo(x - 8, 8 - y)));
    return new THREE.ExtrudeGeometry(s, { depth: 2.4, bevelEnabled: false }).translate(0, 0, -1.2);
  })();
  const drop = new THREE.LatheGeometry([[0, -0.5], [0.2, -0.46], [0.33, -0.33], [0.38, -0.16], [0.33, 0.02], [0.2, 0.24], [0.08, 0.42], [0, 0.56]].map(([x, y]) => new THREE.Vector2(x, y)), 14);
  const arrow = (() => {
    const s = new THREE.Shape(), P = [[-0.5, 0.1], [-0.2, 0.1], [-0.2, 0.6], [0.2, 0.6], [0.2, 0.1], [0.5, 0.1], [0, -0.6]];
    P.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
    return new THREE.ExtrudeGeometry(s, { depth: 0.24, bevelEnabled: false }).translate(0, 0, -0.12);
  })();
  const link = new THREE.TorusGeometry(0.36, 0.09, 6, 6).rotateX(Math.PI / 2).scale(1, 2.2, 1);
  // an upgrade is affordable: two chevrons pointing up
  const up = (() => {
    const parts = [0.28, -0.28].map((dy) => {
      const s = new THREE.Shape(), P = [[-0.5, -0.2], [0, 0.26], [0.5, -0.2], [0.5, -0.46], [0, 0], [-0.5, -0.46]];
      P.forEach(([x, y], i) => (i ? s.lineTo(x, y + dy) : s.moveTo(x, y + dy)));
      return new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: false }).translate(0, 0, -0.1);
    });
    const pos: number[] = [], nor: number[] = [];
    for (const g of parts) { const n = g.index ? g.toNonIndexed() : g; pos.push(...(n.getAttribute('position').array as Float32Array)); nor.push(...(n.getAttribute('normal').array as Float32Array)); g.dispose(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return g;
  })();
  // a mite, seen from above as it sits on a tower: a fat body, a head with two jaws, six bent legs
  const mite = (() => {
    const stroke = (P: number[][], w: number) => {
      const L: number[][] = [], R: number[][] = [];
      P.forEach((p, i) => {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
        const k = i === P.length - 1 ? 0.45 : 1; // (a leg tapers to its foot)
        L.push([p[0] + nx * w * k, p[1] + ny * w * k]); R.unshift([p[0] - nx * w * k, p[1] - ny * w * k]);
      });
      const sh = new THREE.Shape();
      [...L, ...R].forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
      return sh;
    };
    const shapes: THREE.Shape[] = [];
    const body = new THREE.Shape(); body.absellipse(0, -0.5, 2.7, 3.3, 0, Math.PI * 2, false, 0); shapes.push(body);
    const head = new THREE.Shape(); head.absarc(0, 3.3, 1.45, 0, Math.PI * 2, false); shapes.push(head);
    for (const sx of [-1, 1]) {
      const m = (P: number[][]) => P.map(([x, y]) => [x * sx, y]);
      shapes.push(stroke(m([[0.7, 4.3], [1.5, 5.7], [0.8, 6.6]]), 0.42)); // a jaw
      shapes.push(stroke(m([[2.2, 1.4], [4.6, 3.6], [6.6, 2.4]]), 0.5), stroke(m([[2.6, -0.5], [5.2, 0.3], [7.0, -1.5]]), 0.5), stroke(m([[2.2, -2.4], [4.6, -3.4], [5.8, -6.0]]), 0.5));
    }
    const parts = shapes.map((sh) => new THREE.ExtrudeGeometry(sh, { depth: 1.6, bevelEnabled: false, curveSegments: 7 }).translate(0, 0, -0.8));
    const pos: number[] = [], nor: number[] = [];
    for (const g of parts) { const n = g.index ? g.toNonIndexed() : g; pos.push(...(n.getAttribute('position').array as Float32Array)); nor.push(...(n.getAttribute('normal').array as Float32Array)); g.dispose(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return g;
  })();
  const shapes: THREE.BufferGeometry[] = [items.iron_ore!, items.coal!, items.iron!, upright(items.shell!), items.cell!, upright(items.missile!), bolt, drop, arrow, link, up, mite];
  const pos: number[] = [], nor: number[] = [], shp: number[] = [], box = new THREE.Box3(), c = new THREE.Vector3(), s = new THREE.Vector3();
  shapes.forEach((g0, id) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    box.setFromBufferAttribute(g.getAttribute('position') as THREE.BufferAttribute); box.getCenter(c); box.getSize(s);
    const k = 1 / Math.max(s.x, s.y, s.z), P = g.getAttribute('position'), N = g.getAttribute('normal');
    for (let i = 0; i < P.count; i++) { pos.push((P.getX(i) - c.x) * k, (P.getY(i) - c.y) * k, (P.getZ(i) - c.z) * k); nor.push(N.getX(i), N.getY(i), N.getZ(i)); shp.push(id); }
  });
  for (const g of new Set([...Object.values(items), bolt, drop, arrow, link, up, mite])) g!.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setAttribute('shape', new THREE.Float32BufferAttribute(shp, 1));
  return out;
}

export class CueView {
  private sim: Sim | null = null;
  private fac: FacView;
  private deckY: (x: number, z: number) => number;
  private arrived: (x: number, y: number, z: number, color: number) => void;
  private clock = { value: 0 };
  private res = new THREE.Vector2(1, 1); private minPx = { value: 26 }; private dpr = { value: 1 };
  private ringMesh: THREE.Mesh; private lineMesh: THREE.Mesh; private holoMesh: THREE.Mesh;
  /** the lines once more, drawn only where something stands in front of them (see LINE_FRAG) */
  private xrayMesh: THREE.Mesh;
  private ringA: Record<string, THREE.InstancedBufferAttribute>; private lineA: Record<string, THREE.InstancedBufferAttribute>; private holoA: Record<string, THREE.InstancedBufferAttribute>;
  private rings: Ring[] = []; private ringBy = new Map<string, Ring>();
  private icons: Icon[] = []; private iconBy = new Map<string, Icon>();
  /** True while the ghost and the tutorial add their cues: they may use the reserved slots. */
  private prio = false;
  private lines: Line[] = []; private lineBy = new Map<string, Line>();
  private later: Later[] = [];
  private now = 0; private dirty = false; private nextGc = NEVER;
  /** what the persistent cues were last worked out for */
  private dg: Map<string, Diag> | null = null; private plan = false; private dryKey = 0; private rev = -1; private wasIntro = false;
  /** per diagnosis key: its needs that were met last time (a bit each), and when it last became supplied */
  private sat = new Map<string, number>(); private okAt = new Map<string, number>(); private okNext = NEVER;
  /** tiles built on since the last pass (from the 'build' events) */
  private built: number[] = [];
  private tool: CueTool | null = null; private toolDirty = false;
  private showAll = false; private showWas = false;
  /** the selected factory building's tile, as last drawn (FacView keeps the selection) */
  private selKey = -1;
  /** what the ghost of a pole or generator would power: those lose their "lacks power" cue while it hovers */
  private cover = new Set<string>();
  /** whether affordable upgrades are marked (the controller switches it off for a spectator or the attract mode) */
  private ups = true;
  private guide: CueGuide[] = []; private guideKey = ''; private guideDirty = false;
  private towerAt = new Map<number, Tower>();
  /** towers that ran dry in this wave: the sim time each was first seen dry, and the ones dry for longer than DRY_GRACE */
  private drySince = new Map<number, number>(); private dryNow = new Set<number>();
  private C = new THREE.Color(); private P2 = { x: 0, z: 0 };
  /** the arms of the layout by the tiles they put onto and take from (worked out again when the layout changes) */
  private armsRev = -1; private armsMap: ArmMaps = { front: new Map(), back: new Map() };
  private segs = 0;

  /** `arrived`: a route's pulse has reached a tower or building at (x, y, z) (the view adds its sparks and lights the deck there). */
  constructor(scene: THREE.Scene, fac: FacView, deckY: (x: number, z: number) => number, arrived: (x: number, y: number, z: number, color: number) => void = () => {}) {
    this.fac = fac; this.deckY = deckY; this.arrived = arrived;
    const mk = (g: THREE.BufferGeometry, vs: string, fs: string, uni: Record<string, THREE.IUniform>, order: number) => {
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: uni, vertexShader: vs, fragmentShader: fs, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, side: THREE.DoubleSide }));
      m.frustumCulled = false; m.visible = false; m.layers.set(FX_LAYER); m.renderOrder = order; scene.add(m);
      return m;
    };
    const quad = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const [rg, ra] = instanced(quad, [['iPos', 4, MAX_RING], ['iCol', 4, MAX_RING], ['iPar', 4, MAX_RING]]);
    this.ringA = ra; this.ringMesh = mk(rg, RING_VERT, RING_FRAG, { time: this.clock }, 5);
    const strip = new THREE.PlaneGeometry(2, 1).translate(0, 0.5, 0);
    const [lg, la] = instanced(strip, [['iA', 3, MAX_SEG], ['iB', 3, MAX_SEG], ['iS', 4, MAX_SEG], ['iC', 4, MAX_SEG], ['iD', 2, MAX_SEG]]);
    this.lineA = la; this.lineMesh = mk(lg, LINE_VERT, LINE_FRAG, { time: this.clock, res: { value: this.res }, dpr: this.dpr, xray: { value: 0 } }, 6);
    this.xrayMesh = mk(lg, LINE_VERT, LINE_FRAG, { time: this.clock, res: { value: this.res }, dpr: this.dpr, xray: { value: 1 } }, 6);
    (this.xrayMesh.material as THREE.ShaderMaterial).depthFunc = THREE.GreaterDepth;
    const [hg, ha] = instanced(holoGeometry(), [['iPos', 4, MAX_ICON], ['iCol', 4, MAX_ICON], ['iPar', 4, MAX_ICON]]);
    this.holoA = ha; this.holoMesh = mk(hg, HOLO_VERT, HOLO_FRAG, { time: this.clock, res: { value: this.res }, minPx: this.minPx }, 7);
  }

  setSim(sim: Sim | null) {
    this.sim = sim;
    this.rings.length = 0; this.ringBy.clear(); this.icons.length = 0; this.iconBy.clear(); this.lines.length = 0; this.lineBy.clear(); this.later.length = 0;
    this.dg = null; this.sat.clear(); this.okAt.clear(); this.okNext = NEVER; this.built.length = 0; this.tool = null; this.guide = []; this.guideKey = ''; this.drySince.clear(); this.dryNow.clear();
    this.flush();
  }
  handle(evs: Ev[]) {
    for (const e of evs) if (e.k === 'build') { const [cx, cz] = worldToCell(e.x, e.z); this.built.push(cz * GW + cx); }
  }
  /** The ghost: what it would connect to and what it would lack is shown on it (null: nothing is being placed). */
  setTool(t: CueTool | null) {
    const o = this.tool;
    if (!t && !o) return;
    if (t && o && t.tower === o.tower && t.fac === o.fac && t.cx === o.cx && t.cz === o.cz && t.dir === o.dir && t.ok === o.ok) return;
    this.tool = t ? { ...t } : null; this.toolDirty = true;
  }
  /** Show the calm ring on everything that is supplied (while something is being placed, or a key is held). */
  setShowAll(on: boolean) { this.showAll = on; }
  setUpgrades(on: boolean) { if (on !== this.ups) { this.ups = on; this.toolDirty = true; } }
  setGuide(pts: CueGuide[]) {
    let key = '';
    for (const g of pts) key += g.kind[0] + g.x.toFixed(1) + ',' + g.z.toFixed(1) + ',' + (g.i || 0) + ';';
    if (key === this.guideKey) return;
    this.guideKey = key; this.guide = pts.map((g) => ({ ...g })); this.guideDirty = true;
  }
  /** Draw calls and instances in use right now (for the frame statistics). */
  stats() { return { draws: +this.ringMesh.visible + +this.lineMesh.visible + +this.xrayMesh.visible + +this.holoMesh.visible, rings: this.rings.length, segments: this.segs, holograms: this.icons.length }; }

  /** w, h: the drawing buffer in pixels; dpr: its pixels per CSS pixel. */
  sync(time: number, reveal: ((x: number, z: number) => number) | null, w: number, h: number, dpr = 1) {
    this.now = this.clock.value = time; this.res.set(w, h); this.dpr.value = dpr; this.minPx.value = 27 * dpr;
    const sim = this.sim;
    if (!sim) return;
    const F = sim.factory, dg = sim.opts.free ? NO_DIAG : sim.diag(), plan = sim.planning;
    // the deck is still assembling: nothing is shown, and what stands there already is taken as given (no pulses for it later)
    if (reveal) {
      if (!this.wasIntro) { this.rings.length = 0; this.ringBy.clear(); this.icons.length = 0; this.iconBy.clear(); this.lines.length = 0; this.lineBy.clear(); this.later.length = 0; this.flush(); }
      this.wasIntro = true; this.baseline(dg, F); this.built.length = 0;
      return;
    }
    // (what changes without the layout changing: which towers ran dry in a wave, which upgrades can be paid for)
    // (a tower counts as dry once it has stood empty for a moment: at the start of a wave nothing has been made yet)
    let dry = 0;
    this.dryNow.clear();
    const tws = sim.towers;
    if (!plan) for (let i = 0; i < tws.length; i++) {
      const t = tws[i];
      if (!t.dry) { this.drySince.delete(t.id); continue; }
      let t0 = this.drySince.get(t.id);
      if (t0 === undefined) this.drySince.set(t.id, (t0 = sim.time));
      if (sim.time - t0 < DRY_GRACE) continue;
      this.dryNow.add(t.id);
      dry = (Math.imul(dry, 31) + t.id * 4 + (t.pwr < 0.05 ? 1 : 0) + (t.tank < 1 ? 2 : 0) + 7) | 0;
    } else this.drySince.clear();
    if (this.ups && sim.wave > 0) for (let i = 0; i < tws.length; i++) { const t = tws[i]; if (this.canUp(sim, t)) dry = (Math.imul(dry, 33) + t.id * 8 + t.lvl) | 0; }
    for (let i = 0; i < tws.length; i++) { const t = tws[i]; if (t.stun > 0 || t.jam > 0) dry = (Math.imul(dry, 37) + t.id * 4 + (t.stun > 0 ? 1 : 2)) | 0; }
    const sc = this.fac.selectedCell(), selKey = sc ? sc.cz * GW + sc.cx : -1; // (a tile index, no string every frame)
    if (selKey !== this.selKey || (selKey >= 0 && F.rev !== this.rev)) { this.selKey = selKey; this.toolDirty = true; }
    if (dg !== this.dg || plan !== this.plan || dry !== this.dryKey || this.showAll !== this.showWas || this.built.length || this.toolDirty || this.guideDirty || this.wasIntro || time >= this.okNext || (this.tool && F.rev !== this.rev)) {
      this.rebuild(sim, F, dg, plan);
      this.dg = dg; this.plan = plan; this.dryKey = dry; this.showWas = this.showAll; this.toolDirty = this.guideDirty = this.wasIntro = false; this.rev = F.rev;
    }
    for (let i = 0; i < this.later.length; i++) if (this.later[i].t <= time) { const l = this.later[i]; this.later.splice(i--, 1); l.fn(); }
    if (time >= this.nextGc) this.dirty = true;
    if (this.dirty) this.flush();
  }

  // ---------- needs ----------
  private needsOfKey(key: string, F: Factory): Need[] | null {
    const id = +key.slice(1);
    if (key[0] === 't') { const t = this.sim!.towers.find((o) => o.id === id); return t ? towerNeeds(needsOf(t)) : null; }
    const f = F.facById(id);
    return f ? facNeeds(f.type) : null;
  }
  /** The diagnosis as the cues read it: a pole on a grid whose generators get no coal lacks that (as the HUD says it). */
  private diagOf(key: string, d: Diag, F: Factory, dg: Map<string, Diag>): Diag {
    if (!d.ok || key[0] !== 'f') return d;
    const f = F.facById(+key.slice(1));
    if (!f || f.type !== 'pole') return d;
    const n = F.powerNet(f.net);
    return n && !n.nodes.some((g) => g.type === 'generator' && dg.get('f' + g.id)?.ok) ? { ok: false, missing: ['coal for its Generator'], from: d.from } : d;
  }
  private satOf(key: string, d: Diag, F: Factory): number {
    const ns = this.needsOfKey(key, F);
    let m = 0;
    if (ns) ns.forEach((n, i) => { if (!lacks(n, d)) m |= 1 << i; });
    return m | (d.ok ? 1 << 30 : 0);
  }
  private baseline(dg: Map<string, Diag>, F: Factory) {
    if (dg === this.dg) return;
    this.dg = dg; this.sat.clear(); this.okAt.clear();
    for (const [k, d0] of dg) this.sat.set(k, this.satOf(k, this.diagOf(k, d0, F, dg), F));
  }

  // ---------- the pass ----------
  private rebuild(sim: Sim, F: Factory, dg: Map<string, Diag>, plan: boolean) {
    const now = this.now;
    this.towerAt.clear();
    for (const t of sim.towers) this.towerAt.set(t.cz * GW + t.cx, t);
    // 1. what has just been placed, and what has just become supplied
    const first = !this.dg, fresh = new Set<string>();
    for (const j of this.built) {
        const cx = j % GW, cz = (j / GW) | 0, t = this.towerAt.get(j), f = t ? undefined : F.facAt(cx, cz);
        const key = t ? 't' + t.id : f ? 'f' + f.id : '';
        if (!key || first) continue;
        fresh.add(key);
        const d0 = dg.get(key), d = d0 ? this.diagOf(key, d0, F, dg) : undefined;
        const small = !!f && (conveyor(f.type) || pipeLike(f.type));
        const col = !d ? SAND : d.ok ? GREEN : d.missing.every((m) => m.startsWith('a taker')) ? AMBER : RUST;
        this.shot(S_PULSE, cellX(cx, cz), this.deckY(cellX(cx, cz), cellZ(cz)) + 0.075, cellZ(cz), small ? 0.5 : 1, col, small ? 0.55 : 1.15, 0, 1.0);
    }
    if (dg !== this.dg) {
      let pulses = 0;
      const was = this.sat, sat = new Map<string, number>();
      const order = [...dg.keys()].sort((a, b) => +fresh.has(b) - +fresh.has(a) || +(b[0] === 't') - +(a[0] === 't'));
      for (const key of order) {
        const d = this.diagOf(key, dg.get(key)!, F, dg), m = this.satOf(key, d, F), old = was.get(key);
        sat.set(key, m);
        if (first || m === old) continue;
        const isNew = old === undefined, gained = m & ~(old || 0) & ~(1 << 30);
        if (isNew && !fresh.has(key)) continue; // (came in some other way: a loaded game, a co-op partner's is announced by its own build event)
        const lead = fresh.has(key) && isNew ? PLACE_LEAD : 0;
        let arrive = lead;
        if (gained && plan) {
          const ns = this.needsOfKey(key, F)!, pos = this.posOf(key, F);
          if (pos) ns.forEach((n, i) => {
            if (!(gained & (1 << i)) || pulses >= MAX_PULSES) return;
            const r = this.route(n, pos.cx, pos.cz, F, dg, pos.fac, SUPPLY, undefined, !pos.fac);
            if (!r || r.pts.length < 6) return;
            pulses++;
            const dur = this.pulse(r.pts, needColor(n, r.it), lead);
            arrive = Math.max(arrive, lead + dur);
            const item = n.k === 'item';
            const col = needColor(n, r.it);
            this.at(now + lead + dur, () => { this.fac.flashTaker(key, item); this.shot(S_ARRIVE, pos.x, pos.y + 0.08, pos.z, 1, GREEN, 1.1, 0, 1.4); this.arrived(pos.x, pos.y, pos.z, col); });
          });
        }
        if (d.ok && !(old !== undefined && old & (1 << 30))) this.okAt.set(key, now + arrive);
        if (!d.ok) this.okAt.delete(key);
      }
      this.sat = sat;
      for (const k of this.okAt.keys()) if (!dg.has(k)) this.okAt.delete(k);
    }
    this.built.length = 0;
    // 2. the standing cues
    for (const r of this.rings) r.seen = r.keep;
    for (const i of this.icons) i.seen = false;
    for (const l of this.lines) l.seen = l.keep;
    this.okNext = NEVER;
    const showAll = this.showAll && plan;
    // (what the ghost of a pole or generator would power stops saying it lacks power while the ghost hovers: the brackets closing on it say so)
    const tool = this.tool && this.tool.ok && inBoard(this.tool.cx, this.tool.cz) ? this.tool : null;
    this.cover.clear();
    if (tool && (tool.fac === 'pole' || tool.fac === 'generator') && this.ghostLive(tool, F, dg)) {
      for (const q of F.facs) if (FACS[q.type].power && hexDist(q.cx, q.cz, tool.cx, tool.cz) <= SUPPLY) this.cover.add('f' + q.id);
      for (const t of sim.towers) if (needsOf(t).power && hexDist(t.cx, t.cz, tool.cx, tool.cz) <= SUPPLY) this.cover.add('t' + t.id);
    }
    const state = (key: string, x: number, y: number, z: number, top: number, crate: boolean, dryLack: string[] | null) => {
      const d0 = dg.get(key);
      if (!d0 && !dryLack) return;
      const d = d0 ? this.diagOf(key, d0, F, dg) : null;
      let missing = dryLack || (d && !d.ok ? d.missing : null);
      if (missing && !dryLack && this.cover.has(key)) { missing = missing.filter((m) => m !== 'power'); if (!missing.length) return; }
      if (missing) {
        if (crate) return; // (a full crate nobody uses yet is normal)
        const hs: [number, number][] = [];
        for (const m of missing) { const h = holoOf(m); if (h && hs.length < 3 && !hs.some((o) => o[0] === h[0] && o[1] === h[1])) hs.push(h); }
        if (!hs.length && missing.every((m) => m.startsWith('a taker'))) { this.ring(key + ':o', S_OUT, x, y + 0.07, z, 1, AMBER, 0.9, (x * 0.37 + z * 0.61) % 1); return; }
        this.ring(key + ':m', S_MISS, x, y + 0.075, z, 1, RUST, 1, Math.abs((x * 0.37 + z * 0.61) % 1));
        this.holos(key, hs, x, y + top, z);
        return;
      }
      if (!d || !plan) return;
      // (the ring comes on when the route's pulse has arrived, stays a few seconds, and is there for everything while asked for)
      const t = this.okAt.get(key), on = t !== undefined && now >= t && now < t + OK_SHOW;
      if (t !== undefined && now < t + OK_SHOW) this.okNext = Math.min(this.okNext, now < t ? t : t + OK_SHOW);
      if (showAll || on) this.ring(key + ':k', S_OK, x, y + 0.07, z, 1, GREEN, on ? 1.1 : 0.9, Math.abs((x * 0.13 + z * 0.29) % 1));
    };
    for (const t of sim.towers) {
      let lack: string[] | null = null;
      if (this.dryNow.has(t.id) && !plan && !sim.opts.free) { const n = needsOf(t); lack = [n.power && t.pwr < 0.05 ? 'power' : n.fluid && t.tank < 1 ? fluidName(n.fluid) : n.item ? ITEMS[n.item].short : 'power']; }
      // stunned by the Titan's landing or jammed by mites comes first (the tower neither fires nor charges): a crackling
      // ring round its base in the Static's blue or the mites' violet, and a bolt or a mite over it
      const held = t.stun > 0 ? 1 : t.jam > 0 ? 2 : 0, y = this.deckY(t.x, t.z), seat = this.seatTower(t);
      if (held) {
        const col = held === 1 ? STATIC : VIOLET, k = Math.abs((t.x * 0.37 + t.z * 0.61) % 1) * 0.3;
        this.ring('t' + t.id + ':h' + held, S_HELD, t.x, y + 0.08, t.z, 1, col, held === 1 ? 1.2 : 1.05, held === 1 ? 0.1 + k : 0.6 + k);
        this.icon('t' + t.id + ':h' + held, t.x, y + seat + 0.12, t.z, held === 1 ? 1.25 : 1.35, col, held === 1 ? H_BOLT : H_MITE, 0, true);
        if (!plan) continue;
      }
      state('t' + t.id, t.x, y, t.z, seat, false, lack);
    }
    // an upgrade the player can pay for: chevrons beside the tower (not before the first wave: the starting credits are for towers)
    if (this.ups && sim.wave > 0 && !sim.over) for (const t of sim.towers) if (this.canUp(sim, t)) this.icon('u' + t.id, t.x, this.deckY(t.x, t.z) + t.h * 0.8, t.z, 0.52, APRICOT, H_UP, 1.0);
    for (const f of F.facs) {
      if (!conveyor(f.type) && !pipeLike(f.type)) { state('f' + f.id, f.x, 0, f.z, this.seatFac(f.type), f.type === 'crate', null); continue; }
      // a line that carries something and ends without an arm to empty it: an open cap at its end, in rust
      const d = pipeLike(f.type) ? undefined : dg.get('f' + f.id);
      if (d && !d.ok && d.missing.includes('an arm at its end')) this.ring('f' + f.id + ':e', S_CAP, f.x + Math.cos((f.dir * Math.PI) / 3) * 0.96, ROUTE_GEOM.RAIL_Y + 0.09, f.z + Math.sin((f.dir * Math.PI) / 3) * 0.96, 0.62, RUST, 1.05, 1);
    }
    // 3. the ghost and the tutorial
    this.prio = true; // (the tutorial first: its marks are few, the ghost's route can be long)
    let heres = 0;
    for (const g of this.guide) if (g.kind === 'here') heres++;
    for (const g of this.guide) {
      const y = this.deckY(g.x, g.z);
      if (g.kind === 'here') {
        const k = 'G' + g.x.toFixed(1) + ':' + g.z.toFixed(1);
        // (several targets side by side would add up to a white blaze under the bloom: each is drawn more quietly then)
        this.ring(k, S_HERE, g.x, y + 0.08, g.z, 1, GREEN, heres > 1 ? 0.7 : 1.2, 0);
        this.icon(k, g.x, Math.max(g.y, y) + 1.55, g.z, 1.15, GREEN, H_ARROW, 0);
      } else this.ring('P' + g.x.toFixed(1) + ':' + g.z.toFixed(1), S_CHEV, g.x, y + 0.08, g.z, 1, GREEN, g.i || 0, Math.atan2((g.nz ?? g.z) - g.z, (g.nx ?? g.x) - g.x));
    }
    if (tool) this.preview(tool, sim, F, dg);
    else {
      // nothing is being placed: what the selected pole, generator, tunnel or arm connects to
      const sc = this.fac.selectedCell(), sf = sc ? F.facAt(sc.cx, sc.cz) : undefined;
      if (sf && sf.type === 'arm') this.armPreview(sf.cx, sf.cz, sf.dir, sim, F, `s${sf.id}:`, false);
      if (sf && (sf.type === 'pole' || sf.type === 'generator')) {
        const n = F.powerNet(sf.net), live = !!n && n.nodes.some((q) => q.type === 'generator' && dg.get('f' + q.id)?.ok !== false);
        this.reach(sf.type, sf.cx, sf.cz, sim, F, dg, `s${sf.id}:`, live, sf, null);
      } else if (sf && (sf.type === 'tunnel' || sf.type === 'ptunnel')) this.tunnelPair(sf.type, sf.cx, sf.cz, sf.dir, sf.pair ? F.facById(sf.pair) : undefined, sf, `s${sf.id}:`);
    }
    this.prio = false;
    for (const r of this.rings) if (!r.seen && r.t1 >= NEVER) r.t1 = now;
    for (const i of this.icons) if (!i.seen && i.t1 >= NEVER) i.t1 = now;
    for (const l of this.lines) if (!l.seen && l.t1 >= NEVER) l.t1 = now;
    this.dirty = true;
  }
  private canUp(sim: Sim, t: Tower) { return t.lvl < 3 && t.stun <= 0 && t.jam <= 0 && sim.gold >= sim.upCost(t) && sim.mats >= sim.upMat(t); }
  private posOf(key: string, F: Factory): { cx: number; cz: number; x: number; y: number; z: number; fac: Fac | null } | null {
    const id = +key.slice(1);
    if (key[0] === 't') { const t = this.sim!.towers.find((o) => o.id === id); return t ? { cx: t.cx, cz: t.cz, x: t.x, y: this.deckY(t.x, t.z), z: t.z, fac: null } : null; }
    const f = F.facById(id);
    return f ? { cx: f.cx, cz: f.cz, x: f.x, y: 0, z: f.z, fac: f } : null;
  }
  /** Where a hologram's middle sits over a tower, from its deck: clear of the model's real top (the parts of its level
   *  included) and of the power node's emblem while that shows a charge. */
  private seatTower(t: Tower): number {
    const top = this.fac.modelTop('tower_' + t.type, t.lvl) * TOWER_SCALE || t.h + 0.5;
    return Math.max(top, TOWERS[t.type].special && t.charge > 0.02 ? t.h + 0.55 + NODE_R : 0) + SEAT;
  }
  private seatFac(type: FacType): number { return (this.fac.modelTop('fac_' + type) || (type === 'pole' ? 3.4 : 2)) + SEAT; }
  /** Whether a pole or generator to be would carry power: a generator that gets coal, a pole a working generator's grid reaches. */
  private ghostLive(tool: CueTool, F: Factory, dg: Map<string, Diag>): boolean {
    const r = tool.fac === 'generator' ? this.route({ k: 'item', it: 'coal' }, tool.cx, tool.cz, F, dg, null) : this.route({ k: 'grid' }, tool.cx, tool.cz, F, dg, null, POLE_REACH, 'pole');
    return !!r && r.ok;
  }
  /** The holograms of what is missing, side by side over a thing. */
  private holos(key: string, hs: [number, number][], x: number, y: number, z: number) {
    const n = hs.length;
    hs.forEach((h, i) => this.icon(key + ':' + h[0] + ':' + h[1], x, y, z, 1, h[1], h[0], (i - (n - 1) / 2) * 1.05));
  }

  // ---------- the ghost ----------
  private preview(tool: CueTool, sim: Sim, F: Factory, dg: Map<string, Diag>) {
    // (on a deposit the ghost's ring rides above the ore: the deck there is buried under it)
    const { cx, cz } = tool, x = cellX(cx, cz), z = cellZ(cz), y = this.deckY(x, z) + (F.oreAt(cx, cz) ? 0.5 : 0), g = `g${cx}:${cz}:`;
    const here = F.facAt(cx, cz);
    if (tool.fac === 'arm') { this.armPreview(cx, cz, here && here.type === 'arm' ? here.dir : tool.dir, sim, F, g, true); return; }
    if (tool.fac === 'belt') { this.beltEnd(cx, cz, here && here.type === 'belt' ? here.dir : tool.dir, sim, F, g); return; }
    if (tool.fac === 'pipe') { this.pipeEnd(cx, cz, sim, F, dg, g); return; }
    if (tool.fac === 'tunnel' || tool.fac === 'ptunnel') { this.tunnelPair(tool.fac, cx, cz, tool.dir, tunnelMate(F, tool.fac, cx, cz, tool.dir), null, g); return; }
    if (tool.fac && (conveyor(tool.fac) || pipeLike(tool.fac))) return;
    const needs = tool.tower ? towerNeeds(TOWERS[tool.tower].needs) : facNeeds(tool.fac!);
    const hs: [number, number][] = [];
    let live = needs.length > 0, via: Fac | null = null;
    needs.forEach((n, i) => {
      const r = this.route(n, cx, cz, F, dg, null, tool.fac === 'pole' ? POLE_REACH : SUPPLY, tool.fac, !!tool.tower);
      if (!r || !r.ok) live = false;
      if (r && r.node) via = r.node;
      if (r && r.ok) {
        this.line(g + 'r' + i + (r.src ? r.src.id : 0) + ':' + r.pts.length, r.pts, GREEN, 1);
        if (r.src) this.ring(g + 's' + r.src.id, S_SRC, r.src.x, 0.08, r.src.z, 1, GREEN, 1, 0);
      } else {
        if (r && r.pts.length >= 6) this.line(g + 'x' + i + ':' + r.pts.length, r.pts, RUST, 1);
        const h = needHolo(n);
        if (hs.length < 3) hs.push(h);
      }
    });
    if (hs.length) {
      this.ring(g + 'm', S_MISS, x, y + 0.075, z, 1, RUST, 1, 0.3);
      this.holos(g, hs, x, y + (tool.tower ? (this.fac.modelTop('tower_' + tool.tower) * TOWER_SCALE || 3) + SEAT : this.seatFac(tool.fac!)), z);
    } else this.ring(g + 'k', S_OK, x, y + 0.075, z, 1, needs.length ? GREEN : SAND, needs.length ? 1.25 : 0.8, 0.1);
    if (tool.fac === 'pole' || tool.fac === 'generator') this.reach(tool.fac, cx, cz, sim, F, dg, g, live, null, via);
    // what it makes: the arms that would take it away (their backs to this tile), each with the way to its own target
    if (tool.fac) {
      const out = this.makes(tool.fac, cx, cz, F);
      if (out.length) {
        const takers = this.arms(F).back.get(cz * GW + cx) || [];
        for (const a of takers) {
          const hx = Math.cos((a.dir * Math.PI) / 3), hz = Math.sin((a.dir * Math.PI) / 3);
          this.line(g + 'o' + a.id, [x + hx * 0.6, 0.62, z + hz * 0.6, a.x, 1.0, a.z, a.x + hx * 1.3, ROUTE_GEOM.ARM_Y, a.z + hz * 1.3], GREEN, 1);
          this.ring(g + 'ot' + a.id, S_SRC, a.x, 0.08, a.z, 1, GREEN, 0.9, 0);
        }
        if (!takers.length && !hs.length) this.ring(g + 'o', S_OUT, x, y + 0.07, z, 1, AMBER, 0.75, 0.2);
      }
    }
  }
  /** The arms of the layout by front and back tile. */
  private arms(F: Factory): ArmMaps {
    if (this.armsRev !== F.rev) { this.armsRev = F.rev; this.armsMap = armMaps(F); }
    return this.armsMap;
  }
  /**
   * A Transfer Arm to be (ghost) or selected: dashes flow through its tile from the tile behind it to the tile in front,
   * with chevrons where they leave it. Behind: brackets on the source and, floating over it, the items the arm would take
   * (what the source gives and the target accepts); amber brackets that reach and fall short when nothing stands there to
   * take from. In front: brackets that lock green on a target that accepts; a dotted rust hex on an empty tile; a broken
   * rust ring on something that takes no items, or takes none the source gives (then what it would take floats over it).
   * The ghost also gets the arcs that say it can be turned.
   */
  private armPreview(cx: number, cz: number, dir: number, sim: Sim, F: Factory, g: string, ghost: boolean) {
    const w = armWould(sim, cx, cz, dir), x = cellX(cx, cz), z = cellZ(cz), a = (dir * Math.PI) / 3, hx = Math.cos(a), hz = Math.sin(a);
    const col = w.state === 'ok' ? GREEN : w.state === 'nosource' ? AMBER : RUST;
    const bx = x - 2 * hx, bz = z - 2 * hz, fx = x + 2 * hx, fz = z + 2 * hz;
    const qb = inBoard(w.back[0], w.back[1]) ? F.facAt(w.back[0], w.back[1]) : undefined, qf = inBoard(w.front[0], w.front[1]) ? F.facAt(w.front[0], w.front[1]) : undefined;
    const tw = this.towerAt.get(w.front[1] * GW + w.front[0]), fy = tw ? this.deckY(fx, fz) : 0;
    const seat = (q: Fac | undefined, t: Tower | undefined) => (t ? this.seatTower(t) : !q ? 1.2 : conveyor(q.type) ? 1.05 : this.seatFac(q.type));
    // the way through the tile: low over the deck from the source's side to the target's, lifting over the arm's own pad
    const k = g + dir + w.state[0] + ':';
    this.line(k + 'w', [bx + hx * 0.75, 0.3, bz + hz * 0.75, x - hx * 0.55, 0.42, z - hz * 0.55, x, 0.5, z, x + hx * 0.55, 0.42, z + hz * 0.55, fx - hx * 0.75, 0.3, fz - hz * 0.75], col, L_FLOW);
    this.ring(k + 'c', S_CHEV, x + hx * 1.0, 0.1, z + hz * 1.0, 0.62, col, 0, a);
    if (ghost) this.ring(g + 'turn', S_TURN, x, 0.09, z, 1, SAND, 0.55, 0);
    // behind: the source and what would be taken from it
    if (w.state === 'nosource' && !w.offered.length) this.ring(k + 'b', S_OPEN, bx, 0.08, bz, 1, AMBER, 1, 0.2);
    else {
      this.ring(k + 'b', S_SRC, bx, 0.08, bz, 1, w.take.length ? GREEN : AMBER, 1, 0);
      const show = (w.take.length ? w.take : w.offered).slice(0, 3);
      this.holos(k + 'bi', show.map((it) => [ITEM_HOLO[it], ITEM_LIT[it]] as [number, number]), bx, seat(qb, undefined), bz);
    }
    // in front: the target
    if (w.state === 'notarget') this.ring(k + 'f', S_SLOT, fx, this.deckY(fx, fz) + 0.08, fz, 1, RUST, 1, 0.3);
    else if (w.state === 'ok' || w.state === 'nosource') this.ring(k + 'f', w.state === 'ok' ? S_LOCK : S_SRC, fx, fy + 0.08, fz, 1, w.state === 'ok' ? GREEN : AMBER, 1.1, 0.3);
    else {
      this.ring(k + 'f', S_MISS, fx, fy + 0.075, fz, 1, RUST, 1, 0.4);
      if (w.state === 'mismatch') this.holos(k + 'fi', w.accepts.slice(0, 3).map((it) => [ITEM_HOLO[it], ITEM_LIT[it]] as [number, number]), fx, fy + seat(qf, tw), fz);
    }
  }
  /**
   * The reach of a pole or generator  /**
   * The reach of a pole or generator, to be (sel null) or selected: the tiles it powers under a soft fill one scan line
   * sweeps, their outline, and what stands in them. To be: brackets close on everything it would newly power, with the
   * drop cable it would get flowing down to it (green on a grid that carries power, amber on a dead one); what has power
   * already keeps quiet brackets; what lacks power just outside gets brackets that reach and fall short. The wires to the
   * other grids it would join flow in too. Selected: brackets and flowing drops on what it does power, and its own wires.
   */
  private reach(type: FacType, cx: number, cz: number, sim: Sim, F: Factory, dg: Map<string, Diag>, g: string, live: boolean, sel: Fac | null, via: Fac | null) {
    const x = cellX(cx, cz), z = cellZ(cz), col = live ? POWER : AMBER, seed = Math.abs((x * 0.071 + z * 0.113) % 1);
    const tiles = disc(cx, cz, SUPPLY).filter(([a, b]) => inBoard(a, b));
    for (const [a, b] of tiles) { const tx = cellX(a, b), tz = cellZ(b); this.ring(g + 'a' + a + ':' + b, S_AREA, tx, this.deckY(tx, tz) + 0.055, tz, 1, col, live ? 1 : 0.8, seed); }
    this.outline(tiles, 0.07).forEach((pts, i) => this.line(g + 'e' + i + ':' + pts.length, pts, col, L_EDGE));
    const pole = type === 'pole', top = pole ? ROUTE_GEOM.POLE_Y : ROUTE_GEOM.GEN_Y;
    const span = (a: number[], b: number[], sag: number) => {
      const pts: number[] = [], len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      for (let i = 0; i <= 6; i++) { const k = i / 6; pts.push(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k - 4 * k * (1 - k) * len * sag, a[2] + (b[2] - a[2]) * k); }
      return pts;
    };
    const head = (tx: number) => [x + (pole ? (tx >= x ? ROUTE_GEOM.POLE_ARM : -ROUTE_GEOM.POLE_ARM) : 0), top, z];
    const drop = (key: string, tx: number, ty: number, tz: number, c: number) => {
      const h = head(tx), dl = Math.hypot(h[0] - tx, h[2] - tz) || 1, k = Math.min(ROUTE_GEOM.TAKER_IN, dl * 0.5);
      this.line(g + 'd' + key, span(h, [tx + ((h[0] - tx) / dl) * k, ty + ROUTE_GEOM.SOCK_Y + 0.04, tz + ((h[2] - tz) / dl) * k], 0.07), c, L_FLOW);
    };
    if (sel) {
      for (const l of F.links()) {
        if (l.kind !== 'power' || l.from !== sel.id) continue;
        const ty = this.towerAt.has(worldToCell(l.tx, l.tz)[1] * GW + worldToCell(l.tx, l.tz)[0]) ? this.deckY(l.tx, l.tz) : 0;
        this.ring(g + 'p' + l.to, S_LOCK, l.tx, ty + 0.08, l.tz, 1, live ? GREEN : AMBER, 1, 0.4);
        drop(l.to, l.tx, ty, l.tz, live ? GREEN : AMBER);
      }
      for (const [a, b] of F.wires) {
        if (a !== sel.id && b !== sel.id) continue;
        const o = F.facById(a === sel.id ? b : a);
        if (o) this.line(g + 'w' + o.id, pole ? span(wireEnd(o, x), head(o.x), 0.045) : span(head(o.x), wireEnd(o, x), 0.045), col, L_FLOW);
      }
      return;
    }
    // the other grids it would join: a wire from the nearest pole or generator of each (the one its route comes in by is drawn already)
    const nets = new Map<number, Fac>();
    for (const q of F.facs) {
      if ((q.type !== 'pole' && q.type !== 'generator') || (q.cx === cx && q.cz === cz) || hexDist(q.cx, q.cz, cx, cz) > POLE_REACH) continue;
      const o = nets.get(q.net);
      if (!o || hexDist(q.cx, q.cz, cx, cz) < hexDist(o.cx, o.cz, cx, cz)) nets.set(q.net, q);
    }
    for (const q of nets.values()) if (!via || q.net !== via.net) this.line(g + 'w' + q.id, span(wireEnd(q, x), head(q.x), 0.045), col, L_FLOW);
    if (!dg.size) return;
    const mark = (key: string, c: [number, number], tx: number, ty: number, tz: number) => {
      const d = hexDist(c[0], c[1], cx, cz), d0 = dg.get(key), lack = !!d0 && !d0.ok && d0.missing.includes('power');
      if (d === 0 || d > SUPPLY + 2) return;
      if (d > SUPPLY) { if (lack) this.ring(g + 'x' + key, S_OPEN, tx, ty + 0.08, tz, 1, RUST, 0.9, Math.abs((tx * 0.37 + tz * 0.61) % 1)); return; }
      if (!lack) { this.ring(g + 'p' + key, S_SRC, tx, ty + 0.08, tz, 1, col, 0.42, 0); return; }
      this.ring(g + 'l' + key, S_LOCK, tx, ty + 0.08, tz, 1, live ? GREEN : AMBER, 1.1, Math.abs((tx * 0.13 + tz * 0.29) % 1));
      drop(key, tx, ty, tz, live ? GREEN : AMBER);
    };
    for (const q of F.facs) if (FACS[q.type].power) mark('f' + q.id, [q.cx, q.cz], q.x, 0, q.z);
    for (const t of sim.towers) if (needsOf(t).power) mark('t' + t.id, [t.cx, t.cz], t.x, this.deckY(t.x, t.z), t.z);
  }
  /** The outline of a set of tiles, as closed polylines at height y (each edge that has no tile of the set across it). */
  private outline(tiles: [number, number][], y: number): number[][] {
    if (!tiles.length) return [];
    const inSet = new Set(tiles.map(([a, b]) => b * GW + a));
    const [n0x, n0z] = neighbor(tiles[0][0], tiles[0][1], 0);
    const R = Math.hypot(cellX(n0x, n0z) - cellX(tiles[0][0], tiles[0][1]), cellZ(n0z) - cellZ(tiles[0][1])) / 2 / Math.cos(Math.PI / 6);
    const key = (px: number, pz: number) => Math.round(px * 20) + ':' + Math.round(pz * 20);
    const edges = new Map<string, number[]>();
    for (const [a, b] of tiles) {
      const tx = cellX(a, b), tz = cellZ(b);
      for (let d = 0; d < 6; d++) {
        const [nx, nz] = neighbor(a, b, d);
        if (inBoard(nx, nz) && inSet.has(nz * GW + nx)) continue;
        const a0 = ((d * 60 - 30) * Math.PI) / 180, a1 = ((d * 60 + 30) * Math.PI) / 180;
        const e = [tx + Math.cos(a0) * R, tz + Math.sin(a0) * R, tx + Math.cos(a1) * R, tz + Math.sin(a1) * R];
        edges.set(key(e[0], e[1]), e);
      }
    }
    const out: number[][] = [];
    while (edges.size) {
      const [k0, e0] = edges.entries().next().value as [string, number[]];
      edges.delete(k0);
      const pts = [e0[0], y, e0[1], e0[2], y, e0[3]];
      for (let e = edges.get(key(e0[2], e0[3])), n = 0; e && n < 400; n++) { edges.delete(key(e[0], e[1])); pts.push(e[2], y, e[3]); e = edges.get(key(e[2], e[3])); }
      out.push(pts);
    }
    return out;
  }
  /**
   * A tunnel to be (sel null) or selected, and its other end: the hidden run between them as a line of dashes flowing the
   * way the items will (a pipe tunnel has no way), brackets closing on the partner; without a partner, a dotted hex on
   * every tile one could stand on, the furthest the strongest.
   */
  private tunnelPair(type: FacType, cx: number, cz: number, dir: number, mate: Fac | undefined, sel: Fac | null, g: string) {
    const x = cellX(cx, cz), z = cellZ(cz), y = 0.13;
    if (mate) {
      // (a belt tunnel runs from its entrance to its exit: the end behind is the entrance)
      const back = type === 'tunnel' && (sel ? sel.exit : lineDir(cx, cz, mate.cx, mate.cz) !== dir);
      const a = back ? [mate.x, mate.z] : [x, z], b = back ? [x, z] : [mate.x, mate.z], pts: number[] = [];
      const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2) * 2);
      for (let i = 0; i <= n; i++) pts.push(a[0] + ((b[0] - a[0]) * i) / n, y, a[1] + ((b[1] - a[1]) * i) / n);
      this.line(g + 'u' + mate.id + (back ? 'b' : 'f'), pts, GREEN, L_FLOW);
      this.ring(g + 'ul' + mate.id, sel ? S_SRC : S_LOCK, mate.x, 0.08, mate.z, 1, GREEN, sel ? 0.9 : 1.1, 0.2);
      return;
    }
    const dirs = type === 'tunnel' ? [dir] : [0, 1, 2, 3, 4, 5];
    for (const d of dirs) {
      let c: [number, number] = [cx, cz];
      for (let k = 1; k <= TUNNEL_REACH; k++) {
        c = neighbor(c[0], c[1], d);
        if (!inBoard(c[0], c[1])) break;
        const tx = cellX(c[0], c[1]), tz = cellZ(c[1]);
        this.ring(g + 'us' + c[0] + ':' + c[1], S_SLOT, tx, this.deckY(tx, tz) + 0.08, tz, k === TUNNEL_REACH ? 1 : 0.72, AMBER, k === TUNNEL_REACH ? 1 : 0.6, k * 0.13);
      }
    }
  }
  /**
   * A pipe about to be laid: the network it would join. Dashes in the fluid's colour flow from the pump (or refinery) that
   * network leads back to, through the pipes, into the new piece; everything along the network that takes the fluid gets
   * brackets. The piece itself gets a cap, closed and green when the line now runs from a source to a taker, open and
   * amber while it leads nowhere (no source yet, or nothing at its end).
   */
  private pipeEnd(cx: number, cz: number, sim: Sim, F: Factory, dg: Map<string, Diag>, g: string) {
    const x = cellX(cx, cz), z = cellZ(cz), y = ROUTE_GEOM.PIPE_Y + 0.06;
    const nets = F.pipeNets as { forced: FluidType | null }[];
    let fl: FluidType | null = null, r: Route | null = null;
    for (let d = 0; d < 6 && !fl; d++) { const [nx, nz] = neighbor(cx, cz, d), q = F.facAt(nx, nz); if (q && pipeLike(q.type)) fl = nets[q.net]?.forced || null; }
    for (const f of (fl ? [fl] : ['crude', 'petrol']) as FluidType[]) {
      const q = this.fluidRoute(f, cx, cz, x, z, F, dg, F.facAt(cx, cz) || null);
      if (q && q.src && (!r || (q.ok && !r.ok))) { r = q; fl = f; }
    }
    if (r && fl) {
      r.pts.push(x, y, z);
      this.line(g + 'r' + fl + r.src!.id + ':' + r.pts.length, r.pts, r.ok ? FLUID_LIT[fl] : RUST, L_FLOW);
      this.ring(g + 's' + r.src!.id, S_SRC, r.src!.x, 0.08, r.src!.z, 1, r.ok ? FLUID_LIT[fl] : RUST, 1, 0);
    }
    // the takers along the network (the new piece included)
    const wants = (q: Fac): FluidType | null => { const n = facNeeds(q.type).find((o) => o.k === 'fluid') as { k: 'fluid'; fl: FluidType } | undefined; return n ? n.fl : null; };
    const seen = new Set<number>([cz * GW + cx]), queue: [number, number][] = [[cx, cz]];
    let found = 0;
    for (let k = 0; k < queue.length && k < 400; k++) {
      const [px, pz] = queue[k], me = F.facAt(px, pz);
      const o = me && me.type === 'ptunnel' && me.pair ? F.facById(me.pair) : undefined;
      if (o && !seen.has(o.cz * GW + o.cx)) { seen.add(o.cz * GW + o.cx); queue.push([o.cx, o.cz]); }
      for (let d = 0; d < 6; d++) {
        const [nx, nz] = neighbor(px, pz, d);
        if (!inBoard(nx, nz) || seen.has(nz * GW + nx)) continue;
        const q = F.facAt(nx, nz), t = this.towerAt.get(nz * GW + nx);
        if (q && pipeLike(q.type)) { const f = nets[q.net]?.forced; if (!fl || !f || f === fl) { seen.add(nz * GW + nx); queue.push([nx, nz]); } continue; }
        const w = t ? needsOf(t).fluid || null : q ? wants(q) : null;
        if (!w || (fl && w !== fl) || found >= 6) continue;
        seen.add(nz * GW + nx); found++;
        const tx = cellX(nx, nz), tz = cellZ(nz), ty = t ? this.deckY(tx, tz) : 0, c = FLUID_LIT[fl || w];
        this.ring(g + 't' + nx + ':' + nz, k === 0 ? S_LOCK : S_SRC, tx, ty + 0.08, tz, 1, GREEN, 1, 0.3);
        // (a taker right beside the new piece: the branch it would get)
        if (k === 0) this.line(g + 'b' + nx + ':' + nz, [x, y, z, x + (tx - x) * 0.5, y, z + (tz - z) * 0.5, tx - (tx - x) * (ROUTE_GEOM.TAKER_IN / 2), y, tz - (tz - z) * (ROUTE_GEOM.TAKER_IN / 2)], r && r.ok ? c : AMBER, L_FLOW);
      }
    }
    const good = !!r && r.ok && found > 0;
    this.ring(g + 'cap' + (good ? 'g' : 'a'), S_PCAP, x, 0.085, z, 1, good ? GREEN : AMBER, good ? 0.95 : 1.05, good ? 0 : 1);
  }
  /** The items a building of a type would put out on a tile. */
  private makes(type: FacType, cx: number, cz: number, F: Factory): ItemType[] {
    if (type === 'mine') { const o = F.oreAt(cx, cz); return o && o !== 'oil' ? [o as ItemType] : []; }
    if (type === 'smelter') return ['iron', 'copper'];
    const o = MAKES[type]?.out;
    return o ? [o] : [];
  }
  /**
   * A belt about to be laid (or the end of the line being dragged): follow it downstream to where it ends. Every Transfer
   * Arm that takes from the line (its back to one of its tiles) gets brackets; the end of the line gets a cap, closed and
   * green when an arm empties the line or it runs on into a splitter, open and amber when nothing takes anything off it
   * (a belt feeds nothing by itself).
   */
  private beltEnd(cx: number, cz: number, dir: number, sim: Sim, F: Factory, g: string) {
    let c: [number, number] = [cx, cz], d = dir, found = 0, joins = false;
    const seen = new Set<number>(), backs = this.arms(F).back;
    for (let step = 0; step < 90; step++) {
      const j = c[1] * GW + c[0];
      if (seen.has(j)) break;
      seen.add(j);
      for (const a of backs.get(j) || []) {
        if (found >= 6) break;
        found++;
        this.ring(g + 't' + a.id, S_SRC, a.x, 0.08, a.z, 1, GREEN, 1, 0);
      }
      const [nx, nz] = neighbor(c[0], c[1], d), q = F.facAt(nx, nz);
      if (q && q.type === 'belt' && !pointsAt(q, c[0], c[1])) { c = [nx, nz]; d = q.dir; continue; }
      if (q && q.type === 'splitter') { joins = true; c = [nx, nz]; break; }
      if (q && q.type === 'tunnel' && q.pair > 0 && !q.exit) { const e = F.facById(q.pair); if (e) { c = [e.cx, e.cz]; d = e.dir; continue; } }
      break;
    }
    const ex = cellX(c[0], c[1]) + (joins ? 0 : Math.cos((d * Math.PI) / 3) * 0.96), ez = cellZ(c[1]) + (joins ? 0 : Math.sin((d * Math.PI) / 3) * 0.96);
    const good = found > 0 || joins;
    this.ring(g + 'cap' + c[0] + ':' + c[1] + ':' + d + (good ? 'g' : 'a'), S_CAP, ex, ROUTE_GEOM.RAIL_Y + 0.09, ez, 0.62, good ? GREEN : AMBER, good ? 0.85 : 1.0, good ? 0 : 1);
  }

  // ---------- routes ----------
  /**
   * The route that supplies a need of the thing on tile (cx, cz), read backwards from it: null when nothing leads there at
   * all. `self` is the building asking (so it is not taken for its own source), `reach` how far a power node may be.
   */
  private route(n: Need, cx: number, cz: number, F: Factory, dg: Map<string, Diag>, self: Fac | null, reach = SUPPLY, ghost?: FacType, tower = false): Route | null {
    const tx = cellX(cx, cz), tz = cellZ(cz);
    if (n.k === 'item') return this.itemRoute(n.it, cx, cz, tx, tz, F, dg, new Set(self ? [self.id] : []), 0, tower);
    if (n.k === 'fluid') return this.fluidRoute(n.fl, cx, cz, tx, tz, F, dg, self);
    return this.powerRoute(cx, cz, tx, tz, F, dg, self, n.k === 'grid', reach, ghost);
  }
  /**
   * An item's way to the thing on tile (cx, cz), read backwards: the Transfer Arms that put into that tile, what stands
   * behind each (a producer, or a line of belts, splitters and tunnels with the arms that load it, or a chain of arms),
   * breadth first to the nearest producer of the item that works (else one that does not yet). For a tower also the supply
   * crate right beside it, the one thing that feeds it without an arm.
   */
  private itemRoute(it: ItemType | 'ore', cx: number, cz: number, tx: number, tz: number, F: Factory, dg: Map<string, Diag>, skip: Set<number>, depth: number, tower = false): Route | null {
    const par = new Map<number, number>(), queue: Fac[] = [], arms = this.arms(F);
    let best: Fac | null = null, via = 0, fb: Fac | null = null, fbVia = 0;
    const consider = (p: Fac, v: number) => {
      if (skip.has(p.id) || !makesIt(p, it)) return;
      if (works(p, dg)) { if (!best) { best = p; via = v; } } else if (!fb) { fb = p; fbVia = v; }
    };
    const push = (q: Fac, down: number) => { if (!par.has(q.id)) { par.set(q.id, down); queue.push(q); } };
    if (tower) for (let d = 0; d < 6; d++) { const [nx, nz] = neighbor(cx, cz, d), q = F.facAt(nx, nz); if (q && q.type === 'crate') consider(q, 0); }
    for (const a of arms.front.get(cz * GW + cx) || []) push(a, 0);
    for (let k = 0; k < queue.length && k < 600 && !best; k++) {
      const c = queue[k];
      for (const q of preds(F, c, arms)) { if (q.type === 'arm' || conveyor(q.type)) push(q, c.id); else consider(q, c.id); }
    }
    const prod = (best || fb) as Fac | null;
    if (!prod) return null;
    const chain: Fac[] = [];
    for (let c = best ? via : fbVia; c; c = par.get(c) || 0) chain.push(F.facById(c)!);
    const pts: number[] = [], P = this.P2, yb = ROUTE_GEOM.RAIL_Y + 0.085;
    // a producer that is itself fed: its own route first (mine to smelter to press to tower reads as one line)
    let ok = !!best, made = makesIt(prod, it)!;
    if (depth < 3 && prod.type !== 'mine' && prod.type !== 'crate') {
      const first = facNeeds(prod.type).find((n) => n.k === 'item' && (prod.type !== 'smelter' || n.it === 'ore')) as { k: 'item'; it: ItemType | 'ore' } | undefined;
      const up = first ? this.itemRoute(first.it, prod.cx, prod.cz, prod.x, prod.z, F, dg, new Set([...skip, prod.id]), depth + 1) : null;
      if (up) { pts.push(...up.pts); if (it === 'ore' && up.it) made = up.it; }
    }
    pts.push(prod.x, 0.62, prod.z);
    chain.forEach((c, i) => {
      const before = chain[i - 1], after = chain[i + 1];
      // an arm: up over its own pad, between what it takes from and what it puts into
      if (c.type === 'arm') { pts.push(c.x, ROUTE_GEOM.ARM_TOP, c.z); return; }
      if (c.type !== 'belt') { pts.push(c.x, yb, c.z); return; }
      // a belt: from where the arm before it puts things on (its start when that arm stands right behind it, else its
      // middle) to where the arm after it takes them off (its middle, or near its end when the belt runs into that arm)
      const p0 = before && before.type === 'arm' ? (before.dir === c.dir ? 0 : 0.5) : 0;
      const p1 = after && after.type === 'arm' ? (pointsAt(c, after.cx, after.cz) ? 0.92 : 0.5) : 1;
      const straight = this.fac.beltPoint(c, p0, P);
      pts.push(P.x, yb, P.z);
      if (p1 <= p0) return;
      const n = straight ? 1 : 4;
      for (let s = 1; s <= n; s++) { this.fac.beltPoint(c, p0 + ((p1 - p0) * s) / n, P); pts.push(P.x, yb, P.z); }
    });
    this.toTaker(pts, tx, tz, ROUTE_GEOM.ARM_Y + 0.07);
    if (it !== 'ore') made = it;
    return { pts, src: prod, ok, it: made };
  }
  /** End a route at a taker: from the last point to just inside its tile's edge. */
  private toTaker(pts: number[], tx: number, tz: number, y: number) {
    const n = pts.length, lx = pts[n - 3], lz = pts[n - 1], dl = Math.hypot(tx - lx, tz - lz) || 1, k = Math.min(ROUTE_GEOM.TAKER_IN, dl * 0.5);
    pts.push(tx - ((tx - lx) / dl) * k, y, tz - ((tz - lz) / dl) * k);
  }
  private fluidRoute(fl: FluidType, cx: number, cz: number, tx: number, tz: number, F: Factory, dg: Map<string, Diag>, self: Fac | null): Route | null {
    const srcType = FLUID_SRC[fl], y = ROUTE_GEOM.PIPE_Y + 0.06;
    const par = new Map<number, number>(), queue: Fac[] = [];
    let best: Fac | null = null, via = 0, fb: Fac | null = null, fbVia = 0;
    const consider = (p: Fac, v: number) => {
      if (p.type !== srcType || p === self) return;
      if (works(p, dg)) { if (!best) { best = p; via = v; } } else if (!fb) { fb = p; fbVia = v; }
    };
    const nets = F.pipeNets as { forced: FluidType | null }[];
    const push = (q: Fac, down: number) => { if (!par.has(q.id)) { par.set(q.id, down); queue.push(q); } };
    for (let d = 0; d < 6; d++) {
      const [nx, nz] = neighbor(cx, cz, d), q = F.facAt(nx, nz);
      if (!q) continue;
      if (pipeLike(q.type)) { const f = nets[q.net]?.forced; if (!f || f === fl) push(q, 0); } else consider(q, 0);
    }
    for (let k = 0; k < queue.length && k < 800 && !best; k++) {
      const c = queue[k];
      for (let d = 0; d < 6; d++) {
        const [nx, nz] = neighbor(c.cx, c.cz, d), q = F.facAt(nx, nz);
        if (!q) continue;
        if (pipeLike(q.type)) push(q, c.id); else consider(q, c.id);
      }
      const o = c.type === 'ptunnel' && c.pair ? F.facById(c.pair) : undefined;
      if (o) push(o, c.id);
    }
    const prod = (best || fb) as Fac | null;
    if (!prod) { if (!queue.length) return null; const p = queue[0], pts = [p.x, y, p.z]; this.toTaker(pts, tx, tz, y); return { pts, src: null, ok: false }; }
    const pts: number[] = [prod.x, y, prod.z];
    for (let c = best ? via : fbVia; c; c = par.get(c) || 0) { const p = F.facById(c)!; pts.push(p.x, y, p.z); }
    this.toTaker(pts, tx, tz, y);
    return { pts, src: prod, ok: !!best };
  }
  /** Power: from a generator along the wires, pole to pole, to the node in reach of the tile, and down its drop cable
   *  (grid: the tile is a pole or generator itself, so the route ends at its own head). */
  private powerRoute(cx: number, cz: number, tx: number, tz: number, F: Factory, dg: Map<string, Diag>, self: Fac | null, grid: boolean, reach: number, ghost?: FacType): Route | null {
    let node: Fac | undefined, bd = Infinity;
    if (grid && self) node = self;
    else for (const q of F.facs) {
      if ((q.type !== 'pole' && q.type !== 'generator') || q === self) continue;
      const d = hexDist(q.cx, q.cz, cx, cz);
      if (d <= reach && (d < bd || (d === bd && node && q.id < node.id))) { bd = d; node = q; }
    }
    if (!node) return null;
    const adj = new Map<number, number[]>();
    for (const [a, b] of F.wires) { (adj.get(a) || adj.set(a, []).get(a)!).push(b); (adj.get(b) || adj.set(b, []).get(b)!).push(a); }
    const par = new Map<number, number>([[node.id, 0]]), queue = [node];
    let best: Fac | null = null, fb: Fac | null = null;
    for (let k = 0; k < queue.length && !best; k++) {
      const c = queue[k];
      if (c.type === 'generator') { if (dg.get('f' + c.id)?.ok) { best = c; break; } else if (!fb) fb = c; }
      for (const id of adj.get(c.id) || []) if (!par.has(id)) { const q = F.facById(id); if (q) { par.set(id, c.id); queue.push(q); } }
    }
    const gen = (best || fb) as Fac | null, pts: number[] = [];
    const span = (a: [number, number, number], b: [number, number, number], sag: number, n: number, skipFirst: boolean) => {
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      for (let i = skipFirst ? 1 : 0; i <= n; i++) { const k = i / n; pts.push(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k - 4 * k * (1 - k) * len * sag, a[2] + (b[2] - a[2]) * k); }
    };
    if (gen) for (let c: Fac = gen; c !== node;) { const nx = F.facById(par.get(c.id)!)!; span(wireEnd(c, nx.x), wireEnd(nx, c.x), 0.045, 7, false); c = nx; }
    if (grid && self) { if (!pts.length) return null; return { pts, src: gen, ok: !!best, node }; }
    // (a pole or generator to be gets a wire to its head; anything else a drop cable to its socket)
    const head = ghost === 'pole' || ghost === 'generator';
    const top = ghost === 'pole' ? ROUTE_GEOM.POLE_Y : ghost === 'generator' ? ROUTE_GEOM.GEN_Y : ROUTE_GEOM.SOCK_Y + 0.04;
    const w = wireEnd(node, tx), dl = Math.hypot(w[0] - tx, w[2] - tz) || 1, inn = head ? (ghost === 'pole' ? ROUTE_GEOM.POLE_ARM : 0) : Math.min(ROUTE_GEOM.TAKER_IN, dl * 0.5);
    span(w, [tx + ((w[0] - tx) / dl) * inn, top, tz + ((w[2] - tz) / dl) * inn], head ? 0.045 : 0.07, 6, false);
    return { pts, src: gen, ok: !!best, node };
  }

  // ---------- cue lists ----------
  private ring(key: string, st: number, x: number, y: number, z: number, R: number, col: number, gain: number, rot: number) {
    let r = this.ringBy.get(key);
    if (!r) {
      if (this.rings.length >= MAX_RING - (this.prio ? 0 : RESV_RING)) return;
      r = { key, st, x, y, z, R, col, gain, t0: this.now, t1: NEVER, rot, seen: true, keep: false };
      this.rings.push(r); this.ringBy.set(key, r);
    }
    r.st = st; r.x = x; r.y = y; r.z = z; r.R = R; r.col = col; r.gain = gain; r.t1 = NEVER; r.seen = true;
  }
  /** A ring that plays once (delay: seconds from now) and goes. */
  private shot(st: number, x: number, y: number, z: number, R: number, col: number, gain: number, delay: number, life: number) {
    if (this.rings.length >= MAX_RING - RESV_RING) return;
    this.rings.push({ key: '', st, x, y, z, R, col, gain, t0: this.now + delay, t1: this.now + delay + life, rot: 0, seen: true, keep: true });
    this.dirty = true;
  }
  /** A hologram. Items turn on the spot; a sign (the arrow, the upgrade chevrons) faces the eye. */
  private icon(key: string, x: number, y: number, z: number, sc: number, col: number, shape: number, slot: number, sign = shape === H_ARROW || shape === H_UP) {
    let i = this.iconBy.get(key);
    if (!i) {
      if (this.icons.length >= MAX_ICON - (this.prio ? 0 : RESV_ICON)) return;
      const ph = 0.02 + Math.abs((x * 0.173 + z * 0.311 + shape * 0.37) % 0.97);
      i = { key, x, y, z, sc, col, shape, t0: this.now, t1: NEVER, ph: sign ? -ph : ph, slot, seen: true };
      this.icons.push(i); this.iconBy.set(key, i);
    }
    i.x = x; i.y = y; i.z = z; i.slot = slot; i.t1 = NEVER; i.seen = true;
  }
  private line(key: string, pts: number[], col: number, mode: number) {
    let l = this.lineBy.get(key);
    if (!l) { l = { key, pts, col, mode, t0: this.now, t1: NEVER, dur: 1, seen: true, keep: false }; this.lines.push(l); this.lineBy.set(key, l); }
    l.pts = pts; l.col = col; l.t1 = NEVER; l.seen = true;
  }
  /** A pulse down a route, once; returns how long it takes to arrive. */
  private pulse(pts: number[], col: number, delay: number): number {
    let len = 0;
    for (let i = 3; i < pts.length; i += 3) len += Math.hypot(pts[i] - pts[i - 3], pts[i + 1] - pts[i - 2], pts[i + 2] - pts[i - 1]);
    const dur = Math.min(ROUTE_MAX, Math.max(ROUTE_MIN, len / ROUTE_SPEED));
    // (the head reaches the end of the route at `dur * len / (len + tail)`: near enough to dur for the arrival to land on it)
    this.lines.push({ key: '', pts, col, mode: 0, t0: this.now + delay, t1: this.now + delay + dur + 1.3, dur, seen: true, keep: true });
    this.dirty = true;
    return dur * (len / (len + ROUTE_TAIL));
  }
  private at(t: number, fn: () => void) { this.later.push({ t, fn }); }

  /** Drop what has faded and write the three instance buffers. */
  private flush() {
    const now = this.now;
    let gc = NEVER;
    const live = <T extends { key: string; t1: number }>(list: T[], by: Map<string, T>, tail: number) => {
      let n = 0;
      for (const o of list) {
        if (o.t1 + tail <= now) { if (o.key && by.get(o.key) === o) by.delete(o.key); continue; }
        if (o.t1 < NEVER) gc = Math.min(gc, o.t1 + tail);
        list[n++] = o;
      }
      list.length = n;
    };
    live(this.rings, this.ringBy, FADE + 0.05); live(this.icons, this.iconBy, FADE + 0.05); live(this.lines, this.lineBy, 0.3);
    const C = this.C;
    {
      const P = this.ringA.iPos.array as Float32Array, Co = this.ringA.iCol.array as Float32Array, Pa = this.ringA.iPar.array as Float32Array;
      let n = 0;
      for (const r of this.rings) {
        const j = n * 4; C.setHex(r.col);
        P[j] = r.x; P[j + 1] = r.y; P[j + 2] = r.z; P[j + 3] = r.R;
        Co[j] = C.r; Co[j + 1] = C.g; Co[j + 2] = C.b; Co[j + 3] = r.gain;
        Pa[j] = r.st; Pa[j + 1] = r.t0; Pa[j + 2] = r.t1; Pa[j + 3] = r.rot;
        n++;
      }
      this.commit(this.ringMesh, this.ringA, n);
    }
    {
      const P = this.holoA.iPos.array as Float32Array, Co = this.holoA.iCol.array as Float32Array, Pa = this.holoA.iPar.array as Float32Array;
      let n = 0;
      for (const i of this.icons) {
        const j = n * 4; C.setHex(i.col);
        P[j] = i.x; P[j + 1] = i.y; P[j + 2] = i.z; P[j + 3] = i.sc;
        Co[j] = C.r; Co[j + 1] = C.g; Co[j + 2] = C.b; Co[j + 3] = i.shape;
        Pa[j] = i.t0; Pa[j + 1] = i.t1; Pa[j + 2] = i.ph; Pa[j + 3] = i.slot;
        n++;
      }
      this.commit(this.holoMesh, this.holoA, n);
    }
    {
      const A = this.lineA.iA.array as Float32Array, B = this.lineA.iB.array as Float32Array, S = this.lineA.iS.array as Float32Array, Co = this.lineA.iC.array as Float32Array, D = this.lineA.iD.array as Float32Array;
      let n = 0;
      for (const l of this.lines) {
        const p = l.pts;
        let total = 0;
        for (let i = 3; i < p.length; i += 3) total += Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2], p[i + 2] - p[i - 1]);
        C.setHex(l.col);
        let s = 0;
        for (let i = 3; i < p.length && n < MAX_SEG; i += 3) {
          const len = Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2], p[i + 2] - p[i - 1]);
          if (len < 1e-4) continue;
          A[n * 3] = p[i - 3]; A[n * 3 + 1] = p[i - 2]; A[n * 3 + 2] = p[i - 1];
          B[n * 3] = p[i]; B[n * 3 + 1] = p[i + 1]; B[n * 3 + 2] = p[i + 2];
          S[n * 4] = s; S[n * 4 + 1] = len; S[n * 4 + 2] = total; S[n * 4 + 3] = l.t0;
          Co[n * 4] = C.r; Co[n * 4 + 1] = C.g; Co[n * 4 + 2] = C.b; Co[n * 4 + 3] = l.mode;
          D[n * 2] = l.dur; D[n * 2 + 1] = l.t1;
          s += len; n++;
        }
      }
      this.segs = n;
      this.commit(this.lineMesh, this.lineA, n);
      // (pulses and routes are drawn a second time, faintly, where something stands in front of them)
      this.xrayMesh.visible = n > 0 && this.lines.some((l) => l.mode < 2);
    }
    this.nextGc = gc; this.dirty = false;
  }
  private commit(m: THREE.Mesh, attrs: Record<string, THREE.InstancedBufferAttribute>, n: number) {
    (m.geometry as THREE.InstancedBufferGeometry).instanceCount = n; m.visible = n > 0;
    if (n) for (const k in attrs) { const a = attrs[k]; a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
  }
}
