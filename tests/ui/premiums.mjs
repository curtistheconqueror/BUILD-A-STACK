/* Premiums that stack, and callback minimums.
   The two parts of a nurse's pay that are not data — one differential was enough for a bus
   operator; a nurse can be on three at once, and a call-in pays a floor rather than a rate. */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
const CHROME = process.env.PW_CHROME || undefined;
const KEY = 'payclock.v1';

const TYPES = {'.html':'text/html','.js':'text/javascript',
               '.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/' || p === '/index.html'){ r.writeHead(200,{'Content-Type':'text/html'});
    return r.end(readFileSync(ROOT + 'index.html')); }
  if (p === '/favicon.ico'){ r.writeHead(204); return r.end(); }
  const f = ROOT + p.slice(1);
  if (!existsSync(f)){ r.writeHead(404); return r.end('no'); }
  r.writeHead(200, {'Content-Type': TYPES[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream'});
  r.end(readFileSync(f));
}).listen(8200);

let fails = 0;
const ok = (n, c, x = '') => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  → ' + x : ''}`); if (!c) fails++; };
const near = (n, got, want, tol = 0.02) =>
  ok(n, Math.abs(got - want) <= tol, `${(+got).toFixed(2)} vs ${(+want).toFixed(2)}`);
const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport:{width:1100,height:2400},
                                 timezoneId:'America/Chicago', locale:'en-US' });
const T = (d, h, mi = 0) => Date.UTC(2026, 7, d, h + 5, mi);

const CFG = { rate:40, otMultiplier:1.5, otMode:'weekly', weeklyThreshold:999999,
  periodThreshold:80, dailyThreshold:8, shiftThreshold:8, weekStartDay:0,
  periodAnchor:'2026-08-09', periodLengthDays:14, payDateOffsetDays:13,
  schedStart:'19:00', schedEnd:'07:00', lunchMins:0,
  workDays:[true,true,true,true,true,true,true],
  nightOn:true, nightFrom:'19:00', nightTo:'07:00', nightRate:5,
  premiums:[], callbackMin:0,
  holidays:[], banks:[], daysOff:[], vacations:[] };
const SEED = { configured:true,
  jobs:[{ id:'j1', name:'Hospital', profession:'nurse', primary:true,
          activeStart:null, activeAdj:null, cfg: JSON.parse(JSON.stringify(CFG)) }],
  activeJob:'j1', sessions:[], absences:[], unit:'sec', ui:{open:{period:1,log:1}}, net:{} };

async function boot(seed, at){
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  PAGE ERROR:', e.message); fails++; });
  p.on('console', m => { if (m.type()==='error'){ console.log('  CONSOLE ERROR:', m.text()); fails++; } });
  await p.addInitScript(([k,v]) => { if (sessionStorage.getItem('__s')) return;
    sessionStorage.setItem('__s','1'); localStorage.setItem(k, JSON.stringify(v)); }, [KEY, seed]);
  await p.clock.install({ time: new Date(at) });
  await p.goto('http://localhost:8200/'); await p.waitForTimeout(700);
  await p.evaluate(() => document.querySelectorAll('.col').forEach(c => c.classList.add('open')));
  await p.waitForTimeout(300);
  return p;
}
const openCfg = async p => { await p.evaluate(() =>
  document.querySelectorAll('#cfg details').forEach(d => d.open = true)); await p.waitForTimeout(300); };
const st = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
const NOW = T(20, 12);

console.log('\n━━ Adding premiums in Settings ━━');
let p = await boot(SEED, NOW);
await openCfg(p);
/* The list itself is an empty div until something is in it, so the control that matters is
   the way to add one. */
ok('there is a way to add a premium', await p.isVisible('#cPremAdd'));
ok('and a list to put it in', (await p.$$('#cPremList')).length === 1);
ok('and a callback minimum', await p.isVisible('#cCallback'));
ok('no premiums to start', (await p.$$('#cPremList .premrow')).length === 0);

