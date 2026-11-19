// The game state inside a report screenshot (src/pngstate.ts), without a browser: node tools/png-test.ts [out.png]
// A PNG made here from scratch gets the state chunk; it must come back with every CRC right, still decode to the same pixels
// (a minimal decoder: IHDR, the IDAT stream inflated, the scanline filters undone), and give back a state that restores to
// the same run (stateHash). With a path, the PNG is also written there (for tools/repro.ts by hand).
import { deflateSync, inflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { PNG_SIG, crc32, pngChunk, pngChunks, withText, readText, isPng, textChunk, STATE_KEY, REPORT_KEY } from '../src/pngstate.ts';
import { encodeSnapshot, decodeSnapshot, restoreSim, stateHash } from '../src/game/snapshot.ts';
import { bigFactory } from './bench.ts';

let fail = 0, n = 0;
const ok = (c: unknown, m: string) => { n++; if (!c) { fail++; console.log('FAIL', m); } };
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((a, b) => a + b.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

// CRC-32 check value of the standard ("123456789" -> cbf43926) and of a known chunk (IEND, empty: ae426082)
ok(crc32(new TextEncoder().encode('123456789')) === 0xcbf43926, 'crc32 check value');
ok([...pngChunk('IEND', new Uint8Array(0)).slice(8)].map((b) => b.toString(16).padStart(2, '0')).join('') === 'ae426082', 'IEND chunk CRC');

/** An RGB PNG, W x H, every row with another filter (0..4) so the decoder below has to get each right. */
function makePng(W: number, H: number): { png: Uint8Array; px: Uint8Array } {
  const px = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; px[i] = (x * 7 + y) & 255; px[i + 1] = (y * 13) & 255; px[i + 2] = (x ^ y) & 255; }
  const raw = new Uint8Array(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    const f = y % 5, o = y * (1 + W * 3);
    raw[o] = f;
    for (let i = 0; i < W * 3; i++) {
      const cur = px[y * W * 3 + i], a = i >= 3 ? px[y * W * 3 + i - 3] : 0, b = y ? px[(y - 1) * W * 3 + i] : 0, c = i >= 3 && y ? px[(y - 1) * W * 3 + i - 3] : 0;
      raw[o + 1 + i] = (cur - [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]) & 255;
    }
  }
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, W); dv.setUint32(4, H); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const z = deflateSync(raw), half = z.length >> 1; // (two IDAT chunks: the stream may be split anywhere)
  return { png: cat(PNG_SIG, pngChunk('IHDR', ihdr), textChunk('Comment', 'made by png-test'), pngChunk('IDAT', z.subarray(0, half)), pngChunk('IDAT', z.subarray(half)), pngChunk('IEND', new Uint8Array(0))), px };
}
function paeth(a: number, b: number, c: number) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
/** A minimal decoder for 8-bit RGB/RGBA non-interlaced PNGs: the checks a real one makes on the way to the pixels. */
function decode(png: Uint8Array): { W: number; H: number; px: Uint8Array } {
  const ch = pngChunks(png);
  if (ch[0].type !== 'IHDR' || ch[0].len !== 13) throw new Error('IHDR is not first');
  if (ch.some((c) => !c.crcOk)) throw new Error('bad CRC in ' + ch.filter((c) => !c.crcOk).map((c) => c.type).join(' '));
  const at = (c: { start: number; len: number }) => png.subarray(c.start + 8, c.start + 8 + c.len);
  const h = at(ch[0]), dv = new DataView(h.buffer, h.byteOffset, 13), W = dv.getUint32(0), H = dv.getUint32(4);
  if (h[8] !== 8 || (h[9] !== 2 && h[9] !== 6) || h[12] !== 0) throw new Error('unsupported PNG kind');
  const bpp = h[9] === 2 ? 3 : 4, idat = ch.filter((c) => c.type === 'IDAT');
  const first = ch.indexOf(idat[0]), last = ch.indexOf(idat[idat.length - 1]);
  if (!idat.length || last - first + 1 !== idat.length) throw new Error('IDAT chunks missing or not consecutive');
  const raw = inflateSync(cat(...idat.map(at))), stride = W * bpp;
  if (raw.length !== H * (stride + 1)) throw new Error(`IDAT inflates to ${raw.length} bytes, want ${H * (stride + 1)}`);
  const px = new Uint8Array(H * stride);
  for (let y = 0; y < H; y++) {
    const f = raw[y * (stride + 1)];
    if (f > 4) throw new Error('bad filter ' + f);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[y * stride + i - bpp] : 0, b = y ? px[(y - 1) * stride + i] : 0, c = i >= bpp && y ? px[(y - 1) * stride + i - bpp] : 0;
      px[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]) & 255;
    }
  }
  return { W, H, px };
}

