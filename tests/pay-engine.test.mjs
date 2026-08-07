/**
 * Tests the pay engine by extracting it verbatim from pay-clock.html — so what's
 * verified here is exactly the code that ships, with no duplicated copy to drift.
 *
 *   node tests/pay-engine.test.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// index.html when the widget is the whole site; pay-clock.html when it sits alongside
// other pages. Pick by which file actually carries the engine, not by name — a repo can
// have an unrelated index.html.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKERS = /\/\* ==ENGINE-START==[\s\S]*?\*\/([\s\S]*?)\/\* ==ENGINE-END== \*\//;

let m = null, widget = null;
for (const name of ['pay-clock.html', 'index.html']) {
  const path = join(root, name);
  if (!existsSync(path)) continue;
  const found = readFileSync(path, 'utf8').match(MARKERS);
  if (found) { m = found; widget = name; break; }
}
if (!m) { console.error('FATAL: no file with engine markers found'); process.exit(1); }
console.log(`engine source: ${widget}`);

const E = new Function(m[1] + `
  return { DEFAULTS, periodInfo, weekInfo, splitSession, buildLedger,
           sumRange, sumSession, bucketHoursAt, plannedStopAt, quantize, HOUR_MS,
           HOLIDAY_DEFAULTS, nthDow, holidayDate, holidaysInYear, holidayOn,
           isWorkDay, anyWorkDay, adjacentWorkDay, dkey };
`)();

// The shipped defaults carry no wage or pay schedule — those come from first-run setup —
// so the suite supplies the numbers it asserts against.
const cfg = { ...E.DEFAULTS, rate: 38, periodAnchor: '2026-07-26' };
let pass = 0, fail = 0;

function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? '  → ' + extra : ''}`); }
}
function near(name, got, want, tol = 1e-9) {
  ok(name, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);
}
function group(t) { console.log(`\n${t}`); }

// Local-time helper so the suite is timezone-agnostic.
const at = (y, mo, d, h = 0, mi = 0) => +new Date(y, mo - 1, d, h, mi, 0, 0);
const shift = (id, a, b) => ({ id, start: a, end: b });
const gross = (sessions, c = cfg) => {
  const l = E.buildLedger(sessions, c);
  return l.parts.reduce((s, p) => s + p.gross, 0);
};

/* ------------------------------------------------------------------ */
group('Pay period boundaries (anchor 2026-07-26, 14 days)');
{
  const p = E.periodInfo(at(2026, 7, 30, 12), cfg);
  ok('current period starts Sun Jul 26', p.start.getMonth() === 6 && p.start.getDate() === 26);
  ok('...and is a Sunday', p.start.getDay() === 0);
  ok('last day is Sat Aug 8', p.lastDay.getMonth() === 7 && p.lastDay.getDate() === 8);
  ok('...and is a Saturday', p.lastDay.getDay() === 6);
  ok('payday is Fri Aug 21', p.payDate.getMonth() === 7 && p.payDate.getDate() === 21 && p.payDate.getDay() === 5);

  // The instant that ends the period belongs to the NEXT one — midnight closing Aug 8.
  ok('23:59 Aug 8 is still this period', E.periodInfo(at(2026, 8, 8, 23, 59), cfg).index === p.index);
  ok('00:00 Aug 9 rolls to the next period', E.periodInfo(at(2026, 8, 9, 0, 0), cfg).index === p.index + 1);

  const nxt = E.periodInfo(at(2026, 8, 9), cfg);
  ok('next period is Aug 9 – Aug 22', nxt.start.getDate() === 9 && nxt.lastDay.getDate() === 22);
  ok('next payday is Fri Sep 4', nxt.payDate.getMonth() === 8 && nxt.payDate.getDate() === 4 && nxt.payDate.getDay() === 5);

  // Self-perpetuating: a period a year out still lands on a Sunday.
  ok('period a year later still starts Sunday', E.periodInfo(at(2027, 7, 30), cfg).start.getDay() === 0);
  ok('a date before the anchor resolves to a negative index', E.periodInfo(at(2026, 7, 20), cfg).index === -1);
}

