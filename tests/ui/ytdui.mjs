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
const srv=http.createServer((q,r)=>{
  const u=q.url||'/';
  if(u.startsWith('/sw.js')){r.writeHead(200,{'Content-Type':'text/javascript'});return r.end(readFileSync(R+'sw.js'));}
  if(u.startsWith('/manifest')){r.writeHead(200,{'Content-Type':'application/manifest+json'});return r.end(readFileSync(R+'manifest.webmanifest'));}
  if(u.indexOf('.png')>-1){r.writeHead(404);return r.end();}
  r.writeHead(200,{'Content-Type':'text/html'});r.end(readFileSync(R+'index.html'));
}).listen(8082);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const openAll=async pg=>{ try{ await pg.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open'))); }catch(e){} };
const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({timezoneId:'America/New_York',locale:'en-US',viewport:{width:900,height:2100}});
const jul=(d,h)=>+new Date(2026,6,d,h);
// worked earlier this year too: 500 h straight in the spring + this period's 90 h (10 OT)
const spring=[];
for(let w=0;w<10;w++) for(let d=0;d<5;d++)
  spring.push({id:'s'+w+d,start:+new Date(2026,2,2+w*7+d,8),end:+new Date(2026,2,2+w*7+d,18)});
const thisper=[26,27,28,29,30,31,1,2,3].map((d,i)=>({id:'p'+i,
  start:d>20?jul(d,8):+new Date(2026,7,d,8), end:(d>20?jul(d,8):+new Date(2026,7,d,8))+10*3600e3}));
const seed={configured:true,
  cfg:{rate:38,periodAnchor:'2026-07-26',otMode:'period',periodLengthDays:14,payDateOffsetDays:13,weekStartDay:0},
  sessions:spring.concat(thisper),activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false,
  net:{enabled:false,configured:true,view:'net',filing:'single',dependents:0,fedExempt:false,fedOverride:null,
       statePct:4.95,stateExempt:false,stateOverride:null,ficaOn:true,otBreak:true,otCommit:0,items:[]}};
const p=await ctx.newPage();
p.on('pageerror',e=>{console.log('  💥',e.message);fails++;});
p.on('console',m=>{if(m.type()==='error'){console.log('  💥',m.text());fails++;}});
await p.addInitScript(([k,v])=>{if(sessionStorage.getItem('__s'))return;sessionStorage.setItem('__s','1');
  localStorage.setItem(k,JSON.stringify(v));},[KEY,seed]);
await p.clock.install({time:new Date('2026-08-04T21:00:00Z')});   // Tue Aug 4
await p.goto('http://localhost:8082/'); await p.waitForTimeout(450); await openAll(p);
const T=s=>p.textContent(s), N=async s=>parseFloat((await T(s)).replace(/[$,]/g,''));

console.log('\n━━ YTD section ━━');
ok('section shows with the year', (await T('#ytdYear'))==='2026', await T('#ytdYear'));
// spring 500 h straight ($19,000)... spring weeks were 50 h -> under period rule (14-day periods) some OT
const yg=await N('#yGross');
ok('YTD gross includes months outside this period', yg>19000, `$${yg}`);
ok('YTD hours shown', (await T('#yDet')).includes('590.00 h'), await T('#yDet'));
const yot=await T('#yOt');
ok('OT YTD counted', parseFloat(yot)>=10, yot);
ok('premium line present', (await T('#yOtDet')).includes('premium'), await T('#yOtDet'));

console.log('\n━━ The $12,500 cap bar ━━');
ok('cap bar visible with the law on', await p.isVisible('#yCapWrap'));
ok('cap denominated at $12,500', (await T('#yCapNum')).includes('12,500'), await T('#yCapNum'));
ok('says how much tax-free room is left', (await T('#yCapNote')).includes('left this year'), (await T('#yCapNote')).slice(0,90));

console.log('\n━━ Committed weekly OT drives the projection ━━');
const projBefore=await N('#yProj');
await p.fill('#yCommit','10'); await p.dispatchEvent('#yCommit','change'); await p.waitForTimeout(400);
const projAfter=await N('#yProj');
ok('projection rises with committed OT', projAfter>projBefore, `$${projBefore} -> $${projAfter}`);
ok('detail names the commitment', (await T('#yProjDet')).includes('10.0 OT h'), await T('#yProjDet'));
ok('projects premium to Dec 31', (await T('#yProjDet')).includes('by Dec 31'), '');
ok('cap fate stated', /cap/.test(await T('#yProjDet')), await T('#yProjDet'));
await p.reload(); await p.waitForTimeout(400); await openAll(p);
ok('commitment survives reload', (await p.inputValue('#yCommit'))==='10');

console.log('\n━━ Live: a running shift feeds YTD ━━');
const before=await N('#yGross');
await p.click('#punch'); await p.waitForTimeout(200);
await p.clock.fastForward(3600_000); await p.waitForTimeout(300);
ok('YTD climbs while on the clock', (await N('#yGross'))>before, `${before} -> ${await N('#yGross')}`);
await p.click('#punch'); await p.waitForTimeout(200);

console.log('\n━━ The law toggle changes net withholding ━━');
// switch NET on; note the period net; then turn the law off and net should DROP
await p.click('#payMode button[data-p="net"]'); await p.waitForTimeout(350);
const netOn=await N('#cumeGross');
await p.evaluate(()=>{document.querySelectorAll('#cfg details').forEach(d=>d.open=true);});
// reopen the interview to reach the checkbox
await p.click('#payMode button[data-p="gross"]'); await p.waitForTimeout(200);
await p.evaluate(()=>{ const s=JSON.parse(localStorage.getItem('payclock.v1')); s.net.otBreak=false; s.net.enabled=true;
  localStorage.setItem('payclock.v1', JSON.stringify(s)); });
await p.reload(); await p.waitForTimeout(450); await openAll(p);
const netOff=await N('#cumeGross');
ok('turning the OT break off lowers take-home', netOff<netOn, `$${netOn} with -> $${netOff} without`);

console.log('\n━━ Hide the section from Settings ━━');
await p.evaluate(()=>{document.querySelectorAll('#cfg details').forEach(d=>d.open=true);});
await p.selectOption('#cYtd','0'); await p.waitForTimeout(300);
ok('section hides', !(await p.isVisible('#ytd')));
await p.selectOption('#cYtd','1'); await p.waitForTimeout(300);
ok('and returns', await p.isVisible('#ytd'));

console.log(`\n${fails===0?'✅':'❌'}  YTD + OT break UI: ${fails} failure(s)\n`);
await b.close(); srv.close(); process.exit(fails?1:0);
