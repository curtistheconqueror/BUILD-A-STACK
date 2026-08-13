/* Work that is counted, not clocked.
   A surgeon has no punch to make. The production card replaces the clock entirely — and
   the maths behind it is the one thing that decides whether another case is worth taking:
   a base salary covers a threshold, and everything past it pays per unit. */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
// Scratch files never land in the repo.
const TMP = join(process.env.TMPDIR || '/tmp', 'wisewage-tests');
mkdirSync(TMP, { recursive: true });
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
}).listen(8201);

let fails = 0;
const ok = (n, c, x = '') => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  → ' + x : ''}`); if (!c) fails++; };

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport:{width:1100,height:2400},
                                 timezoneId:'America/Chicago', locale:'en-US' });

/* 2 July 2026, 06:00 Chicago. 182 days into the year — the pace divisor, hand-checked so
   every projection below is a fixed number rather than whatever the clock happens to say. */
const NOW = Date.UTC(2026, 6, 2, 11, 0);

const CFG = { rate:0, otMultiplier:1.5, otMode:'weekly', weeklyThreshold:40,
  periodThreshold:80, dailyThreshold:8, shiftThreshold:8, weekStartDay:0,
  periodAnchor:'2026-01-04', periodLengthDays:14, payDateOffsetDays:13,
  schedStart:'07:00', schedEnd:'17:00', lunchMins:0,
  workDays:[false,true,true,true,true,true,false],
  holidays:[], banks:[], daysOff:[], vacations:[], premiums:[],
  unitName:'wRVU', unitBase:350000, unitThreshold:5000, unitRate:45 };

/* 3,000 wRVU booked over the first half of the year. */
const U = (id, date, count, note) => ({ id, jobId:'j1', date, count, note: note || '' });
const SEED = { configured:true,
  jobs:[{ id:'j1', name:'North Memorial', profession:'surgeon', primary:true,
          activeStart:null, activeAdj:null, cfg: JSON.parse(JSON.stringify(CFG)) }],
  activeJob:'j1', sessions:[], absences:[],
  units:[ U('u1','2026-02-11', 1200, 'Q1 board'),
          U('u2','2026-04-20', 900,  'total knee'),
          U('u3','2026-06-15', 900,  '') ],
  unit:'sec', ui:{open:{}}, net:{} };

async function boot(seed, at){
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  PAGE ERROR:', e.message); fails++; });
  p.on('console', m => { if (m.type()==='error'){ console.log('  CONSOLE ERROR:', m.text()); fails++; } });
  await p.addInitScript(([k,v]) => { if (sessionStorage.getItem('__s')) return;
    sessionStorage.setItem('__s','1');
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); },
    [KEY, seed === undefined ? null : seed]);
  await p.clock.install({ time: new Date(at) });
  await p.goto('http://localhost:8201/'); await p.waitForTimeout(700);
  return p;
}
const seen = (p, sel) => p.evaluate(s => { const e = document.querySelector(s);
  return !!e && e.checkVisibility({contentVisibilityAuto:true, visibilityProperty:true}); }, sel);
const txt = (p, sel) => p.evaluate(s => (document.querySelector(s)?.textContent || '').trim(), sel);
const st  = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
const openCfg = async p => { await p.evaluate(() =>
  document.querySelectorAll('#cfg details').forEach(d => d.open = true)); await p.waitForTimeout(300); };

console.log('\n━━ The production card replaces the clock ━━');
let p = await boot(SEED, NOW);
ok('the production card is on screen', await seen(p, '#units'));
ok('and it is open without being asked', await seen(p, '#units .colbody'));
ok('there is no clock', !(await seen(p, '#hero')));
ok('no punch log', !(await seen(p, '#log')));
ok('no hours-to-overtime bar', !(await seen(p, '#progress')));
ok('and nothing about turning up early', !(await seen(p, '#extra')));
ok('the model says so', (await p.evaluate(() => jobModel())) === 'units');

console.log('\n━━ What has been booked, and where it lands ━━');
ok('the tile is labelled with the year', (await txt(p, '#uSoFarK')) === '2026 so far',
   await txt(p, '#uSoFarK'));
ok('3,000 wRVU so far', (await txt(p, '#uSoFar')) === '3,000', await txt(p, '#uSoFar'));
/* 3000 / 182 = 16.4835 a day. */
ok('a day rate and the days behind it',
   /16\.48 a day over 182 days/.test(await txt(p, '#uSoFarDet')), await txt(p, '#uSoFarDet'));
ok('named in the words the contract uses',
   (await txt(p, '#uSoFarDet')).startsWith('wRVU'), await txt(p, '#uSoFarDet'));