/* ------------------------------------------------------------------ */
group('Work weeks nest cleanly inside the period');
{
  const w1 = E.weekInfo(at(2026, 7, 28), cfg), w2 = E.weekInfo(at(2026, 8, 5), cfg);
  ok('week 1 starts Sun Jul 26', w1.start.getDate() === 26);
  ok('week 2 starts Sun Aug 2', w2.start.getDate() === 2);
  ok('the two weeks are adjacent', w2.index === w1.index + 1);
  ok('Sat Aug 1 23:59 is still week 1', E.weekInfo(at(2026, 8, 1, 23, 59), cfg).index === w1.index);
  ok('Sun Aug 2 00:00 opens week 2', E.weekInfo(at(2026, 8, 2, 0, 0), cfg).index === w2.index);
}

/* ------------------------------------------------------------------ */
group('Straight time');
{
  near('1 h  = $38.00', gross([shift('a', at(2026, 7, 27, 9), at(2026, 7, 27, 10))]), 38);
  near('8 h  = $304.00', gross([shift('a', at(2026, 7, 27, 9), at(2026, 7, 27, 17))]), 304);
  near('30 min = $19.00', gross([shift('a', at(2026, 7, 27, 9), at(2026, 7, 27, 9, 30))]), 19);
  near('1 min  = $0.6333…', gross([shift('a', at(2026, 7, 27, 9), at(2026, 7, 27, 9, 1))]), 38 / 60, 1e-9);
  near('per-second rate', 38 / 3600, 0.010555555555555556, 1e-15);
}

/* ------------------------------------------------------------------ */
group('Weekly OT — 40 h, resets Sunday');
{
  // Mon–Fri 9-to-5 = 40 h exactly. Nothing should tip into OT.
  const week1 = [1, 2, 3, 4, 5].map(i => shift('d' + i, at(2026, 7, 26 + i, 9), at(2026, 7, 26 + i, 17)));
  const l1 = E.buildLedger(week1, cfg);
  near('40 h flat  → 40 reg / 0 OT', l1.parts.reduce((s, p) => s + p.otHours, 0), 0);
  near('40 h flat  → $1,520.00', gross(week1), 1520);

  // Sixth day: every hour is OT.
  const plusSat = week1.concat([shift('sat', at(2026, 8, 1, 9), at(2026, 8, 1, 13))]);
  const l2 = E.buildLedger(plusSat, cfg);
  near('+4 h on Sat → 4 h OT', l2.parts.reduce((s, p) => s + p.otHours, 0), 4);
  near('+4 h on Sat → $1,520 + $228 = $1,748', gross(plusSat), 1520 + 4 * 57);

  // THE case that matters: a single shift straddling the 40 h line must split, not round.
  const straddle = [1, 2, 3, 4].map(i => shift('d' + i, at(2026, 7, 26 + i, 9), at(2026, 7, 26 + i, 17)))
    .concat([shift('fri', at(2026, 7, 31, 9), at(2026, 7, 31, 21))]); // 32 h banked, then 12 h
  const l3 = E.buildLedger(straddle, cfg);
  const fri = E.sumSession(l3.parts, 'fri');
  near('straddling shift: 8 h billed straight', fri.regHours, 8);
  near('straddling shift: 4 h billed OT', fri.otHours, 4);
  near('straddling shift gross = 8×38 + 4×57 = $532', fri.gross, 532);

  // New week, clean slate.
  const twoWeeks = plusSat.concat([shift('nw', at(2026, 8, 3, 9), at(2026, 8, 3, 17))]);
  const l4 = E.buildLedger(twoWeeks, cfg);
  near('week 2 Monday is straight time again', E.sumSession(l4.parts, 'nw').otHours, 0);
  near('week 2 Monday = $304', E.sumSession(l4.parts, 'nw').gross, 304);
}

/* ------------------------------------------------------------------ */
group('Period OT — 80 h cumulative, no weekly reset');
{
  const pcfg = { ...cfg, otMode: 'period' };
  // 10 straight days × 9 h = 90 h. Under weekly rules some of week 1 would already be OT;
  // under period rules OT starts only once the 80th hour is passed.
  const days = [];
  for (let i = 0; i < 10; i++) days.push(shift('p' + i, at(2026, 7, 26 + i, 8), at(2026, 7, 26 + i, 17)));
  const lp = E.buildLedger(days, pcfg);
  const totH = lp.parts.reduce((s, p) => s + p.hours, 0);
  const totOt = lp.parts.reduce((s, p) => s + p.otHours, 0);
  near('90 h worked', totH, 90);
  near('10 h of it is OT', totOt, 10);
  near('gross = 80×38 + 10×57 = $3,610', gross(days, pcfg), 80 * 38 + 10 * 57);

  const lw = E.buildLedger(days, cfg);
  const wOt = lw.parts.reduce((s, p) => s + p.otHours, 0);
  ok('weekly mode finds more OT on the same hours', wOt > totOt, `weekly ${wOt} vs period ${totOt}`);

  // The 80 h counter resets with the new pay period, not with the week.
  const across = days.concat([shift('next', at(2026, 8, 9, 9), at(2026, 8, 9, 17))]);
  near('first shift of the new period is straight time',
    E.sumSession(E.buildLedger(across, pcfg).parts, 'next').otHours, 0);
}