await p.click('#cPremAdd'); await p.waitForTimeout(400);
ok('a row appears', (await p.$$('#cPremList .premrow')).length === 1);
await p.fill('#cPremList .premrow input[data-pf="name"]', 'Weekend');
await p.fill('#cPremList .premrow input[data-pf="rate"]', '3');
await p.waitForTimeout(500);
let d = await st(p);
ok('it saves', d.jobs[0].cfg.premiums.length === 1, String(d.jobs[0].cfg.premiums.length));
ok('with its name and rate',
   d.jobs[0].cfg.premiums[0].name === 'Weekend' && d.jobs[0].cfg.premiums[0].rate === 3,
   JSON.stringify(d.jobs[0].cfg.premiums[0]).slice(0, 70));

console.log('\n━━ Picking which days it applies to ━━');
const dayBtns = await p.$$('#cPremList .premrow .pdays button');
ok('seven day buttons', dayBtns.length === 7, String(dayBtns.length));
// Turn off Mon–Fri, leaving Sat and Sun.
for (const i of [1,2,3,4,5]){ await p.click(`#cPremList .premrow .pdays button[data-pday="${i}"]`);
  await p.waitForTimeout(120); }
d = await st(p);
ok('only the weekend is left',
   JSON.stringify(d.jobs[0].cfg.premiums[0].days) === '[1,0,0,0,0,0,1]',
   JSON.stringify(d.jobs[0].cfg.premiums[0].days));
/* A premium that applies to no day is not a premium. */
for (const i of [0,6]){ await p.click(`#cPremList .premrow .pdays button[data-pday="${i}"]`);
  await p.waitForTimeout(120); }
d = await st(p);
ok('turning off the last day is refused',
   d.jobs[0].cfg.premiums[0].days.some(Boolean),
   JSON.stringify(d.jobs[0].cfg.premiums[0].days));

console.log('\n━━ Three premiums on one hour ━━');
await p.evaluate(() => {
  state.cfg.premiums = [
    { id:'w', name:'Weekend', rate:3, from:'', to:'', days:[1,0,0,0,0,0,1] },
    { id:'c', name:'Charge',  rate:2, from:'', to:'', days:[1,1,1,1,1,1,1] }
  ];
  save(); renderPremiums(); lastHeavySig=''; _ledCache={}; render();
});
await p.waitForTimeout(500);
const stacked = await p.evaluate(t => {
  const list = premiumList(state.cfg);
  return { count: list.length, at: premiumsAt(t, list) };
}, T(16, 20));                                    // Sunday Aug 16, 8 PM
ok('three premiums are live', stacked.count === 3, String(stacked.count));
near('and a Sunday night hour stacks all three', stacked.at.rate, 10);
ok('naming each of them', stacked.at.names.join(',') === 'Night,Weekend,Charge',
   stacked.at.names.join(','));

const note = (await p.textContent('#cPremNote')).replace(/\s+/g, ' ');
ok('the note says what an hour is worth', /\+\$10\.00/.test(note), note.slice(0, 130));
ok('and names the premiums making it up', /Night \+ Weekend \+ Charge/.test(note), note.slice(0, 130));

console.log('\n━━ Paid on a real shift ━━');
// Sunday 7 PM to 1 AM: six hours, all night, all weekend... except the two past midnight,
// which are Monday, so they lose the weekend premium.
await p.evaluate(t => {
  state.sessions.push({ id:'s1', jobId: state.activeJob, start: t, end: t + 6*3600e3 });
  save(); lastHeavySig=''; _ledCache={}; render();
}, T(16, 19));
await p.waitForTimeout(600);
const paid = await p.evaluate(() => {
  const l = buildLedger(jobSessions(), state.cfg, Date.now());
  return sumRange(l.parts, +ymd('2026-08-09'), +ymd('2026-08-23'));
});
near('six hours', paid.hours, 6);
/* Five hours Sunday at 40+10, one hour Monday at 40+7 — the weekend premium stops at
   midnight because the day changed, which is the whole point of the day mask. */
near('the weekend premium stops at midnight', paid.gross, 5 * 50 + 1 * 47);

console.log('\n━━ Callback minimums ━━');
await p.fill('#cCallback', '3'); await p.dispatchEvent('#cCallback', 'change');
await p.waitForTimeout(500);
d = await st(p);
ok('the minimum saves', d.jobs[0].cfg.callbackMin === 3, String(d.jobs[0].cfg.callbackMin));