const { png, px } = makePng(97, 41);
ok(isPng(png), 'made a PNG');
const d0 = decode(png);
ok(d0.W === 97 && d0.H === 41 && Buffer.from(d0.px).equals(Buffer.from(px)), 'the test PNG decodes to its pixels');

// a real run's state, as the game writes it
const sim = bigFactory(5);
for (let i = 0; i < 300; i++) sim.step(1 / 60);
const block = await encodeSnapshot(sim, { build: 'png-test' });
const report = '[Bug] arms stop\n\n### What happened\nÜmlauts, 漢字 and emoji 🎯 in the player\'s text\n';
const shot = withText(png, [{ key: STATE_KEY, text: block }, { key: REPORT_KEY, text: report, utf8: true }]);
const ch = pngChunks(shot);
ok(ch.every((c) => c.crcOk), 'every CRC right after the insert');
ok(ch[ch.length - 1].type === 'IEND' && ch[ch.length - 2].type === 'iTXt' && ch[ch.length - 3].type === 'tEXt', 'text chunks right before IEND');
ok(shot.length === png.length + (12 + STATE_KEY.length + 1 + block.length) + (12 + REPORT_KEY.length + 5 + new TextEncoder().encode(report).length), 'chunk sizes');
const d1 = decode(shot);
ok(Buffer.from(d1.px).equals(Buffer.from(px)), 'the picture is unchanged');
const t = readText(shot);
ok(t.get(STATE_KEY) === block, 'state block read back');
ok(t.get(REPORT_KEY) === report, 'UTF-8 report text read back');
ok(t.get('Comment') === 'made by png-test', 'the PNG\'s own text chunk kept');
ok(stateHash(restoreSim(await decodeSnapshot(t.get(STATE_KEY)!))) === stateHash(sim), 'the state restores to the same run (stateHash)');
// a second insert replaces, it does not pile up
const again = withText(shot, [{ key: STATE_KEY, text: 'BSR1:x.' }]);
ok(pngChunks(again).filter((c) => c.type === 'tEXt').length === 2 && readText(again).get(STATE_KEY) === 'BSR1:x.', 'same keyword replaced');
// damage: a flipped byte in the state chunk makes its CRC fail and the state is not read (rather none than a wrong one)
const bad = shot.slice(), sc = pngChunks(bad).find((c) => c.type === 'tEXt' && readText(shot).has(STATE_KEY) && c.len > 1000)!;
bad[sc.start + 8 + 200] ^= 1;
ok(!pngChunks(bad).find((c) => c.start === sc.start)!.crcOk && !readText(bad).has(STATE_KEY), 'a damaged state chunk is refused');
// cut off: an error, not a wrong answer
let threw = false;
try { readText(shot.subarray(0, shot.length - 20)); } catch { threw = true; }
ok(threw, 'a cut-off PNG throws');
threw = false;
try { readText(new TextEncoder().encode('BSR1:abc.')); } catch { threw = true; }
ok(threw && !isPng(new TextEncoder().encode('BSR1:abc.')), 'text is not a PNG');
threw = false;
try { textChunk(STATE_KEY, 'ü漢'); } catch { threw = true; }
ok(threw, 'tEXt refuses non-Latin-1');
// hostile: a 2 MB tEXt chunk with no NUL (no keyword) must neither throw (call stack) nor be read; withText keeps it
const huge = cat(png.subarray(0, png.length - 12), pngChunk('tEXt', new Uint8Array(2 << 20).fill(65)), png.subarray(png.length - 12));
let hostile = '';
try { hostile = readText(huge).size === 1 && withText(huge, [{ key: STATE_KEY, text: 'BSR1:x.' }]).length > huge.length ? 'ok' : 'wrong'; } catch (e) { hostile = String(e); }
ok(hostile === 'ok', 'a text chunk without a keyword is skipped, not spread (' + hostile + ')');
// hostile: a length field past the end of the file throws instead of reading out of bounds
const lie = png.slice(); new DataView(lie.buffer).setUint32(png.length - 12, 0x7fffffff);
threw = false; try { pngChunks(lie); } catch { threw = true; }
ok(threw, 'a chunk length past the end throws');

if (process.argv[2]) { writeFileSync(process.argv[2], shot); console.log(`wrote ${process.argv[2]} (state hash ${stateHash(sim)})`); }
console.log(`${n - fail}/${n} png checks passed`);
if (fail) process.exit(1);
