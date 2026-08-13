/* The job layer, while there is still only one job.
   Nothing here should be visible to a user. The point of the suite is that an old save
   becomes a job-shaped one silently, exactly once, and that everything downstream still
   reads the same numbers it did before. */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// The app under test sits two directories up from tests/ui/.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
// Set PW_CHROME to point at a specific build; otherwise Playwright finds its own.
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
}).listen(8196);

let fails = 0;
const ok = (n, c, x = '') => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  → ' + x : ''}`); if (!c) fails++; };
const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport:{width:1100,height:1800},
                                 timezoneId:'America/Chicago', locale:'en-US' });
const T = (d, h) => Date.UTC(2026, 7, d, h + 5, 0);          // America/Chicago, CDT

/* A save written before jobs existed: config at the top level, shifts with no jobId. */
const OLD = { configured: true,
  cfg: { rate: 37.78, otMultiplier: 1.5, otMode: 'weekly', weeklyThreshold: 40,
         periodThreshold: 80, dailyThreshold: 8, shiftThreshold: 8, weekStartDay: 0,
         periodAnchor: '2026-08-09', periodLengthDays: 14, payDateOffsetDays: 13,
         schedStart: '14:00', schedEnd: '22:30', lunchMins: 30,
         workDays: [true,true,true,true,true,false,false] },
  sessions: [ { id:'a', start:T(10,14), end:T(10,22)+30*60000 },
              { id:'b', start:T(11,14), end:T(11,22)+30*60000 } ],
  absences: [ { id:'x', date:'2026-08-12', kind:'calloff', hours:8 } ],
  activeStart: null, unit:'sec', ui:{open:{}}, net:{} };

async function boot(seed, at){
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  PAGE ERROR:', e.message); fails++; });
  p.on('console', m => { if (m.type()==='error'){ console.log('  CONSOLE ERROR:', m.text()); fails++; } });
  await p.addInitScript(([k, v]) => {
    if (sessionStorage.getItem('__s')) return;
    sessionStorage.setItem('__s','1');
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
  }, [KEY, seed === undefined ? null : seed]);
  await p.clock.install({ time: new Date(at) });
  await p.goto('http://localhost:8196/'); await p.waitForTimeout(700);
  await p.evaluate(() => document.querySelectorAll('.col').forEach(c => c.classList.add('open')));
  await p.waitForTimeout(300);
  return p;
}
const stored = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);

console.log('\n━━ An old save becomes a job-shaped one ━━');
let p = await boot(OLD, T(12, 16));
let d = await stored(p);
ok('there is exactly one job', Array.isArray(d.jobs) && d.jobs.length === 1,
   JSON.stringify((d.jobs || []).map(j => j.name)));
ok('it carries the whole config', d.jobs[0].cfg.rate === 37.78 && d.jobs[0].cfg.lunchMins === 30,
   '$' + d.jobs[0].cfg.rate + ' / ' + d.jobs[0].cfg.lunchMins + ' min');
ok('and it is the active one', d.activeJob === d.jobs[0].id, d.activeJob);
ok('every shift is stamped with it', d.sessions.every(s => s.jobId === d.jobs[0].id),
   d.sessions.map(s => s.jobId).join(','));
ok('and every absence too', d.absences.every(a => a.jobId === d.jobs[0].id));

/* The top-level cfg must NOT survive: a save carrying both would be read as an older save
   on the next load and migrated into a second, duplicate job. */
ok('the old top-level cfg is gone', d.cfg === undefined, JSON.stringify(d.cfg));

console.log('\n━━ state.cfg still works exactly as it did ━━');
const c = await p.evaluate(() => ({
  read: state.cfg.rate,
  sameObject: state.cfg === activeJob().cfg,
  enumerable: Object.keys(state).includes('cfg')
}));
ok('reading it gives the active job\'s config', c.read === 37.78, String(c.read));
ok('it IS the job\'s config, not a copy', c.sameObject);
ok('but it never serialises', !c.enumerable);
await p.evaluate(() => { state.cfg.rate = 41.5; save(); });
await p.waitForTimeout(300);
d = await stored(p);
ok('writing through it lands on the job', d.jobs[0].cfg.rate === 41.5, String(d.jobs[0].cfg.rate));
ok('and still nowhere else', d.cfg === undefined);
await p.evaluate(() => { state.cfg.rate = 37.78; save(); });

