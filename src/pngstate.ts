// Text inside a PNG, DOM-free (the game, tools/repro.ts and tools/png-test.ts share it). A bug report too long for GitHub's
// new-issue link carries its game state in the screenshot the player attaches (report.ts): the state block goes into a tEXt
// chunk with the keyword 'beatspire-state', the issue text into an iTXt chunk 'beatspire-report' (UTF-8: console messages and
// the player's text need not be Latin-1). A chunk is: length (4 bytes, big-endian, of the data only), type (4 ASCII letters),
// data, CRC-32 of type + data. Text chunks go right before IEND; a decoder skips chunks it does not know, so the picture
// still opens everywhere.
export const PNG_SIG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
export const STATE_KEY = 'beatspire-state';
export const REPORT_KEY = 'beatspire-report';

let table: Uint32Array | null = null;
/** CRC-32 (ISO 3309, as PNG uses it) of b[start..end). */
export function crc32(b: Uint8Array, start = 0, end = b.length): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = table[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export const isPng = (b: Uint8Array) => b.length >= 8 && PNG_SIG.every((v, i) => b[i] === v);

/** One chunk: length, type, data, CRC. */
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('bad chunk type ' + type);
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}
const latin1 = (s: string) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c > 255) throw new Error('tEXt takes Latin-1 only'); b[i] = c; } return b; };
const keyBytes = (k: string) => { if (!/^[\x20-\x7e]{1,79}$/.test(k) || /^ | $|  /.test(k)) throw new Error('bad PNG text keyword'); return latin1(k); };
/** A tEXt chunk (keyword, NUL, Latin-1 text). */
export function textChunk(key: string, text: string): Uint8Array {
  const k = keyBytes(key), t = latin1(text), d = new Uint8Array(k.length + 1 + t.length);
  d.set(k); d.set(t, k.length + 1);
  return pngChunk('tEXt', d);
}
/** An uncompressed iTXt chunk (keyword, NUL, flag 0, method 0, no language, NUL, no translated keyword, NUL, UTF-8 text). */
export function itxtChunk(key: string, text: string): Uint8Array {
  const k = keyBytes(key), t = new TextEncoder().encode(text), d = new Uint8Array(k.length + 5 + t.length);
  d.set(k); // then NUL, 0, 0, NUL, NUL (already zero)
  d.set(t, k.length + 5);
  return pngChunk('iTXt', d);
}

export interface PngChunkInfo { type: string; start: number; len: number; crcOk: boolean }
/** The chunks of a PNG, in order. Throws when it is not a PNG or a chunk runs past the end. */
export function pngChunks(b: Uint8Array): PngChunkInfo[] {
  if (!isPng(b)) throw new Error('not a PNG file');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), out: PngChunkInfo[] = [];
  let o = 8;
  while (o + 12 <= b.length) {
    const len = dv.getUint32(o), type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    if (o + 12 + len > b.length) throw new Error(`PNG cut off inside its ${type} chunk`);
    if (out.length >= 100_000) throw new Error('PNG with too many chunks'); // (a real one has a few dozen)
    out.push({ type, start: o, len, crcOk: crc32(b, o + 4, o + 8 + len) === dv.getUint32(o + 8 + len) });
    o += 12 + len;
    if (type === 'IEND') break;
  }
  if (!out.length || out[out.length - 1].type !== 'IEND') throw new Error('PNG has no IEND (cut off?)');
  return out;
}

/** The PNG with these text chunks put before IEND (iTXt when `utf8`, else tEXt); old text chunks with the same keywords are dropped. */
export function withText(png: Uint8Array, entries: readonly { key: string; text: string; utf8?: boolean }[]): Uint8Array {
  const chunks = pngChunks(png), keys = new Set(entries.map((e) => e.key));
  const keep = chunks.filter((c) => !((c.type === 'tEXt' || c.type === 'iTXt') && keys.has(keyOf(png, c))));
  const add = entries.map((e) => (e.utf8 ? itxtChunk(e.key, e.text) : textChunk(e.key, e.text)));
  const parts: Uint8Array[] = [PNG_SIG];
  for (const c of keep) {
    if (c.type === 'IEND') parts.push(...add);
    parts.push(png.subarray(c.start, c.start + 12 + c.len));
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function keyOf(b: Uint8Array, c: PngChunkInfo): string {
  // (a keyword is 1 to 79 bytes: look no further, so a hostile chunk never spreads megabytes into one call)
  const d = b.subarray(c.start + 8, c.start + 8 + Math.min(c.len, 80)), z = d.indexOf(0);
  return String.fromCharCode(...d.subarray(0, z < 0 ? Math.min(d.length, 79) : z));
}
/**
 * The text chunks of a PNG by keyword: tEXt, and iTXt when uncompressed (the game never compresses them; a compressed one,
 * and zTXt, is skipped). A chunk whose CRC does not match is skipped too (damaged in transit: better none than a wrong one).
 */
export function readText(png: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of pngChunks(png)) {
    if (!c.crcOk || (c.type !== 'tEXt' && c.type !== 'iTXt')) continue;
    const d = png.subarray(c.start + 8, c.start + 8 + c.len), z = d.subarray(0, 80).indexOf(0);
    if (z < 1) continue; // (no keyword, or none within its 79 bytes: not a text chunk this reads)
    const key = String.fromCharCode(...d.subarray(0, z));
    if (c.type === 'tEXt') { let s = ''; for (let i = z + 1; i < d.length; i += 8192) s += String.fromCharCode(...d.subarray(i, Math.min(d.length, i + 8192))); out.set(key, s); continue; }
    if (d[z + 1] !== 0) continue; // compressed iTXt
    const lang = d.indexOf(0, z + 3), tkey = lang < 0 ? -1 : d.indexOf(0, lang + 1);
    if (tkey < 0) continue;
    out.set(key, new TextDecoder().decode(d.subarray(tkey + 1)));
  }
  return out;
}
