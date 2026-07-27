/**
 * Curtis's scenario check — run against the REAL engine extracted from index.html.
 * Verifies:
 *  1. Weekly 40h mode: OT resets each week, but the pay-period total keeps accruing.
 *  2. Period 80h mode: once 80h is crossed, every further hour is OT for the whole period.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKERS = /\/\* ==ENGINE-START==[\s\S]*?\*\/([\s\S]*?)\/\* ==ENGINE-END== \*\//;
const m = readFileSync(join(root, 'index.html'), 'utf8').match(MARKERS);
const E = new Function(m[1] + `
  return { DEFAULTS, periodInfo, weekInfo, buildLedger, sumRange, sumSession, HOUR_MS };
`)();

const DAY = 86400000, H = E.HOUR_MS;
// Anchor period: Sun 2026-07-26 → Sat 2026-08-08 (14 days), two full Sun→Sat weeks.
const base = { ...E.DEFAULTS, rate: 38, periodAnchor: '2026-07-26' };
const T = (s) => new Date(s + 'T00:00:00').getTime();

function mkShift(startIso, hours) {
  const start = T(startIso);
  return { id: 'x' + start, start, end: start + hours * H };
}

let pass = 0, fail = 0;
const ok = (name, cond, extra='') => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' → ' + extra : '')); }
};

/* ============ SCENARIO 1: weekly 40h mode ============ */
console.log('\nWEEKLY 40h mode — OT resets each week, period total keeps accruing');
const weeklyCfg = { ...base, otMode: 'weekly', weeklyThreshold: 40 };

// Week 1: 45 h (Sun 7/26 → Sat 8/1). Expect 40 reg + 5 OT.
const w1 = [mkShift('2026-07-27', 9), mkShift('2026-07-28', 9), mkShift('2026-07-29', 9),
            mkShift('2026-07-30', 9), mkShift('2026-07-31', 9)]; // 45 h Mon–Fri
const led1 = E.buildLedger(w1, weeklyCfg);
const period = E.periodInfo(T('2026-08-01'), weeklyCfg);
const p1 = E.sumRange(led1.parts, period.startMs, period.endMs);
ok('week 1: 40 h regular', Math.abs(p1.regHours - 40) < 1e-9, p1.regHours);
ok('week 1: 5 h OT', Math.abs(p1.otHours - 5) < 1e-9, p1.otHours);
ok('week 1: gross = 40×38 + 5×57 = $1,805', Math.abs(p1.gross - 1805) < 1e-9, p1.gross);

// Week 2: 10 h more (Mon 8/3, Tue 8/4). Fresh bucket — should ALL be straight time.
const w2 = w1.concat([mkShift('2026-08-03', 5), mkShift('2026-08-04', 5)]);
const led2 = E.buildLedger(w2, weeklyCfg);
const p2 = E.sumRange(led2.parts, period.startMs, period.endMs);
ok('after 55 h total: period OT still 5 h (week 2 did NOT inherit OT)', Math.abs(p2.otHours - 5) < 1e-9, p2.otHours);
ok('after 55 h total: period regular = 50 h', Math.abs(p2.regHours - 50) < 1e-9, p2.regHours);

// The thing Curtis cares about: the PERIOD TOTAL keeps accruing across the reset.
ok('period total keeps accruing: gross = 50×38 + 5×57 = $2,185',
   Math.abs(p2.gross - 2185) < 1e-9, p2.gross);

// Week 2 hits 40 → OT kicks in again within week 2.
const w3 = w2.concat([mkShift('2026-08-05', 9), mkShift('2026-08-06', 9), mkShift('2026-08-07', 9),
                      mkShift('2026-08-08', 8)]); // +35 → week 2 = 45 h
const led3 = E.buildLedger(w3, weeklyCfg);
const p3 = E.sumRange(led3.parts, period.startMs, period.endMs);
ok('week 2 also goes past 40: total OT = 5 + 5 = 10 h', Math.abs(p3.otHours - 10) < 1e-9, p3.otHours);
ok('period gross = 80 reg×38 + 10 OT×57 = $3,610', Math.abs(p3.gross - 3610) < 1e-9, p3.gross);

// New period (Sun 8/9 onward): hours from old period must NOT leak in.
const w4 = w3.concat([mkShift('2026-08-10', 8)]);
const led4 = E.buildLedger(w4, weeklyCfg);
const period2 = E.periodInfo(T('2026-08-10'), weeklyCfg);
const p4old = E.sumRange(led4.parts, period.startMs, period.endMs);
const p4new = E.sumRange(led4.parts, period2.startMs, period2.endMs);
ok('old period total FROZEN at $3,610 (history preserved)', Math.abs(p4old.gross - 3610) < 1e-9, p4old.gross);
ok('new period starts clean at 8×38 = $304', Math.abs(p4new.gross - 304) < 1e-9, p4new.gross);
ok('new period OT bucket reset: 0 h OT', Math.abs(p4new.otHours) < 1e-9, p4new.otHours);

/* ============ SCENARIO 2: period 80h mode ============ */
console.log('\nPERIOD 80h mode — one running bucket; past 80, EVERY hour is OT');
const periodCfg = { ...base, otMode: 'period', periodThreshold: 80 };

// Same 90 h of shifts across the two weeks.
const led5 = E.buildLedger(w3, periodCfg);
const p5 = E.sumRange(led5.parts, period.startMs, period.endMs);
ok('90 h total: 80 reg', Math.abs(p5.regHours - 80) < 1e-9, p5.regHours);
ok('90 h total: 10 OT', Math.abs(p5.otHours - 10) < 1e-9, p5.otHours);
ok('gross = 80×38 + 10×57 = $3,610', Math.abs(p5.gross - 3610) < 1e-9, p5.gross);

// The hour that crosses 80 must split: part straight, part OT (no free OT, no lost OT).
const cross = [mkShift('2026-07-27', 79.5), mkShift('2026-07-28', 1)]; // crosses 80 mid-shift
const led6 = E.buildLedger(cross, periodCfg);
const p6 = E.sumRange(led6.parts, period.startMs, period.endMs);
ok('crossing shift splits exactly: 80 reg / 0.5 OT',
   Math.abs(p6.regHours - 80) < 1e-9 && Math.abs(p6.otHours - 0.5) < 1e-9,
   p6.regHours + ' / ' + p6.otHours);

// After 80, EVERY hour is OT — no weekly reset in this mode.
const after = cross.concat([mkShift('2026-08-03', 8)]); // week 2 hours, still period bucket
const led7 = E.buildLedger(after, periodCfg);
const p7 = E.sumRange(led7.parts, period.startMs, period.endMs);
ok('week 2 hours are ALL OT once past 80 (no reset): 8.5 OT total',
   Math.abs(p7.otHours - 8.5) < 1e-9, p7.otHours);
ok('gross = 80×38 + 8.5×57 = $3,524.50', Math.abs(p7.gross - 3524.5) < 1e-9, p7.gross);

// New period resets the OT bucket — first shift of next period is straight time again.
const nextPer = after.concat([mkShift('2026-08-10', 8)]);
const led8 = E.buildLedger(nextPer, periodCfg);
const np = E.periodInfo(T('2026-08-10'), periodCfg);
const p8 = E.sumRange(led8.parts, np.startMs, np.endMs);
ok('new period: first 8 h straight again', Math.abs(p8.otHours) < 1e-9 && Math.abs(p8.gross - 304) < 1e-9,
   p8.otHours + ' OT / $' + p8.gross);

console.log('\n' + (fail ? fail + ' FAILED' : 'ALL ' + pass + ' CHECKS PASSED'));
process.exit(fail ? 1 : 0);
