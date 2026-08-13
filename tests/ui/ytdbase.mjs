/* Carrying a paystub's year-to-date figure in, and the Dec 31 projection. */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// The app under test sits two directories up from tests/ui/.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
// Set PW_CHROME to point at a specific build; otherwise Playwright finds its own.
const CHROME = process.env.PW_CHROME || undefined;

const KEY='payclock.v1', R = ROOT;
const TYPES={'.html':'text/html','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{
  let path=decodeURIComponent(q.url.split('?')[0]);
  if(path==='/'||path==='/index.html'){r.writeHead(200,{'Content-Type':'text/html'});return r.end(readFileSync(R+'index.html'));}
  if(path==='/favicon.ico'){r.writeHead(204);return r.end();}
  const f=R+path; if(!existsSync(f)){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'Content-Type':TYPES[path.slice(path.lastIndexOf('.'))]||'application/octet-stream'});
  r.end(readFileSync(f));
}).listen(8167);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const b=await chromium.launch({executablePath: CHROME});
const T=(m,d,h,mi=0)=>Date.UTC(2026,m,d,h+5,mi);          // America/Chicago, CDT
// Ten shifts in July, all before the stub date; two in August, after it.
const before=[]; for(let i=0;i<10;i++){const d=13+i; before.push({id:'b'+i,start:T(6,d,14),end:T(6,d,22,30)});}
const after=[{id:'a1',start:T(7,3,14),end:T(7,3,22,30)},{id:'a2',start:T(7,4,14),end:T(7,4,22,30)}];
const seed=(over={})=>({configured:true,cfg:{rate:37.78,otMultiplier:1.5,otMode:'shift',
  weeklyThreshold:40,periodThreshold:80,dailyThreshold:8,shiftThreshold:8,weekStartDay:0,
  periodAnchor:'2026-07-12',periodLengthDays:14,payDateOffsetDays:13,
  schedStart:'14:00',schedEnd:'22:30',lunchMins:30,
  workDays:[true,true,true,true,true,false,false],holidays:[],banks:[],daysOff:[],vacations:[],
  shiftDayRule:'majority',skewOn:false,skewMins:0,makeUpOn:false,nightOn:false},
  sessions:before.concat(after),absences:[],activeStart:null,unit:'sec',planOn:false,
  plannedHours:8,sound:false,ui:{open:{}},
  net:{ytdShow:true,enabled:false,otBreak:true,filing:'single'},...over});
async function boot(ctx, st, atMs){
  const p=await ctx.newPage();
  p.on('pageerror',e=>{console.log('  PAGE ERROR:',e.message);fails++;});
  p.on('console',m=>{if(m.type()==='error'){console.log('  CONSOLE ERROR:',m.text());fails++;}});
  await p.addInitScript(([k,v])=>{
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded','1'); localStorage.setItem(k,JSON.stringify(v));
  },[KEY,st]);
  await p.clock.install({time:new Date(atMs)});
  await p.goto('http://localhost:8167/'); await p.waitForTimeout(650);
  await p.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open')));
  await p.waitForTimeout(400);
  return p;
}
const num = async (p,sel) => parseFloat((await p.textContent(sel)).replace(/[$,]/g,''));
const ctx = await b.newContext({viewport:{width:1100,height:2600},timezoneId:'America/Chicago',locale:'en-US'});
const NOW = T(7,5,12);          // Wed Aug 5, noon

console.log('\n━━ Twelve shifts logged, nothing carried in ━━');
let p = await boot(ctx, seed(), NOW);
const tracked = await num(p,'#yGross');
console.log('       YTD ' + tracked.toFixed(2));
ok('96 paid hours at 37.78', Math.abs(tracked-96*37.78)<0.02, tracked.toFixed(2));

console.log('\n━━ Carrying in a stub that already covers ten of them ━━');
await p.click('#yBaseBtn'); await p.waitForTimeout(350);
ok('the editor asks for the date it runs through', await p.isVisible('#yBaseThrough'));
await p.fill('#yBaseGross','5000');
await p.fill('#yBaseThrough','2026-07-25');
await p.click('#yBaseSave'); await p.waitForTimeout(600);
const withBase = await num(p,'#yGross');
const det = await p.textContent('#yDet');
console.log('       YTD ' + withBase.toFixed(2) + '   ' + det.replace(/\s+/g,' '));
ok('the ten July shifts are not counted twice',
   Math.abs(withBase-(5000+16*37.78))<0.02, withBase.toFixed(2));
ok('only the two August shifts are added on', det.includes('$604.48'), det);
ok('and the sum is spelled out', det.includes('carried in') && det.includes('tracked'), det);
ok('naming the date it runs through', det.includes('Jul 25'), det);

console.log('\n━━ Without a date it behaves as it always did ━━');
await p.click('#yBaseBtn'); await p.waitForTimeout(350);
await p.fill('#yBaseThrough',''); await p.click('#yBaseSave'); await p.waitForTimeout(600);
const noDate = await num(p,'#yGross');
console.log('       YTD ' + noDate.toFixed(2));
ok('everything logged is added to the stub', Math.abs(noDate-(5000+96*37.78))<0.02, noDate.toFixed(2));

console.log('\n━━ The projection holds still while you are on the clock ━━');
await p.close();
p = await boot(ctx, seed({activeStart:T(7,5,9)}), NOW);
const proj1 = await num(p,'#yProj');
const gross1 = await num(p,'#yGross');
await p.clock.fastForward(20*60*1000); await p.waitForTimeout(700);
const proj2 = await num(p,'#yProj');
const gross2 = await num(p,'#yGross');
console.log('       after 20 min on the clock: YTD ' + gross1.toFixed(2) + ' -> ' + gross2.toFixed(2)
          + ' , projection ' + proj1.toFixed(2) + ' -> ' + proj2.toFixed(2));
ok('year to date keeps climbing', gross2>gross1, `${gross1} -> ${gross2}`);
ok('the projection does not', proj2===proj1, `${proj1} -> ${proj2}`);

console.log('\n━━ And it says what it is made of ━━');
const pdet = await p.textContent('#yProjDet');
console.log('       ' + pdet.replace(/\s+/g,' '));
ok('banked plus days left', /banked \+ \d+ days at/.test(pdet), pdet);
ok('at your rostered week, not the threshold', pdet.includes('40 h'), pdet);

console.log('\n━━ A part-time roster forecasts on its own week ━━');
await p.close();
p = await boot(ctx, seed({cfg:{...seed().cfg, workDays:[false,true,true,true,false,false,false]}}), NOW);
ok('24 h a week, not 40', (await p.textContent('#yProjDet')).includes('24 h'),
   await p.textContent('#yProjDet'));

console.log('\n━━ On a phone ━━');
await p.close();
const mob = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  deviceScaleFactor:3,timezoneId:'America/Chicago',locale:'en-US'});
p = await boot(mob, seed(), NOW);
await p.click('#yBaseBtn'); await p.waitForTimeout(400);
const m = await p.evaluate(()=>({
  w:document.documentElement.scrollWidth, win:window.innerWidth,
  f:['yBaseGross','yBaseThrough','yBaseHours','yBaseOt'].map(id=>({
    h:Math.round(document.getElementById(id).getBoundingClientRect().height),
    fs:parseFloat(getComputedStyle(document.getElementById(id)).fontSize)}))}));
ok('no sideways scroll', m.w<=m.win+1, `${m.w} vs ${m.win}`);
ok('every field is tappable', m.f.every(x=>x.h>=40), JSON.stringify(m.f));
ok('and none makes iOS zoom', m.f.every(x=>x.fs>=16), JSON.stringify(m.f));

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
