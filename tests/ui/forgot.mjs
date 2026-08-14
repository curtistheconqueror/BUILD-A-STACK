/* A punch that was never ended.
   Forgetting to clock IN was solved three ways. Forgetting to clock OUT had nothing, and it
   is the more expensive mistake: the clock keeps running all night, and under a per-shift
   rule almost every invented hour bills at time and a half. */
import { chromium } from 'playwright';
import http from 'node:http'; import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
const CHROME = process.env.PW_CHROME || undefined;

const R = ROOT, KEY = 'payclock.v1';
const TY = {'.html':'text/html','.js':'text/javascript',
            '.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((q,r) => { let p = decodeURIComponent(q.url.split('?')[0]);
  if (p==='/'||p==='/index.html'){ r.writeHead(200,{'Content-Type':'text/html'});
    return r.end(readFileSync(R+'index.html')); }
  if (p==='/favicon.ico'){ r.writeHead(204); return r.end(); }
  const f = R+p; if (!existsSync(f)){ r.writeHead(404); return r.end('no'); }
  r.writeHead(200,{'Content-Type':TY[p.slice(p.lastIndexOf('.'))]||'application/octet-stream'});
  r.end(readFileSync(f));
}).listen(8208);
let fails = 0;
const ok = (n,c,x='') => { console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++; };

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport:{width:1100,height:2600},
                                 timezoneId:'America/Chicago', locale:'en-US' });
const T = (d,h,mi=0) => Date.UTC(2026, 7, d, h+5, mi);      // CDT

/* Curtis's roster: Sun–Thu, 2:00 PM to 10:30 PM, half-hour lunch, per-shift overtime —
   the rule under which a forgotten punch is most expensive. */
const CFG = { rate:37.78, otMultiplier:1.5, otMode:'shift', weeklyThreshold:40,
  periodThreshold:80, dailyThreshold:8, shiftThreshold:8, weekStartDay:0,
  periodAnchor:'2026-08-09', periodLengthDays:14, payDateOffsetDays:13,
  schedStart:'14:00', schedEnd:'22:30', lunchMins:30,
  workDays:[true,true,true,true,true,false,false],
  holidays:[], banks:[], daysOff:[], vacations:[], premiums:[] };

const seedAt = start => ({ configured:true,
  jobs:[{ id:'j1', name:'Pace', profession:'', primary:true,
          activeStart:start, activeAdj:null, cfg: JSON.parse(JSON.stringify(CFG)) }],
  activeJob:'j1', sessions:[], absences:[], units:[], stipends:[], otHist:[],
  unit:'sec', ui:{open:{hero:true}}, net:{} });

async function boot(seed, at){
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  PAGE ERROR:', e.message); fails++; });
  p.on('console', m => { if (m.type()==='error'){ console.log('  CONSOLE ERROR:', m.text()); fails++; } });
  await p.addInitScript(([k,v]) => { if (sessionStorage.getItem('__s')) return;
    sessionStorage.setItem('__s','1'); localStorage.setItem(k, JSON.stringify(v)); }, [KEY, seed]);
  await p.clock.install({ time:new Date(at) });
  await p.goto('http://localhost:8208/');
  await p.waitForFunction(() => typeof state !== 'undefined' && state.jobs, null, { timeout:15000 });
  await p.waitForTimeout(600);
  return p;
}
const seen = (p,sel) => p.evaluate(s => { const e = document.querySelector(s);
  return !!e && e.checkVisibility({contentVisibilityAuto:true, visibilityProperty:true}); }, sel);
const txt = (p,sel) => p.evaluate(s => (document.querySelector(s)?.textContent||'').trim(), sel);
const st  = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);

console.log('\n━━ An ordinary shift is never questioned ━━');
/* Being asked every time you stay late is how someone learns to dismiss it unread. */
let p = await boot(seedAt(T(12,14)), T(12,18));
ok('mid-shift there is no banner', !(await seen(p, '#forgotBar')));
await p.clock.setFixedTime(new Date(T(12,22,45))); await p.waitForTimeout(700);
ok('a quarter-hour over is still fine', !(await seen(p, '#forgotBar')));
await p.close();

