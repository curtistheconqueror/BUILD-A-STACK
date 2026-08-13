/* What a second job does to your tax.
   Overtime never combines across employers; tax does, because it is charged to a person
   rather than to a payroll department. Two consequences, neither of which appears on either
   employer's payslip, because neither employer can see the other. */
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
}).listen(8198);

let fails = 0;
const ok = (n, c, x = '') => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  → ' + x : ''}`); if (!c) fails++; };
const near = (n, got, want, tol = 0.02) =>
  ok(n, Math.abs(got - want) <= tol, `${(+got).toFixed(2)} vs ${(+want).toFixed(2)}`);
const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport:{width:1100,height:2400},
                                 timezoneId:'America/Chicago', locale:'en-US' });

/* Late December, so a year's earnings are nearly all in and "at this pace" is close to the
   real year. Wages are seeded as one long shift per job at a rate chosen to land on a round
   figure — the point here is the tax arithmetic, not the ledger's. */
/* weeklyThreshold is set out of reach on purpose: these fixtures are about the tax
   arithmetic, and a 1,200-hour block against a 40-hour rule is almost entirely overtime,
   which would make the wage figures something other than what they say. */
const cfgFor = rate => ({ rate: rate, otMultiplier:1.5, otMode:'weekly', weeklyThreshold:999999,
  periodThreshold:80, dailyThreshold:8, shiftThreshold:8, weekStartDay:0,
  periodAnchor:'2026-01-04', periodLengthDays:14, payDateOffsetDays:13,
  schedStart:'09:00', schedEnd:'17:00', lunchMins:0,
  workDays:[false,true,true,true,true,true,false],
  holidays:[], banks:[], daysOff:[], vacations:[] });

// One shift of `hours` at `rate`, entirely inside 2026, paid straight through.
const wages = (id, jobId, hours, startDay) => ({
  id, jobId, start: Date.UTC(2026, 0, startDay, 14), end: Date.UTC(2026, 0, startDay, 14) + hours * 3600e3 });

function seed(jobs){
  return { configured: true,
    jobs: jobs.map((j, i) => ({ id:'j'+(i+1), name:j.name, primary:i===0,
                                activeStart:null, activeAdj:null, cfg: cfgFor(j.rate) })),
    activeJob: 'j1',
    sessions: jobs.map((j, i) => wages('w'+i, 'j'+(i+1), j.hours, 5 + i)),
    absences: [], unit:'sec',
    ui:{ open:{ ytd:1 } },
    net:{ ytdShow:true, enabled:true, configured:true, otBreak:true, filing:'single',
          dependents:0, ficaOn:true, statePct:4.95, items:[], fedExempt:false } };
}
async function boot(s, at){
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  PAGE ERROR:', e.message); fails++; });
  p.on('console', m => { if (m.type()==='error'){ console.log('  CONSOLE ERROR:', m.text()); fails++; } });
  await p.addInitScript(([k,v]) => { if (sessionStorage.getItem('__s')) return;
    sessionStorage.setItem('__s','1'); localStorage.setItem(k, JSON.stringify(v)); }, [KEY, s]);
  await p.clock.install({ time: new Date(at) });
  await p.goto('http://localhost:8198/'); await p.waitForTimeout(700);
  await p.evaluate(() => document.querySelectorAll('.col').forEach(c => c.classList.add('open')));
  await p.waitForTimeout(400);
  return p;
}
const seen = (p, sel) => p.evaluate(s => { const e = document.querySelector(s);
  return !!e && e.checkVisibility({contentVisibilityAuto:true, visibilityProperty:true}); }, sel);
const DEC = Date.UTC(2026, 11, 31, 18);

console.log('\n━━ One job: neither problem can happen ━━');
let p = await boot(seed([{ name:'Pace', rate:100, hours:1200 }]), DEC);
ok('no cross-job panel at all', !(await seen(p, '#jobTax')));
const single = await p.evaluate(() => ({ ss: ssOverpaid(Date.now()), uw: underWithheld(Date.now()) }));
ok('and nothing is computed for it', single.ss === null && single.uw === null);
await p.close();

console.log('\n━━ Social Security overpaid between two employers ━━');
/* $120,000 at one and $120,000 at the other. Each withholds 6.2% on its own wages, and
   neither passes the $184,500 base alone — but between them they withhold on $240,000. */
p = await boot(seed([{ name:'Pace', rate:100, hours:1200 },
                     { name:'Night job', rate:100, hours:1200 }]), DEC);
const ss = await p.evaluate(() => ssOverpaid(Date.now()));
near('the first withholds 6.2% of $120,000', ss.each[0].withheld, 120000 * 0.062);
near('so does the second',                   ss.each[1].withheld, 120000 * 0.062);
near('between them that is on $240,000',     ss.withheld, 240000 * 0.062);
near('the most anyone owes in a year',       ss.max, 184500 * 0.062);
near('so the overpayment is 6.2% of the excess $55,500', ss.over, 55500 * 0.062);
ok('which is real money', ss.over > 3400, '$' + ss.over.toFixed(2));

const txt = (await p.textContent('#jobTax')).replace(/\s+/g, ' ');
ok('the panel is on screen', await seen(p, '#jobTax'));
ok('it names the overpayment', /Social Security overpaid/.test(txt), txt.slice(0, 70));
ok('shows the figure', txt.includes('$' + ss.over.toLocaleString('en-US',
   {minimumFractionDigits:2, maximumFractionDigits:2})), txt.slice(0, 160));
