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
           isWorkDay, anyWorkDay, adjacentWorkDay, dkey,
           workedOn, holidayEligibility, holidayYears, holidayCredits, holidayOutlook,
           BANK_DEFAULTS, bankById, daysOffUsed, bankLeft, bankSlots, dayOffName,
           bankCredits, daysOffOutlook, periodHistory, timeCardRows, timeCardTotals,
           extraTime, chartHours, otThresholdOf, otBucketKey, sumSessionRange,
           payMonths, currentPayMonth, shiftDayMs, toMinute };
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


/* ---------------- holiday pay ---------------- */
{
  // $38/hr, weekly 40 h overtime, Sunday-start weeks, Curtis's Sun-Thu roster.
  const hcfg = { ...E.DEFAULTS, rate: 38, periodAnchor: '2026-11-22',
                 workDays: [true, true, true, true, true, false, false] };
  const at = (y, mo, d, h) => new Date(y, mo, d, h).getTime();
  const sh = (id, mo, d, from, to) => ({ id, start: at(2026, mo, d, from), end: at(2026, mo, d, to) });
  const H = 3600000;

  // Thanksgiving 2026 is Thu Nov 26. Roster Sun-Thu, so either side means Wed 25 and Sun 29.
  const wed = sh('wed', 10, 25, 9, 17);          // 8 h
  const sun = sh('sun', 10, 29, 9, 17);          // 8 h
  const thu = sh('thu', 10, 26, 9, 17);          // 8 h worked ON the holiday

  const credits = s => E.holidayCredits(s, hcfg);
  const thxOnly = c => c.filter(x => x.id === '__hol:2026-11-26');

  ok('no credit with neither side worked', thxOnly(credits([])).length === 0);
  ok('no credit with only the day before', thxOnly(credits([wed])).length === 0);
  ok('no credit with only the day after',  thxOnly(credits([sun])).length === 0);
  ok('both sides worked earns it',         thxOnly(credits([wed, sun])).length === 1);

  const c = thxOnly(credits([wed, sun]))[0];
  ok('worth 8 hours',   Math.abs((c.end - c.start) / H - 8) < 1e-9, (c.end - c.start) / H);
  ok('placed on the holiday itself', E.dkey(new Date(c.start).getFullYear(),
     new Date(c.start).getMonth(), new Date(c.start).getDate()) === '2026-11-26');
  ok('flagged straight so it never pays overtime on itself', c.adj.straight === true);
  ok('and carries no lunch deduction', c.adj.noLunch === true);

  // Not working it: 16 h worked + 8 h holiday = 24 h, all straight. 24 * 38 = 912.
  const off = E.buildLedger([wed, sun], hcfg);
  const offT = off.parts.reduce((t, p) => ({ hours: t.hours + p.hours, gross: t.gross + p.gross,
                                             ot: t.ot + p.otHours }), { hours: 0, gross: 0, ot: 0 });
  near('not working it: 24 h banked', offT.hours, 24);
  near('paid $912.00', offT.gross, 912);
  near('none of it overtime', offT.ot, 0);

  // Working it: 24 h worked + 8 h holiday = 32 h. 32 * 38 = 1216.
  const on = E.buildLedger([wed, thu, sun], hcfg);
  const onT = on.parts.reduce((t, p) => ({ hours: t.hours + p.hours, gross: t.gross + p.gross,
                                           ot: t.ot + p.otHours }), { hours: 0, gross: 0, ot: 0 });
  near('working it: 32 h banked', onT.hours, 32);
  near('the worked hours are paid on top — $1,216.00', onT.gross, 1216);
  ok('which is exactly 8 h more than not working it', Math.abs((onT.gross - offT.gross) - 8 * 38) < 1e-6);

  /* The 8 holiday hours push worked hours into overtime sooner. Sun 22 - Wed 25 at 9 h
     banks 36 h straight. The credit sits at midnight opening Thursday, taking the bucket
     to 44 — past the 40 h line — so every one of Thursday's 9 worked hours is overtime.
     Without the credit Thursday would have had 4 h of headroom left, so 4 straight and
     5 over. The holiday therefore turns 5 h of overtime into 9. */
  const week = [sh('w22', 10, 22, 9, 18), sh('w23', 10, 23, 9, 18),   // 9 h each
                sh('w24', 10, 24, 9, 18), sh('w25', 10, 25, 9, 18),   // 36 h by Wed
                sh('w26', 10, 26, 9, 18)];                            // 9 h on the holiday
  const withHol = E.buildLedger(week.concat([sun]), hcfg);
  const wk = withHol.parts.filter(p => p.weekKey === withHol.parts.find(x => x.sessionId === 'w22').weekKey);
  const wkOt = wk.reduce((s, p) => s + p.otHours, 0);
  const wkHours = wk.reduce((s, p) => s + p.hours, 0);
  near('the holiday week banks 45 h + 8 h holiday = 53 h', wkHours, 53);
  near('9 h of it is overtime once the holiday counts', wkOt, 9);
  const noHol = E.buildLedger(week, { ...hcfg, holidayCredit: false });
  near('without the holiday counting it would be 5 h', noHol.parts.reduce((s, p) => s + p.otHours, 0), 5);
  // The holiday is paid straight even though the bucket was already past the line.
  const hp = withHol.parts.filter(p => p.sessionId === '__hol:2026-11-26');
  near('and the holiday itself is still straight time', hp.reduce((s, p) => s + p.otHours, 0), 0);
  near('worth 8 x $38 = $304.00', hp.reduce((s, p) => s + p.gross, 0), 304);

  // A holiday whose own flag says it does not count stays out of the bucket entirely.
  const noOtCfg = { ...hcfg, holidays: hcfg.holidays.map(h =>
                    h.id === 'thanks' ? { ...h, ot: false } : h) };
  const nc = E.holidayCredits([wed, sun], noOtCfg).filter(x => x.id === '__hol:2026-11-26')[0];
  ok('an OT-exempt holiday is flagged noOt', nc.adj.noOt === true && !nc.adj.straight);

  // Switching the rule off pays it regardless of what was worked.
  ok('with the either-side rule off it pays on its own',
     E.holidayCredits([], { ...hcfg, holidayNeedsAdjacent: false, holidays: hcfg.holidays })
      .filter(x => x.id === '__hol:2026-11-26').length === 1);

  // A holiday on a day off: July 4 2026 is a Saturday. Either side = Thu Jul 2, Sun Jul 5.
  const jcfg = { ...hcfg, periodAnchor: '2026-06-28' };
  const thu2 = sh('j2', 6, 2, 9, 17), sun5 = sh('j5', 6, 5, 9, 17);
  const j4 = cc => E.holidayCredits(cc, jcfg).filter(x => x.id === '__hol:2026-07-04').length;
  ok('a Saturday holiday still pays when either side is worked', j4([thu2, sun5]) === 1);
  ok('and does not when the Thursday is missed',                 j4([sun5]) === 0);
  ok('nor when the Sunday is missed',                            j4([thu2]) === 0);
  ok('set to not pay on a day off, it does not',
     E.holidayCredits([thu2, sun5], { ...jcfg, holidayOffDayPays: false })
      .filter(x => x.id === '__hol:2026-07-04').length === 0);

  // The outlook: what the app shows about each holiday.
  const look = E.holidayOutlook([wed], hcfg, at(2026, 10, 27, 12));   // the Friday after
  const thx = look.find(h => h.key === '2026-11-26');
  ok('Thanksgiving is still pending on the Friday', thx.status === 'pending', thx.status);
  ok('and names the Sunday as what is still needed',
     thx.need.length === 1 && E.dkey(thx.need[0].getFullYear(), thx.need[0].getMonth(),
                                     thx.need[0].getDate()) === '2026-11-29');
  const late = E.holidayOutlook([wed], hcfg, at(2026, 11, 5, 12)).find(h => h.key === '2026-11-26');
  ok('by the following week it is lost', late.status === 'lost', late.status);
  const got = E.holidayOutlook([wed, sun], hcfg, at(2026, 11, 5, 12)).find(h => h.key === '2026-11-26');
  ok('and earned once both are in', got.paid === true && got.status === 'paid');
  ok('the outlook prices it', Math.abs(got.pay - 8 * 38) < 1e-6, got.pay);

  /* A holiday from before the first shift on file was not missed — nothing was being
     tracked yet. Saying "missed" there would put four red badges on a new user's screen
     for days they may well have been paid for. */
  const early = E.holidayOutlook([wed, sun], hcfg, at(2026, 11, 5, 12));
  const ny = early.find(h => h.key === '2026-01-01');
  ok('a holiday before the first shift reads as untracked', ny.status === 'untracked', ny.status);
  ok('and claims nothing is owed for it', ny.paid === false && ny.need.length === 0);
  const xmas = early.find(h => h.key === '2026-12-25');
  ok('while one still ahead stays pending', xmas.status === 'pending', xmas.status);
  ok('an untracked holiday is still never credited',
     E.holidayCredits([wed, sun], hcfg).some(c => c.id === '__hol:2026-01-01') === false);
  ok('and knows whether it was worked', got.worked === false &&
     E.holidayOutlook([wed, thu, sun], hcfg, at(2026, 11, 5, 12))
      .find(h => h.key === '2026-11-26').worked === true);

  // Nothing is credited twice, however many times the ledger is built.
  const twice = E.buildLedger([wed, sun], hcfg);
  ok('one credit per holiday, not one per rebuild',
     twice.parts.filter(p => p.sessionId === '__hol:2026-11-26').length === 1);

  ok('an empty roster earns nothing rather than throwing',
     E.holidayCredits([wed, sun], { ...hcfg, workDays: [false,false,false,false,false,false,false] }).length === 0);
  ok('zero holiday hours credits nothing', E.holidayCredits([wed, sun], { ...hcfg, holidayHours: 0 }).length === 0);
  ok('no holidays configured credits nothing', E.holidayCredits([wed, sun], { ...hcfg, holidays: [] }).length === 0);
}