/* ------------------------------------------------------------------ */
group('Shifts that cross midnight');
{
  const night = [shift('n', at(2026, 7, 27, 22), at(2026, 7, 28, 6))]; // 10pm → 6am
  const l = E.buildLedger(night, cfg);
  near('8 h total', E.sumSession(l.parts, 'n').hours, 8);
  ok('split into two day-parts', l.parts.length === 2);
  near('2 h land on the first day',
    E.sumRange(l.parts, +new Date(2026, 6, 27), +new Date(2026, 6, 28)).hours, 2);
  near('6 h land on the second day',
    E.sumRange(l.parts, +new Date(2026, 6, 28), +new Date(2026, 6, 29)).hours, 6);
  near('gross unaffected by the split', E.sumSession(l.parts, 'n').gross, 8 * 38);

  // Sat→Sun overnight: the hours after midnight belong to the NEW week's 40 h bucket.
  const over = [shift('o', at(2026, 8, 1, 22), at(2026, 8, 2, 6))];
  const lo = E.buildLedger(over, cfg);
  const w1 = E.weekInfo(at(2026, 8, 1), cfg).index;
  ok('overnight shift straddles two week buckets',
    lo.parts[0].weekKey === 'w' + w1 && lo.parts[1].weekKey === 'w' + (w1 + 1));
}

/* ------------------------------------------------------------------ */
group('Period rollover resets the totals');
{
  const s = [shift('old', at(2026, 8, 7, 9), at(2026, 8, 7, 17)),   // this period
             shift('new', at(2026, 8, 10, 9), at(2026, 8, 10, 17))]; // next period
  const l = E.buildLedger(s, cfg);
  const p1 = E.periodInfo(at(2026, 8, 7), cfg), p2 = E.periodInfo(at(2026, 8, 10), cfg);
  near('period 1 shows only its own shift', E.sumRange(l.parts, p1.startMs, p1.endMs).gross, 304);
  near('period 2 shows only its own shift', E.sumRange(l.parts, p2.startMs, p2.endMs).gross, 304);
  ok('they really are different periods', p1.index !== p2.index);
}

/* ------------------------------------------------------------------ */
group('Auto-stop target');
{
  const start = at(2026, 7, 27, 9);
  near('8 h target with nothing banked → stops at 5pm',
    E.plannedStopAt(start, 8, [], cfg), at(2026, 7, 27, 17));

  // A morning shift already banked shortens the remainder.
  const morning = [shift('am', at(2026, 7, 27, 6), at(2026, 7, 27, 9))]; // 3 h
  near('3 h already banked → 5 h left, stops at 2pm',
    E.plannedStopAt(at(2026, 7, 27, 9), 8, morning, cfg), at(2026, 7, 27, 14));

  ok('no target set → no auto-stop', E.plannedStopAt(start, 0, [], cfg) === null);
  ok('not clocked in → no auto-stop', E.plannedStopAt(null, 8, [], cfg) === null);
  ok('target already met → stops immediately',
    E.plannedStopAt(at(2026, 7, 27, 18), 8, [shift('f', at(2026, 7, 27, 9), at(2026, 7, 27, 18))], cfg)
      === at(2026, 7, 27, 18));
}

