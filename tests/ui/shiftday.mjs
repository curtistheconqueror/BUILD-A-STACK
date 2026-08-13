/* Which day a shift belongs to. A night worker rostered Mon–Fri, scheduled 22:00–06:00:
   their Monday shift starts Sunday night, and everything that asks "what day is this"
   has to agree with them. */
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
}).listen(8129);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const b=await chromium.launch({executablePath: CHROME});
const T=(d,h,mi=0)=>Date.UTC(2026,7,d,h+4,mi);        // America/New_York, EDT

// Night worker: Mon–Fri, 22:00–06:00, no lunch. Period Sun Aug 9, 14 days.
const night={configured:true,cfg:{rate:38,otMultiplier:1.5,otMode:'shift',weeklyThreshold:40,
  periodThreshold:80,dailyThreshold:8,shiftThreshold:8,weekStartDay:0,periodAnchor:'2026-08-09',
  periodLengthDays:14,payDateOffsetDays:13,schedStart:'22:00',schedEnd:'06:00',lunchMins:0,
  workDays:[false,true,true,true,true,true,false],holidays:[],banks:[],daysOff:[],
  shiftDayRule:'majority'},
  sessions:[],activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false,
  ui:{open:{},tc:true}};

async function boot(ctx, seed, atMs){
  const p=await ctx.newPage();
  p.on('pageerror',e=>{console.log('  PAGE ERROR:',e.message);fails++;});
  p.on('console',m=>{if(m.type()==='error'){console.log('  CONSOLE ERROR:',m.text());fails++;}});
  await p.addInitScript(([k,v])=>{
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded','1');
    localStorage.setItem(k,JSON.stringify(v));
  },[KEY,seed]);
  await p.clock.install({time:new Date(atMs)});
  await p.goto('http://localhost:8129/'); await p.waitForTimeout(650);
  await p.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open')));
  await p.evaluate(()=>{ document.querySelectorAll('#cfg details').forEach(d=>d.open=true); });
  await p.waitForTimeout(350);
  return p;
}
const logDays = p => p.evaluate(()=>[...document.querySelectorAll('#logBody tbody tr')]
  .map(tr=>tr.querySelector('.c-day')?.innerText.replace(/\s+/g,' ').trim()));
const tcRows = p => p.evaluate(()=>[...document.querySelectorAll('#tcList .tcrow:not(.head)')].map(r=>({
  day:r.querySelector('.d').textContent.trim(), claim:r.querySelector('.x').textContent.trim(),
  whole:r.classList.contains('un')})));
const ctx = await b.newContext({viewport:{width:1100,height:2400},timezoneId:'America/New_York',locale:'en-US'});

// Sun Aug 16 22:00 -> Mon Aug 17 06:00 is Monday's shift.
const MON=[{id:'m',start:T(16,22),end:T(17,6)}];

console.log('\n━━ The shift log names the day the shift is ━━');
let p = await boot(ctx, {...night, sessions:MON}, T(17,12));
let days = await logDays(p);
console.log('       ' + JSON.stringify(days));
ok('a Sunday 10 PM start reads Mon', days[0].includes('Mon Aug 17'), days[0]);
ok('not Sun',                       !days[0].includes('Sun'), days[0]);

console.log('\n━━ And the roster is judged against that day ━━');
/* The time card only lists periods that have closed, so stand in the next one:
   period Aug 9–22 closes, and the Monday shift sits inside it. */
await p.close();
p = await boot(ctx, {...night, sessions:MON}, T(24,12));
let rows = await tcRows(p);
console.log('       ' + JSON.stringify(rows));
ok('the time card lists it as Monday', rows[0].day.includes('Mon Aug 17'), rows[0].day);
ok('not flagged as a whole unscheduled day', rows[0].whole===false);
ok('and a shift worked exactly to schedule claims nothing', rows[0].claim==='—', rows[0].claim);

