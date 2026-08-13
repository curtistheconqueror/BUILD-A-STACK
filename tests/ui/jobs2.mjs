/* The second job, visible.
   The promise being tested is reversibility: adding a job changes the app, and removing it
   puts everything back exactly as it was — including the parts that are supposed to vanish. */
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
}).listen(8197);

let fails = 0;
const ok = (n, c, x = '') => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  → ' + x : ''}`); if (!c) fails++; };
const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport:{width:1100,height:2200},
                                 timezoneId:'America/Chicago', locale:'en-US' });
const T = (d, h, mi = 0) => Date.UTC(2026, 7, d, h + 5, mi);

const SEED = { configured: true,
  jobs: [{ id:'j1', name:'Pace', profession:'', primary:true, activeStart:null, activeAdj:null,
           cfg:{ rate:40, otMultiplier:1.5, otMode:'weekly', weeklyThreshold:40,
                 periodThreshold:80, dailyThreshold:8, shiftThreshold:8, weekStartDay:0,
                 periodAnchor:'2026-08-09', periodLengthDays:14, payDateOffsetDays:13,
                 schedStart:'14:00', schedEnd:'22:30', lunchMins:0,
                 workDays:[true,true,true,true,true,false,false],
                 holidays:[], banks:[], daysOff:[], vacations:[] } }],
  activeJob: 'j1',
  // 38 hours at the first job: two short of overtime on its own.
  sessions: [9,10,11,12].map(d => ({ id:'p'+d, jobId:'j1', start:T(d,14), end:T(d,23,30) })),
  absences: [], unit:'sec', ui:{open:{hero:1,totals:1,period:1,log:1}}, net:{} };

async function boot(seed, at){
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  PAGE ERROR:', e.message); fails++; });
  p.on('console', m => { if (m.type()==='error'){ console.log('  CONSOLE ERROR:', m.text()); fails++; } });
  await p.addInitScript(([k,v]) => {
    if (sessionStorage.getItem('__s')) return;
    sessionStorage.setItem('__s','1'); localStorage.setItem(k, JSON.stringify(v));
  }, [KEY, seed]);
  await p.clock.install({ time: new Date(at) });
  await p.goto('http://localhost:8197/'); await p.waitForTimeout(700);
  await p.evaluate(() => document.querySelectorAll('.col').forEach(c => c.classList.add('open')));
  await p.waitForTimeout(300);
  return p;
}
const openCfg = async p => { await p.evaluate(() =>
  document.querySelectorAll('#cfg details').forEach(d => d.open = true)); await p.waitForTimeout(300); };
const st = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
const seen = (p, sel) => p.evaluate(s => { const e = document.querySelector(s);
  return !!e && e.checkVisibility({contentVisibilityAuto:true, visibilityProperty:true}); }, sel);

const NOW = T(13, 16);
let p = await boot(SEED, NOW);

console.log('\n━━ One job shows nothing extra ━━');
ok('no switcher', !(await seen(p, '#jobBar')));
ok('no overlap warning', !(await seen(p, '#jobWarn')));
const oneJob = await p.evaluate(() => ({
  period: document.querySelector('#pGross').textContent,
  ot: document.querySelector('#otNum').textContent
}));
ok('38 h at $40 with no overtime', oneJob.period === '$1,520.00', oneJob.period);

console.log('\n━━ Adding a second ━━');
await openCfg(p);
await p.click('#jobAdd'); await p.waitForTimeout(700);
let d = await st(p);
ok('there are two jobs now', d.jobs.length === 2, String(d.jobs.length));
ok('and the new one is showing', d.activeJob === d.jobs[1].id);
ok('its settings start from the first', d.jobs[1].cfg.rate === 40 && d.jobs[1].cfg.periodAnchor === '2026-08-09');
/* Time off is the one thing NOT copied: holidays and allowances are granted by an employer,
   and inheriting the first job's would invent days the second one never gave. */