/* ---------------- floaters and sick days ---------------- */
{
  const B = E.BANK_DEFAULTS();
  ok('two banks ship', B.length === 2, B.length);
  const fl = E.bankById({ banks: B }, 'float'), sk = E.bankById({ banks: B }, 'sick');
  ok('four floaters',  fl.count === 4, fl.count);
  ok('five sick days', sk.count === 5, sk.count);
  ok('both worth 8 h', fl.hours === 8 && sk.hours === 8);
  ok('floaters count toward overtime', fl.ot === true);
  ok('sick days do not',               sk.ot === false);
  ok('the floater slots are named',
     JSON.stringify(fl.slots) === JSON.stringify(['Birthday','Anniversary','MLK Day','Extra floater']),
     JSON.stringify(fl.slots));

  const cfg3 = { ...E.DEFAULTS, rate: 38, periodAnchor: '2026-01-04', banks: B,
                 workDays: [true,true,true,true,true,false,false], daysOff: [] };

  ok('a fresh year has all four floaters', E.bankLeft(cfg3, 'float', 2026) === 4);
  ok('and all five sick days',             E.bankLeft(cfg3, 'sick',  2026) === 5);

  // Spend the MLK floater on MLK day 2026 (Mon Jan 19) and a sick day in March.
  const spent = { ...cfg3, daysOff: [
    { id: 'a', bank: 'float', slot: 2, date: '2026-01-19' },
    { id: 'b', bank: 'sick',  slot: null, date: '2026-03-10' }
  ]};
  ok('spending a floater leaves three', E.bankLeft(spent, 'float', 2026) === 3, E.bankLeft(spent, 'float', 2026));
  ok('spending a sick day leaves four', E.bankLeft(spent, 'sick',  2026) === 4, E.bankLeft(spent, 'sick', 2026));
  ok('and it is named by its slot', E.dayOffName(spent, spent.daysOff[0]) === 'MLK Day',
     E.dayOffName(spent, spent.daysOff[0]));
  ok('a slotless bank falls back to the bank name',
     E.dayOffName(spent, spent.daysOff[1]) === 'Sick day', E.dayOffName(spent, spent.daysOff[1]));

  const slots = E.bankSlots(spent, 'float', 2026);
  ok('four slots are reported', slots.length === 4);
  ok('MLK Day shows as taken', slots[2].used && slots[2].used.date === '2026-01-19');
  ok('the birthday is still free', slots[0].name === 'Birthday' && !slots[0].used);

  // Allowances run by calendar year, so next year starts full without anything being cleared.
  ok('next year is full again', E.bankLeft(spent, 'float', 2027) === 4);
  ok('and last year is too',    E.bankLeft(spent, 'float', 2025) === 4);
  ok('the used list is per year', E.daysOffUsed(spent, 'float', 2026).length === 1 &&
                                  E.daysOffUsed(spent, 'float', 2027).length === 0);

  // Pricing.
  const cr = E.bankCredits(spent);
  ok('two credits', cr.length === 2, cr.length);
  const flc = cr.find(c => c.bank === 'float'), skc = cr.find(c => c.bank === 'sick');
  near('a floater is worth 8 h', (flc.end - flc.start) / 3600000, 8);
  ok('a floater fills the overtime bucket', flc.adj.straight === true && !flc.adj.noOt);
  ok('a sick day does not',                 skc.adj.noOt === true && !skc.adj.straight);
  ok('neither has lunch taken off', flc.adj.noLunch === true && skc.adj.noLunch === true);
  ok('a floater is named on its credit', flc.dayOff === 'MLK Day', flc.dayOff);

  // In the ledger, next to real work. Week of Mon Jan 19 2026 (Sun Jan 18 starts it).
  const d = (day, from, to) => ({ id: 'w' + day, start: +new Date(2026, 0, day, from),
                                                 end: +new Date(2026, 0, day, to) });
  // Sun 18 - Thu 22 at 9 h = 45 h. Add the MLK floater on the Monday.
  const wk = [d(18,9,18), d(19,9,18), d(20,9,18), d(21,9,18), d(22,9,18)];
  /* Just the floater for this one — `spent` also holds a sick day in March, and the
     ledger prices everything it is given; the period windows come later, in sumRange. */
  const floatOnly = { ...spent, daysOff: [spent.daysOff[0]] };
  const led = E.buildLedger(wk, floatOnly);
  const tot = led.parts.reduce((t, p) => ({ h: t.h + p.hours, ot: t.ot + p.otHours, g: t.g + p.gross }),
                               { h: 0, ot: 0, g: 0 });
  near('45 h worked plus an 8 h floater = 53 h', tot.h, 53);
  const noFloat = E.buildLedger(wk, { ...spent, daysOff: [] });
  near('the March sick day is priced too, just outside this week',
       E.buildLedger(wk, spent).parts.reduce((s, p) => s + p.hours, 0), 61);
  near('without it, 45 h gives 5 h of overtime',
       noFloat.parts.reduce((s, p) => s + p.otHours, 0), 5);
  // The floater sits at midnight opening Monday: 9 h banked, +8 = 17, so the line is
  // reached 8 h sooner and overtime rises by 8.
  near('with it, 13 h of overtime', tot.ot, 13);
  const fp = led.parts.filter(p => p.sessionId === '__off:a');
  near('the floater itself is straight time', fp.reduce((s, p) => s + p.otHours, 0), 0);
  near('worth 8 x $38 = $304.00',             fp.reduce((s, p) => s + p.gross, 0), 304);

  // A sick day is paid but never moves the overtime line.
  const sickWeek = { ...cfg3, daysOff: [{ id: 's', bank: 'sick', slot: null, date: '2026-01-19' }] };
  const sl = E.buildLedger(wk, sickWeek);
  near('a sick day pays its 8 h', sl.parts.filter(p => p.sessionId === '__off:s')
       .reduce((s, p) => s + p.gross, 0), 304);
  near('but overtime stays where it was', sl.parts.reduce((s, p) => s + p.otHours, 0), 5);
  near('53 h all the same', sl.parts.reduce((s, p) => s + p.hours, 0), 53);

  // The outlook the app lists.
  const look = E.daysOffOutlook(spent, 2026);
  ok('both spent days are listed', look.length === 2, look.length);
  ok('earliest first', look[0].key === '2026-01-19');
  ok('named', look[0].name === 'MLK Day' && look[1].name === 'Sick day');
  ok('priced', Math.abs(look[0].pay - 304) < 1e-6);
  ok('and flagged for overtime correctly', look[0].ot === true && look[1].ot === false);

  // Robustness.
  ok('an unknown bank is skipped', E.bankCredits({ banks: B, daysOff: [{ id: 'x', bank: 'nope', date: '2026-01-01' }] }).length === 0);
  ok('a broken date is skipped',   E.bankCredits({ banks: B, daysOff: [{ id: 'x', bank: 'sick', date: 'not-a-date' }] }).length === 0);
  ok('zero hours credits nothing', E.bankCredits({ banks: [{ id: 'z', name: 'Z', count: 1, hours: 0 }],
                                                   daysOff: [{ id: 'x', bank: 'z', date: '2026-01-01' }] }).length === 0);
  ok('the calculator opts out entirely',
     E.bankCredits({ ...spent, holidayCredit: false }).length === 0);
  ok('spending more than the allowance cannot push the balance below zero',
     E.bankLeft({ ...cfg3, daysOff: [1,2,3,4,5,6].map(i => ({ id: 'f' + i, bank: 'float', slot: i - 1, date: '2026-0' + i + '-01' })) },
                'float', 2026) === 0);

  // A floater and a paid holiday on the same day are two separate entries, not one.
  const both = { ...spent, daysOff: [{ id: 'x', bank: 'float', slot: 0, date: '2026-12-25' }] };
  const dec = E.buildLedger([{ id: 'w1', start: +new Date(2026, 11, 24, 9), end: +new Date(2026, 11, 24, 17) },
                             { id: 'w2', start: +new Date(2026, 11, 27, 9), end: +new Date(2026, 11, 27, 17) }], both);
  ok('Christmas pays as a holiday', dec.parts.some(p => p.sessionId === '__hol:2026-12-25'));
  ok('and the floater pays as well', dec.parts.some(p => p.sessionId === '__off:x'));
  near('16 h worked + 8 h holiday + 8 h floater = 32 h',
       dec.parts.reduce((s, p) => s + p.hours, 0), 32);
}


