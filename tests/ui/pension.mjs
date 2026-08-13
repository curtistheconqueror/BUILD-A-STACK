/* A public pension standing in place of Social Security.
   Fifteen states keep most of their teachers out of Social Security entirely, and the same
   arrangement covers a lot of police, fire and municipal work. The thing that must not be
   got wrong: no OASDI, but Medicare is still withheld — those are two separate switches. */
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
}).listen(8203);
let fails = 0;
const ok = (n,c,x='') => { console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++; };

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport:{width:1100,height:2600},
                                 timezoneId:'America/Chicago', locale:'en-US' });
const T = (d,h) => Date.UTC(2026,7,d,h+5,0);
const NOW = T(12,16);

/* $45/h over an 80 h period is $3,600 a cheque — near enough a teacher's semi-monthly on a
   $72k contract that the figures read the way a real stub would. */
const SEED = { configured:true,
  jobs:[{ id:'j1', name:'District 214', profession:'', primary:true, activeStart:null, activeAdj:null,
    cfg:{ rate:45, otMultiplier:1.5, otMode:'weekly', weeklyThreshold:40, periodThreshold:80,
      dailyThreshold:8, shiftThreshold:8, weekStartDay:0, periodAnchor:'2026-08-09',
      periodLengthDays:14, payDateOffsetDays:13, schedStart:'08:00', schedEnd:'16:00',
      lunchMins:0, workDays:[false,true,true,true,true,true,false],
      holidays:[], banks:[], daysOff:[], vacations:[] } }],
  activeJob:'j1', sessions:[], absences:[], unit:'sec', ui:{open:{}},
  net:{ enabled:true, configured:true, view:'net', filing:'single', dependents:0,
        fedExempt:false, fedOverride:null, state:'IL', statePct:4.95, stateExempt:false,
        stateOverride:null, ficaOn:true, ssOn:true, pension:null, items:[] } };

async function boot(seed){
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  PAGE ERROR:', e.message); fails++; });
  p.on('console', m => { if (m.type()==='error'){ console.log('  CONSOLE ERROR:', m.text()); fails++; } });
  await p.addInitScript(([k,v]) => { if (sessionStorage.getItem('__s')) return;
    sessionStorage.setItem('__s','1'); localStorage.setItem(k, JSON.stringify(v)); }, [KEY, seed]);
  await p.clock.install({ time:new Date(NOW) });
  await p.goto('http://localhost:8203/');
  await p.waitForFunction(() => typeof state !== 'undefined' && state.net, null, { timeout:15000 });
  await p.waitForTimeout(400);
  return p;
}
const st = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
const seen = (p,sel) => p.evaluate(s => { const e = document.querySelector(s);
  return !!e && e.checkVisibility({contentVisibilityAuto:true, visibilityProperty:true}); }, sel);
const txt = (p,sel) => p.evaluate(s => (document.querySelector(s)?.textContent||'').trim(), sel);
/* One cheque, priced by the app's own engine rather than by arithmetic repeated here. */
const chq = p => p.evaluate(() => {
  const nc = netCfg();
  const std = periodNetView(0,0,[],nc,state.cfg,'net').stdHours;
  return periodNetView(state.cfg.rate*std, std, nc.items, nc, state.cfg, 'hole', 0, 0);
});

console.log('\n━━ It is off until someone says otherwise ━━');
let p = await boot(SEED);
await p.evaluate(() => openNetSetup()); await p.waitForTimeout(500);
ok('the setup screen has a pension section', await seen(p, '#nPenOn'));
ok('and it starts off', !(await p.isChecked('#nPenOn')));
ok('so the fields are out of the way', !(await seen(p, '#nPenFields')));
ok('the note says Social Security is normal',
   /withheld at 6\.2%/.test(await txt(p, '#nPenNote')), await txt(p, '#nPenNote'));
const before = await chq(p);
ok('Social Security is coming out', before.ss > 0, '$'+before.ss.toFixed(2));
ok('and so is Medicare', before.medicare > 0, '$'+before.medicare.toFixed(2));
ok('nothing to a pension', !before.pension, String(before.pension));

console.log('\n━━ Turning it on ━━');
await p.check('#nPenOn'); await p.waitForTimeout(400);
ok('the fields appear', await seen(p, '#nPenFields'));
ok('and so does the before-tax question', await seen(p, '#nPenPreRow'));
ok('which starts ticked, the way a pick-up plan works', await p.isChecked('#nPenPre'));
ok('it asks for the percentage before pricing anything',
   /Set the percentage/.test(await txt(p, '#nPenNote')), await txt(p, '#nPenNote'));