console.log('\n━━ The next morning, the clock is still running ━━');
p = await boot(seedAt(T(12,14)), T(13,7));               // clocked in 2 PM, it is now 7 AM
ok('the banner is showing', await seen(p, '#forgotBar'));
const msg = (await txt(p, '#forgotTxt')).replace(/\s+/g,' ');
ok('it names the day the punch was made', /since Wed Aug 12/.test(msg), msg.slice(0,90));
ok('and how long it has run', /17\.00 h/.test(msg), msg.slice(0,120));
ok('it asks rather than tells', /Did you forget to clock out\?/.test(msg), msg.slice(0,150));
ok('it names the rostered end', /schedule ends at 10:30 PM/.test(msg), msg.slice(60,200));
ok('and what ending there would drop', /drops <?b?>?8\.50 h/.test(msg) || /8\.50 h/.test(msg),
   msg.slice(-140));
/* The number that makes the point: under a per-shift rule those hours are all overtime. */
ok('priced, so the stakes are visible', /\$\d/.test(msg), msg.slice(-90));
ok('the fix button offers the schedule time', /End it at 10:30 PM/.test(await txt(p, '#forgotFix')),
   await txt(p, '#forgotFix'));

console.log('\n━━ Ending it at the scheduled time ━━');
await p.click('#forgotFix'); await p.waitForTimeout(800);
const d = await st(p);
ok('the shift is banked', d.sessions.length === 1, String(d.sessions.length));
ok('ending at 10:30 PM, not 7 AM', d.sessions[0].end === T(12,22,30),
   new Date(d.sessions[0].end).toISOString());
ok('the clock is stopped', !d.jobs[0].activeStart, String(d.jobs[0].activeStart));
ok('the banner is gone', !(await seen(p, '#forgotBar')));
ok('and it says the log is still editable',
   /Edit it in the log/.test(await txt(p, '#toast')), await txt(p, '#toast'));
/* 2 PM–10:30 PM less the half-hour lunch is exactly 8.00 h — the threshold, no overtime. */
const banked = await p.evaluate(() => {
  const l = buildLedger(jobSessions(), state.cfg, Date.now());
  const t = sumRange(l.parts, +ymd('2026-08-09'), +ymd('2026-08-23'));
  return { h:t.hours, ot:t.otHours, g:t.gross }; });
ok('eight hours banked', Math.abs(banked.h - 8) < 0.01, banked.h.toFixed(2));
ok('with no invented overtime', banked.ot < 0.01, banked.ot.toFixed(2));
await p.close();

console.log('\n━━ What it saved ━━');
/* The same punch, banked as it stood: seventeen hours, nine of them at time and a half. */
p = await boot(seedAt(T(12,14)), T(13,7));
await p.click('#forgotKeep'); await p.waitForTimeout(500);
await p.click('#punch'); await p.waitForTimeout(800);
const runaway = await p.evaluate(() => {
  const l = buildLedger(jobSessions(), state.cfg, Date.now());
  const t = sumRange(l.parts, +ymd('2026-08-09'), +ymd('2026-08-23'));
  return { h:t.hours, ot:t.otHours, g:t.gross }; });
/* Seventeen on the clock, less the half-hour lunch the app still deducts. */
ok('left alone it banks sixteen and a half hours', Math.abs(runaway.h - 16.5) < 0.02,
   runaway.h.toFixed(2));
ok('almost nine of them overtime', runaway.ot > 8.4, runaway.ot.toFixed(2));
ok('worth hundreds that were never earned', runaway.g - banked.g > 400,
   '$' + (runaway.g - banked.g).toFixed(2));
await p.close();

console.log('\n━━ It never overrules you ━━');
p = await boot(seedAt(T(12,14)), T(13,7));
await p.click('#forgotKeep'); await p.waitForTimeout(600);
ok('keeping it running hides the banner', !(await seen(p, '#forgotBar')));
ok('the clock is still going', !!(await st(p)).jobs[0].activeStart);
ok('and it says it will not ask again',
   /will not ask about this shift again/.test(await txt(p, '#toast')), await txt(p, '#toast'));
await p.clock.setFixedTime(new Date(T(13,11))); await p.waitForTimeout(700);
ok('four hours later it is still quiet', !(await seen(p, '#forgotBar')));
/* A genuine long day exists. Clocking out after dismissing must not re-ask. */
await p.click('#punch'); await p.waitForTimeout(800);
ok('and clocking out just works', (await st(p)).sessions.length === 1,
   String((await st(p)).sessions.length));
ok('banking the full run', (await st(p)).sessions[0].end === T(13,11),
   new Date((await st(p)).sessions[0].end).toISOString());
await p.close();