/* ---------------- completed pay periods ---------------- */
{
  // Anchor Sun Jul 26 2026, 14-day periods, payday 13 days after the last day.
  const hcfg = { ...E.DEFAULTS, rate: 38, periodAnchor: '2026-07-26', periodLengthDays: 14,
                 payDateOffsetDays: 13, holidays: [], banks: [], daysOff: [] };
  const day = (mo, d, from, to) => ({ id: `s${mo}-${d}`, start: +new Date(2026, mo - 1, d, from),
                                                          end: +new Date(2026, mo - 1, d, to) });
  // Period 0: Jul 26 – Aug 8. Period 1: Aug 9 – Aug 22. Period 2: Aug 23 – Sep 5.
  const work = [
    day(7, 27, 9, 17), day(7, 28, 9, 17),               // 16 h in period 0
    day(8, 10, 9, 17), day(8, 11, 9, 17), day(8, 12, 9, 17),   // 24 h in period 1
    day(8, 24, 9, 17)                                    // 8 h in period 2
  ];
  const led = E.buildLedger(work, hcfg);
  // Standing in period 2, so periods 0 and 1 are complete.
  const now = +new Date(2026, 7, 25, 12);
  const hist = E.periodHistory(led.parts, hcfg, now, 24);

  ok('two completed periods', hist.length === 2, hist.length);
  ok('newest first', hist[0].index > hist[1].index, `${hist[0].index}, ${hist[1].index}`);
  ok('the period you are standing in is not listed',
     !hist.some(h => h.startMs <= now && h.endMs > now));

  const p1 = hist[0], p0 = hist[1];
  ok('the newer one is Aug 9 – Aug 22',
     p1.start.getDate() === 9 && p1.lastDay.getDate() === 22, `${p1.start} ${p1.lastDay}`);
  near('with 24 h', p1.hours, 24);
  near('and $912.00', p1.gross, 912);
  ok('payday Fri Sep 4', p1.payDate.getMonth() === 8 && p1.payDate.getDate() === 4);
  ok('not paid yet on Aug 25', p1.paid === false);

  ok('the older one is Jul 26 – Aug 8',
     p0.start.getDate() === 26 && p0.lastDay.getDate() === 8);
  near('with 16 h', p0.hours, 16);
  near('and $608.00', p0.gross, 608);
  ok('payday Fri Aug 21', p0.payDate.getMonth() === 7 && p0.payDate.getDate() === 21);
  ok('and it has been paid', p0.paid === true);

  // A period with nothing in it is skipped rather than listed as zeroes.
  const gap = [day(7, 27, 9, 17), day(8, 24, 9, 17)];    // nothing at all in period 1
  const gh = E.periodHistory(E.buildLedger(gap, hcfg).parts, hcfg, now, 24);
  ok('an empty period is left out', gh.length === 1 && gh[0].index === 0, gh.map(h => h.index));

  // Overtime is reported per period, and the premium banked before it is carried
  // so a past period's tax break is worked out on the room left at the time.
  const heavy = [];
  for (let d = 26; d <= 31; d++) heavy.push(day(7, d, 8, 20));   // 6 x 12 h in period 0
  const hl = E.buildLedger(heavy, hcfg);
  const hh = E.periodHistory(hl.parts, hcfg, now, 24);
  near('72 h in that period', hh[hh.length - 1].hours, 72);
  ok('with overtime recorded', hh[hh.length - 1].otHours > 0, hh[hh.length - 1].otHours);
  near('and nothing banked before it in the year', hh[hh.length - 1].otHoursBefore, 0);

  const twoBusy = heavy.concat([day(8, 10, 8, 20), day(8, 11, 8, 20), day(8, 12, 8, 20),
                                day(8, 13, 8, 20)]);            // 48 h in period 1
  const tb = E.periodHistory(E.buildLedger(twoBusy, hcfg).parts, hcfg, now, 24);
  ok('the later period knows what came before it', tb[0].otHoursBefore > 0, tb[0].otHoursBefore);
  near('and it is period 0\'s overtime', tb[0].otHoursBefore, tb[1].otHours);

  // Limits and edges.
  ok('the limit is respected', E.periodHistory(led.parts, hcfg, now, 1).length === 1);
  ok('no parts means no history', E.periodHistory([], hcfg, now, 24).length === 0);
  ok('standing in the first period there is nothing behind you',
     E.periodHistory(E.buildLedger([day(7, 27, 9, 17)], hcfg).parts, hcfg,
                     +new Date(2026, 6, 30, 12), 24).length === 0);
  // Holiday and booked days count toward a completed period the same as worked hours.
  const withHol = { ...hcfg, holidays: E.HOLIDAY_DEFAULTS(),
                    workDays: [true,true,true,true,true,false,false],
                    banks: E.BANK_DEFAULTS(),
                    daysOff: [{ id: 'f', bank: 'float', slot: 0, date: '2026-08-11' }] };
  const wh = E.periodHistory(E.buildLedger(work, withHol).parts, withHol, now, 24);
  near('a booked floater lands in its period', wh[0].hours, 32);
  near('and is paid in its total', wh[0].gross, 1216);
}