ok('and says it is refundable rather than lost', /claim it back/i.test(txt));
ok('naming both employers', /Pace/.test(txt) && /Night job/.test(txt));

console.log('\n━━ Under-withholding, which is the expensive one ━━');
const uw = await p.evaluate(() => underWithheld(Date.now()));
near('the two jobs together are $240,000', uw.combined, 240000, 400);
ok('each employer withholds as if it were your only income',
   Math.abs(uw.rows[0].withheld - uw.rows[1].withheld) < 1,
   '$' + uw.rows[0].withheld.toFixed(0) + ' and $' + uw.rows[1].withheld.toFixed(0));
/* The real bill on $240,000, single, standard deduction — computed independently here so
   the assertion is not just the app agreeing with itself. */
const owed = await p.evaluate(() => {
  const t = TAX2026.fed.single;
  return bracketTax(240000 - t.std, t.brackets);
});
near('the actual liability is worked out on the combined figure', uw.owed, owed, 400);
ok('and the two employers between them fall short', uw.gap > 0, '$' + uw.gap.toFixed(2));
ok('by thousands, not pennies', uw.gap > 3000, '$' + uw.gap.toFixed(2));

ok('the panel says so', /Under-withheld/.test(txt) || /Under-withheld/.test(
   (await p.textContent('#jobTax')).replace(/\s+/g,' ')));
const txt2 = (await p.textContent('#jobTax')).replace(/\s+/g, ' ');
ok('it explains why, not just that', /only income/.test(txt2), txt2.slice(-260, -120));
ok('and says what to do about it', /W-4/.test(txt2) && /set aside/.test(txt2));
await p.close();

console.log('\n━━ Two modest jobs are under-withheld too ━━');
/* $18,000 and $9,000 — nowhere near the wage base, so nothing is overpaid. But the gap is
   still real, and for a reason worth naming: each employer subtracts the WHOLE standard
   deduction, and only one of them can. That alone under-withholds most two-job households
   by something close to the deduction times the bottom bracket, whatever they earn. */
p = await boot(seed([{ name:'Day', rate:15, hours:1200 },
                     { name:'Weekend', rate:15, hours:600 }]), DEC);
const small = await p.evaluate(() => ({ ss: ssOverpaid(Date.now()), uw: underWithheld(Date.now()) }));
near('nothing overpaid on $27,000', small.ss.over, 0);
near('the two jobs together are $27,000', small.uw.combined, 27000, 60);
/* The second job's $9,000 falls entirely under its own copy of the standard deduction, so
   that employer withholds nothing at all. */
near('the second employer withholds nothing', small.uw.rows[1].withheld, 0, 1);
ok('so there is still a gap', small.uw.gap > 400, '$' + small.uw.gap.toFixed(2));
ok('and it is the size of a double-counted deduction, not a rounding error',
   small.uw.gap > 600 && small.uw.gap < 1600, '$' + small.uw.gap.toFixed(2));
const smallTxt = (await p.textContent('#jobTax')).replace(/\s+/g, ' ');
ok('the panel flags it rather than staying quiet', /Under-withheld/.test(smallTxt), smallTxt.slice(0, 70));
ok('and no Social Security section, since none was overpaid',
   !/Social Security overpaid/.test(smallTxt));
await p.close();

console.log('\n━━ It respects being exempt ━━');
const ex = seed([{ name:'Day', rate:100, hours:1200 }, { name:'Night', rate:100, hours:1200 }]);
ex.net.fedExempt = true;
p = await boot(ex, DEC);
ok('nothing is compared when nothing is withheld',
   (await p.evaluate(() => underWithheld(Date.now()))) === null);
/* Social Security is separate from federal withholding, so going exempt does not stop it. */
ok('but Social Security is still checked',
   (await p.evaluate(() => ssOverpaid(Date.now()))).over > 3400);
await p.close();

console.log('\n━━ On a phone ━━');
const mob = await b.newContext({ viewport:{width:390,height:1200}, isMobile:true, hasTouch:true,
  deviceScaleFactor:3, timezoneId:'America/Chicago', locale:'en-US' });
const q = await mob.newPage();
await q.addInitScript(([k,v]) => { if (sessionStorage.getItem('__s')) return;
  sessionStorage.setItem('__s','1'); localStorage.setItem(k, JSON.stringify(v)); },
  [KEY, seed([{ name:'Pace', rate:100, hours:1200 }, { name:'Night job', rate:100, hours:1200 }])]);
await q.clock.install({ time: new Date(DEC) });
await q.goto('http://localhost:8198/'); await q.waitForTimeout(800);
await q.evaluate(() => document.querySelectorAll('.col').forEach(c => c.classList.add('open')));
await q.waitForTimeout(400);
const m = await q.evaluate(() => ({ w: document.documentElement.scrollWidth, win: innerWidth,
  box: Math.round(document.querySelector('#jobTax').getBoundingClientRect().right) }));
ok('no sideways scroll', m.w <= m.win + 1, `${m.w} vs ${m.win}`);
ok('the panel fits', m.box <= m.win, `${m.box} vs ${m.win}`);

console.log(`\n${fails === 0 ? '✅' : '❌'}  ${fails === 0 ? 'all passed' : fails + ' failed'}`);
await b.close(); srv.close();
process.exit(fails === 0 ? 0 : 1);