/* 3000 × 365.25/182 = 6,020.6 */
ok('the year projects to 6,021', (await txt(p, '#uPace')) === '6,021', await txt(p, '#uPace'));
ok('by the end of December', /31 December/.test(await txt(p, '#uPaceDet')), await txt(p, '#uPaceDet'));

console.log('\n━━ Below the threshold the salary is the whole of it ━━');
ok('earning the base and nothing else', (await txt(p, '#uPay')) === '$350,000.00', await txt(p, '#uPay'));
ok('and it says why', /nothing past the threshold yet/.test(await txt(p, '#uPayDet')),
   await txt(p, '#uPayDet'));
ok('the bar counts toward the threshold', /Toward 5,000 wRVU/.test(await txt(p, '#uBarLbl')),
   await txt(p, '#uBarLbl'));
ok('with the running figure beside it', (await txt(p, '#uBarNum')) === '3,000 / 5,000',
   await txt(p, '#uBarNum'));
ok('the note counts down the 2,000 to go', /2,000 wRVU/.test(await txt(p, '#uNote')),
   await txt(p, '#uNote'));
ok('and names what each one starts paying', /\$45\.00/.test(await txt(p, '#uNote')),
   await txt(p, '#uNote'));
const bars = await p.evaluate(() => ({
  reg: document.getElementById('uBarReg').style.width,
  over: document.getElementById('uBarOver').style.width }));
ok('the bar is filled 60% of the way', bars.reg === '60%', bars.reg);
ok('with nothing past it', bars.over === '0%', bars.over);

console.log('\n━━ The projection is priced, not just counted ━━');
/* 6,020.604 projected − 5,000 = 1,020.604 × $45 = $45,927.20 on top of the base. */
ok('at this pace the year is worth $395,927.20',
   /\$395,927\.20/.test(await txt(p, '#uWhatNote')), await txt(p, '#uWhatNote'));
ok('and says which pace that is', /At this pace/.test(await txt(p, '#uWhatNote')),
   await txt(p, '#uWhatNote'));

console.log('\n━━ What if the rest of the year ran differently ━━');
await p.click('#uWhat button[data-f="1.25"]'); await p.waitForTimeout(500);
/* 6,020.604 × 1.25 = 7,525.76 → over 2,525.76 × $45 = $113,659.19 + base */
let w = await txt(p, '#uWhatNote');
ok('a quarter more lands at 7,526', /7,526/.test(w), w);
ok('worth $463,659.00', /\$463,659\.00/.test(w), w);
ok('and it is stated as a gain on holding steady', /up /.test(w), w);
ok('by the difference', /\$67,731\.80/.test(w), w);
await p.click('#uWhat button[data-f="0.9"]'); await p.waitForTimeout(500);
w = await txt(p, '#uWhatNote');
ok('ten per cent slower is a loss', /down /.test(w), w);
ok('the button shows which one is picked',
   (await p.$$eval('#uWhat button.on', bs => bs.map(x => x.dataset.f))).join() === '0.9');
await p.click('#uWhat button[data-f="1"]'); await p.waitForTimeout(500);
ok('back to this pace', /At this pace/.test(await txt(p, '#uWhatNote')));

console.log('\n━━ Logging a case ━━');
ok('the count field is named after the unit', (await txt(p, '#uCountUnit')) === 'wRVU',
   await txt(p, '#uCountUnit'));
await p.click('#uAdd'); await p.waitForTimeout(400);
ok('it will not log without a date', /date/i.test(await txt(p, '#toast')), await txt(p, '#toast'));
await p.fill('#uDate', '2026-06-30'); await p.click('#uAdd'); await p.waitForTimeout(400);
ok('nor without a count', /How many wRVU/.test(await txt(p, '#toast')), await txt(p, '#toast'));
await p.fill('#uCount', '2500'); await p.fill('#uNoteIn', 'revision hip');
await p.click('#uAdd'); await p.waitForTimeout(600);
ok('it says what was logged', /2500 wRVU logged/.test(await txt(p, '#toast')), await txt(p, '#toast'));
ok('the form is cleared for the next one', (await p.inputValue('#uCount')) === '');
ok('the year is now 5,500', (await txt(p, '#uSoFar')) === '5,500', await txt(p, '#uSoFar'));

