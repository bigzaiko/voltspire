// Hex grid maths. Pointy-top hexes, rows run left to right, odd rows are shifted half a tile to the right
// ("odd-r" offset coordinates). A cell is (cx, cz) = (column, row); cells outside the board are allowed
// (spawn gates sit two tiles outside).
export const GW = 26;
export const GH = 20;
/** Tile width, flat side to flat side. */
export const CELL = 2;
export const HEX_SIZE = CELL / Math.sqrt(3); // centre to corner
export const ROW_H = HEX_SIZE * 1.5; // distance between rows
export const BOARD_W = (GW + 0.5) * CELL;
export const BOARD_D = (GH - 1) * ROW_H + 2 * HEX_SIZE;

const odd = (cz: number) => cz & 1;

/** World x of a tile centre (needs the row because odd rows are shifted). */
export const cellX = (cx: number, cz: number) => (cx + 0.5 * odd(cz) - GW / 2 + 0.25) * CELL;
export const cellZ = (cz: number) => (cz - (GH - 1) / 2) * ROW_H;

/** Tile under a world position. */
export function worldToCell(x: number, z: number): [number, number] {
  const rf = z / ROW_H + (GH - 1) / 2;
  const qf = x / CELL + GW / 2 - 0.25 - rf / 2;
  // cube rounding
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return [q + (r - odd(r)) / 2, r];
}

/** Offset -> axial (q, r). */
export const toAxial = (cx: number, cz: number): [number, number] => [cx - (cz - odd(cz)) / 2, cz];
export const fromAxial = (q: number, r: number): [number, number] => [q + (r - odd(r)) / 2, r];

/** The six directions in axial coordinates, starting east and going clockwise on screen (z grows downward). */
export const HEX_DIRS: [number, number][] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];

export function neighbor(cx: number, cz: number, dir: number): [number, number] {
  const [q, r] = toAxial(cx, cz), d = HEX_DIRS[((dir % 6) + 6) % 6];
  return fromAxial(q + d[0], r + d[1]);
}
export function neighbors(cx: number, cz: number): [number, number][] {
  const out: [number, number][] = [];
  for (let d = 0; d < 6; d++) out.push(neighbor(cx, cz, d));
  return out;
}
/** Distance in tiles. */
export function hexDist(ax: number, az: number, bx: number, bz: number) {
  const [aq, ar] = toAxial(ax, az), [bq, br] = toAxial(bx, bz);
  const dq = aq - bq, dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
/** Direction index 0..5 if b lies on a straight hex line from a, else -1. */
export function lineDir(ax: number, az: number, bx: number, bz: number) {
  const [aq, ar] = toAxial(ax, az), [bq, br] = toAxial(bx, bz);
  const dq = bq - aq, dr = br - ar;
  if (dq === 0 && dr === 0) return -1;
  if (dr === 0) return dq > 0 ? 0 : 3;
  if (dq === 0) return dr > 0 ? 1 : 4;
  if (dq === -dr) return dr > 0 ? 2 : 5;
  return -1;
}
/** All tiles from a to b inclusive when they share a hex line; otherwise just [a, b]. */
export function lineCells(ax: number, az: number, bx: number, bz: number): [number, number][] {
  const dir = lineDir(ax, az, bx, bz);
  if (dir < 0) return ax === bx && az === bz ? [[ax, az]] : [[ax, az], [bx, bz]];
  const out: [number, number][] = [[ax, az]];
  let c: [number, number] = [ax, az];
  for (let i = 0; i < 200 && (c[0] !== bx || c[1] !== bz); i++) { c = neighbor(c[0], c[1], dir); out.push(c); }
  return out;
}
/** Tiles within `radius` steps of a centre tile (the centre first). */
export function disc(cx: number, cz: number, radius: number): [number, number][] {
  const [q0, r0] = toAxial(cx, cz), out: [number, number][] = [[cx, cz]];
  for (let dq = -radius; dq <= radius; dq++) for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
    if (dq || dr) out.push(fromAxial(q0 + dq, r0 + dr));
  }
  return out;
}
export const inBoard = (cx: number, cz: number) => cx >= 0 && cz >= 0 && cx < GW && cz < GH;
/** The six corners of a tile around its centre, as [dx, dz] pairs (first corner points up-screen). */
export const HEX_CORNERS: [number, number][] = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 3) * i - Math.PI / 2;
  return [Math.cos(a) * HEX_SIZE, Math.sin(a) * HEX_SIZE] as [number, number];
});

/** Build a road from a start tile and a list of [direction, steps] moves; returns the corner tiles. */
export function route(start: [number, number], moves: [number, number][]): [number, number][] {
  const out: [number, number][] = [start];
  let c = start;
  for (const [dir, n] of moves) { for (let i = 0; i < n; i++) c = neighbor(c[0], c[1], dir); out.push(c); }
  return out;
}
