/* OT expectancy. Two numbers — expected overtime, and the chance of clearing a yearly
   target — resampled from real history. Below the minimum it refuses to answer, because
   this feature exists to be trusted by someone who is not the user. */
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
}).listen(8205);
let fails = 0;
const ok = (n,c,x='') => { console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++; };

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport:{width:1100,height:2600},
                                 timezoneId:'America/Chicago', locale:'en-US' });
const T = (d,h,mo=7) => Date.UTC(2026, mo, d, h+5, 0);

/* Curtis's shape: $37.78, Sun–Thu, five 8-hour paid days a week. Ten completed periods of
   history — five months — with overtime in some of them. */
const CFG = { rate:37.78, otMultiplier:1.5, otMode:'weekly', weeklyThreshold:40,
  periodThreshold:80, dailyThreshold:8, shiftThreshold:8, weekStartDay:0,
  periodAnchor:'2026-08-09', periodLengthDays:14, payDateOffsetDays:13,
  schedStart:'14:00', schedEnd:'22:30', lunchMins:0,
  workDays:[true,true,true,true,true,false,false],
  holidays:[], banks:[], daysOff:[], vacations:[], premiums:[] };

const sess = [];
let sid = 0;
/* Twenty weeks, Sun Mar 22 through Sat Aug 8: Sun–Thu shifts, 8 h each, with a ninth hour
   Mon–Wed on even weeks so some periods carry overtime and some none. */
const week0 = Date.UTC(2026, 2, 22, 19, 0);           // Sun 22 Mar, 14:00 CDT
for (let w = 0; w < 20; w++){
  for (let d = 0; d < 5; d++){
    const start = week0 + (w*7 + d) * 864e5;
    const len = (w % 2 === 0 && d >= 1 && d <= 3) ? 9 : 8;
    sess.push({ id:'s'+(sid++), start, end: start + len*3600e3 });
  }
}
const SEED = { configured:true,
  jobs:[{ id:'j1', name:'Pace', profession:'transit_operator', primary:true,
          activeStart:null, activeAdj:null, cfg: JSON.parse(JSON.stringify(CFG)) }],
  activeJob:'j1', sessions:sess, absences:[], units:[], stipends:[], otHist:[],
  unit:'sec', ui:{open:{ote:true}}, net:{} };
const NOW = T(12, 11);                                 // Wed 12 Aug 2026

async function boot(seed, at){
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  PAGE ERROR:', e.message); fails++; });
  p.on('console', m => { if (m.type()==='error'){ console.log('  CONSOLE ERROR:', m.text()); fails++; } });
  await p.addInitScript(([k,v]) => { if (sessionStorage.getItem('__s')) return;
    sessionStorage.setItem('__s','1'); localStorage.setItem(k, JSON.stringify(v)); }, [KEY, seed]);
  await p.clock.install({ time:new Date(at) });
  await p.goto('http://localhost:8205/');
  await p.waitForFunction(() => typeof state !== 'undefined' && state.jobs, null, { timeout:15000 });
  await p.waitForTimeout(600);
  return p;
}
const seen = (p,sel) => p.evaluate(s => { const e = document.querySelector(s);
  return !!e && e.checkVisibility({contentVisibilityAuto:true, visibilityProperty:true}); }, sel);
const txt = (p,sel) => p.evaluate(s => (document.querySelector(s)?.textContent||'').trim(), sel);
const st  = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);

console.log('\n━━ With real history, it answers ━━');
let p = await boot(SEED, NOW);
ok('the outlook card is on screen', await seen(p, '#ote'));
ok('and its figures are showing', await seen(p, '#oReady'));
ok('not the not-enough-history notice', !(await seen(p, '#oNeed')));
const exp = await txt(p, '#oExp');
ok('expected overtime is a real number', /^\d+(\.\d)? h$/.test(exp), exp);
/* Ten periods, half with 3 h of OT: the mean must sit between the two shapes. */
/* Each period pairs one busy week (3 h OT) with one quiet one — so every sample is the
   same three hours, and the mean must be exactly that. */