await p.fill('#nPenName', 'TRS'); await p.dispatchEvent('#nPenName','change');
await p.fill('#nPenPct', '9');   await p.dispatchEvent('#nPenPct','change');
await p.waitForTimeout(500);

console.log('\n━━ What actually comes off the cheque ━━');
const after = await chq(p);
ok('nine per cent goes to the pension',
   Math.abs(after.pension - after.gross*0.09) < 0.01, '$'+after.pension.toFixed(2));
ok('Social Security stops entirely', after.ss === 0, '$'+after.ss.toFixed(2));
/* The line that would be easiest to get wrong, and the most expensive to get wrong. */
ok('Medicare does NOT stop', after.medicare > 0, '$'+after.medicare.toFixed(2));
ok('and is charged on the wage after the pension came out',
   Math.abs(after.medicare - (after.gross - after.pension)*0.0145) < 0.01,
   '$'+after.medicare.toFixed(2));
ok('taxable wages fall by the contribution',
   Math.abs(after.taxable - (after.gross - after.pension)) < 0.01, '$'+after.taxable.toFixed(2));
ok('so federal withholding falls too', after.fed < before.fed,
   '$'+before.fed.toFixed(2)+' → $'+after.fed.toFixed(2));
ok('and state with it', after.state < before.state,
   '$'+before.state.toFixed(2)+' → $'+after.state.toFixed(2));
ok('every dollar still adds up',
   Math.abs(after.gross - after.deductions - after.net) < 0.01,
   `${after.gross.toFixed(2)} − ${after.deductions.toFixed(2)} = ${after.net.toFixed(2)}`);

console.log('\n━━ The screen explains the trade ━━');
const note = (await txt(p, '#nPenNote')).replace(/\s+/g,' ');
ok('it prices the pension across a year', /TRS takes/.test(note), note.slice(0,90));
ok('against what Social Security would have taken',
   /Social Security would have taken/.test(note), note.slice(0,150));
ok('it says Medicare is still withheld', /Medicare is still withheld/.test(note), note.slice(0,190));
ok('and that the pre-tax part comes back',
   /comes back as federal and state tax you do not pay/.test(note), note.slice(-150));
/* The app cannot verify this and must not pretend to. */
ok('it admits it cannot check the claim',
   /cannot check whether your job is really outside Social Security/.test(note), note.slice(-220));
ok('and says where the answer actually is', /paystub/.test(note), note.slice(-140));
const preview = await txt(p, '#nPreview');
ok('the preview names the pension', /TRS/.test(preview), preview);

console.log('\n━━ After-tax is a different cheque ━━');
await p.uncheck('#nPenPre'); await p.waitForTimeout(500);
const post = await chq(p);
ok('taxable wages go back to the full gross',
   Math.abs(post.taxable - post.gross) < 0.01, '$'+post.taxable.toFixed(2));
ok('the contribution is unchanged', Math.abs(post.pension - after.pension) < 0.01);
ok('but take-home is lower', post.net < after.net,
   '$'+(after.net-post.net).toFixed(2)+' a cheque');
ok('and the note offers the way back',
   /tick the box above/.test(await txt(p, '#nPenNote')), (await txt(p,'#nPenNote')).slice(0,220));
await p.check('#nPenPre'); await p.waitForTimeout(400);

console.log('\n━━ It is saved, and it survives ━━');
await p.click('#nSave'); await p.waitForTimeout(700);
let d = await st(p);
ok('the pension is stored', d.net.pension && d.net.pension.rate === 9,
   JSON.stringify(d.net.pension));
ok('with its name', d.net.pension.name === 'TRS', d.net.pension.name);
ok('and Social Security is marked off', d.net.ssOn === false, String(d.net.ssOn));
ok('while FICA itself stays on', d.net.ficaOn !== false, String(d.net.ficaOn));
await p.reload(); await p.waitForTimeout(900);
await p.evaluate(() => openNetSetup()); await p.waitForTimeout(500);
ok('it comes back ticked', await p.isChecked('#nPenOn'));
ok('at the same rate', (await p.inputValue('#nPenPct')) === '9', await p.inputValue('#nPenPct'));
ok('under the same name', (await p.inputValue('#nPenName')) === 'TRS', await p.inputValue('#nPenName'));
const reloaded = await chq(p);
ok('and the money is where it was', Math.abs(reloaded.net - after.net) < 0.01,
   '$'+reloaded.net.toFixed(2));

