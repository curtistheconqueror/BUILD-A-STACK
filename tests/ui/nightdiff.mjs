/* The shift differential: extra per hour on the part of a shift inside a window. */
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
}).listen(8163);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const b=await chromium.launch({executablePath: CHROME});
const T=(d,h,mi=0)=>Date.UTC(2026,6,d,h+5,mi);          // America/Chicago, CDT
const shifts=[12,13,14,15,19,20,21,22].map(d=>({id:'s'+d,start:T(d,14),end:T(d,22,30)}));
const seed=(cfgOver={})=>({configured:true,cfg:{rate:37.78,otMultiplier:1.5,otMode:'shift',
  weeklyThreshold:40,periodThreshold:80,dailyThreshold:8,shiftThreshold:8,weekStartDay:0,
  periodAnchor:'2026-07-12',periodLengthDays:14,payDateOffsetDays:13,
  schedStart:'14:00',schedEnd:'22:30',lunchMins:30,
  workDays:[true,true,true,true,true,false,false],holidays:[],banks:[],daysOff:[],vacations:[],
  shiftDayRule:'majority',skewOn:false,skewMins:0,makeUpOn:false,
  nightOn:true,nightFrom:'18:00',nightTo:'06:00',nightRate:0.15,...cfgOver},
  sessions:shifts,absences:[],activeStart:null,unit:'sec',planOn:false,plannedHours:8,
  sound:false,ui:{open:{}}});
async function boot(ctx, st, atMs){
  const p=await ctx.newPage();
  p.on('pageerror',e=>{console.log('  PAGE ERROR:',e.message);fails++;});
  p.on('console',m=>{if(m.type()==='error'){console.log('  CONSOLE ERROR:',m.text());fails++;}});
  await p.addInitScript(([k,v])=>{
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded','1'); localStorage.setItem(k,JSON.stringify(v));
  },[KEY,st]);
  await p.clock.install({time:new Date(atMs)});
  await p.goto('http://localhost:8163/'); await p.waitForTimeout(650);
  await p.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open')));
  await p.evaluate(()=>{ document.querySelectorAll('#cfg details').forEach(d=>d.open=true); });
  await p.waitForTimeout(400);
  return p;
}
const foot = p => p.evaluate(()=>{
  const t=document.querySelector('#logBody tfoot tr');
  return t?[...t.querySelectorAll('td')].map(td=>td.textContent.trim()):null; });
const ctx = await b.newContext({viewport:{width:1100,height:2600},timezoneId:'America/Chicago',locale:'en-US'});
const NOW = T(25,12);

console.log('\n━━ A fortnight of 2 PM to 10:30 PM shifts ━━');
let p = await boot(ctx, seed(), NOW);
let f = await foot(p);
console.log('       footer ' + JSON.stringify(f));
ok('sixty-four paid hours', f[1]==='64.00', f[1]);
const note = await p.textContent('#nightNote');
console.log('       ' + note.replace(/\s+/g,' '));
ok('the differential line is shown', await p.isVisible('#nightNote'));
ok('half the hours qualify', note.includes('32.00 h'), note);
ok('named with the time it starts', note.includes('6:00 PM'), note);
ok('and the rate', note.includes('$0.15/h'), note);
ok('and what it came to', note.includes('$4.80'), note);
ok('the gross includes it', f[3]==='$2,422.72', f[3]);   // 64 x 37.78 + 4.80

console.log('\n━━ Turned off, nothing changes but the money ━━');
await p.close();
p = await boot(ctx, seed({nightOn:false}), NOW);
f = await foot(p);
ok('same hours', f[1]==='64.00', f[1]);
ok('base pay only', f[3]==='$2,417.92', f[3]);           // 64 x 37.78
ok('and no line to reconcile', !(await p.isVisible('#nightNote')));

console.log('\n━━ The settings say what it means for your own shift ━━');
await p.close();
p = await boot(ctx, seed(), NOW);
ok('the controls are there', await p.isVisible('#cNightOn') && await p.isVisible('#cNightRate'));
ok('set to yes', (await p.inputValue('#cNightOn'))==='1');
ok('at fifteen cents', (await p.inputValue('#cNightRate'))==='0.15', await p.inputValue('#cNightRate'));
ok('from 18:00', (await p.inputValue('#cNightFrom'))==='18:00', await p.inputValue('#cNightFrom'));
let cn = await p.textContent('#cNightNote');
console.log('       ' + cn.replace(/\s+/g,' '));
ok('worked through your own shift', cn.includes('4.00 h') && cn.includes('8.00 h'), cn);
ok('with what it is worth a shift', cn.includes('$0.60'), cn);

console.log('\n━━ Changing it takes effect at once ━━');
await p.fill('#cNightRate','1.25'); await p.dispatchEvent('#cNightRate','change'); await p.waitForTimeout(600);
f = await foot(p);
ok('the gross moves', f[3]==='$2,457.92', f[3]);          // 64 x 37.78 + 32 x 1.25
ok('and the line follows', (await p.textContent('#nightNote')).includes('$40.00'),
   await p.textContent('#nightNote'));
await p.selectOption('#cNightOn','0'); await p.waitForTimeout(500);
ok('switching it off puts the money back', (await foot(p))[3]==='$2,417.92', (await foot(p))[3]);

console.log('\n━━ A day shift is untouched ━━');
await p.close();
p = await boot(ctx, seed({schedStart:'06:00',schedEnd:'14:30'}), NOW);
await p.evaluate(()=>{ state.sessions=[{id:'d',start:new Date(2026,6,20,6).getTime(),
  end:new Date(2026,6,20,14,30).getTime()}]; save(); lastHeavySig=''; _ledCache={}; render(); });
await p.waitForTimeout(500);
ok('nothing qualifies', !(await p.isVisible('#nightNote')));
cn = await p.textContent('#cNightNote');
ok('and settings says so plainly', cn.includes('None of your scheduled shift'), cn);

console.log('\n━━ On a phone ━━');
await p.close();
const mob = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  deviceScaleFactor:3,timezoneId:'America/Chicago',locale:'en-US'});
p = await boot(mob, seed(), NOW);
const m = await p.evaluate(()=>({
  w:document.documentElement.scrollWidth, win:window.innerWidth,
  f:['cNightOn','cNightRate','cNightFrom','cNightTo'].map(id=>({
    h:Math.round(document.getElementById(id).getBoundingClientRect().height),
    fs:parseFloat(getComputedStyle(document.getElementById(id)).fontSize)}))}));
ok('no sideways scroll', m.w<=m.win+1, `${m.w} vs ${m.win}`);
ok('every field is tappable', m.f.every(x=>x.h>=40), JSON.stringify(m.f));
ok('and none makes iOS zoom', m.f.every(x=>x.fs>=16), JSON.stringify(m.f));

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