/* ---------------- the decimal time card ---------------- */
{
  // Curtis's real shape: scheduled 14:00–22:30, rostered Sun–Thu, half-hour unpaid lunch.
  const tcfg = { ...E.DEFAULTS, rate: 38, periodAnchor: '2026-07-26', periodLengthDays: 14,
                 schedStart: '14:00', schedEnd: '22:30', lunchMins: 30,
                 workDays: [true, true, true, true, true, false, false],
                 holidays: [], banks: [], daysOff: [] };
  const S = (id, mo, d, h1, m1, h2, m2) => ({ id, start: +new Date(2026, mo - 1, d, h1, m1),
                                                   end: +new Date(2026, mo - 1, d, h2, m2) });
  const from = +new Date(2026, 6, 26), to = +new Date(2026, 7, 9);

  // Sun Aug 2 is rostered: in at 12:33 (1h27 early), out at 23:03 (33 min late).
  const sun = S('sun', 8, 2, 12, 33, 23, 3);
  let r = E.timeCardRows([sun], tcfg, from, to)[0];
  ok('a rostered day is marked as such', r.rostered === true);
  near('1.45 h before the shift', r.before, 1.45);
  near('0.55 h after it',         r.after, 0.55);
  near('2.00 h to claim',         r.extra, 2.00);

  // Fri Aug 7 is NOT rostered: clocked 8:30 with a half-hour lunch = 8.00 paid, all of it.
  const fri = S('fri', 8, 7, 9, 0, 17, 30);
  r = E.timeCardRows([fri], tcfg, from, to)[0];
  ok('an unrostered day is marked', r.rostered === false);
  near('the whole paid day counts — 8.00', r.extra, 8.00);
  near('which is the paid hours, lunch already out', r.paid, 8.00);
  ok('and it is not split into before and after', r.before === 0 && r.after === 0);

  // Saturday behaves the same way.
  const sat = E.timeCardRows([S('sat', 8, 8, 9, 30, 18, 0)], tcfg, from, to)[0];
  near('Saturday is a clean 8.00 too', sat.extra, 8.00);
  ok('and is flagged unrostered', sat.rostered === false);

  // A rostered day worked exactly to schedule claims nothing.
  const onTime = E.timeCardRows([S('ot', 8, 3, 14, 0, 22, 30)], tcfg, from, to)[0];
  near('on-time day claims nothing', onTime.extra, 0);
  near('but its paid hours are still reported', onTime.paid, 8.00);

  // Only early.
  const early = E.timeCardRows([S('e', 8, 4, 12, 0, 22, 30)], tcfg, from, to)[0];
  near('two hours early', early.before, 2.00);
  near('nothing late',    early.after, 0);
  // Only late.
  const late = E.timeCardRows([S('l', 8, 5, 14, 0, 24, 1)], tcfg, from, to)[0];
  near('nothing early', late.before, 0);
  near('1.52 h late',   late.after, 1.52);

  // The whole period, the way it gets filled in.
  const week = [sun, S('mon', 8, 3, 14, 0, 24, 15), S('tue', 8, 4, 14, 0, 24, 1),
                S('wed', 8, 5, 12, 31, 24, 1), S('thu', 8, 6, 12, 32, 23, 55), fri, sat];
  const rows = E.timeCardRows(week, tcfg, from, to);
  ok('every day is listed', rows.length === 7, rows.length);
  ok('in date order', rows.every((x, i) => i === 0 || x.start >= rows[i - 1].start));
  ok('five rostered, two not', rows.filter(x => x.rostered).length === 5 &&
                               rows.filter(x => !x.rostered).length === 2);
  const t = E.timeCardTotals(rows);
  // rostered: Sun 1.45+0.55, Mon 0+1.75, Tue 0+1.52, Wed 1.48+1.52, Thu 1.47+1.42
  near('early time totals 4.40', t.before, 4.40);
  near('late time totals 6.76',  t.after, 6.76);
  near('unrostered days total 16.00', t.whole, 16.00);
  near('and the claim is 27.16', t.extra, 27.16);
  ok('the day count is right', t.days === 7);

  // Rounding is per entry, the way a slip adds them, not on the exact total.
  const two = [S('a', 8, 3, 13, 13, 22, 30), S('b', 8, 4, 13, 13, 22, 30)];   // 47 min early twice
  const tr = E.timeCardRows(two, tcfg, from, to);
  near('each 47-minute entry rounds to 0.78', tr[0].before, 0.78);
  near('and two of them make 1.56, not 1.57', E.timeCardTotals(tr).before, 1.56);

  // Windows and edges.
  ok('a shift outside the window is left out',
     E.timeCardRows([S('x', 9, 1, 14, 0, 22, 0)], tcfg, from, to).length === 0);
  ok('a zero-length shift is ignored',
     E.timeCardRows([S('z', 8, 3, 14, 0, 14, 0)], tcfg, from, to).length === 0);
  ok('with no schedule set, a rostered day claims nothing rather than guessing',
     E.timeCardRows([sun], { ...tcfg, schedStart: '', schedEnd: '' }, from, to)[0].extra === 0);
  ok('but an unrostered day still claims its whole paid day',
     E.timeCardRows([fri], { ...tcfg, schedStart: '', schedEnd: '' }, from, to)[0].extra === 8);
  ok('with every day rostered, nothing is a whole-day claim',
     E.timeCardTotals(E.timeCardRows(week, { ...tcfg, workDays: [1,1,1,1,1,1,1].map(Boolean) },
                                     from, to)).whole === 0);
}


