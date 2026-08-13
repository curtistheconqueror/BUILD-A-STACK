/* Vacation blocks, the corrected holiday and allowance defaults, and the split between
   "counts toward overtime" and "still owe the hours". */
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
}).listen(8153);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const b=await chromium.launch({executablePath: CHROME});

// Sun-Thu, 14:00-22:30, half-hour lunch. Period anchored on Sun Sep 20 so the vacation is one.
const seed=(over={},cfgOver={})=>({configured:true,cfg:{rate:38,otMultiplier:1.5,otMode:'shift',
  weeklyThreshold:40,periodThreshold:80,dailyThreshold:8,shiftThreshold:8,weekStartDay:0,
  periodAnchor:'2026-09-20',periodLengthDays:14,payDateOffsetDays:13,
  schedStart:'14:00',schedEnd:'22:30',lunchMins:30,
  workDays:[true,true,true,true,true,false,false],
  holidays:[],banks:[],daysOff:[],vacations:[],
  shiftDayRule:'majority',skewOn:false,skewMins:0,makeUpOn:false,makeUpWindow:'period',...cfgOver},
  sessions:[],absences:[],activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false,
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
  await p.goto('http://localhost:8153/'); await p.waitForTimeout(650);
  await p.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open')));
  await p.evaluate(()=>{ document.querySelectorAll('#cfg details').forEach(d=>d.open=true); });
  await p.waitForTimeout(400);
  return p;
}
const foot = p => p.evaluate(()=>{
  const t=document.querySelector('#logBody tfoot tr');
  return t?[...t.querySelectorAll('td')].map(td=>td.textContent.trim()):null; });
const VAC = [{id:'v1',name:'Vacation',from:'2026-09-20',to:'2026-10-03',hours:8,ot:false}];
const SEP=(d,h=12)=>Date.UTC(2026,8,d,h+4);

const ctx = await b.newContext({viewport:{width:1100,height:3000},timezoneId:'America/New_York',locale:'en-US'});

console.log('\n━━ Booking Sept 20 through Oct 3 ━━');
let p = await boot(ctx, seed(), SEP(15));
ok('the vacation section is in Settings', await p.isVisible('#cVacList'));
ok('empty to start', (await p.textContent('#cVacList')).includes('No vacation booked'));
await p.click('#cVacAdd'); await p.waitForTimeout(400);
await p.fill('#vName','Vacation');
await p.fill('#vFrom','2026-09-20'); await p.fill('#vTo','2026-10-03');
await p.dispatchEvent('#vTo','change'); await p.waitForTimeout(350);
let prev = await p.textContent('#vPreview');
console.log('       ' + prev.replace(/\s+/g,' '));
ok('ten rostered days inside it', prev.includes('10 rostered days'), prev);
ok('worth 80 hours', prev.includes('80.00 h'), prev);
ok('and it says when you are back', prev.includes('Back on Sun Oct 4'), prev);
await p.click('#vSave'); await p.waitForTimeout(500);
let list = await p.textContent('#cVacList');
console.log('       ' + list.replace(/\s+/g,' '));
ok('it is listed', list.includes('Vacation'), list);
ok('with its dates', list.includes('Sep 20, 2026') && list.includes('Oct 3, 2026'), list);
ok('and marked flat', list.includes('flat, no OT credit'), list);
ok('stored on the config', await p.evaluate(()=>{
  const v=JSON.parse(localStorage.getItem('payclock.v1')).jobs[0].cfg.vacations;
  return v.length===1 && v[0].from==='2026-09-20' && v[0].to==='2026-10-03'; }));

console.log('\n━━ It pays, flat ━━');
await p.close();
p = await boot(ctx, seed({},{vacations:VAC}), SEP(22));
let f = await foot(p);
console.log('       footer ' + JSON.stringify(f));
ok('eighty hours', f[1]==='80.00', f[1]);
ok('none of it overtime', f[2]==='—', f[2]);
ok('two normal weeks of pay', f[3]==='$3,040.00', f[3]);
const rows = await p.evaluate(()=>[...document.querySelectorAll('#logBody tbody tr')].map(tr=>({
  cls:tr.className, pill:(tr.querySelector('.c-in')?.textContent||'').trim(),
  day:(tr.querySelector('.c-day')?.innerText||'').replace(/\s+/g,' ').trim()})));
ok('ten vacation rows', rows.filter(r=>r.cls.includes('vacrowlog')).length===10,
   String(rows.filter(r=>r.cls.includes('vacrowlog')).length));
ok('each labelled VACATION', rows[0].pill==='VACATION', rows[0].pill);
ok('and named', rows[0].day.includes('Vacation'), rows[0].day);
ok('no Friday or Saturday among them',
   !rows.some(r=>r.cls.includes('vacrowlog') && (r.day.includes('Fri')||r.day.includes('Sat'))),
   JSON.stringify(rows.filter(r=>r.cls.includes('vacrowlog')).map(r=>r.day)));

console.log('\n━━ Highlighted on the calendar ━━');
await p.evaluate(()=>{ document.getElementById('qCalOn').checked=true;
  document.getElementById('qCalOn').dispatchEvent(new Event('change',{bubbles:true})); });
await p.waitForTimeout(600);
const cal = await p.evaluate(()=>{
  const on=[...document.querySelectorAll('.calcell.vac')].map(c=>c.dataset.d);
  return { on, dots:document.querySelectorAll('.calcell.vac .vacdot').length,
           tip:(document.querySelector('.calcell.vac')||{}).dataset }; });
console.log('       ' + JSON.stringify(cal.on));
ok('the rostered vacation days are marked', cal.on.length>0, JSON.stringify(cal.on));
ok('every one carries a dot', cal.dots===cal.on.length, `${cal.dots} vs ${cal.on.length}`);
ok('Sep 25 is a Friday and is not marked', !cal.on.includes('2026-09-25'), JSON.stringify(cal.on));
ok('Sep 24 is a Thursday and is', cal.on.includes('2026-09-24'), JSON.stringify(cal.on));

console.log('\n━━ Two weeks off is not two weeks in the hole ━━');
await p.close();
p = await boot(ctx, seed({},{vacations:VAC,makeUpOn:true,otMode:'shift'}), SEP(22));
ok('nothing to work off', !(await p.isVisible('#makeUpBar')));
ok('and no missing days to explain', await p.evaluate(()=>
  ![...document.querySelectorAll('#logBody tbody tr')].some(t=>t.className.includes('gaprowlog'))));

console.log('\n━━ The corrected defaults ━━');
await p.close();
/* Leave the keys out entirely rather than nulling them — a stored null is a value, and
   Object.assign would keep it over the default. */
const bare = seed(); delete bare.cfg.holidays; delete bare.cfg.banks;
p = await boot(ctx, bare, SEP(15));
/* Read the live config: defaults are merged in on load and only written back on the next
   save, so storage still holds exactly what was seeded. */
const d = await p.evaluate(()=>{
  const c=state.cfg;
  return { hols:(c.holidays||[]).map(h=>({n:h.name,ot:h.ot})), banks:(c.banks||[]).map(x=>
    ({id:x.id,count:x.count,ot:x.ot,makeUp:x.makeUp})) }; });
console.log('       ' + JSON.stringify(d.banks));
ok('six holidays', d.hols.length===6, String(d.hols.length));
ok('none earning overtime credit', d.hols.every(h=>h.ot===false), JSON.stringify(d.hols));
ok('three floaters', d.banks[0].count===3, String(d.banks[0].count));
ok('five sick days', d.banks[1].count===5, String(d.banks[1].count));
ok('five vacation random days', d.banks[2].id==='vrd' && d.banks[2].count===5, JSON.stringify(d.banks[2]));
ok('the sick day is the one you owe back', d.banks[1].makeUp===true, JSON.stringify(d.banks[1]));
ok('the VRD is not', d.banks[2].makeUp===false, JSON.stringify(d.banks[2]));
const slots = await p.evaluate(()=>[...document.querySelectorAll('#cBankList input[data-bslot="0"]')].map(i=>i.value));
ok('the floaters are MLK, Birthday, Anniversary',
   JSON.stringify(slots)===JSON.stringify(['MLK Day','Birthday','Anniversary']), JSON.stringify(slots));
ok('and both questions are asked per allowance',
   (await p.locator('#cBankList select[data-bf="makeUp"]').count())===3);

console.log('\n━━ Editing and removing ━━');
await p.close();
p = await boot(ctx, seed({},{vacations:VAC}), SEP(15));
await p.click('#cVacList button[data-vedit]'); await p.waitForTimeout(400);
ok('it reopens on what you saved', (await p.inputValue('#vFrom'))==='2026-09-20', await p.inputValue('#vFrom'));
await p.fill('#vTo','2026-09-26'); await p.dispatchEvent('#vTo','change'); await p.waitForTimeout(300);
await p.click('#vSave'); await p.waitForTimeout(500);
ok('a shorter block re-counts', (await p.textContent('#cVacList')).includes('5 rostered days'),
   (await p.textContent('#cVacList')).replace(/\s+/g,' '));
await p.click('#cVacList button[data-vdel]'); await p.waitForTimeout(450);
ok('and it can be removed', (await p.textContent('#cVacList')).includes('No vacation booked'));

console.log('\n━━ Nonsense is refused ━━');
await p.click('#cVacAdd'); await p.waitForTimeout(300);
await p.fill('#vFrom','2026-09-20'); await p.fill('#vTo','2026-09-10');
await p.dispatchEvent('#vTo','change'); await p.waitForTimeout(300);
await p.click('#vSave'); await p.waitForTimeout(350);
ok('a backwards block is rejected', await p.isVisible('#vErr'));
ok('with a reason', (await p.textContent('#vErr')).includes('cannot be before'), await p.textContent('#vErr'));

console.log('\n━━ On a phone ━━');
await p.close();
const mob = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  deviceScaleFactor:3,timezoneId:'America/New_York',locale:'en-US'});
p = await boot(mob, seed({},{vacations:VAC}), SEP(22));
await p.click('#cVacList button[data-vedit]'); await p.waitForTimeout(400);
const m = await p.evaluate(()=>({
  w:document.documentElement.scrollWidth, win:window.innerWidth,
  f:['vName','vFrom','vTo','vHours','vOt'].map(id=>({
    h:Math.round(document.getElementById(id).getBoundingClientRect().height),
    fs:parseFloat(getComputedStyle(document.getElementById(id)).fontSize)}))}));
ok('no sideways scroll', m.w<=m.win+1, `${m.w} vs ${m.win}`);
ok('every field is tappable', m.f.every(x=>x.h>=40), JSON.stringify(m.f));
ok('and none makes iOS zoom', m.f.every(x=>x.fs>=16), JSON.stringify(m.f));

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