ok('but not its time off', d.jobs[1].cfg.holidays.length === 0 && d.jobs[1].cfg.banks.length === 0);
ok('the switcher appears', await seen(p, '#jobBar'));
const chips = await p.$$eval('#jobBar .jobchip', bs => bs.map(x => x.textContent.trim()));
ok('with a chip each', chips.length === 2, chips.join(' | '));

console.log('\n━━ The new job starts empty ━━');
const fresh = await p.evaluate(() => ({
  period: document.querySelector('#pGross').textContent,
  rows: document.querySelectorAll('#logBody tbody tr').length
}));
ok('no pay yet', /\$0\.00/.test(fresh.period), fresh.period);
ok('and no shifts — the first job\'s stay with it', fresh.rows === 0, fresh.rows + ' rows');

console.log('\n━━ Overtime does not combine across employers ━━');
// Six hours at the second job. Combined that is 44 h; separately, neither reaches 40.
await p.evaluate(t => {
  state.sessions.push({ id:'s1', jobId: state.activeJob, start: t, end: t + 6*3600e3 });
  save(); lastHeavySig=''; _ledCache={}; render();
}, T(13, 8));
await p.waitForTimeout(600);
const second = await p.evaluate(() => ({
  period: document.querySelector('#pGross').textContent,
  ot: document.querySelector('#otNum').textContent
}));
ok('the second job bills 6 h straight', second.period === '$240.00', second.period);
ok('with no overtime, though the two together are 44 h', /0\.00 h in OT|6\.00 \/ 40/.test(second.ot), second.ot);

await p.click('#jobBar .jobchip:first-child'); await p.waitForTimeout(700);
const back = await p.evaluate(() => ({
  period: document.querySelector('#pGross').textContent,
  active: state.activeJob, name: activeJob().name
}));
ok('switching back shows the first job again', back.name === 'Pace', back.name);
/* The second job's six hours must not have touched this one. */
ok('with its own figure, untouched by the other job', back.period === '$1,520.00', back.period);

console.log('\n━━ Two clocks can run at once, and it says so ━━');
await p.click('#punch'); await p.waitForTimeout(500);
ok('the first job is running', (await st(p)).jobs[0].activeStart != null);
ok('no warning with one clock', !(await seen(p, '#jobWarn')));
await p.click('#jobBar .jobchip:nth-child(2)'); await p.waitForTimeout(600);
const stillRunning = await p.evaluate(() =>
  document.querySelectorAll('#jobBar .jobchip.live').length);
ok('the other job keeps counting while you look away', stillRunning === 1, String(stillRunning));
await p.click('#punch'); await p.waitForTimeout(500);
await p.clock.fastForward(1800_000); await p.waitForTimeout(500);
ok('both clocks now run', (await p.evaluate(() =>
   document.querySelectorAll('#jobBar .jobchip.live').length)) === 2);
ok('and the overlap is flagged', await seen(p, '#jobWarn'));
const warn = (await p.textContent('#jobWarn')).replace(/\s+/g, ' ');
ok('naming both jobs', /Pace/.test(warn) && /Second job/.test(warn), warn.slice(0, 90));
ok('and how long they have overlapped', /0\.5\d h/.test(warn), warn.slice(0, 90));

console.log('\n━━ Each clock stops on its own ━━');
await p.click('#punch'); await p.waitForTimeout(600);
ok('stopping this one leaves the other running',
   (await p.evaluate(() => document.querySelectorAll('#jobBar .jobchip.live').length)) === 1);
ok('and clears the warning', !(await seen(p, '#jobWarn')));
await p.click('#jobBar .jobchip:first-child'); await p.waitForTimeout(500);
await p.click('#punch'); await p.waitForTimeout(600);
ok('no clocks left', (await p.evaluate(() =>
   document.querySelectorAll('#jobBar .jobchip.live').length)) === 0);