/* ---------------- overtime counted per shift, not per calendar day ---------------- */
{
  /* The distinction that matters to anyone on nights: a shift running 2 PM to 12:30 AM is
     one shift, and the eight-hour allowance should not start again at midnight. */
  const scfg = { ...E.DEFAULTS, rate: 38, otMode: 'shift', shiftThreshold: 8,
                 periodAnchor: '2026-08-09', lunchMins: 0,
                 holidays: [], banks: [], daysOff: [],
                 workDays: [true, true, true, true, true, false, false] };
  const dcfg = { ...scfg, otMode: 'daily', dailyThreshold: 8 };
  const at = (d, h, mi = 0) => +new Date(2026, 7, d, h, mi);
  const tot = (sessions, c) => {
    const l = E.buildLedger(sessions, c);
    return l.parts.reduce((a, p) => ({ h: a.h + p.hours, ot: a.ot + p.otHours, g: a.g + p.gross }),
                          { h: 0, ot: 0, g: 0 });
  };

  // 2:00 PM – 12:30 AM = 10.5 h. Per shift: 8 straight, 2.5 over.
  const night = [{ id: 'n', start: at(11, 14), end: at(12, 0, 30) }];
  near('a shift crossing midnight is 10.5 h', tot(night, scfg).h, 10.5);
  near('per shift: 2.5 h of overtime',        tot(night, scfg).ot, 2.5);
  near('paid 8x38 + 2.5x57 = $446.50',        tot(night, scfg).g, 8 * 38 + 2.5 * 57);
  // The calendar rule gives less, because the last half hour starts a fresh allowance.
  near('the daily rule would say 2.0 h',      tot(night, dcfg).ot, 2.0);
  ok('so the shift rule is worth more here', tot(night, scfg).g > tot(night, dcfg).g,
     `${tot(night, scfg).g} vs ${tot(night, dcfg).g}`);

  // A longer one: 12:15 PM – 12:30 AM = 12.25 h -> 4.25 h over per shift, 3.75 daily.
  const longNight = [{ id: 'L', start: at(13, 12, 15), end: at(14, 0, 30) }];
  near('12.25 h shift gives 4.25 h per shift', tot(longNight, scfg).ot, 4.25);
  near('and 3.75 h by the calendar',           tot(longNight, dcfg).ot, 3.75);

  // Midnight genuinely does not reset it: a shift starting at 8 PM and running 12 h has
  // 4 h before midnight and 8 h after, and should still be 4 h over.
  const deep = [{ id: 'd', start: at(15, 20), end: at(16, 8) }];
  near('8 PM to 8 AM is 12 h', tot(deep, scfg).h, 12);
  near('per shift: 4 h over',  tot(deep, scfg).ot, 4);
  near('the daily rule finds none of it', tot(deep, dcfg).ot, 0);

  // A shift entirely inside one day behaves identically under both rules.
  const dayShift = [{ id: 'x', start: at(10, 9), end: at(10, 20) }];   // 11 h
  near('an 11 h day shift is 3 h over per shift', tot(dayShift, scfg).ot, 3);
  near('and 3 h over by the calendar too',        tot(dayShift, dcfg).ot, 3);

  // Each shift gets its own allowance — two short shifts in a day are not added together.
  const split = [{ id: 'a', start: at(17, 6), end: at(17, 12) },     // 6 h
                 { id: 'b', start: at(17, 18), end: at(18, 1) }];    // 7 h, crosses midnight
  near('13 h across two shifts', tot(split, scfg).h, 13);
  near('neither passes 8 h on its own, so no overtime', tot(split, scfg).ot, 0);
  // The same two under the calendar rule: 6 h + 6 h on the 17th is 12 h, so 4 h over.
  near('the calendar rule adds them and finds 4 h', tot(split, dcfg).ot, 4);

  // The threshold is its own setting, independent of the daily one.
  near('a 10 h per-shift threshold leaves 0.5 h over',
       tot(night, { ...scfg, shiftThreshold: 10 }).ot, 0.5);
  near('and changing the daily one does not touch it',
       tot(night, { ...scfg, dailyThreshold: 12 }).ot, 2.5);
  ok('the threshold reads back from the right field',
     E.otThresholdOf({ ...scfg, shiftThreshold: 9 }) === 9 &&
     E.otThresholdOf({ ...dcfg, dailyThreshold: 7 }) === 7);

  // An unpaid lunch comes out before the allowance is counted.
  near('with a half-hour lunch, 10.5 clocked is 10 paid',
       tot(night, { ...scfg, lunchMins: 30 }).h, 10);
  near('and 2 h over rather than 2.5',
       tot(night, { ...scfg, lunchMins: 30 }).ot, 2);

  // Crossing a pay-period boundary: the hours still belong to the periods they fall in,
  // but the shift's own overtime allowance runs straight through.
  // Period anchor Sun Aug 9, 14 days -> period ends midnight closing Sat Aug 22.
  const boundary = [{ id: 'bd', start: at(22, 20), end: at(23, 8) }];   // Sat 8 PM -> Sun 8 AM
  const bl = E.buildLedger(boundary, scfg);
  near('12 h in total', bl.parts.reduce((n, p) => n + p.hours, 0), 12);
  near('4 h of it over, counted across the boundary',
       bl.parts.reduce((n, p) => n + p.otHours, 0), 4);
  const p1 = E.periodInfo(at(22, 21), scfg), p2 = E.periodInfo(at(23, 1), scfg);
  ok('the two halves really are in different periods', p1.index !== p2.index,
     `${p1.index} vs ${p2.index}`);
  near('4 h land in the old period', E.sumRange(bl.parts, p1.startMs, p1.endMs).hours, 4);
  near('and 8 h in the new one',     E.sumRange(bl.parts, p2.startMs, p2.endMs).hours, 8);

  /* A shift belongs to both periods, and each has to be able to ask for just its own half.
     Without this the shift log summed the whole shift into whichever period was on screen
     while the period tile beside it summed only that period's share — two figures for the
     same fortnight, on the same screen. */
  const oldHalf = E.sumSessionRange(bl.parts, 'bd', p1.startMs, p1.endMs);
  const newHalf = E.sumSessionRange(bl.parts, 'bd', p2.startMs, p2.endMs);
  near('the old period\'s share is 4 h', oldHalf.hours, 4);
  near('the new period\'s share is 8 h', newHalf.hours, 8);
  ok('both know they are only part of a shift', oldHalf.clipped && newHalf.clipped);
  near('and the two halves add back to the whole', oldHalf.gross + newHalf.gross,
       bl.parts.reduce((n, p) => n + p.gross, 0));
  near('with the overtime landing in the half that earned it', newHalf.otHours, 4);
  near('and none of it in the other',                          oldHalf.otHours, 0);

  // A shift wholly inside one period is not marked as split.
  const inside = E.buildLedger([{ id: 'w', start: at(11, 14), end: at(12, 0, 30) }], scfg);
  const whole = E.sumSessionRange(inside.parts, 'w',
                                  E.periodInfo(at(11, 15), scfg).startMs,
                                  E.periodInfo(at(11, 15), scfg).endMs);
  ok('a shift inside one period is not clipped', whole.clipped === false);
  near('and reports all of its hours', whole.hours, 10.5);
}


