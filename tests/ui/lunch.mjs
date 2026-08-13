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

// ---- engine ----
const html=readFileSync(R+'index.html','utf8');
const m=html.match(/\/\* ==ENGINE-START==[\s\S]*?\*\/([\s\S]*?)\/\* ==ENGINE-END== \*\//);
const E=new Function(m[1]+`return {buildLedger,sumSession,sumRange,plannedStopAt,paidSpans,lunchWindow,DEFAULTS,HOUR_MS};`)();
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const near=(n,g,w,t=0.01)=>ok(n,Math.abs(g-w)<=t,`got ${g}, want ${w}`);
const jul=(d,h,mm=0)=>+new Date(2026,6,d,h,mm);
const C=mins=>({...E.DEFAULTS,rate:38,periodAnchor:'2026-07-26',otMode:'period',lunchMins:mins});

console.log('\n━━ Engine: the 30 minutes vanish from pay ━━');
const ten={id:'t',start:jul(27,8),end:jul(27,18)};                       // 10 h wall
near('10 h shift pays 9.5 h', E.sumSession(E.buildLedger([ten],C(30)).parts,'t').hours, 9.5);
near('= $361.00 not $380.00', E.sumSession(E.buildLedger([ten],C(30)).parts,'t').gross, 9.5*38);
near('1 h option pays 9.0 h', E.sumSession(E.buildLedger([ten],C(60)).parts,'t').hours, 9);
near('toggle off pays all 10', E.sumSession(E.buildLedger([ten],C(0)).parts,'t').hours, 10);
const five={id:'f',start:jul(27,8),end:jul(27,13)};                      // exactly 5 h
near('a 5 h shift loses nothing', E.sumSession(E.buildLedger([five],C(30)).parts,'f').hours, 5);
const clipped={id:'c',start:jul(27,8),end:jul(27,13,15)};                // 5h15 wall
near('5h15 shift: only the 15 min clip', E.sumSession(E.buildLedger([clipped],C(30)).parts,'c').hours, 5);
near('worked-through-lunch stays paid', E.sumSession(E.buildLedger([{...ten,adj:{noLunch:true}}],C(30)).parts,'t').hours, 10);
near('PTO never has a lunch carved out', E.sumSession(E.buildLedger([{...ten,adj:{noOt:true}}],C(30)).parts,'t').hours, 10);

console.log('\n━━ The lunch sits exactly at hours 5.0–5.5 of the shift ━━');
const led=E.buildLedger([ten],C(30));
const spans=E.paidSpans(ten,C(30));
ok('paid spans split at 1 PM', new Date(spans[0].end).getHours()===13 && new Date(spans[1].start).getMinutes()===30,
   spans.map(x=>new Date(x.start).toLocaleTimeString()+'-'+new Date(x.end).toLocaleTimeString()).join(', '));
// money at 5h into the shift == money at 5h20 (paused), < money at 5h40 (resumed)
const grossAt=t=>E.sumSession(E.buildLedger([{id:'x',start:ten.start,end:t}],C(30)).parts,'x').gross;
near('during lunch nothing accrues', grossAt(jul(27,13,20)), grossAt(jul(27,13)));
ok('after lunch it resumes', grossAt(jul(27,13,40)) > grossAt(jul(27,13,29)), '');
near('resume picks up exactly', grossAt(jul(27,13,40)), 5*38 + (10/60)*38);

console.log('\n━━ Overtime math uses PAID hours, not wall hours ━━');
// nine 10h days with lunch = 85.5 paid h -> only 5.5 OT under the 80h rule
const days=[...Array(9)].map((_,i)=>({id:'d'+i,start:jul(26+i,8),end:jul(26+i,18)}));
const l9=E.buildLedger(days,C(30));
const tot=l9.parts.reduce((a,p)=>({h:a.h+p.hours,o:a.o+p.otHours,g:a.g+p.gross}),{h:0,o:0,g:0});
near('paid hours 85.5, not 90', tot.h, 85.5);
near('OT is 5.5 h, not 10', tot.o, 5.5);
near('gross 80x38 + 5.5x57', tot.g, 80*38+5.5*57);

console.log('\n━━ Your exact case: Sun–Fri, six 10 h days, toggle flipped on ━━');
const six=[...Array(6)].map((_,i)=>({id:'s'+i,start:jul(26+i,8),end:jul(26+i,18)}));
const before=E.buildLedger(six,C(0)).parts.reduce((a,p)=>a+p.gross,0);
const after =E.buildLedger(six,C(30)).parts.reduce((a,p)=>a+p.gross,0);
near('before: 60 h = $2,280', before, 60*38);
near('after: 57 paid h = $2,166', after, 57*38);
near('the six lunches cost exactly $114', before-after, 6*0.5*38);

console.log('\n━━ Auto-stop knows lunch takes wall time ━━');
near('8 paid h target stops 8.5 wall h later',
  E.plannedStopAt(jul(30,8), 8, [], C(30)), jul(30,16,30));
near('4 paid h target (under 5) is unchanged',
  E.plannedStopAt(jul(30,8), 4, [], C(30)), jul(30,12));

// ---- UI ----
const srv=http.createServer((q,r)=>{const u=q.url||'/';
  if(u.startsWith('/sw.js')){r.writeHead(200,{'Content-Type':'text/javascript'});return r.end(readFileSync(R+'sw.js'));}
  if(u.startsWith('/manifest')){r.writeHead(200,{'Content-Type':'application/manifest+json'});return r.end(readFileSync(R+'manifest.webmanifest'));}
  if(u.indexOf('.png')>-1){r.writeHead(404);return r.end();}
  r.writeHead(200,{'Content-Type':'text/html'});r.end(readFileSync(R+'index.html'));}).listen(8077);
const openAll=async pg=>{try{await pg.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open')));}catch(e){}};
const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({timezoneId:'America/New_York',locale:'en-US',viewport:{width:900,height:2100}});
const seed={configured:true,
  cfg:{rate:38,periodAnchor:'2026-07-26',otMode:'period',periodLengthDays:14,payDateOffsetDays:13,weekStartDay:0},
  sessions:[...Array(6)].map((_,i)=>({id:'s'+i,start:jul(26+i,8),end:jul(26+i,18)})),
  activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false};
const p=await ctx.newPage();
p.on('pageerror',e=>{console.log('  💥',e.message);fails++;});
p.on('console',mm=>{if(mm.type()==='error'){console.log('  💥',mm.text());fails++;}});
await p.addInitScript(([k,v])=>{if(sessionStorage.getItem('__s'))return;sessionStorage.setItem('__s','1');
  localStorage.setItem(k,JSON.stringify(v));},[KEY,seed]);
await p.clock.install({time:new Date('2026-08-01T12:00:00Z')});   // Sat morning, before any shift
await p.goto('http://localhost:8077/'); await p.waitForTimeout(400); await openAll(p);
const T=s=>p.textContent(s), N=async s=>parseFloat((await T(s)).replace(/[$,]/g,''));

console.log('\n━━ UI: flipping the toggle retro-corrects six logged shifts ━━');
const openCfg=()=>p.evaluate(()=>{document.querySelectorAll('#cfg details').forEach(d=>d.open=true);});
await openCfg();
near('period shows $2,280 before', await N('#cumeGross'), 2280, 0.05);
await p.selectOption('#cLunch','30'); await p.waitForTimeout(400);
near('flips to $2,166 — all six lunches deducted', await N('#cumeGross'), 2166, 0.05);
ok('log rows now show 9.50 h', (await T('#logBody')).includes('9.50'), '');
await p.selectOption('#cLunch','60'); await p.waitForTimeout(400);
near('1-hour option deepens it to $2,052', await N('#cumeGross'), 2052, 0.05);
await p.selectOption('#cLunch','30'); await p.waitForTimeout(300);
await p.reload(); await p.waitForTimeout(400); await openAll(p); await openCfg();
near('setting survives reload', await N('#cumeGross'), 2166, 0.05);

console.log('\n━━ UI: the live pause at 5 h ━━');
await p.click('#punch'); await p.waitForTimeout(200);
await p.clock.fastForward(5*3600_000 + 10*60_000); await p.waitForTimeout(300);   // 5h10m in
ok('status says on unpaid lunch', (await T('#statusTxt')).includes('lunch'), await T('#statusTxt'));
ok('liveline explains the pause', (await T('#liveline')).includes('paused'), await T('#liveline'));
const during=await N('#money');
near('money froze at 5 h = $190', during, 190, 0.05);
await p.clock.fastForward(10*60_000); await p.waitForTimeout(300);                // 5h20m
near('still frozen mid-lunch', await N('#money'), during, 0.02);
await p.clock.fastForward(15*60_000); await p.waitForTimeout(300);                // 5h35 — resumed
ok('resumes after 30 min', (await N('#money'))>during, `$${await N('#money')}`);
ok('status back to on the clock', !(await T('#statusTxt')).includes('lunch'), await T('#statusTxt'));
await p.click('#punch'); await p.waitForTimeout(250);

console.log('\n━━ UI: worked-through-lunch exemption in the editor ━━');
await p.click('#addShift'); await p.waitForTimeout(250);
ok('exemption checkbox appears when lunch is on', await p.isVisible('#eNoLunch'));
await p.fill('#eHours','10'); await p.waitForTimeout(250);
ok('preview deducts lunch by default (9.50 h)', (await T('#ePreview')).includes('9.50 h'), '');
await p.check('#eNoLunch'); await p.waitForTimeout(250);
ok('checking it restores the full 10.00 h', (await T('#ePreview')).includes('10.00 h'), '');
await p.click('#eCancel'); await p.waitForTimeout(200);

console.log('\n━━ UI: extra lunches for hours the log cannot see ━━');
const base=await N('#cumeGross');
await p.fill('#cLunchExtra','6'); await p.dispatchEvent('#cLunchExtra','change'); await p.waitForTimeout(400);
near('6 extra lunches deduct $114 more', await N('#cumeGross'), base-114, 0.05);
ok('and the line says so', (await T('#cumeSub')).includes('extra lunches'), await T('#cumeSub'));
await p.fill('#cLunchExtra','0'); await p.dispatchEvent('#cLunchExtra','change'); await p.waitForTimeout(300);
near('back to zero restores', await N('#cumeGross'), base, 0.05);

console.log(`\n${fails===0?'✅':'❌'}  unpaid lunch: ${fails} failure(s)\n`);
await b.close(); srv.close(); process.exit(fails?1:0);