const expN = parseFloat(exp);
ok('and reproduces the history exactly', Math.abs(expN - 3) < 0.05, exp);
const proj = await txt(p, '#oProj');
ok('the year projection is money', /^\$[\d,]+$/.test(proj), proj);
ok('with a range behind it, not one confident figure', /–/.test(await txt(p, '#oProjDet')),
   await txt(p, '#oProjDet'));
const prob = await txt(p, '#oProb');
ok('the chance is a percentage', /^\d+%$/.test(prob), prob);
ok('and says where it came from', /from \d+ real periods/.test(await txt(p, '#oProbDet')),
   await txt(p, '#oProbDet'));

console.log('\n━━ The target is yours to pick ━━');
ok('it starts at $100k', /100,000/.test(await txt(p, '#oProbK')), await txt(p, '#oProbK'));
const p100 = parseInt(await txt(p, '#oProb'));
await p.click('#oTargets button[data-t="90000"]'); await p.waitForTimeout(600);
const p90 = parseInt(await txt(p, '#oProb'));
ok('the heading follows the pick', /90,000/.test(await txt(p, '#oProbK')), await txt(p, '#oProbK'));
ok('a lower bar is never harder to clear', p90 >= p100, p90 + '% vs ' + p100 + '%');
await p.click('#oTargets button[data-t="120000"]'); await p.waitForTimeout(600);
const p120 = parseInt(await txt(p, '#oProb'));
ok('a higher one is never easier', p120 <= p100, p120 + '% vs ' + p100 + '%');
await p.click('#oTargets button[data-t="100000"]'); await p.waitForTimeout(500);

console.log('\n━━ It is a lever, and it says how the method works ━━');
const lever = (await txt(p, '#oLever')).replace(/\s+/g,' ');
ok('the lever sentence exists', lever.length > 20, lever.slice(0,110));
const method = (await txt(p, '#oMethod')).replace(/\s+/g,' ');
ok('the method is stated', /Resampled from your own recorded periods/.test(method), method.slice(0,90));
ok('and it promises stability', /moves once per pay period/.test(method), method.slice(-90));
ok('the folded heading carries both numbers',
   /h\/period · \d+% of \$100,000/.test(await txt(p, '#sum_ote')), await txt(p, '#sum_ote'));

console.log('\n━━ The figure holds still between renders ━━');
const before = await txt(p, '#oProb');
await p.clock.fastForward(90 * 1000); await p.waitForTimeout(500);
ok('ninety seconds later it has not flickered', (await txt(p, '#oProb')) === before,
   before + ' vs ' + await txt(p, '#oProb'));

console.log('\n━━ Old paystubs feed it by hand ━━');
await p.click('#ohAdd'); await p.waitForTimeout(300);
ok('it will not add without a month', /Pick the month/.test(await txt(p, '#toast')),
   await txt(p, '#toast'));
await p.fill('#ohMonth', '2025-12'); await p.click('#ohAdd'); await p.waitForTimeout(300);
ok('nor without the hours', /How many overtime hours/.test(await txt(p, '#toast')),
   await txt(p, '#toast'));
await p.fill('#ohHours', '26'); await p.click('#ohAdd'); await p.waitForTimeout(600);
ok('a month saves', /2025-12 saved/.test(await txt(p, '#toast')), await txt(p, '#toast'));
ok('and is listed', (await p.$$eval('#ohList .jobrow', r => r.length)) === 1);
ok('stamped with its job', (await st(p)).otHist[0].jobId === 'j1');
ok('the method now credits it', /1 month entered from old stubs/.test(await txt(p, '#oMethod')),
   (await txt(p, '#oMethod')).slice(0,140));
/* Typing the same month again corrects it rather than doubling it. */
await p.fill('#ohMonth', '2025-12'); await p.fill('#ohHours', '30');
await p.click('#ohAdd'); await p.waitForTimeout(600);
ok('re-entering a month replaces it', (await st(p)).otHist.length === 1
   && (await st(p)).otHist[0].otHours === 30, JSON.stringify((await st(p)).otHist));
await p.click('#ohList button[data-ohdel]'); await p.waitForTimeout(500);
ok('and it can be removed', (await st(p)).otHist.length === 0);