/* ---------------- what you are paid in a month ---------------- */
{
  /* Curtis's real shape: 14-day periods anchored Sun Jul 26 2026, payday 13 days after
     the period ends.
       period 0  Jul 26 – Aug  8  -> paid Fri Aug 21   (August)
       period 1  Aug  9 – Aug 22  -> paid Fri Sep  4   (September)
       period 2  Aug 23 – Sep  5  -> paid Fri Sep 18   (September)
       period 3  Sep  6 – Sep 19  -> paid Fri Oct  2   (October)
     Two periods land in September, which is the case a naive calendar-month total gets
     wrong. */
  const mcfg = { ...E.DEFAULTS, rate: 38, periodAnchor: '2026-07-26', periodLengthDays: 14,
                 payDateOffsetDays: 13, lunchMins: 0, holidays: [], banks: [], daysOff: [] };
  const d = (mo, day, from, to) => ({ id: `${mo}-${day}`, start: +new Date(2026, mo - 1, day, from),
                                                          end: +new Date(2026, mo - 1, day, to) });
  const work = [
    d(7, 27, 9, 17), d(7, 28, 9, 17),                    // 16 h in period 0
    d(8, 10, 9, 17), d(8, 11, 9, 17),                    // 16 h in period 1
    d(8, 24, 9, 17)                                      // 8 h in period 2
  ];
  const parts = E.buildLedger(work, mcfg).parts;
  const now = +new Date(2026, 7, 25, 12);                // Tue Aug 25, inside period 2
  const months = E.payMonths(parts, mcfg, now, 0);

  ok('two pay months so far', months.length === 2, months.map(m => m.ym));
  ok('newest first', months[0].ym === '2026-09' && months[1].ym === '2026-08',
     months.map(m => m.ym));

  const aug = months.find(m => m.ym === '2026-08');
  const sep = months.find(m => m.ym === '2026-09');

  // August's money is period 0 only — worked mostly in July, paid Aug 21.
  near('August is paid 16 h', aug.hours, 16);
  near('worth $608.00',       aug.gross, 608);
  ok('from one period',       aug.periods.length === 1, aug.periods.length);
  ok('which was worked in July', aug.periods[0].start.getMonth() === 6);
  ok('August is not the live month', aug.live === false);

  // September gets BOTH periods that pay in it.
  ok('September collects two periods', sep.periods.length === 2, sep.periods.length);
  near('24 h between them', sep.hours, 24);
  near('worth $912.00',     sep.gross, 912);
  ok('and it is the live one', sep.live === true);

  ok('currentPayMonth points at September',
     E.currentPayMonth(parts, mcfg, now).ym === '2026-09');

  // Paid vs still owed.
  ok('August has been paid by Aug 25', aug.allPaid === true);
  ok('September has not', sep.allPaid === false);
  const early = E.payMonths(parts, mcfg, +new Date(2026, 7, 12, 12), 0);
  ok('and on Aug 12, August is not paid yet',
     early.find(m => m.ym === '2026-08').allPaid === false);

  // A month total is NOT the calendar month of the work.
  const augWork = E.sumRange(parts, +new Date(2026, 7, 1), +new Date(2026, 8, 1));
  near('work actually done in August is 24 h', augWork.hours, 24);
  ok('which is not what August pays', Math.abs(augWork.hours - aug.hours) > 0.001,
     `${augWork.hours} worked vs ${aug.hours} paid`);

  // The live month exists even before any hours are in it.
  const fresh = E.payMonths(E.buildLedger([], mcfg).parts, mcfg, now, 0);
  ok('an empty ledger still names the month being earned', fresh.length === 1 && fresh[0].live,
     JSON.stringify(fresh.map(m => m.ym)));
  near('at zero', fresh[0].gross, 0);

  // Overtime is carried through.
  const heavy = [];
  for (let x = 26; x <= 31; x++) heavy.push(d(7, x, 8, 20));    // 6 x 12 h in period 0
  const hm = E.payMonths(E.buildLedger(heavy, mcfg).parts, mcfg, now, 0);
  const hAug = hm.find(m => m.ym === '2026-08');
  near('72 h paid in August', hAug.hours, 72);
  ok('with overtime counted', hAug.otHours > 0, hAug.otHours);
  near('and priced with it', hAug.gross, 40 * 38 + 32 * 57);

  // Holidays and booked days land in the month their period pays in.
  const withOff = { ...mcfg, banks: E.BANK_DEFAULTS(),
                    daysOff: [{ id: 'f', bank: 'float', slot: 0, date: '2026-08-12' }] };
  const om = E.payMonths(E.buildLedger(work, withOff).parts, withOff, now, 0);
  near('a floater on Aug 12 pays in September', om.find(m => m.ym === '2026-09').hours, 32);
  near('and August is unchanged', om.find(m => m.ym === '2026-08').hours, 16);

  // Limits and edges.
  ok('the limit is respected', E.payMonths(parts, mcfg, now, 1).length === 1);
  ok('an empty month with no live flag is dropped',
     E.payMonths(parts, mcfg, now, 0).every(m => m.gross > 0 || m.live));
  ok('the months add back to the ledger',
     Math.abs(months.reduce((s, m) => s + m.gross, 0)
              - parts.reduce((s, p) => s + p.gross, 0)) < 1e-6);
}