console.log('\n━━ Named by the day it began, it would be wrong ━━');
await p.close();
p = await boot(ctx, {...night, cfg:{...night.cfg, shiftDayRule:'start'}, sessions:MON}, T(24,12));
rows = await tcRows(p);
ok('it reads Sunday', rows[0].day.includes('Sun Aug 16'), rows[0].day);
ok('Sunday is not rostered, so the whole shift is claimed', rows[0].whole===true);
ok('all 8 hours of it', rows[0].claim==='8.00', rows[0].claim);

console.log('\n━━ The setting, and what it says about your own shift ━━');
await p.close();
p = await boot(ctx, {...night, sessions:MON}, T(17,12));
ok('the control is in Settings', await p.isVisible('#cShiftDay'));
ok('defaulting to the majority rule', (await p.inputValue('#cShiftDay'))==='majority',
   await p.inputValue('#cShiftDay'));
ok('three options', (await p.locator('#cShiftDay option').count())===3);
let note = await p.textContent('#cShiftDayNote');
console.log('       ' + note);
ok('it says the shift crosses midnight', note.includes('crosses midnight'), note);
ok('and works it out with their own hours', /counts as/.test(note), note);
await p.selectOption('#cShiftDay','start'); await p.waitForTimeout(500);
await p.evaluate(()=>{ document.querySelectorAll('#cfg details').forEach(d=>d.open=true); });
await p.waitForTimeout(250);
note = await p.textContent('#cShiftDayNote');
ok('changing it changes the worked example', note.includes('crosses midnight'), note);
ok('and it saves', (await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).jobs[0].cfg.shiftDayRule))==='start');

console.log('\n━━ A day-shift worker is told it makes no difference ━━');
await p.close();
p = await boot(ctx, {...night, cfg:{...night.cfg, schedStart:'14:00', schedEnd:'22:30',
  workDays:[true,true,true,true,true,false,false]},
  sessions:[{id:'a',start:T(16,12,15),end:T(17,0,45)}]}, T(17,12));
note = await p.textContent('#cShiftDayNote');
console.log('       ' + note);
ok('it says so plainly', note.includes('does not cross midnight'), note);
days = await logDays(p);
ok("and a 12:15 PM to 12:45 AM shift still reads Sun", days[0].includes('Sun Aug 16'), days[0]);

console.log('\n━━ The evening shift that stays put ━━');
await p.close();
// 6 PM to 2 AM: more of it before midnight, so it is that evening's shift.
p = await boot(ctx, {...night, sessions:[{id:'e',start:T(16,18),end:T(17,2)}]}, T(17,12));
days = await logDays(p);
ok('6 PM to 2 AM reads Sun, the evening it started', days[0].includes('Sun Aug 16'), days[0]);

console.log('\n━━ Holidays and booked days keep their own dates ━━');
await p.close();
p = await boot(ctx, {...night, sessions:MON, cfg:{...night.cfg,
  banks:[{id:'float',name:'Floating holiday',count:4,hours:8,ot:true,slots:[]}],
  daysOff:[{id:'x',bank:'float',slot:0,date:'2026-08-18',hours:8}]}}, T(19,12));
days = await logDays(p);
console.log('       ' + JSON.stringify(days));
ok('the booked day is filed on its own date', days.some(d=>d.includes('Tue Aug 18')),
   JSON.stringify(days));

console.log('\n━━ On a phone ━━');
await p.close();
const mob = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  deviceScaleFactor:3,timezoneId:'America/New_York',locale:'en-US'});
p = await boot(mob, {...night, sessions:MON}, T(17,12));
const m = await p.evaluate(()=>({
  pageW:document.documentElement.scrollWidth, winW:window.innerWidth,
  sel:Math.round(document.getElementById('cShiftDay').getBoundingClientRect().height),
  fs:parseFloat(getComputedStyle(document.getElementById('cShiftDay')).fontSize)
}));
ok('no sideways scroll', m.pageW<=m.winW+1, `${m.pageW} vs ${m.winW}`);
ok('the control is tappable', m.sel>=40, `${m.sel}px`);
ok('and will not make iOS zoom', m.fs>=16, `${m.fs}px`);

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
