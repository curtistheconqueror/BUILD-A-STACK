/* The ordinary union rule: over 8 in a shift OR over 40 in the week, no hour counted twice.
   The point of it is that nobody has to guess which of the two rules pays better this week —
   it takes the larger on its own, every week. */
import { chromium } from 'playwright';
import http from 'node:http'; import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// The app under test sits two directories up from tests/ui/.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
// Set PW_CHROME to point at a specific build; otherwise Playwright finds its own.
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
}).listen(8202);
let fails = 0;
const ok = (n,c,x='') => { console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++; };

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport:{width:390,height:2400}, isMobile:true, hasTouch:true,
  deviceScaleFactor:3, timezoneId:'America/Chicago', locale:'en-US' });
const T = (d,h,m=0) => Date.UTC(2026,7,d,h+5,m);          // America/Chicago, CDT

/* Sunday 9 August 2026 starts the week. Two schedules, chosen because each one catches out
   exactly one of the two single rules. */
const LONG  = [9,10,11,12].map(d => ({ id:'l'+d, start:T(d,14), end:T(d,14)+11.35*3600e3 }));
const SHORT = [9,10,11,12,13,14].map(d => ({ id:'s'+d, start:T(d,14), end:T(d,21) }));

const seed = (mode, ss) => ({ configured:true,
  cfg:{ rate:40, otMultiplier:1.5, otMode:mode,
    weeklyThreshold:40, periodThreshold:80, dailyThreshold:8, shiftThreshold:8, weekStartDay:0,
    periodAnchor:'2026-08-09', periodLengthDays:14, payDateOffsetDays:13,
    schedStart:'14:00', schedEnd:'22:30', lunchMins:0,
    workDays:[true,true,true,true,true,false,false],
    holidays:[], banks:[], daysOff:[], vacations:[],
    shiftDayRule:'majority', skewOn:false, makeUpOn:false, nightOn:false },
  sessions:ss, absences:[], activeStart:null, unit:'sec', ui:{open:{}}, net:{} });

async function boot(mode, ss, at){
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  PAGE ERROR:', e.message); fails++; });
  p.on('console', m => { if (m.type()==='error'){ console.log('  CONSOLE ERROR:', m.text()); fails++; } });
  await p.addInitScript(([k,v]) => { if (sessionStorage.getItem('__s')) return;
    sessionStorage.setItem('__s','1'); localStorage.setItem(k, JSON.stringify(v)); }, [KEY, seed(mode,ss)]);
  await p.clock.install({ time:new Date(at) });
  await p.goto('http://localhost:8202/'); await p.waitForTimeout(700);
  await p.evaluate(() => { document.querySelectorAll('.col').forEach(c => c.classList.add('open'));
    document.querySelectorAll('#cfg details').forEach(d => d.open = true); });
  await p.waitForTimeout(400); return p;
}
/* The week of Sun 9 – Sat 15 August, read straight off the ledger the screen is drawn from. */
const wk = p => p.evaluate(() => { const l = buildLedger(state.sessions, state.cfg, Date.now());
  const t = sumRange(l.parts, +ymd('2026-08-09'), +ymd('2026-08-16'));
  return { h:t.hours, ot:t.otHours, reg:t.regHours, g:t.gross }; });
const NOW = T(15, 12);

console.log('\n━━ The mode is offered ━━');
let p = await boot('weekly', LONG, NOW);
const opts = await p.$$eval('#cMode option', os => os.map(o => o.value));
ok('Settings lists it', opts.includes('eight40'), opts.join(','));
const lblOpt = await p.$eval('#cMode option[value="eight40"]', o => o.textContent);
ok('and names both legs', /8/.test(lblOpt) && /40/.test(lblOpt) && /week/i.test(lblOpt), lblOpt);
const setup = await p.$$eval('#sMode button', bs => bs.map(x => x.dataset.m));
ok('first-run setup offers it too', setup.includes('eight40'), setup.join(','));
const lblBtn = await p.$eval('#sMode button[data-m="eight40"]', x => x.textContent);
ok('and says you always get whichever pays more', /pays more/i.test(lblBtn), lblBtn.slice(0,100));

console.log('\n━━ A week of long shifts — where the 40-hour rule falls short ━━');
/* Four shifts of 11.35 h from 2 PM, so each one runs past midnight. 45.40 hours. */
const wLong = await wk(p);
ok('a 40-hour week calls it 45.40 hours', Math.abs(wLong.h-45.4)<0.02, wLong.h.toFixed(2));
ok('with 5.40 h of overtime', Math.abs(wLong.ot-5.4)<0.02, wLong.ot.toFixed(2));
await p.close();

p = await boot('shift', LONG, NOW);
const sLong = await wk(p);
ok('a per-shift rule pays 13.40 h instead', Math.abs(sLong.ot-13.4)<0.02, sLong.ot.toFixed(2));
await p.close();