/* ---------------- how close to overtime, under every rule ---------------- */
{
  /* Days, weeks and periods can be named from an instant alone. A shift cannot — two
     shifts can cover the same time of day — so the per-shift rule has to be told which
     shift, or find it. Getting this wrong reads the bucket "sundefined", which is always
     zero, so the overtime bar sits at nothing all shift and never warns. */
  const mk = m => ({ ...E.DEFAULTS, rate: 38, otMode: m, weeklyThreshold: 40,
                     periodThreshold: 80, dailyThreshold: 8, shiftThreshold: 8,
                     periodAnchor: '2026-08-09', lunchMins: 0,
                     holidays: [], banks: [], daysOff: [] });
  const start = +new Date(2026, 7, 10, 12, 15), now = +new Date(2026, 7, 10, 16, 25);
  const live = [{ id: '__active', start: start, end: now }];

  ['weekly', 'daily', 'shift'].forEach(mode => {
    const c = mk(mode), led = E.buildLedger(live, c);
    near(`${mode}: named shift reports the hours banked`,
         E.bucketHoursAt(led, now, c, '__active'), 25 / 6);
    near(`${mode}: and finds them without being told`,
         E.bucketHoursAt(led, now, c), 25 / 6);
  });

  // A wrong or unknown id must not silently read as zero-but-plausible; it reads zero,
  // which is why the caller has to pass the id it actually used.
  const sc = mk('shift'), sled = E.buildLedger(live, sc);
  near('an unknown shift id banks nothing', E.bucketHoursAt(sled, now, sc, '__nope'), 0);

  // Two shifts in one day: each has its own allowance, and the bar must follow the one
  // being worked rather than adding them.
  const two = [{ id: 'a', start: +new Date(2026, 7, 10, 6), end: +new Date(2026, 7, 10, 12) },
               { id: 'b', start: +new Date(2026, 7, 10, 18), end: +new Date(2026, 7, 10, 23) }];
  const tled = E.buildLedger(two, sc);
  near('the morning shift banks 6 h', E.bucketHoursAt(tled, +new Date(2026, 7, 10, 11), sc), 6);
  near('the evening one banks 5 h',   E.bucketHoursAt(tled, +new Date(2026, 7, 10, 22), sc), 5);
  const dled = E.buildLedger(two, mk('daily'));
  near('while the daily rule adds both to 11 h',
       E.bucketHoursAt(dled, +new Date(2026, 7, 10, 22), mk('daily')), 11);

  // Between shifts nothing is banked toward the next one.
  near('an hour with no shift on it banks nothing',
       E.bucketHoursAt(tled, +new Date(2026, 7, 10, 15), sc), 0);

  /* Across midnight the shift keeps its bucket, which is the whole point of the rule.
     Note what this function means: it is the bucket's total, not the hours up to `t`. That
     reads as "so far" in the app only because the ledger there is built up to now — the
     same is true of the weekly and daily rules. Here the shift is already complete, so all
     10.75 h of it are in the bucket at any instant inside it. */
  const night = [{ id: 'n', start: +new Date(2026, 7, 11, 14), end: +new Date(2026, 7, 12, 0, 45) }];
  const nled = E.buildLedger(night, sc);
  near('the shift banks all 10.75 h of itself',
       E.bucketHoursAt(nled, +new Date(2026, 7, 11, 23), sc), 10.75);
  near('and midnight does not divide it',
       E.bucketHoursAt(nled, +new Date(2026, 7, 12, 0, 30), sc), 10.75);
  const nd = mk('daily'), ndl = E.buildLedger(night, nd);
  near('where the daily rule starts the new day at 0.75 h',
       E.bucketHoursAt(ndl, +new Date(2026, 7, 12, 0, 30), nd), 0.75);
  near('and gives the evening 10 h of its own',
       E.bucketHoursAt(ndl, +new Date(2026, 7, 11, 23), nd), 10);

  // Hours-so-far, the way the app actually asks it: a ledger built up to the moment.
  const sofar = E.buildLedger([{ id: 'n', start: +new Date(2026, 7, 11, 14),
                                 end: +new Date(2026, 7, 11, 23) }], sc);
  near('a shift nine hours in reads nine hours',
       E.bucketHoursAt(sofar, +new Date(2026, 7, 11, 23), sc, 'n'), 9);
}


