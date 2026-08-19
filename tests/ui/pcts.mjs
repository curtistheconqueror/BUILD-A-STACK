/* Percentage deductions, and what a deduction comes out BEFORE.
   Settled against a real stub: a Section 125 health premium comes out before every tax
   including Social Security; a 401(k) comes out before income tax only, and FICA is still
   charged on it. One boolean could not say that, and got FICA wrong. */
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
}).listen(8209);
let fails = 0;
const ok = (n,c,x='') => { console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++; };

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport:{width:1100,height:2800},
                                 timezoneId:'America/Chicago', locale:'en-US' });
const NOW = Date.UTC(2026, 7, 12, 21, 0);

/* $42.2071/h × 80 h = $3,376.57 — the reference stub's gross, so every figure below can be
   checked against a real payslip rather than against itself. */
const SEED = { configured:true,
  jobs:[{ id:'j1', name:'Pace', profession:'', primary:true, activeStart:null, activeAdj:null,
    cfg:{ rate:42.207125, otMultiplier:1.5, otMode:'weekly', weeklyThreshold:40,
      periodThreshold:80, dailyThreshold:8, shiftThreshold:8, weekStartDay:0,
      periodAnchor:'2026-08-09', periodLengthDays:14, payDateOffsetDays:13,
      schedStart:'14:00', schedEnd:'22:30', lunchMins:0,
      workDays:[true,true,true,true,true,false,false],
      holidays:[], banks:[], daysOff:[], vacations:[], premiums:[] } }],
  activeJob:'j1', sessions:[], absences:[], units:[], stipends:[], otHist:[],
  unit:'sec', ui:{open:{}},
  net:{ enabled:true, configured:true, view:'net', filing:'single', dependents:0,
        fedExempt:true, fedOverride:null, state:'IL', statePct:4.95, stateExempt:false,
        stateOverride:null, ficaOn:true, ssOn:true, pension:null, otBreak:false,
        pcts:[], items:[{ id:'h', name:'Med Union Pretx', amount:130, basis:'all' }] } };

async function boot(seed){
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  PAGE ERROR:', e.message); fails++; });
  p.on('console', m => { if (m.type()==='error'){ console.log('  CONSOLE ERROR:', m.text()); fails++; } });
  await p.addInitScript(([k,v]) => { if (sessionStorage.getItem('__s')) return;
    sessionStorage.setItem('__s','1'); localStorage.setItem(k, JSON.stringify(v)); }, [KEY, seed]);
  await p.clock.install({ time:new Date(NOW) });
  await p.goto('http://localhost:8209/');
  await p.waitForFunction(() => typeof state !== 'undefined' && state.net, null, { timeout:15000 });
  await p.waitForTimeout(400);
  await p.evaluate(() => openNetSetup()); await p.waitForTimeout(500);
  return p;
}
const txt = (p,sel) => p.evaluate(s => (document.querySelector(s)?.textContent||'').trim(), sel);
const st  = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
/* One standard check, priced by the app's own engine. */
const chq = p => p.evaluate(() => {
  const nc = netCfg();
  const std = periodNetView(0,0,[],nc,state.cfg,'net').stdHours;
  return periodNetView(state.cfg.rate*std, std, nc.items, nc, state.cfg, 'hole', 0, 0);
});

console.log('\n━━ The section exists and starts empty ━━');
let p = await boot(SEED);
ok('a percentage section is on the deductions screen', await p.isVisible('#nPcts'));
ok('with nothing in it', /A 401k or pension contribution goes here/.test(await txt(p, '#nPcts')),
   await txt(p, '#nPcts'));
const base = await chq(p);
ok('the standard check is the stub gross', Math.abs(base.gross - 3376.57) < 0.02,
   base.gross.toFixed(2));
ok('nothing is taken as a percentage yet', !base.pctTotal, String(base.pctTotal));

console.log('\n━━ Adding your two 401k lines ━━');
await p.click('#nPctAdd'); await p.waitForTimeout(400);
await p.click('#nPctAdd'); await p.waitForTimeout(400);
ok('two rows appear', (await p.$$eval('#nPcts .nitem', r => r.length)) === 2);
ok('each defaults to before income tax only — the 401k case',
   (await p.$$eval('#nPcts select[data-pf="basis"]', ss => ss.map(x => x.value))).join() === 'income,income');
const row = i => p.locator('#nPcts .nitem').nth(i);
await row(0).locator('input[data-pf="name"]').fill('401k Union Vol');
await row(0).locator('input[data-pf="rate"]').fill('4');
await row(1).locator('input[data-pf="name"]').fill('401kUnionMand');
await row(1).locator('input[data-pf="rate"]').fill('4.5');
await p.waitForTimeout(600);