const cb = await p.evaluate(t => {
  state.sessions = [{ id:'cb', jobId: state.activeJob, callback: true, start: t, end: t + 20*60e3 }];
  save(); lastHeavySig=''; _ledCache={}; render();
  const l = buildLedger(jobSessions(), state.cfg, Date.now());
  return sumRange(l.parts, +ymd('2026-08-09'), +ymd('2026-08-23'));
}, T(18, 3));                                     // Tuesday 3 AM
await p.waitForTimeout(500);
near('twenty minutes pays the three-hour minimum', cb.hours, 3);
/* 3 AM is inside the night window, so the guaranteed block earns the differential too —
   a night callback is a night callback for all three hours. */
near('at base plus the night premium', cb.gross, 3 * 47);

const plain = await p.evaluate(t => {
  state.sessions = [{ id:'p1', jobId: state.activeJob, start: t, end: t + 20*60e3 }];
  save(); lastHeavySig=''; _ledCache={}; render();
  const l = buildLedger(jobSessions(), state.cfg, Date.now());
  return sumRange(l.parts, +ymd('2026-08-09'), +ymd('2026-08-23')).hours;
}, T(18, 3));
near('an ordinary short shift is still twenty minutes', plain, 1/3);

console.log('\n━━ Removing one ━━');
await openCfg(p);
const before = (await p.$$('#cPremList .premrow')).length;
/* Clicked through the page rather than with a synthetic mouse: the rows are rebuilt whenever
   settings redraw, so a mouse click resolved a moment earlier can land on a node that has
   since been replaced. */
await p.evaluate(() => document.querySelector('#cPremList .premrow button[data-pdel]').click());
await p.waitForTimeout(500);
ok('the row goes', (await p.$$('#cPremList .premrow')).length === before - 1,
   before + ' → ' + (await p.$$('#cPremList .premrow')).length);
ok('and the premium is gone from the config',
   (await st(p)).jobs[0].cfg.premiums.length === before - 1,
   String((await st(p)).jobs[0].cfg.premiums.length));
await p.evaluate(() => { state.cfg.premiums = []; state.cfg.nightOn = false;
  save(); renderPremiums(); });
await p.waitForTimeout(400);
ok('with none left the note says so',
   /No premiums/.test(await p.textContent('#cPremNote')), await p.textContent('#cPremNote'));

console.log('\n━━ On a phone ━━');
await p.close();
const mob = await b.newContext({ viewport:{width:390,height:1000}, isMobile:true, hasTouch:true,
  deviceScaleFactor:3, timezoneId:'America/Chicago', locale:'en-US' });
const q = await mob.newPage();
const two = JSON.parse(JSON.stringify(SEED));
two.jobs[0].cfg.premiums = [{ id:'w', name:'Weekend', rate:3, from:'', to:'', days:[1,0,0,0,0,0,1] }];
await q.addInitScript(([k,v]) => { if (sessionStorage.getItem('__s')) return;
  sessionStorage.setItem('__s','1'); localStorage.setItem(k, JSON.stringify(v)); }, [KEY, two]);
await q.clock.install({ time: new Date(NOW) });
await q.goto('http://localhost:8200/'); await q.waitForTimeout(700);
await q.evaluate(() => document.querySelectorAll('#cfg details').forEach(d => d.open = true));
await q.waitForTimeout(400);
const m = await q.evaluate(() => ({
  w: document.documentElement.scrollWidth, win: innerWidth,
  day: Math.round(document.querySelector('.pdays button').getBoundingClientRect().height),
  cb: Math.round(document.getElementById('cCallback').getBoundingClientRect().height)
}));
ok('no sideways scroll', m.w <= m.win + 1, `${m.w} vs ${m.win}`);
ok('the day buttons are tappable', m.day >= 34, m.day + 'px');
ok('and the callback field is finger-sized', m.cb >= 44, m.cb + 'px');

console.log(`\n${fails === 0 ? '✅' : '❌'}  ${fails === 0 ? 'all passed' : fails + ' failed'}`);
await b.close(); srv.close();
process.exit(fails === 0 ? 0 : 1);
