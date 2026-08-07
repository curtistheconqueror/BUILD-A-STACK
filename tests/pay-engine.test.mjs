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
           workedOn, holidayEligibility, holidayYears, holidayCredits, holidayOutlook };
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

/* ------------------------------------------------------------------ */
console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