console.log('\n━━ Naming ━━');
await openCfg(p);
await p.fill('#jobList input[data-jname]:nth-of-type(1)', 'Pace Suburban').catch(()=>{});
await p.evaluate(() => {
  const i = document.querySelector('#jobList input[data-jname]');
  i.value = 'Pace Suburban'; i.dispatchEvent(new Event('input', {bubbles:true}));
});
await p.waitForTimeout(500);
ok('a renamed job saves', (await st(p)).jobs[0].name === 'Pace Suburban');
ok('and the chip follows', (await p.textContent('#jobBar')).includes('Pace Suburban'));

console.log('\n━━ Removing the second puts everything back ━━');
/* On a clean page: the section above clocks in and out, which creates real shifts, so
   comparing against the very first reading would be comparing two different histories. */
await p.close();
const twoJob = JSON.parse(JSON.stringify(SEED));
twoJob.jobs.push({ id:'j2', name:'Second job', primary:false, activeStart:null, activeAdj:null,
  cfg: Object.assign({}, twoJob.jobs[0].cfg, {holidays:[],banks:[],daysOff:[],vacations:[]}) });
twoJob.sessions = twoJob.sessions.concat([{ id:'s2', jobId:'j2', start:T(13,8), end:T(13,14) }]);
p = await boot(twoJob, NOW);
const beforeRemoval = await p.evaluate(() => ({
  bar: !!document.querySelector('#jobBar').offsetParent,
  shifts: state.sessions.length
}));
ok('two jobs, five shifts between them', beforeRemoval.shifts === 5, String(beforeRemoval.shifts));
ok('and a switcher on screen', beforeRemoval.bar);

await openCfg(p);
const delSel = '#jobList .jobrow:nth-child(2) button[data-jdel]';
await p.click(delSel); await p.waitForTimeout(300);          // arms
await p.click(delSel); await p.waitForTimeout(800);          // confirms
d = await st(p);
ok('one job again', d.jobs.length === 1, String(d.jobs.length));
ok('the removed job took its shift with it', d.sessions.length === 4, String(d.sessions.length));
ok('and every survivor belongs to the one left',
   d.sessions.every(s => s.jobId === d.jobs[0].id), d.sessions.map(s => s.jobId).join(','));
ok('the switcher is gone', !(await seen(p, '#jobBar')));
ok('and so is the warning', !(await seen(p, '#jobWarn')));
const restored = await p.evaluate(() => ({
  period: document.querySelector('#pGross').textContent,
  ot: document.querySelector('#otNum').textContent
}));
ok('the figures are exactly what they were before the second job existed',
   restored.period === oneJob.period && restored.ot === oneJob.ot,
   restored.period + ' / ' + restored.ot);

console.log('\n━━ On a phone ━━');
await p.close();
const mob = await b.newContext({ viewport:{width:390,height:900}, isMobile:true, hasTouch:true,
  deviceScaleFactor:3, timezoneId:'America/Chicago', locale:'en-US' });
const two = JSON.parse(JSON.stringify(SEED));
two.jobs.push({ id:'j2', name:'Second job', primary:false, activeStart:null, activeAdj:null,
                cfg: Object.assign({}, two.jobs[0].cfg, {holidays:[],banks:[],daysOff:[],vacations:[]}) });
const q = await mob.newPage();
await q.addInitScript(([k,v]) => { if (sessionStorage.getItem('__s')) return;
  sessionStorage.setItem('__s','1'); localStorage.setItem(k, JSON.stringify(v)); }, [KEY, two]);
await q.clock.install({ time: new Date(NOW) });
await q.goto('http://localhost:8197/'); await q.waitForTimeout(700);
const m = await q.evaluate(() => ({
  w: document.documentElement.scrollWidth, win: innerWidth,
  h: Math.round(document.querySelector('.jobchip').getBoundingClientRect().height)
}));
ok('no sideways scroll', m.w <= m.win + 1, `${m.w} vs ${m.win}`);
ok('the chips are finger-sized', m.h >= 44, m.h + 'px');

console.log(`\n${fails === 0 ? '✅' : '❌'}  ${fails === 0 ? 'all passed' : fails + ' failed'}`);
await b.close(); srv.close();
process.exit(fails === 0 ? 0 : 1);
