// node tools/hex-test.ts
import { GW, GH, CELL, cellX, cellZ, worldToCell, neighbors, hexDist, lineDir, lineCells, disc } from '../src/game/hex.ts';
let fail = 0;
const ok = (c: unknown, m: string) => { if (!c) { fail++; console.log('FAIL', m); } };
for (let cz = -3; cz < GH + 3; cz++) for (let cx = -3; cx < GW + 3; cx++) {
  const x = cellX(cx, cz), z = cellZ(cz);
  const [bx, bz] = worldToCell(x, z);
  ok(bx === cx && bz === cz, `round trip ${cx},${cz} -> ${bx},${bz}`);
  for (let k = 0; k < 6; k++) { const a = Math.random() * 6.28, r = Math.random() * 0.95; const [jx, jz] = worldToCell(x + Math.cos(a) * r, z + Math.sin(a) * r); ok(jx === cx && jz === cz, `jitter ${cx},${cz}`); }
  for (const [nx, nz] of neighbors(cx, cz)) {
    const d = Math.hypot(cellX(nx, nz) - x, cellZ(nz) - z);
    ok(Math.abs(d - CELL) < 1e-9, `neighbour spacing ${cx},${cz}`);
    ok(hexDist(cx, cz, nx, nz) === 1 && lineDir(cx, cz, nx, nz) >= 0, 'neighbour dist/dir');
  }
}
ok(lineCells(2, 3, 9, 3).length === 8, 'row line');
const diag = lineCells(4, 2, 7, 8);
ok(diag.length === 7 && diag[6][0] === 7 && diag[6][1] === 8, 'diagonal line ' + JSON.stringify(diag));
ok(lineDir(0, 0, 3, 1) === -1, 'off-axis');
ok(disc(10, 10, 1).length === 7 && disc(10, 10, 2).length === 19, 'disc sizes');
console.log(fail ? `${fail} FAILED` : 'hex maths ok');
process.exit(fail ? 1 : 0);