console.log('\n━━ Which is exactly what the stub says ━━');
const real = await chq(p);
/* Every one of these is a figure printed on a real payslip. */
ok('$287.01 to the two 401k lines', Math.abs(real.pctTotal - 287.01) < 0.03,
   '$' + real.pctTotal.toFixed(2));
ok('Social Security $201.37 — charged on the 401k',
   Math.abs(real.ss - 201.37) < 0.10, '$' + real.ss.toFixed(2));
ok('Medicare $47.09 — likewise', Math.abs(real.medicare - 47.09) < 0.10,
   '$' + real.medicare.toFixed(2));
ok('Illinois $146.50 — NOT charged on it', Math.abs(real.state - 146.50) < 0.10,
   '$' + real.state.toFixed(2));
ok('federal nothing, because it is blocked', real.fed === 0, '$' + real.fed.toFixed(2));
ok('FICA wages exclude only the health premium',
   Math.abs(real.ficaWages - (3376.57 - 130)) < 0.02, real.ficaWages.toFixed(2));
ok('taxable wages exclude the 401k as well',
   Math.abs(real.taxable - (3376.57 - 130 - 287.01)) < 0.03, real.taxable.toFixed(2));
ok('and every dollar reconciles',
   Math.abs(real.gross - real.deductions - real.net) < 0.02,
   `${real.gross.toFixed(2)} − ${real.deductions.toFixed(2)} = ${real.net.toFixed(2)}`);

console.log('\n━━ The row prices itself ━━');
const note = await p.evaluate(() =>
  document.querySelector('#nPcts .nitem .note').textContent.trim());
ok('showing what the percentage is worth', /≈ \$135\.06/.test(note), note);
ok('and that it follows the gross', /follows your gross/.test(note), note);
ok('the preview totals them', /Percentages \$287\.01/.test(await txt(p, '#nPreview')),
   await txt(p, '#nPreview'));

console.log('\n━━ It follows the gross without being retyped ━━');
/* The whole reason this is a percentage and not a typed figure. */
await p.evaluate(() => { state.cfg.rate = 68.75; save(); syncControls(); });
await p.waitForTimeout(500);
const big = await chq(p);
ok('a bigger check takes proportionally more',
   Math.abs(big.pctTotal - big.gross * 0.085) < 0.02, '$' + big.pctTotal.toFixed(2));
ok('which is more than before', big.pctTotal > real.pctTotal * 1.5,
   '$' + real.pctTotal.toFixed(2) + ' → $' + big.pctTotal.toFixed(2));
await p.evaluate(() => { state.cfg.rate = 42.207125; save(); syncControls(); });
await p.waitForTimeout(400);

console.log('\n━━ The mistake this replaces ━━');
/* Marking a 401k "before every tax" is the old boolean's only pre-tax option, and it
   under-withholds Social Security. */
await p.$$eval('#nPcts select[data-pf="basis"]',
  ss => ss.forEach(x => { x.value = 'all'; x.dispatchEvent(new Event('change', {bubbles:true})); }));
await p.waitForTimeout(600);
const wrong = await chq(p);
ok('treating it as fully pre-tax cuts Social Security', wrong.ss < real.ss,
   '$' + real.ss.toFixed(2) + ' → $' + wrong.ss.toFixed(2));
ok('by about $17.79 a fortnight', Math.abs((real.ss - wrong.ss) - 17.79) < 0.05,
   '$' + (real.ss - wrong.ss).toFixed(2));
ok('and Medicare with it', wrong.medicare < real.medicare,
   '$' + (real.medicare - wrong.medicare).toFixed(2));
await p.$$eval('#nPcts select[data-pf="basis"]',
  ss => ss.forEach(x => { x.value = 'income'; x.dispatchEvent(new Event('change', {bubbles:true})); }));
await p.waitForTimeout(500);
ok('putting it back restores the right figure',
   Math.abs((await chq(p)).ss - real.ss) < 0.02);

console.log('\n━━ All three answers are offered on fixed deductions too ━━');
const opts = await p.$$eval('#nItems select[data-f="basis"] option', os => os.map(o => o.value));
ok('three choices, not a checkbox', opts.join() === 'all,income,none', opts.join());
ok('the health premium is before everything',
   (await p.inputValue('#nItems select[data-f="basis"]')) === 'all',
   await p.inputValue('#nItems select[data-f="basis"]'));

console.log('\n━━ It saves and survives ━━');
await p.click('#nSave'); await p.waitForTimeout(700);
let d = await st(p);
ok('both percentages are stored', d.net.pcts.length === 2, String(d.net.pcts.length));
ok('with their rates', d.net.pcts.map(x => x.rate).join() === '4,4.5',
   d.net.pcts.map(x => x.rate).join());