p = await boot('eight40', LONG, NOW);
const cLong = await wk(p);
ok('8 and 40 pays the same 13.40 h', Math.abs(cLong.ot-13.4)<0.02, cLong.ot.toFixed(2));
ok('so nobody loses a penny moving onto it', Math.abs(cLong.g-sLong.g)<0.01,
   '$'+cLong.g.toFixed(2)+' vs $'+sLong.g.toFixed(2));
/* 8.00 h move from straight time to overtime, and overtime is worth half the base again
   on top — 8 × $20. */
ok('and it is worth $160 more than the weekly rule', Math.abs((cLong.g-wLong.g)-160)<0.01,
   '$'+(cLong.g-wLong.g).toFixed(2));

console.log('\n━━ The screen says which rule is running ━━');
const otLbl = await p.textContent('#otLbl');
ok('the bar names both legs', /8 h/.test(otLbl) && /40 h this week/.test(otLbl), otLbl);
const p80 = (await p.textContent('#p80Note')).replace(/\s+/g,' ');
ok('the 80 h bar names 8 and 40 as the rule in force', /8 and 40/.test(p80), p80.slice(0,120));
ok('and says the week half out loud', /40 h in the week/.test(p80), p80.slice(0,150));
await p.evaluate(() => document.querySelectorAll('#cfg details').forEach(d => d.open = true));
await p.waitForTimeout(300);
const sum = await p.textContent('#sumPay');
ok('the folded Settings summary spells the rule out',
   /8 h a shift or 40 h a week/.test(sum), sum);

console.log('\n━━ A week of short shifts — where the per-shift rule falls short ━━');
await p.close();
p = await boot('shift', SHORT, NOW);
const sShort = await wk(p);
ok('six seven-hour shifts is 42 hours', Math.abs(sShort.h-42)<0.02, sShort.h.toFixed(2));
ok('and a per-shift rule pays no overtime at all', sShort.ot < 0.001, sShort.ot.toFixed(2));
await p.close();

p = await boot('eight40', SHORT, NOW);
const cShort = await wk(p);
ok('8 and 40 finds the two hours past forty', Math.abs(cShort.ot-2)<0.02, cShort.ot.toFixed(2));
ok('worth $40 that would otherwise have gone unpaid', Math.abs((cShort.g-sShort.g)-40)<0.01,
   '$'+(cShort.g-sShort.g).toFixed(2));

console.log('\n━━ No hour is ever counted twice ━━');
ok('straight time never passes forty', cShort.reg <= 40.001, cShort.reg.toFixed(2));
ok('and every hour is either straight or overtime',
   Math.abs(cShort.reg + cShort.ot - cShort.h) < 0.001,
   `${cShort.reg.toFixed(2)} + ${cShort.ot.toFixed(2)} = ${cShort.h.toFixed(2)}`);
ok('the long week too', cLong.reg <= 40.001 && Math.abs(cLong.reg+cLong.ot-cLong.h)<0.001,
   cLong.reg.toFixed(2));

console.log('\n━━ Past forty, a fresh shift is overtime from its first minute ━━');
/* Five eights takes the week to exactly forty; the sixth shift has a full eight-hour
   allowance of its own and still cannot use it. */
const FIVE = [9,10,11,12,13].map(d => ({ id:'f'+d, start:T(d,14), end:T(d,22) }))
             .concat([{ id:'f14', start:T(14,14), end:T(14,19) }]);
await p.close();
p = await boot('eight40', FIVE, NOW);
const cFive = await wk(p);
ok('five eights then a five is 45 hours', Math.abs(cFive.h-45)<0.02, cFive.h.toFixed(2));
ok('the whole last shift is overtime', Math.abs(cFive.ot-5)<0.02, cFive.ot.toFixed(2));
const bar = await p.textContent('#otLbl');
ok('the bar still names the shift leg', /This shift toward 8 h/.test(bar), bar);

console.log('\n━━ Switching is live and reversible ━━');
await p.selectOption('#cMode','shift'); await p.waitForTimeout(600);
ok('per shift pays none of it', (await wk(p)).ot < 0.001, (await wk(p)).ot.toFixed(2));
await p.selectOption('#cMode','eight40'); await p.waitForTimeout(600);
ok('and switching back returns all five hours', Math.abs((await wk(p)).ot-5)<0.02);
ok('the choice is remembered', (await p.evaluate(() =>
   JSON.parse(localStorage.getItem('payclock.v1')).jobs[0].cfg.otMode)) === 'eight40');
await p.reload(); await p.waitForTimeout(800);
ok('and survives a reload', (await p.inputValue('#cMode')) === 'eight40');

console.log('\n━━ On a phone ━━');
const m = await p.evaluate(() => ({ w:document.documentElement.scrollWidth, win:innerWidth }));
ok('no sideways scroll', m.w <= m.win+1, `${m.w} vs ${m.win}`);

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close(); process.exit(fails===0?0:1);
