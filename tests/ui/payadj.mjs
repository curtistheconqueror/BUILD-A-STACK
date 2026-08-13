import { chromium } from 'playwright';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// The app under test sits two directories up from tests/ui/.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
// Set PW_CHROME to point at a specific build; otherwise Playwright finds its own.
const CHROME = process.env.PW_CHROME || undefined;

const KEY='payclock.v1', R = ROOT;

// ---- engine-level first ----
const html = readFileSync(R+'index.html','utf8');
const m = html.match(/\/\* ==ENGINE-START==[\s\S]*?\*\/([\s\S]*?)\/\* ==ENGINE-END== \*\//);
const E = new Function(m[1] + `return {buildLedger,sumSession,rateAt,DEFAULTS};`)();
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const openAll=async pg=>{ try{ await pg.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open'))); }catch(e){} };
const near=(n,g,w,t=0.01)=>ok(n,Math.abs(g-w)<=t,`got ${g}, want ${w}`);
const CFG={...E.DEFAULTS, rate:40, periodAnchor:'2026-07-26', otMode:'period',
           rateHistory:[{before:'2026-08-01', rate:38}]};   // raise to $40 effective Aug 1
const jul=(d,h)=>+new Date(2026,6,d,h), aug=(d,h)=>+new Date(2026,7,d,h);

console.log('\n━━ Engine: a raise never re-prices history ━━');
const L=E.buildLedger([{id:'old',start:jul(28,9),end:jul(28,17)},
                       {id:'new',start:aug(3,9),end:aug(3,17)}],CFG);
near('July shift still at $38', E.sumSession(L.parts,'old').gross, 8*38);
near('August shift at the new $40', E.sumSession(L.parts,'new').gross, 8*40);
near('rateAt before the boundary', E.rateAt(jul(31,23),CFG), 38);
near('rateAt after the boundary', E.rateAt(aug(1,0),CFG), 40);
// overnight shift straddling the raise: Jul 31 10 PM -> Aug 1 6 AM
const L2=E.buildLedger([{id:'x',start:jul(31,22),end:aug(1,6)}],CFG);
near('straddling shift splits at midnight: 2h@38 + 6h@40', E.sumSession(L2.parts,'x').gross, 2*38+6*40);

console.log('\n━━ Engine: shift types ━━');
const C38={...E.DEFAULTS, rate:38, periodAnchor:'2026-07-26', otMode:'period'};
const night=E.buildLedger([{id:'n',start:jul(28,22),end:jul(29,6),adj:{diff:2}}],C38);
near('overnight +$2/h: 8h at $40', E.sumSession(night.parts,'n').gross, 8*40);
const hol=E.buildLedger([{id:'h',start:jul(28,9),end:jul(28,17),adj:{mult:1.5}}],C38);
near('holiday 1.5x: 8h at $57', E.sumSession(hol.parts,'h').gross, 8*57);
// PTO: 8h paid straight, and does NOT push the next hours into OT
const week=[...Array(8)].map((_,i)=>({id:'w'+i,start:jul(26+i,8),end:jul(26+i,18)}));  // 80h -> at cap
const withPto=E.buildLedger(week.concat([{id:'pto',start:+new Date(2026,7,3,9),end:+new Date(2026,7,3,17),adj:{noOt:true}}]),C38);
near('PTO pays straight', E.sumSession(withPto.parts,'pto').gross, 8*38);
near('PTO adds no OT hours', E.sumSession(withPto.parts,'pto').otHours, 0);
const after=E.buildLedger(week.concat([
  {id:'pto',start:+new Date(2026,7,3,9),end:+new Date(2026,7,3,17),adj:{noOt:true}},
  {id:'work',start:+new Date(2026,7,4,9),end:+new Date(2026,7,4,11)}]),C38);
near('...and real work after the cap is still OT', E.sumSession(after.parts,'work').otHours, 2);

// ---- UI level ----
const srv=http.createServer((q,r)=>{
  const u=q.url||'/';
  if(u.startsWith('/sw.js')){r.writeHead(200,{'Content-Type':'text/javascript'});return r.end(readFileSync(R+'sw.js'));}
  if(u.startsWith('/manifest')){r.writeHead(200,{'Content-Type':'application/manifest+json'});return r.end(readFileSync(R+'manifest.webmanifest'));}
  if(u.indexOf('.png')>-1){r.writeHead(404);return r.end();}
  r.writeHead(200,{'Content-Type':'text/html'});r.end(readFileSync(R+'index.html'));
}).listen(8080);
const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({timezoneId:'America/New_York',locale:'en-US',viewport:{width:900,height:2200}});
const seed={configured:true,
  cfg:{rate:38,periodAnchor:'2026-07-26',otMode:'period',periodLengthDays:14,payDateOffsetDays:13,weekStartDay:0},
  sessions:[{id:'a',start:jul(28,9),end:jul(28,17)}],activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false};
const p=await ctx.newPage();
p.on('pageerror',e=>{console.log('  💥',e.message);fails++;});
p.on('console',mm=>{if(mm.type()==='error'){console.log('  💥',mm.text());fails++;}});
await p.addInitScript(([k,v])=>{if(sessionStorage.getItem('__s'))return;sessionStorage.setItem('__s','1');
  localStorage.setItem(k,JSON.stringify(v));},[KEY,seed]);
await p.clock.install({time:new Date('2026-08-04T21:00:00Z')});
await p.goto('http://localhost:8080/'); await p.waitForTimeout(450); await openAll(p);
const T=s=>p.textContent(s), N=async s=>parseFloat((await T(s)).replace(/[$,]/g,''));

console.log('\n━━ UI: the projection field accepts typing now ━━');
const yc=p.locator('#yCommit');
await yc.click(); await p.waitForTimeout(400);        // focus, let several renders pass
await yc.fill(''); await yc.type('12.5'); await p.waitForTimeout(600);  // renders keep firing while typing
ok('typed value survives the render loop', (await p.inputValue('#yCommit'))==='12.5', await p.inputValue('#yCommit'));
await p.dispatchEvent('#yCommit','change'); await p.waitForTimeout(300);
ok('and takes effect', (await T('#yProjDet')).includes('12.5 OT h'), await T('#yProjDet'));

console.log('\n━━ UI: mid-year carry-in ━━');
ok('carry-in button offered', await p.isVisible('#yBaseBtn'));
const before=await N('#yGross');
await p.click('#yBaseBtn'); await p.waitForTimeout(250);
await p.fill('#yBaseGross','21450.75');
await p.fill('#yBaseHours','540'); await p.fill('#yBaseOt','25');
await p.click('#yBaseSave'); await p.waitForTimeout(400);
near('YTD now includes the paystub figure', await N('#yGross'), before+21450.75, 0.02);
ok('detail says carried in', (await T('#yDet')).includes('carried in'), await T('#yDet'));
ok('OT carry counted', (await T('#yOt')).includes('25.00'), await T('#yOt'));
ok('cap bar includes carried premium', (await T('#yCapNum')).includes('475'), await T('#yCapNum'));
ok('summary chip shows it', (await T('#yBaseSummary')).includes('21,450'), await T('#yBaseSummary'));
await p.reload(); await p.waitForTimeout(400); await openAll(p);
near('survives reload', await N('#yGross'), before+21450.75, 0.02);
ok('rejects OT > hours', await (async()=>{ await p.click('#yBaseBtn'); await p.waitForTimeout(200);
  await p.fill('#yBaseHours','10'); await p.fill('#yBaseOt','20');
  await p.click('#yBaseSave'); await p.waitForTimeout(250); return p.isVisible('#yBaseErr');})());
await p.click('#yBaseCancel'); await p.waitForTimeout(200);

console.log('\n━━ UI: apply a raise without touching history ━━');
const periodBefore=await N('#cumeGross');
await p.evaluate(()=>{document.querySelectorAll('#cfg details').forEach(d=>d.open=true);});
await p.fill('#rNew','40'); await p.fill('#rDate','2026-08-01');
await p.click('#rApply'); await p.waitForTimeout(450);
near('the July shift kept its $304 (old rate)', await N('#cumeGross'), periodBefore, 0.02);
ok('rate history listed', (await T('#rHist')).includes('$38.00'), await T('#rHist'));
ok('live rate line shows the new $40', (await T('#liveline')).includes('$40.00'), await T('#liveline'));
// clock in now (Aug 4) — earns at the NEW rate
await p.click('#punch'); await p.waitForTimeout(200);
await p.clock.fastForward(3600_000); await p.waitForTimeout(300);
near('an hour now earns $40', await N('#money'), 40, 0.05);
await p.click('#punch'); await p.waitForTimeout(250);

console.log('\n━━ UI: shift types in the editor ━━');
await p.click('#addShift'); await p.waitForTimeout(250);
await p.selectOption('#eKind','holiday'); await p.waitForTimeout(200);
ok('multiplier field appears', await p.isVisible('#fMult'));
await p.fill('#eHours','8'); await p.waitForTimeout(250);
ok('preview prices 8h at 1.5x of $40 = $480', (await T('#ePreview')).includes('$480.00'), await T('#ePreview'));
await p.click('#eSave'); await p.waitForTimeout(350);
ok('log tags the holiday shift', (await T('#logBody')).includes('×1.5'), '');
await p.click('#addShift'); await p.waitForTimeout(200);
await p.selectOption('#eKind','pto'); await p.fill('#eHours','8'); await p.waitForTimeout(250);
ok('PTO previews straight pay $320', (await T('#ePreview')).includes('$320.00'), await T('#ePreview'));
await p.click('#eSave'); await p.waitForTimeout(300);
ok('log tags PTO', (await T('#logBody')).includes('PTO'));

console.log(`\n${fails===0?'✅':'❌'}  pay adjustments: ${fails} failure(s)\n`);
await b.close(); srv.close(); process.exit(fails?1:0);
