/* The make-up rule end to end: the hole, the settlement, and the fact that it is visible. */
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
  const f=R+path;
  if(!existsSync(f)){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'Content-Type':TYPES[path.slice(path.lastIndexOf('.'))]||'application/octet-stream'});
  r.end(readFileSync(f));
}).listen(8147);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const b=await chromium.launch({executablePath: CHROME});
const T=(d,h,mi=0)=>Date.UTC(2026,7,d,h+4,mi);

// Sun-Thu 14:00-22:30, half-hour lunch, per-shift OT after 8. Period from Sun Aug 9.
const shift=(d,paid)=>({id:'d'+d,start:T(d,14),end:T(d,14)+(paid+(paid>5?0.5:0))*3600000});
const seed=(over={},cfgOver={})=>({configured:true,cfg:{rate:38,otMultiplier:1.5,otMode:'shift',
  weeklyThreshold:40,periodThreshold:80,dailyThreshold:8,shiftThreshold:8,weekStartDay:0,
  periodAnchor:'2026-08-09',periodLengthDays:14,payDateOffsetDays:13,
  schedStart:'14:00',schedEnd:'22:30',lunchMins:30,
  workDays:[true,true,true,true,true,false,false],holidays:[],banks:[],daysOff:[],
  shiftDayRule:'majority',skewOn:false,skewMins:0,makeUpOn:true,makeUpWindow:'period',...cfgOver},
  sessions:[shift(9,8),shift(10,10),shift(11,8)],
  absences:[],activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false,
  ui:{open:{},tc:true},...over});

async function boot(ctx, st, atMs){
  const p=await ctx.newPage();
  p.on('pageerror',e=>{console.log('  PAGE ERROR:',e.message);fails++;});
  p.on('console',m=>{if(m.type()==='error'){console.log('  CONSOLE ERROR:',m.text());fails++;}});
  await p.addInitScript(([k,v])=>{
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded','1'); localStorage.setItem(k,JSON.stringify(v));
  },[KEY,st]);
  await p.clock.install({time:new Date(atMs)});
  await p.goto('http://localhost:8147/'); await p.waitForTimeout(650);
  await p.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open')));
  await p.waitForTimeout(350);
  return p;
}
const totals = p => p.evaluate(()=>{
  const t=document.querySelector('#logBody tfoot tr');
  return t?[...t.querySelectorAll('td')].map(td=>td.textContent.trim()):null; });

const ctx = await b.newContext({viewport:{width:1100,height:2600},timezoneId:'America/New_York',locale:'en-US'});

console.log('\n━━ Called off Wednesday, read on Thursday afternoon ━━');
let p = await boot(ctx, seed(), T(13,12));
ok('the bar says what you owe', await p.isVisible('#makeUpBar'));
let txt = await p.textContent('#makeUpTxt');
console.log('       ' + txt);
ok('six hours, not eight', txt.includes('6.00 h to work off'), txt);
ok('naming the window', txt.includes('this pay period'), txt);
ok('and where the hours go first', txt.includes('pay it down first'), txt);
let f = await totals(p);
console.log('       footer ' + JSON.stringify(f));
ok("Monday's overtime is gone", f[2]==='—', f[2]);
ok('but the hours are all still there', f[1]==='26.00', f[1]);
ok('and every one of them is paid', f[3]==='$988.00', f[3]);

console.log('\n━━ Working out of it ━━');
for (const [paid,wantOt,wantBar] of [[13,'—',true],[14,'—',false],[15,'1.00',false],[16,'2.00',false]]){
  await p.close();
  p = await boot(ctx, seed({sessions:[shift(9,8),shift(10,10),shift(11,8),shift(13,paid)]}), T(14,12));
  const ft = await totals(p);
  ok(`a ${paid}-hour Thursday pays ${wantOt} overtime`, ft[2]===wantOt, ft[2]);
  ok(`  and the bar is ${wantBar?'still up':'gone'}`, (await p.isVisible('#makeUpBar'))===wantBar);
}

console.log('\n━━ Turn it off and the old figures come back ━━');
await p.close();
p = await boot(ctx, seed({},{makeUpOn:false}), T(13,12));
f = await totals(p);
console.log('       footer ' + JSON.stringify(f));
ok('Monday keeps its two hours', f[2]==='2.00', f[2]);
ok('worth $38 more', f[3]==='$1,026.00', f[3]);
ok('and nothing is asked of you', !(await p.isVisible('#makeUpBar')));
ok('nor is FMLA offered', !(await p.isVisible('#fmlaOut')));

console.log('\n━━ FMLA while clocked out ━━');
await p.close();
p = await boot(ctx, seed(), T(13,12));
ok('the button is there off the clock', await p.isVisible('#fmlaOut'));
ok('and reads as a record, not a clock-out',
   (await p.textContent('#fmlaOut')).includes('Record FMLA'), await p.textContent('#fmlaOut'));
await p.click('#fmlaOut'); await p.waitForTimeout(450);
ok('it opens the absence editor', await p.isVisible('#absEdit'));
ok('pre-set to FMLA', (await p.inputValue('#aKind'))==='fmla', await p.inputValue('#aKind'));
await p.close();
p = await boot(ctx, seed({activeStart:T(13,14)}), T(13,18));
ok('on the clock it reads as a clock-out',
   (await p.textContent('#fmlaOut')).includes('Clock out'), await p.textContent('#fmlaOut'));

console.log('\n━━ Under a weekly rule nothing is settled twice ━━');
await p.close();
p = await boot(ctx, seed({},{otMode:'weekly',weeklyThreshold:40}), T(13,12));
ok('no make-up bar', !(await p.isVisible('#makeUpBar')));
f = await totals(p);
ok('and the week prices normally', f[1]==='26.00', f[1]);

console.log('\n━━ The window is a setting ━━');
await p.close();
p = await boot(ctx, seed({sessions:[shift(9,8),shift(10,10),shift(11,8),shift(16,10)]},
  {makeUpWindow:'week'}), T(17,12));
await p.evaluate(()=>{ document.querySelectorAll('#cfg details').forEach(d=>d.open=true); });
await p.waitForTimeout(300);
ok('the control is there', await p.isVisible('#cMakeUpWin'));
ok('set to weekly', (await p.inputValue('#cMakeUpWin'))==='week');
f = await totals(p);
console.log('       footer ' + JSON.stringify(f));
ok("last week's hole does not follow you", f[2]==='2.00', f[2]);
await p.selectOption('#cMakeUpWin','period'); await p.waitForTimeout(600);
f = await totals(p);
ok('on a pay-period window it does', f[2]==='—', f[2]);

console.log('\n━━ On a phone ━━');
await p.close();
const mob = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  deviceScaleFactor:3,timezoneId:'America/New_York',locale:'en-US'});
p = await boot(mob, seed(), T(13,12));
const m = await p.evaluate(()=>({
  w:document.documentElement.scrollWidth, win:window.innerWidth,
  bar:document.getElementById('makeUpBar').getBoundingClientRect(),
  fm:Math.round(document.getElementById('fmlaOut').getBoundingClientRect().height)}));
ok('no sideways scroll', m.w<=m.win+1, `${m.w} vs ${m.win}`);
ok('the bar is on screen', m.bar.right<=m.win+1 && m.bar.width>0, JSON.stringify(m.bar.width));
ok('the FMLA button is tappable', m.fm>=40, `${m.fm}px`);

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
