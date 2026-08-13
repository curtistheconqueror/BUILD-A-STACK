/* The Today tile follows the day a shift belongs to, so a night that runs past midnight
   reads as one day's work instead of being cut in half by a boundary payroll never uses. */
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
}).listen(8159);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const b=await chromium.launch({executablePath: CHROME});
const T=(d,h,mi=0)=>Date.UTC(2026,7,d,h+4,mi);            // America/New_York, EDT
const NIGHT={id:'n',start:T(9,12,15),end:T(10,0,45)};     // 12:15 PM Sun -> 12:45 AM Mon
const seed=(over={})=>({configured:true,cfg:{rate:38,otMultiplier:1.5,otMode:'shift',
  weeklyThreshold:40,periodThreshold:80,dailyThreshold:8,shiftThreshold:8,weekStartDay:0,
  periodAnchor:'2026-08-09',periodLengthDays:14,payDateOffsetDays:13,
  schedStart:'14:00',schedEnd:'22:30',lunchMins:30,
  workDays:[true,true,true,true,true,false,false],holidays:[],banks:[],daysOff:[],vacations:[],
  shiftDayRule:'majority',skewOn:false,skewMins:0,makeUpOn:false,makeUpWindow:'period'},
  sessions:[NIGHT],absences:[],activeStart:null,unit:'sec',planOn:false,plannedHours:8,
  sound:false,ui:{open:{}},...over});
async function boot(ctx, st, atMs){
  const p=await ctx.newPage();
  p.on('pageerror',e=>{console.log('  PAGE ERROR:',e.message);fails++;});
  p.on('console',m=>{if(m.type()==='error'){console.log('  CONSOLE ERROR:',m.text());fails++;}});
  await p.addInitScript(([k,v])=>{
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded','1'); localStorage.setItem(k,JSON.stringify(v));
  },[KEY,st]);
  await p.clock.install({time:new Date(atMs)});
  await p.goto('http://localhost:8159/'); await p.waitForTimeout(650);
  await p.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open')));
  await p.waitForTimeout(350);
  return p;
}
const tile = p => p.evaluate(()=>({key:document.getElementById('dayKey').textContent.trim(),
  money:document.getElementById('dGross').textContent.trim(),
  det:document.getElementById('dDet').textContent.replace(/\s+/g,' ').trim()}));
const ctx = await b.newContext({viewport:{width:1100,height:2200},timezoneId:'America/New_York',locale:'en-US'});

console.log('\n━━ Just clocked out at 12:45 AM ━━');
let p = await boot(ctx, seed(), T(10,0,50));
let t = await tile(p);
console.log('       ' + JSON.stringify(t));
ok('the whole shift is there', t.money==='$532.00', t.money);
ok('all twelve hours', t.det.startsWith('12.00 h'), t.det);
ok('and the tile names the day it is showing', t.key==='Sun Aug 9', t.key);

console.log('\n━━ Still on the clock, past midnight ━━');
await p.close();
p = await boot(ctx, seed({sessions:[],activeStart:T(9,12,15)}), T(10,0,30));
t = await tile(p);
console.log('       ' + JSON.stringify(t));
ok('it counts the running shift whole', t.det.startsWith('11.75 h'), t.det);
ok('still filed under Sunday', t.key==='Sun Aug 9', t.key);

console.log('\n━━ Before midnight it just says Today ━━');
await p.close();
p = await boot(ctx, seed({sessions:[],activeStart:T(9,12,15)}), T(9,23,0));
t = await tile(p);
ok('no date needed', t.key==='Today', t.key);
ok('hours so far', t.det.startsWith('10.25 h'), t.det);

console.log('\n━━ A fresh day with nothing worked ━━');
await p.close();
p = await boot(ctx, seed(), T(11,14,0));
t = await tile(p);
console.log('       ' + JSON.stringify(t));
ok('back to Today', t.key==='Today', t.key);
ok('and nothing on it', t.money==='$0.00', t.money);

console.log('\n━━ A plain day shift is unchanged ━━');
await p.close();
p = await boot(ctx, seed({sessions:[{id:'d',start:T(11,14),end:T(11,22,30)}]}), T(11,23,0));
t = await tile(p);
console.log('       ' + JSON.stringify(t));
ok('says Today', t.key==='Today', t.key);
ok('eight paid hours', t.det.startsWith('8.00 h'), t.det);
ok('worth $304', t.money==='$304.00', t.money);

console.log('\n━━ Two shifts in one day add up ━━');
await p.close();
p = await boot(ctx, seed({sessions:[{id:'a',start:T(11,6),end:T(11,10)},
                                    {id:'b',start:T(11,14),end:T(11,18)}]}), T(11,19,0));
t = await tile(p);
ok('one figure for both', t.det.startsWith('8.00 h'), t.det);

console.log('\n━━ It agrees with the log ━━');
await p.close();
p = await boot(ctx, seed(), T(10,0,50));
const logTotal = await p.evaluate(()=>{
  const tr=document.querySelector('#logBody tfoot tr');
  return tr?[...tr.querySelectorAll('td')].map(td=>td.textContent.trim()):null; });
console.log('       log footer ' + JSON.stringify(logTotal));
t = await tile(p);
ok('the tile and the log say the same hours', logTotal[1]===t.det.split(' ')[0],
   logTotal[1]+' vs '+t.det.split(' ')[0]);
ok('and the same money', logTotal[3]===t.money, logTotal[3]+' vs '+t.money);

console.log('\n━━ On a phone ━━');
await p.close();
const mob = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  deviceScaleFactor:3,timezoneId:'America/New_York',locale:'en-US'});
p = await boot(mob, seed(), T(10,0,50));
const m = await p.evaluate(()=>{
  const k=document.getElementById('dayKey').getBoundingClientRect();
  return { w:document.documentElement.scrollWidth, win:window.innerWidth, right:Math.round(k.right) }; });
ok('no sideways scroll', m.w<=m.win+1, `${m.w} vs ${m.win}`);
ok('the longer label still fits', m.right<=m.win, `${m.right} vs ${m.win}`);

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