console.log('\n━━ The deductions summary says which arrangement you are on ━━');
const basis = await p.evaluate(() => netBasisNote(netCfg()));
ok('it names Medicare only', /Medicare only, no Social Security/.test(basis), basis);
ok('and the pension by name and rate', /TRS at 9%/.test(basis), basis);

console.log('\n━━ The calculator itemises it ━━');
await p.evaluate(() => { document.getElementById('calc').classList.add('open');
  const m = document.querySelector('#qPayMode button[data-p="net"]'); if (m) m.click(); });
await p.waitForTimeout(600);
const rows = await p.evaluate(() => [...document.querySelectorAll('#qResult .qline')]
  .map(r => r.textContent.replace(/\s+/g,' ').trim()));
ok('the pension has its own line', rows.some(r => /^TRS/.test(r)), rows.join(' | ').slice(0,220));
ok('and the FICA line no longer claims Social Security',
   rows.some(r => /^Medicare/.test(r)) && !rows.some(r => /Social Security/.test(r)),
   rows.join(' | ').slice(0,220));

console.log('\n━━ Turning it back off restores everything ━━');
await p.evaluate(() => openNetSetup()); await p.waitForTimeout(400);
await p.uncheck('#nPenOn'); await p.waitForTimeout(500);
const off = await chq(p);
ok('Social Security comes back', Math.abs(off.ss - before.ss) < 0.01, '$'+off.ss.toFixed(2));
ok('the pension stops', !off.pension, String(off.pension));
ok('and take-home is exactly what it was', Math.abs(off.net - before.net) < 0.01,
   '$'+off.net.toFixed(2)+' vs $'+before.net.toFixed(2));
ok('the fields are put away again', !(await seen(p, '#nPenFields')));

console.log('\n━━ A pension is not the same as no FICA ━━');
await p.check('#nPenOn'); await p.fill('#nPenPct','9'); await p.dispatchEvent('#nPenPct','change');
await p.waitForTimeout(400);
await p.uncheck('#nFica'); await p.waitForTimeout(500);
const none = await chq(p);
ok('turning FICA off takes Medicare with it', none.medicare === 0, '$'+none.medicare.toFixed(2));
ok('where the pension alone left it standing', after.medicare > 0, '$'+after.medicare.toFixed(2));
await p.close();

console.log('\n━━ On a phone ━━');
const mob = await b.newContext({ viewport:{width:390,height:900}, isMobile:true, hasTouch:true,
  deviceScaleFactor:3, timezoneId:'America/Chicago', locale:'en-US' });
const q = await mob.newPage();
q.on('pageerror', e => { console.log('  PAGE ERROR:', e.message); fails++; });
const withPen = JSON.parse(JSON.stringify(SEED));
withPen.net.ssOn = false;
withPen.net.pension = { name:'TRS', rate:9, preTax:true };
await q.addInitScript(([k,v]) => { if (sessionStorage.getItem('__s')) return;
  sessionStorage.setItem('__s','1'); localStorage.setItem(k, JSON.stringify(v)); }, [KEY, withPen]);
await q.clock.install({ time:new Date(NOW) });
await q.goto('http://localhost:8203/'); await q.waitForTimeout(800);
await q.evaluate(() => openNetSetup()); await q.waitForTimeout(500);
const m = await q.evaluate(() => {
  const small = [...document.querySelectorAll('#nPenFields input, #nPenOn, #nPenPre')]
    .filter(e => e.checkVisibility({contentVisibilityAuto:true, visibilityProperty:true}))
    .filter(e => e.getBoundingClientRect().height < 20)
    .map(e => e.id + ':' + Math.round(e.getBoundingClientRect().height));
  return { w:document.documentElement.scrollWidth, win:innerWidth, small };
});
ok('no sideways scroll', m.w <= m.win+1, `${m.w} vs ${m.win}`);
ok('the fields are reachable', m.small.length === 0, m.small.join(', '));
ok('and it loaded already switched on', await q.isChecked('#nPenOn'));

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close(); process.exit(fails===0?0:1);