console.log('\n━━ Past the threshold, every unit is money ━━');
ok('500 past it', (await txt(p, '#uBarNum')) === '5,500 · 500 past it', await txt(p, '#uBarNum'));
ok('worth $22,500 so far', /\$22,500\.00/.test(await txt(p, '#uNote')), await txt(p, '#uNote'));
ok('and each further one adds $45', /adds \$45\.00/.test(await txt(p, '#uNote')), await txt(p, '#uNote'));
ok('earning is base plus productivity', (await txt(p, '#uPay')) === '$372,500.00', await txt(p, '#uPay'));
ok('the detail splits the two', /\$350,000\.00 base/.test(await txt(p, '#uPayDet'))
   && /\$22,500\.00/.test(await txt(p, '#uPayDet')), await txt(p, '#uPayDet'));
const bars2 = await p.evaluate(() => ({
  reg: document.getElementById('uBarReg').style.width,
  over: document.getElementById('uBarOver').style.width }));
/* Past the threshold the bar rescales to 5,500 rather than sitting pinned at full: 5,000
   of it is the base's share and the 500 that is paying per unit is visible on the end. */
ok('the threshold takes 90.9% of the bar', bars2.reg === '90.9%', bars2.reg);
ok('and the part past it is drawn', bars2.over === '9.1%', bars2.over);

console.log('\n━━ The log reads back ━━');
const rows = await p.$$eval('#uList .jobrow', rs => rs.map(r => r.textContent.trim()));
ok('four entries', rows.length === 4, rows.length + '');
ok('newest first', /revision hip/.test(rows[0]), rows[0]);
ok('with the count', /2500\.00/.test(rows[0]), rows[0]);
ok('an entry with no note falls back to the unit name',
   rows.some(r => /wRVU/.test(r)), rows.join(' | '));
ok('the heading summarises the card',
   /5,500 wRVU · \$372,500\.00/.test(await txt(p, '#sum_units')), await txt(p, '#sum_units'));

console.log('\n━━ Removing one puts it back ━━');
await p.click('#uList .jobrow:first-child button[data-udel]'); await p.waitForTimeout(600);
ok('three entries left', (await p.$$eval('#uList .jobrow', r => r.length)) === 3);
ok('the year is 3,000 again', (await txt(p, '#uSoFar')) === '3,000', await txt(p, '#uSoFar'));
ok('and the earning went back to the base', (await txt(p, '#uPay')) === '$350,000.00',
   await txt(p, '#uPay'));
ok('it is gone from storage', (await st(p)).units.length === 3);

console.log('\n━━ It survives a reload ━━');
await p.reload(); await p.waitForTimeout(800);
ok('still 3,000', (await txt(p, '#uSoFar')) === '3,000', await txt(p, '#uSoFar'));
ok('still the production card', await seen(p, '#units'));

console.log('\n━━ The contract lives in Settings ━━');
await openCfg(p);
ok('there is a contract group', await seen(p, '#gUnits'));
ok('the clock groups are not shown', !(await seen(p, '#gPay')) && !(await seen(p, '#gSched')));
ok('nor premiums', !(await seen(p, '#gPrem')));
await p.fill('#cUnitRate', '60'); await p.dispatchEvent('#cUnitRate', 'change');
await p.waitForTimeout(600);
ok('changing the rate saves', (await st(p)).jobs[0].cfg.unitRate === 60,
   String((await st(p)).jobs[0].cfg.unitRate));
ok('and re-prices what a unit is worth', /\$60\.00/.test(await txt(p, '#uNote')),
   await txt(p, '#uNote'));
await p.fill('#cUnitThr', '2000'); await p.dispatchEvent('#cUnitThr', 'change');
await p.waitForTimeout(600);
/* 3,000 − 2,000 = 1,000 × $60 = $60,000 */
ok('a lower threshold puts you past it', /1,000 wRVU/.test(await txt(p, '#uNote')),
   await txt(p, '#uNote'));
ok('and prices it', (await txt(p, '#uPay')) === '$410,000.00', await txt(p, '#uPay'));
await p.fill('#cUnitName', 'case'); await p.dispatchEvent('#cUnitName', 'change');
await p.waitForTimeout(600);
ok('renaming the unit renames it everywhere',
   (await txt(p, '#uCountUnit')) === 'case' && /case/.test(await txt(p, '#uBarLbl')),
   await txt(p, '#uBarLbl'));
await p.close();

console.log('\n━━ Units belong to their job ━━');
const two = JSON.parse(JSON.stringify(SEED));
two.jobs.push({ id:'j2', name:'Locum', profession:'surgeon', primary:false,
                activeStart:null, activeAdj:null,
                cfg: Object.assign(JSON.parse(JSON.stringify(CFG)), { unitBase:0, unitThreshold:0 }) });
