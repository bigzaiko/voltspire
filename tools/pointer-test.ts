// Checks the pointer curve maths: a simulated mouse goes through libinput's adaptive profile and through a browser's
// whole-pixel reporting, and the game's undo has to give back what the hand did.
//   node tools/pointer-test.ts
import { CurveUndo, curve, uncurve, type MouseCurve } from '../src/game/pointer.ts';

let fail = 0;
const ok = (cond: boolean, msg: string) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fail++; };

// the profile against what the test mouse measured on a real desktop
for (const [v, want] of [[0.01, 0.4], [0.04, 0.7], [0.3, 1], [0.8, 1.44], [3, 2]] as const)
  ok(Math.abs(curve(v) - want) < 0.005, `curve: a mouse at ${v} units/ms is scaled by ${curve(v).toFixed(3)}`);

// the inverse is exact over the whole range
let worst = 0;
for (let v = 0.001; v < 4; v *= 1.07) worst = Math.max(worst, Math.abs(uncurve(v * curve(v), 'linear') - v) / v);
ok(worst < 1e-9, `uncurve: linear mode gives every speed back (worst error ${worst.toExponential(1)})`);
ok(uncurve(0.5, 'even') === 0.5 && uncurve(2, 'even') === 2, 'uncurve: even mode leaves the fast end alone');
ok(uncurve(0.03, 'system') === 0.03, 'uncurve: system mode changes nothing');

/**
 * A stretch of steady movement (at least a second and a half, and at least 80 units): a 1000 Hz mouse, the profile on every report, the pointer position kept
 * as a fraction and handed to the page as whole pixels once per frame. Returns what the page turned by, in units.
 */
function run(v: number, mode: MouseCurve, hz = 144, ms = Math.max(1500, 80 / v)): { sent: number; raw: number; got: number } {
  const undo = new CurveUndo();
  const frame = 1000 / hz;
  let pos = 0, seen = 0, sent = 0, raw = 0, got = 0, nextFrame = frame;
  for (let t = 1; t <= ms; t++) {
    sent += v;
    pos += v * curve(v);
    if (t >= nextFrame) {
      nextFrame += frame;
      const step = Math.floor(pos) - seen;
      if (step) { seen += step; raw += step; got += step * undo.gain(step, 0, t, mode); }
    }
  }
  return { sent, raw, got };
}

for (const v of [0.004, 0.01, 0.02, 0.04, 0.06, 0.1, 0.3]) {
  const r = run(v, 'even');
  const before = r.raw / r.sent, after = r.got / r.sent;
  // at the very bottom the steps are further apart than the rest limit, and the undo stays a little short on purpose
  ok(Math.abs(after - 1) < (v < 0.01 ? 0.2 : 0.08), `even: ${(v * 1000).toFixed(0).padStart(3)} units/s arrives as ${(before * 100).toFixed(0)} % from the desktop, ${(after * 100).toFixed(0)} % after the undo`);
}
for (const v of [0.5, 0.8, 1.2, 2.5]) {
  const e = run(v, 'even'), l = run(v, 'linear');
  ok(Math.abs(e.got / e.raw - 1) < 0.002, `even: ${(v * 1000).toFixed(0)} units/s is passed through as the desktop sends it (${(e.raw / e.sent * 100).toFixed(0)} %)`);
  ok(Math.abs(l.got / l.sent - 1) < 0.06, `linear: ${(v * 1000).toFixed(0)} units/s arrives as ${(l.got / l.sent * 100).toFixed(0)} %`);
}
// a slower display must not change the answer
for (const hz of [60, 240]) { const r = run(0.02, 'even', hz); ok(Math.abs(r.got / r.sent - 1) < 0.12, `even: 20 units/s at ${hz} Hz arrives as ${(r.got / r.sent * 100).toFixed(0)} %`); }

// the first step after a rest is lifted by a bounded amount, never by more than the profile could have taken away
{
  const u = new CurveUndo();
  const g = u.gain(1, 0, 5000, 'even');
  ok(g > 1 && g <= 1 / 0.3, `a single step after a rest is scaled by ${g.toFixed(2)}`);
  ok(new CurveUndo().gain(3, 0, 5000, 'even') === 1 && new CurveUndo().gain(40, 0, 5000, 'even') === 1, 'a fast first movement after a rest is left alone');
}

console.log(fail ? `${fail} check(s) failed` : 'pointer curve: all checks passed');
process.exit(fail ? 1 : 0);