console.log('\n━━ The export never says verified ━━');
await p.evaluate(() => { window.__copied = null;
  navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; });
await p.fill('#ohMonth', '2025-11'); await p.fill('#ohHours', '20');
await p.click('#ohAdd'); await p.waitForTimeout(600);
await p.click('#oCopy'); await p.waitForTimeout(500);
const copied = await p.evaluate(() => window.__copied);
ok('a summary was copied', !!copied, String(copied).slice(0,60));
ok('it states the expectancy', /Expected overtime: [\d.]+ h per pay period/.test(copied), copied);
ok('and the chance', /Chance of clearing \$100,000: \d+%/.test(copied), copied);
ok('and the method with its sources', /resampled from \d+ real pay periods/i.test(copied), copied);
ok('manual entries are called what they are',
   /typed by the owner, not verified/.test(copied), copied);
ok('the word verified never stands alone as a claim', !/(^|[^не])verified\b/.test(
   copied.replace('not verified','')), copied);
await p.close();

console.log('\n━━ Too little history refuses to guess ━━');
const thin = JSON.parse(JSON.stringify(SEED));
thin.sessions = sess.slice(0, 20);                    // four weeks — two periods
p = await boot(thin, NOW);
ok('the notice shows instead of the figures', await seen(p, '#oNeed'));
ok('and the tiles are hidden', !(await seen(p, '#oReady')));
const need = (await txt(p, '#oNeed')).replace(/\s+/g,' ');
ok('it counts what it has against what it needs', /\d+ of 8/.test(need), need.slice(0,80));
ok('and says why it will not guess', /lie with a percent sign/.test(need), need.slice(-90));
ok('the folded heading says the same', /of 8 periods/.test(await txt(p, '#sum_ote')),
   await txt(p, '#sum_ote'));
/* Adding months from old stubs is the way in. */
for (const [ym, h] of [['2025-09',10],['2025-10',0],['2025-11',18],['2025-12',26],
                       ['2026-01',8],['2026-02',0]]){
  await p.fill('#ohMonth', ym); await p.fill('#ohHours', String(h));
  await p.click('#ohAdd'); await p.waitForTimeout(350);
}
ok('enough manual months unlock the figures', await seen(p, '#oReady'));
ok('and the notice is gone', !(await seen(p, '#oNeed')));
await p.close();

console.log('\n━━ It is a clock feature and stays out of other work ━━');
const surg = JSON.parse(JSON.stringify(SEED));
surg.jobs[0].profession = 'surgeon'; surg.sessions = [];
p = await boot(surg, NOW);
ok('a surgeon does not see it', !(await seen(p, '#ote')));
await p.close();

console.log('\n━━ On a phone ━━');
const mob = await b.newContext({ viewport:{width:390,height:900}, isMobile:true, hasTouch:true,
  deviceScaleFactor:3, timezoneId:'America/Chicago', locale:'en-US' });
const q = await mob.newPage();
q.on('pageerror', e => { console.log('  PAGE ERROR:', e.message); fails++; });
await q.addInitScript(([k,v]) => { if (sessionStorage.getItem('__s')) return;
  sessionStorage.setItem('__s','1'); localStorage.setItem(k, JSON.stringify(v)); }, [KEY, SEED]);
await q.clock.install({ time:new Date(NOW) });
await q.goto('http://localhost:8205/'); await q.waitForTimeout(900);
const m = await q.evaluate(() => {
  const small = [...document.querySelectorAll('#ote button, #ote input')]
    .filter(e => e.checkVisibility({contentVisibilityAuto:true, visibilityProperty:true}))
    .filter(e => e.getBoundingClientRect().height < 44)
    .map(e => (e.id||e.dataset.t||e.type) + ':' + Math.round(e.getBoundingClientRect().height));
  return { w:document.documentElement.scrollWidth, win:innerWidth, small };
});
ok('no sideways scroll', m.w <= m.win+1, `${m.w} vs ${m.win}`);
ok('every control is finger-sized', m.small.length === 0, m.small.join(', '));

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close(); process.exit(fails===0?0:1);