/* ------------------------------------------------------------------ */
group('SEC / MIN / HR stepping');
{
  const ms = 90 * 60 * 1000 + 45 * 1000 + 500; // 1h 30m 45.5s
  near('sec quantises to the second', E.quantize(ms, 'sec'), 90 * 60000 + 45000);
  near('min quantises to the minute', E.quantize(ms, 'min'), 90 * 60000);
  near('hr  quantises to the hour', E.quantize(ms, 'hr'), 3600000);

  // What each toggle actually shows after 1h 30m 45.5s at $38/hr.
  const st = at(2026, 7, 27, 9);
  const shown = u => gross([shift('q', st, st + E.quantize(ms, u))]);
  near('SEC shows 1:30:45 of pay', shown('sec'), (90 * 60 + 45) / 3600 * 38, 1e-9);
  near('MIN shows 1:30:00 of pay', shown('min'), 1.5 * 38, 1e-9);
  near('HR  shows 1:00:00 of pay', shown('hr'), 38, 1e-9);
}

/* ------------------------------------------------------------------ */
group('Robustness');
{
  ok('zero-length shift is ignored', E.buildLedger([shift('z', at(2026, 7, 27, 9), at(2026, 7, 27, 9))], cfg).parts.length === 0);
  ok('inverted shift is ignored', E.buildLedger([shift('i', at(2026, 7, 27, 17), at(2026, 7, 27, 9))], cfg).parts.length === 0);

  // Out-of-order input must not change the answer — the ledger sorts before filling buckets.
  const a = [shift('x', at(2026, 7, 27, 9), at(2026, 7, 27, 21)),
             shift('y', at(2026, 7, 28, 9), at(2026, 7, 28, 21)),
             shift('z', at(2026, 7, 29, 9), at(2026, 7, 29, 21)),
             shift('w', at(2026, 7, 30, 9), at(2026, 7, 30, 21))]; // 48 h → 8 h OT
  near('chronological order → 8 h OT', E.buildLedger(a, cfg).parts.reduce((s, p) => s + p.otHours, 0), 8);
  near('reversed input → identical gross', gross(a.slice().reverse()), gross(a));

  // A long shift across a DST transition still bills real elapsed hours.
  // (US DST ends Sun Nov 1 2026; a 22:00 → 06:00 shift is 9 real hours where DST applies.)
  const dst = [shift('dst', at(2026, 10, 31, 22), at(2026, 11, 1, 6))];
  const dstH = E.sumSession(E.buildLedger(dst, cfg).parts, 'dst').hours;
  const realH = (at(2026, 11, 1, 6) - at(2026, 10, 31, 22)) / E.HOUR_MS;
  near('DST-night hours match real elapsed time', dstH, realH);

  ok('a whole 24 h day splits into exactly one part',
    E.splitSession(at(2026, 7, 27, 0), at(2026, 7, 28, 0), cfg).length === 1);

  // Marathon shift: must terminate and stay exact.
  const long = [shift('L', at(2026, 7, 27, 0), at(2026, 8, 3, 0))]; // 168 h
  near('7-day shift = 168 h', E.sumSession(E.buildLedger(long, cfg).parts, 'L').hours, 168);
}