console.log('\n━━ Tapping clock out on a forgotten punch asks first ━━');
p = await boot(seedAt(T(12,14)), T(13,7));
await p.click('#punch'); await p.waitForTimeout(700);
ok('nothing was banked yet', ((await st(p)).sessions || []).length === 0,
   String(((await st(p)).sessions || []).length));
ok('the clock is still running', !!(await st(p)).jobs[0].activeStart);
ok('and it says why', /check the end time before this is banked/.test(await txt(p, '#toast')),
   await txt(p, '#toast'));
ok('with the banner in view', await seen(p, '#forgotBar'));
/* Tapping again after being shown the question goes through — never a trap. */
await p.click('#punch'); await p.waitForTimeout(800);
ok('tapping again banks it', (await st(p)).sessions.length === 1);
await p.close();

console.log('\n━━ Dismissing one shift does not silence the next ━━');
p = await boot(seedAt(T(12,14)), T(13,7));
await p.click('#forgotKeep'); await p.waitForTimeout(500);
await p.click('#punch'); await p.waitForTimeout(700);
await p.evaluate(t => { state.activeStart = t; save(); lastMoney=''; lastHeavySig=''; render(); },
                 T(13,14));
await p.clock.setFixedTime(new Date(T(14,7))); await p.waitForTimeout(800);
ok('a fresh forgotten punch asks again', await seen(p, '#forgotBar'));
await p.close();

console.log('\n━━ A day off the roster falls back to a length no shift reaches ━━');
p = await boot(seedAt(Date.UTC(2026,7,15,19,0)), Date.UTC(2026,7,16,4,0));   // Sat, 9 h in
ok('nine hours on a Saturday is quiet', !(await seen(p, '#forgotBar')));
await p.clock.setFixedTime(new Date(Date.UTC(2026,7,16,10,0))); await p.waitForTimeout(700);
ok('fifteen hours is not', await seen(p, '#forgotBar'));
ok('and it does not claim a schedule it does not have',
   !/schedule ends at/.test(await txt(p, '#forgotTxt')),
   (await txt(p, '#forgotTxt')).replace(/\s+/g,' ').slice(0,140));
await p.close();

console.log('\n━━ The widget never traps you ━━');
/* Widget mode hides everything but its own card, so the question would be invisible.
   Banking a shift you can still edit beats a tap that appears to do nothing. */
const w = await ctx.newPage();
w.on('pageerror', e => { console.log('  PAGE ERROR:', e.message); fails++; });
await w.addInitScript(([k,v]) => { if (sessionStorage.getItem('__s')) return;
  sessionStorage.setItem('__s','1'); localStorage.setItem(k, JSON.stringify(v)); },
  [KEY, seedAt(T(12,14))]);
await w.clock.install({ time:new Date(T(13,7)) });
await w.goto('http://localhost:8208/?widget=1'); await w.waitForTimeout(800);
await w.click('#wpunch'); await w.waitForTimeout(700);
ok('the widget clocks out rather than stalling',
   (await w.evaluate(k => JSON.parse(localStorage.getItem(k)).sessions.length, KEY)) === 1);
await w.close();

console.log('\n━━ On a phone ━━');
const mob = await b.newContext({ viewport:{width:390,height:900}, isMobile:true, hasTouch:true,
  deviceScaleFactor:3, timezoneId:'America/Chicago', locale:'en-US' });
const q = await mob.newPage();
q.on('pageerror', e => { console.log('  PAGE ERROR:', e.message); fails++; });
await q.addInitScript(([k,v]) => { if (sessionStorage.getItem('__s')) return;
  sessionStorage.setItem('__s','1'); localStorage.setItem(k, JSON.stringify(v)); },
  [KEY, seedAt(T(12,14))]);
await q.clock.install({ time:new Date(T(13,7)) });
await q.goto('http://localhost:8208/'); await q.waitForTimeout(800);
ok('the banner shows on a phone', await seen(q, '#forgotBar'));
const m = await q.evaluate(() => {
  const small = [...document.querySelectorAll('#forgotBar button')]
    .filter(e => e.checkVisibility({contentVisibilityAuto:true, visibilityProperty:true}))
    .filter(e => e.getBoundingClientRect().height < 44)
    .map(e => e.id + ':' + Math.round(e.getBoundingClientRect().height));
  return { w:document.documentElement.scrollWidth, win:innerWidth, small };
});
ok('no sideways scroll', m.w <= m.win+1, `${m.w} vs ${m.win}`);
ok('both buttons are finger-sized', m.small.length === 0, m.small.join(', '));

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close(); process.exit(fails===0?0:1);