/* ---------------- which day a shift belongs to ---------------- */
{
  const c = { ...E.DEFAULTS, rate: 38, schedStart: '14:00', schedEnd: '22:30', lunchMins: 30,
              workDays: [true, true, true, true, true, false, false],
              holidays: [], banks: [], daysOff: [], periodAnchor: '2026-08-09' };
  // Sun Aug 16 2026 through Mon Aug 17.
  const on = (d, h, mi = 0) => +new Date(2026, 7, d, h, mi);
  const sh = (d1, h1, m1, d2, h2, m2) => ({ id: 'x', start: on(d1, h1, m1), end: on(d2, h2, m2) });
  const dayOf = (s, cfg = c) => {
    const d = new Date(E.shiftDayMs(s, cfg));
    return E.dkey(d.getFullYear(), d.getMonth(), d.getDate());
  };

  ok('a shift inside one day is that day',       dayOf(sh(16, 9, 0, 16, 17, 0)) === '2026-08-16');
  ok('6 PM to 2 AM is the evening it started',   dayOf(sh(16, 18, 0, 17, 2, 0)) === '2026-08-16');
  ok('10 PM to 6 AM is the next day',            dayOf(sh(16, 22, 0, 17, 6, 0)) === '2026-08-17');
  ok("Curtis's 2 PM to 10:30 PM is that day",    dayOf(sh(16, 14, 0, 16, 22, 30)) === '2026-08-16');
  ok("and his 12:15 PM to 12:45 AM too",         dayOf(sh(16, 12, 15, 17, 0, 45)) === '2026-08-16');
  ok('a shift ending exactly at midnight is the day it worked',
     dayOf(sh(16, 16, 0, 17, 0, 0)) === '2026-08-16');
  ok('an exact 50/50 split keeps the day it started',
     dayOf(sh(16, 20, 0, 17, 4, 0)) === '2026-08-16');
  ok('a minute past half tips it over',
     dayOf(sh(16, 20, 0, 17, 4, 1)) === '2026-08-17');
  ok('a shift spanning three days takes the fullest',
     dayOf({ id: 'l', start: on(16, 22, 0), end: on(18, 2, 0) }) === '2026-08-17');

  // Overrides, for employers who name shifts their own way.
  const byStart = { ...c, shiftDayRule: 'start' }, byEnd = { ...c, shiftDayRule: 'end' };
  ok('forced to the start day', dayOf(sh(16, 22, 0, 17, 6, 0), byStart) === '2026-08-16');
  ok('forced to the end day',   dayOf(sh(16, 18, 0, 17, 2, 0), byEnd) === '2026-08-17');
  ok('and "end" still will not claim a day with no hours in it',
     dayOf(sh(16, 16, 0, 17, 0, 0), byEnd) === '2026-08-16');
  ok('a zero-length shift falls back to its start day',
     dayOf({ id: 'z', start: on(16, 9), end: on(16, 9) }) === '2026-08-16');

  /* The reason this matters, with a real night worker: rostered Mon-Fri, scheduled
     10 PM to 6 AM. Their Monday shift starts Sunday night. Judged by the date it begins on
     it lands on Sunday — not a rostered day — and the time card would claim the whole
     shift as extra time instead of nothing. */
  const night = { ...c, schedStart: '22:00', schedEnd: '06:00', lunchMins: 0,
                  workDays: [false, true, true, true, true, true, false] };   // Mon-Fri
  const mondayShift = { id: 'm', start: on(16, 22, 0), end: on(17, 6, 0) };   // Sun 22:00 -> Mon 06:00
  ok('it is Monday\'s shift', dayOf(mondayShift, night) === '2026-08-17');
  const row = E.timeCardRows([mondayShift], night, on(9, 0), on(23, 0))[0];
  ok('so it counts as rostered', row.rostered === true);
  near('and a shift worked exactly to schedule claims nothing', row.extra, 0);
  near('while still reporting its 8 paid hours', row.paid, 8);

  const rowStart = E.timeCardRows([mondayShift], { ...night, shiftDayRule: 'start' },
                                  on(9, 0), on(23, 0))[0];
  ok('named by the day it began, it reads as unrostered', rowStart.rostered === false);
  near('and the whole shift is wrongly claimed', rowStart.extra, 8);

  // Clocking in an hour early on that same shift is an hour to claim, not eight.
  const early = E.timeCardRows([{ id: 'e', start: on(16, 21, 0), end: on(17, 6, 0) }],
                               night, on(9, 0), on(23, 0))[0];
  near('an hour early is 1.00 to claim', early.before, 1);
  near('nothing late',                   early.after, 0);

  // A genuinely unrostered shift is still unrostered.
  const satDay = { id: 'd', start: on(15, 9, 0), end: on(15, 17, 30) };
  ok('a Saturday daytime shift is still not rostered',
     E.timeCardRows([satDay], c, on(9, 0), on(23, 0))[0].rostered === false);
  const satNight = { id: 's', start: on(15, 22, 0), end: on(16, 6, 0) };
  ok('and a Saturday night that is really Sunday is rostered for a Sun-Thu roster',
     E.timeCardRows([satNight], c, on(9, 0), on(23, 0))[0].rostered === true);
}


/* ---------------- slip figures read the punch as printed ---------------- */
{
  /* Curtis clocked in at 12:15-and-some-seconds against a 2 PM start. The screen said
     12:15 PM, so the slip says 1.75 — but measuring from the raw stamp gave 104 minutes
     and 1.73. A hundredth, every shift, on the figure that goes to payroll. */
  const c = { ...E.DEFAULTS, rate: 38, schedStart: '14:00', schedEnd: '22:30', lunchMins: 30,
              workDays: [true, true, true, true, true, false, false],
              holidays: [], banks: [], daysOff: [], periodAnchor: '2026-08-09' };
  const at = (h, mi, sec = 0) => +new Date(2026, 7, 9, h, mi, sec);
  const ex = (h, mi, sec) => E.extraTime(at(h, mi, sec), at(22, 30), 14 * 60, 22 * 60 + 30);

  near('a clean 12:15 is 1.75 h early', E.chartHours(ex(12, 15, 0).before), 1.75);
  near('12:15 and 40 seconds is still 1.75',  E.chartHours(ex(12, 15, 40).before), 1.75);
  near('12:15 and 59 seconds is still 1.75',  E.chartHours(ex(12, 15, 59).before), 1.75);
  near('12:16 on the nose drops to 1.73',     E.chartHours(ex(12, 16, 0).before), 1.73);
  near('and 12:16:59 is still 1.73',          E.chartHours(ex(12, 16, 59).before), 1.73);

  // The same at the other end of the shift.
  const late = (h, mi, sec) => E.extraTime(at(14, 0), at(h, mi, sec), 14 * 60, 22 * 60 + 30);
  near('out at 23:00 flat is 0.50 late',   E.chartHours(late(23, 0, 0).after), 0.50);
  near('23:00 and 50 seconds is still 0.50', E.chartHours(late(23, 0, 50).after), 0.50);
  near('23:01 is 0.52',                    E.chartHours(late(23, 1, 0).after), 0.52);

  ok('toMinute drops the seconds', E.toMinute(at(12, 15, 59)) === at(12, 15, 0));
  ok('and leaves a clean minute alone', E.toMinute(at(12, 15, 0)) === at(12, 15, 0));

  // The time card's own figures follow the same rule.
  const row = E.timeCardRows([{ id: 'r', start: at(12, 15, 40), end: at(22, 30, 20) }],
                             c, at(0, 0), at(23, 59))[0];
  near('the card reads 1.75 early', row.before, 1.75);
  near('nothing late',              row.after, 0);
  near('claiming 1.75',             row.extra, 1.75);
  near('and 9.75 h paid after the half-hour lunch', row.paid, 9.75);

  // A whole fortnight of punches with seconds on them must not drift.
  const week = [];
  for (let d = 9; d <= 13; d++)
    week.push({ id: 'd' + d, start: +new Date(2026, 7, d, 12, 15, 37),
                             end:   +new Date(2026, 7, d, 22, 30, 11) });
  const t = E.timeCardTotals(E.timeCardRows(week, c, +new Date(2026, 7, 8), +new Date(2026, 7, 15)));
  near('five days at 1.75 is 8.75, not 8.65', t.before, 8.75);
  near('with nothing late',                   t.after, 0);
  near('and 8.75 to claim',                   t.extra, 8.75);
}

/* ------------------------------------------------------------------ */
console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