console.log('\n━━ Migration runs once, not every load ━━');
const before = JSON.stringify((await stored(p)).jobs);
await p.reload(); await p.waitForTimeout(800);
d = await stored(p);
ok('still one job after a reload', d.jobs.length === 1, String(d.jobs.length));
ok('with the same id', JSON.stringify(d.jobs) === before);
await p.reload(); await p.waitForTimeout(800);
d = await stored(p);
ok('and after a second one', d.jobs.length === 1 && JSON.stringify(d.jobs) === before);

console.log('\n━━ The numbers did not move ━━');
const figures = await p.evaluate(() => ({
  period: document.querySelector('#pGross').textContent,
  ytd: document.querySelector('#yGross').textContent,
  rows: document.querySelectorAll('#logBody tbody tr').length
}));
ok('the period total is a real figure', /\$\d/.test(figures.period), figures.period);
ok('year to date too', /\$\d/.test(figures.ytd), figures.ytd);
ok('and the log still lists the shifts', figures.rows >= 2, figures.rows + ' rows');

/* The engine must be fed this job's shifts, not the raw list — that is the whole seam the
   second job will arrive through. */
const seam = await p.evaluate(() => {
  const mine = jobSessions().length;
  state.sessions.push({ id:'other', jobId:'someone-else',
                        start: Date.now() - 7200e3, end: Date.now() - 3600e3 });
  const after = jobSessions().length;
  const led = jobLedger().parts.some(p => p.sessionId === 'other');
  state.sessions.pop();
  return { mine, after, led };
});
ok('another job\'s shift is not mine', seam.after === seam.mine, `${seam.mine} → ${seam.after}`);
ok('and never reaches my ledger', !seam.led);

console.log('\n━━ New shifts are stamped ━━');
await p.click('#punch'); await p.waitForTimeout(400);
await p.clock.fastForward(3600_000); await p.waitForTimeout(300);
await p.click('#punch'); await p.waitForTimeout(600);
d = await stored(p);
ok('a shift clocked now belongs to the active job',
   d.sessions.every(s => s.jobId === d.jobs[0].id),
   d.sessions.map(s => s.jobId || '(none)').join(','));

console.log('\n━━ Backups carry jobs, and still read old files ━━');
const backup = await p.evaluate(() => {
  const out = [];
  const real = window.download; window.download = (n, payload) => { out.push(payload); return true; };
  document.getElementById('backup').click();
  window.download = real;
  return out[0];
});
const bk = JSON.parse(backup);
ok('the backup carries the jobs', Array.isArray(bk.jobs) && bk.jobs.length === 1);
ok('and the active one', bk.activeJob === bk.jobs[0].id);
ok('and still writes cfg for older copies of the app', bk.cfg && bk.cfg.rate === 37.78,
   bk.cfg ? '$' + bk.cfg.rate : '(missing)');

const roundTrip = await p.evaluate(txt => {
  restoreFrom(txt);
  return { jobs: state.jobs.length, rate: state.cfg.rate, stamped: state.sessions.every(s => s.jobId) };
}, backup);
ok('restoring it gives one job back', roundTrip.jobs === 1, String(roundTrip.jobs));
ok('with the rate intact', roundTrip.rate === 37.78, String(roundTrip.rate));
ok('and every shift stamped', roundTrip.stamped);

// A backup written before jobs existed has to come back as one job.
const legacy = JSON.stringify({ app:'pay-clock', version:1, cfg:{ rate: 22.5 },
                                sessions:[{ id:'z', start:T(10,9), end:T(10,17) }], configured:true });
const old = await p.evaluate(txt => {
  restoreFrom(txt);
  return { jobs: state.jobs.length, rate: state.cfg.rate,
           stamped: state.sessions.every(s => s.jobId === state.activeJob) };
}, legacy);
ok('a pre-jobs backup restores as one job', old.jobs === 1, String(old.jobs));
ok('with its rate', old.rate === 22.5, String(old.rate));
ok('and its shifts adopted by that job', old.stamped);

console.log('\n━━ A first run starts job-shaped ━━');
await p.close();
p = await boot(undefined, T(12, 16));
d = await stored(p);
const fresh = await p.evaluate(() => ({ jobs: state.jobs.length, active: !!state.activeJob,
                                        cfg: typeof state.cfg }));
ok('a fresh install starts with one job', fresh.jobs === 1, String(fresh.jobs));
ok('an active job', fresh.active);
ok('and a working cfg', fresh.cfg === 'object');

console.log(`\n${fails === 0 ? '✅' : '❌'}  ${fails === 0 ? 'all passed' : fails + ' failed'}`);
await b.close(); srv.close();
process.exit(fails === 0 ? 0 : 1);