ok('and their basis', d.net.pcts.every(x => x.basis === 'income'),
   d.net.pcts.map(x => x.basis).join());
ok('named', d.net.pcts[0].name === '401k Union Vol', d.net.pcts[0].name);
await p.reload(); await p.waitForTimeout(900);
await p.evaluate(() => openNetSetup()); await p.waitForTimeout(500);
ok('they come back after a reload', (await p.$$eval('#nPcts .nitem', r => r.length)) === 2);
ok('with the money unchanged', Math.abs((await chq(p)).net - real.net) < 0.02,
   '$' + (await chq(p)).net.toFixed(2));

console.log('\n━━ Removing one ━━');
await p.locator('#nPcts button[data-del-pct]').first().click(); await p.waitForTimeout(600);
ok('one left', (await st(p)).net.pcts.length === 1);
ok('and only 4.5% is taken now',
   Math.abs((await chq(p)).pctTotal - (await chq(p)).gross * 0.045) < 0.02,
   '$' + (await chq(p)).pctTotal.toFixed(2));

console.log('\n━━ An older save still reads right ━━');
/* Before this existed there was only a boolean, where true meant "before everything". */
const legacy = JSON.parse(JSON.stringify(SEED));
legacy.net.items = [{ id:'h', name:'Healthcare', amount:200, pretax:true },
                    { id:'u', name:'Dues',       amount:40,  pretax:false }];
delete legacy.net.pcts;
await p.close();
p = await boot(legacy);
ok('a legacy pre-tax item shows as before every tax',
   (await p.$$eval('#nItems select[data-f="basis"]', ss => ss.map(x => x.value))).join() === 'all,none',
   (await p.$$eval('#nItems select[data-f="basis"]', ss => ss.map(x => x.value))).join());
const leg = await chq(p);
ok('and still cuts FICA the way it always did',
   Math.abs(leg.ficaWages - (leg.gross - 200)) < 0.02, leg.ficaWages.toFixed(2));
ok('with no percentages assumed', !leg.pctTotal, String(leg.pctTotal));

console.log('\n━━ Nonsense takes nothing ━━');
await p.click('#nPctAdd'); await p.waitForTimeout(400);
await p.locator('#nPcts input[data-pf="rate"]').first().fill('-5');
await p.waitForTimeout(500);
ok('a negative rate takes nothing', !(await chq(p)).pctTotal, String((await chq(p)).pctTotal));
await p.locator('#nPcts input[data-pf="rate"]').first().fill('999');
await p.waitForTimeout(500);
ok('an absurd one is capped', (await st(p)).net.pcts[0].rate <= 60,
   String((await st(p)).net.pcts[0].rate));
ok('and the net never goes to nonsense', isFinite((await chq(p)).net),
   String((await chq(p)).net));
await p.close();

console.log('\n━━ On a phone ━━');
const mob = await b.newContext({ viewport:{width:390,height:900}, isMobile:true, hasTouch:true,
  deviceScaleFactor:3, timezoneId:'America/Chicago', locale:'en-US' });
const q = await mob.newPage();
q.on('pageerror', e => { console.log('  PAGE ERROR:', e.message); fails++; });
const filled = JSON.parse(JSON.stringify(SEED));
filled.net.pcts = [{ id:'a', name:'401k Union Vol', rate:4, basis:'income' },
                   { id:'b', name:'401kUnionMand', rate:4.5, basis:'income' }];
await q.addInitScript(([k,v]) => { if (sessionStorage.getItem('__s')) return;
  sessionStorage.setItem('__s','1'); localStorage.setItem(k, JSON.stringify(v)); }, [KEY, filled]);
await q.clock.install({ time:new Date(NOW) });
await q.goto('http://localhost:8209/'); await q.waitForTimeout(800);
await q.evaluate(() => openNetSetup()); await q.waitForTimeout(600);
const m = await q.evaluate(() => {
  const small = [...document.querySelectorAll('#nPcts input, #nPcts select, #nPctAdd')]
    .filter(e => e.checkVisibility({contentVisibilityAuto:true, visibilityProperty:true}))
    .filter(e => e.getBoundingClientRect().height < 30)
    .map(e => (e.dataset.pf || e.id) + ':' + Math.round(e.getBoundingClientRect().height));
  return { w:document.documentElement.scrollWidth, win:innerWidth, small,
           rows:document.querySelectorAll('#nPcts .nitem').length };
});
ok('both rows render', m.rows === 2, String(m.rows));
ok('no sideways scroll', m.w <= m.win+1, `${m.w} vs ${m.win}`);
ok('the fields are reachable', m.small.length === 0, m.small.join(', '));

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close(); process.exit(fails===0?0:1);