/* ---------------- holidays and the roster ---------------- */
{
  const H = E.HOLIDAY_DEFAULTS();
  const by = id => H.find(h => h.id === id);
  const on = (h, y) => { const d = E.holidayDate(h, y); return d && E.dkey(d.getFullYear(), d.getMonth(), d.getDate()); };

  // Fixed dates are the easy half.
  ok("New Year's 2026 is Jan 1",  on(by('newyear'), 2026) === '2026-01-01');
  ok('July 4th 2026 is Jul 4',    on(by('july4'),   2026) === '2026-07-04');
  ok('Christmas 2026 is Dec 25',  on(by('xmas'),    2026) === '2026-12-25');
  ok('and they move year to year without editing',
     on(by('xmas'), 2031) === '2031-12-25' && on(by('july4'), 2044) === '2044-07-04');

  // The weekday rules are where a calendar goes wrong. Checked against real almanac dates.
  ok('Labor Day 2026 = Mon Sep 7',        on(by('labor'),    2026) === '2026-09-07');
  ok('Labor Day 2027 = Mon Sep 6',        on(by('labor'),    2027) === '2027-09-06');
  ok('Memorial Day 2026 = Mon May 25',    on(by('memorial'), 2026) === '2026-05-25');
  ok('Memorial Day 2027 = Mon May 31',    on(by('memorial'), 2027) === '2027-05-31');
  ok('Memorial Day 2032 = Mon May 31',    on(by('memorial'), 2032) === '2032-05-31');
  ok('Thanksgiving 2026 = Thu Nov 26',    on(by('thanks'),   2026) === '2026-11-26');
  ok('Thanksgiving 2027 = Thu Nov 25',    on(by('thanks'),   2027) === '2027-11-25');
  ok('Thanksgiving 2028 = Thu Nov 23',    on(by('thanks'),   2028) === '2028-11-23');

  // A month whose 1st IS the weekday in question — the classic off-by-one.
  // Sep 1 2025 was a Monday, so the 1st Monday is the 1st itself, not the 8th.
  ok('a month starting on the weekday counts that day as the first',
     on(by('labor'), 2025) === '2025-09-01');
  // May 31 2027 is a Monday, so "last Monday" is the final day of the month.
  ok('"last" reaches the final day when it lands there', on(by('memorial'), 2027) === '2027-05-31');

  // n past the end of the month has no date rather than spilling into the next one.
  ok('a 5th weekday that does not exist returns null',
     E.nthDow(2026, 1, 1, 5) === null);                       // no 5th Monday in Feb 2026
  ok('but a 5th weekday that does exist is found',
     E.dkey(2026, 2, E.nthDow(2026, 2, 1, 5).getDate()) === '2026-03-30');

  // One-off dates belong to their own year only.
  const once = { id: 'x', name: 'Contract day', rule: { kind: 'on', date: '2026-04-10' } };
  ok('a one-off lands on its date',      on(once, 2026) === '2026-04-10');
  ok('and does not repeat next year',    E.holidayDate(once, 2027) === null);

  const cfg = { holidays: H, workDays: [true, true, true, true, true, false, false] };
  const list = E.holidaysInYear(cfg, 2026);
  ok('six holidays in a year', list.length === 6, list.length);
  ok('in date order', list.every((h, i) => i === 0 || h.ms >= list[i - 1].ms));
  ok('and each carries the day it falls on', list[0].key === '2026-01-01');

  // Switching one off removes it without disturbing the rest.
  const off = H.map(h => h.id === 'july4' ? Object.assign({}, h, { on: false }) : h);
  ok('a holiday switched off drops out', E.holidaysInYear({ holidays: off }, 2026).length === 5);

  ok('a date with a holiday is recognised',
     E.holidayOn(cfg, new Date(2026, 8, 7).getTime()).id === 'labor');
  ok('and an ordinary day is not', E.holidayOn(cfg, new Date(2026, 8, 8).getTime()) === null);

  // The roster: Curtis works Sunday through Thursday.
  ok('Sunday is a work day',   E.isWorkDay(cfg, 0));
  ok('Thursday is a work day', E.isWorkDay(cfg, 4));
  ok('Friday is not',         !E.isWorkDay(cfg, 5));
  ok('Saturday is not',       !E.isWorkDay(cfg, 6));
  ok('an unset roster counts every day', E.isWorkDay({}, 6));

  // "The day before and the day after" means the shifts either side, not the dates.
  const key = d => E.dkey(d.getFullYear(), d.getMonth(), d.getDate());
  const mon = new Date(2026, 8, 7);                            // Labor Day 2026, a Monday
  ok('the shift before a Monday holiday is the Sunday',
     key(E.adjacentWorkDay(cfg, +mon, -1)) === '2026-09-06');
  ok('and the shift after is the Tuesday',
     key(E.adjacentWorkDay(cfg, +mon,  1)) === '2026-09-08');

  // A holiday on a day off has to skip the weekend to find the shifts either side.
  const fri = new Date(2026, 6, 3);                            // Fri Jul 3 2026
  ok('from a Friday, the shift before is the Thursday',
     key(E.adjacentWorkDay(cfg, +fri, -1)) === '2026-07-02');
  ok('and the shift after skips the weekend to Sunday',
     key(E.adjacentWorkDay(cfg, +fri,  1)) === '2026-07-05');

  // A one-day roster still resolves rather than spinning.
  const sundays = { workDays: [true, false, false, false, false, false, false] };
  ok('a one-day roster still finds the shift before',
     key(E.adjacentWorkDay(sundays, +new Date(2026, 8, 9), -1)) === '2026-09-06');
  ok('an empty roster has no adjacent shift',
     E.adjacentWorkDay({ workDays: [false,false,false,false,false,false,false] }, +mon, -1) === null);
}

/* ------------------------------------------------------------------ */
console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