two.units.push(U('u9','2026-03-03', 400, 'locum list'));
two.units[3].jobId = 'j2';
p = await boot(two, NOW);
ok('the first job counts only its own', (await txt(p, '#uSoFar')) === '3,000', await txt(p, '#uSoFar'));
await p.evaluate(() => { state.activeJob = 'j2'; save(); syncControls(); lastHeavySig=''; render(); });
await p.waitForTimeout(600);
ok('the second counts only its own', (await txt(p, '#uSoFar')) === '400', await txt(p, '#uSoFar'));
ok('and prices it on its own contract', (await txt(p, '#uPay')) === '$18,000.00', await txt(p, '#uPay'));
ok('its log has one row', (await p.$$eval('#uList .jobrow', r => r.length)) === 1);
await p.evaluate(() => { state.activeJob = 'j1'; save(); syncControls(); lastHeavySig=''; render(); });
await p.waitForTimeout(600);
ok('switching back is untouched by the other', (await txt(p, '#uSoFar')) === '3,000',
   await txt(p, '#uSoFar'));
await p.close();

console.log('\n━━ A job on a clock never sees any of it ━━');
const clockJob = JSON.parse(JSON.stringify(SEED));
clockJob.jobs[0].profession = 'transit_operator';
clockJob.jobs[0].cfg.rate = 37.78;
p = await boot(clockJob, NOW);
ok('the clock is back', await seen(p, '#hero'));
ok('and the production card is gone', !(await seen(p, '#units')));
await openCfg(p);
ok('so is the contract group', !(await seen(p, '#gUnits')));
ok('pay & overtime is back', await seen(p, '#gPay'));
await p.close();

console.log('\n━━ Backup carries production with it ━━');
p = await boot(SEED, NOW);
await openCfg(p);
const dl = await Promise.all([p.waitForEvent('download'), p.click('#backup')]).then(r => r[0]);
const file = join(TMP, 'units-backup.json');
await dl.saveAs(file);
const saved = JSON.parse(readFileSync(file, 'utf8'));
ok('the units are in the file', Array.isArray(saved.units) && saved.units.length === 3,
   String(saved.units && saved.units.length));
ok('stamped with their job', saved.units.every(u => u.jobId === 'j1'));
await p.evaluate(() => { state.units = []; save(); lastHeavySig = ''; render(); });
await p.waitForTimeout(400);
ok('cleared out', (await txt(p, '#uSoFar')) === '0', await txt(p, '#uSoFar'));
await p.setInputFiles('#restoreFile', file); await p.waitForTimeout(800);
ok('and restored again', (await txt(p, '#uSoFar')) === '3,000', await txt(p, '#uSoFar'));
ok('still a surgeon after the restore', (await p.evaluate(() => jobModel())) === 'units');
await p.close();

console.log('\n━━ On a phone ━━');
const mob = await b.newContext({ viewport:{width:390,height:900}, isMobile:true, hasTouch:true,
  deviceScaleFactor:3, timezoneId:'America/Chicago', locale:'en-US' });
const q = await mob.newPage();
q.on('pageerror', e => { console.log('  PAGE ERROR:', e.message); fails++; });
await q.addInitScript(([k,v]) => { if (sessionStorage.getItem('__s')) return;
  sessionStorage.setItem('__s','1'); localStorage.setItem(k, JSON.stringify(v)); }, [KEY, SEED]);
await q.clock.install({ time: new Date(NOW) });
await q.goto('http://localhost:8201/'); await q.waitForTimeout(800);
const m = await q.evaluate(() => {
  const small = [...document.querySelectorAll('#units button, #units input')]
    .filter(e => e.checkVisibility({contentVisibilityAuto:true, visibilityProperty:true}))
    .filter(e => e.getBoundingClientRect().height < 44)
    .map(e => (e.id || e.dataset.f || e.type) + ':' + Math.round(e.getBoundingClientRect().height));
  return { w: document.documentElement.scrollWidth, win: innerWidth, small,
           tiles: [...document.querySelectorAll('#units .tile')].length };
});
ok('no sideways scroll', m.w <= m.win + 1, `${m.w} vs ${m.win}`);
ok('three tiles', m.tiles === 3, String(m.tiles));
ok('every control is finger-sized', m.small.length === 0, m.small.join(', '));
ok('the numbers are readable', (await txt(q, '#uSoFar')) === '3,000', await txt(q, '#uSoFar'));

console.log(`\n${fails === 0 ? '✅' : '❌'}  ${fails === 0 ? 'all passed' : fails + ' failed'}`);
await b.close(); srv.close();
process.exit(fails === 0 ? 0 : 1);
