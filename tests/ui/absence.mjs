/* Absences: time you were scheduled for and did not work. Stage 1 — recording it, seeing it,
   and the FMLA clock-out. The overtime gating comes later; nothing here should touch pay. */
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
}).listen(8141);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const b=await chromium.launch({executablePath: CHROME});
const T=(d,h,mi=0)=>Date.UTC(2026,7,d,h+4,mi);          // America/New_York, EDT

// Sun-Thu, 14:00-22:30, half-hour lunch. Period starts Sun Aug 9.
const seed=(over={})=>({configured:true,cfg:{rate:38,otMultiplier:1.5,otMode:'shift',
  weeklyThreshold:40,periodThreshold:80,dailyThreshold:8,shiftThreshold:8,weekStartDay:0,
  periodAnchor:'2026-08-09',periodLengthDays:14,payDateOffsetDays:13,
  schedStart:'14:00',schedEnd:'22:30',lunchMins:30,
  workDays:[true,true,true,true,true,false,false],holidays:[],banks:[],daysOff:[],
  shiftDayRule:'majority',skewOn:false,skewMins:0,makeUpOn:true},
  sessions:[{id:'a',start:T(9,14),end:T(9,22,30)},
            {id:'b',start:T(10,14),end:T(10,22,30)}],
  absences:[],activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false,
  ui:{open:{},tc:true},...over});

async function boot(ctx, st, atMs){
  const p=await ctx.newPage();
  p.on('pageerror',e=>{console.log('  PAGE ERROR:',e.message);fails++;});
  p.on('console',m=>{if(m.type()==='error'){console.log('  CONSOLE ERROR:',m.text());fails++;}});
  await p.addInitScript(([k,v])=>{
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded','1');
    localStorage.setItem(k,JSON.stringify(v));
  },[KEY,st]);
  await p.clock.install({time:new Date(atMs)});
  await p.goto('http://localhost:8141/'); await p.waitForTimeout(650);
  await p.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open')));
  await p.waitForTimeout(350);
  return p;
}
const logRows = p => p.evaluate(()=>[...document.querySelectorAll('#logBody tbody tr')].map(tr=>({
  day:(tr.querySelector('.c-day')?.innerText||'').replace(/\s+/g,' ').trim(),
  inCell:(tr.querySelector('.c-in')?.textContent||'').trim(),
  hours:(tr.querySelector('.c-hours')?.textContent||'').trim(),
  cls:tr.className })));
const foot = p => p.evaluate(()=>{
  const t=document.querySelector('#logBody tfoot tr');
  return t ? [...t.querySelectorAll('td')].map(td=>td.textContent.trim()) : null; });

const ctx = await b.newContext({viewport:{width:1100,height:2600},timezoneId:'America/New_York',locale:'en-US'});
// Wed Aug 12, noon: Sun and Mon worked, Tue missed entirely, today not yet over.
const NOW = T(12,12);

console.log('\n━━ A scheduled day with nothing on it is asked about, not assumed ━━');
let p = await boot(ctx, seed(), NOW);
let rows = await logRows(p);
console.log('       ' + JSON.stringify(rows,null,0));
const gap = rows.find(r=>r.cls.includes('gaprowlog'));
ok('the missed Tuesday is flagged', !!gap, JSON.stringify(rows.map(r=>r.day)));
ok('and reads MISSING rather than accusing you of anything', gap.inCell==='MISSING', gap.inCell);
ok('showing what the schedule expected', gap.day.includes('8.00 h, nothing logged'), gap.day);
ok('as a subtraction', gap.hours==='−8.00', gap.hours);
ok("today is not flagged — it is not over", !rows.some(r=>r.day.includes('Aug 12')&&r.cls.includes('gaprowlog')),
   JSON.stringify(rows.filter(r=>r.cls.includes('gaprowlog')).map(r=>r.day)));
const footBefore = await foot(p);
console.log('       footer ' + JSON.stringify(footBefore));

console.log('\n━━ Labelling it ━━');
await p.click('#logBody button[data-gap]'); await p.waitForTimeout(400);
ok('the editor opens', await p.isVisible('#absEdit'));
ok('pre-filled with the hours you were short', (await p.inputValue('#aHours'))==='8.00',
   await p.inputValue('#aHours'));
ok('on the right date', (await p.inputValue('#aDate'))==='2026-08-11', await p.inputValue('#aDate'));
ok('FMLA is offered', (await p.locator('#aKind option[value="fmla"]').count())===1);
let prev = await p.textContent('#aPreview');
console.log('       ' + prev.replace(/\s+/g,' '));
ok('and it says plainly that it pays nothing', /Pays nothing/.test(prev), prev);
await p.selectOption('#aKind','fmla');
await p.fill('#aNote','approved 8/11');
await p.click('#aSave'); await p.waitForTimeout(500);

rows = await logRows(p);
const abs = rows.find(r=>r.cls.includes('absrowlog'));
ok('it becomes an FMLA row', !!abs, JSON.stringify(rows.map(r=>r.cls)));
ok('labelled as such', abs.inCell==='FMLA', abs.inCell);
ok('carrying the note', abs.day.includes('approved 8/11'), abs.day);
ok('and the app stops asking', !rows.some(r=>r.cls.includes('gaprowlog')),
   JSON.stringify(rows.map(r=>r.cls)));

console.log('\n━━ It pays nothing and moves nothing ━━');
const footAfter = await foot(p);
console.log('       footer ' + JSON.stringify(footAfter));
ok('the period total is untouched', JSON.stringify(footBefore)===JSON.stringify(footAfter),
   JSON.stringify(footBefore)+' vs '+JSON.stringify(footAfter));
ok('and it is stored', await p.evaluate(()=>{
  const a=JSON.parse(localStorage.getItem('payclock.v1')).absences;
  return a.length===1 && a[0].kind==='fmla' && a[0].hours===8 && a[0].date==='2026-08-11';
}));

console.log('\n━━ Editing and removing ━━');
await p.click('#logBody button[data-absedit]'); await p.waitForTimeout(400);
ok('it reopens on what you saved', (await p.inputValue('#aKind'))==='fmla', await p.inputValue('#aKind'));
await p.fill('#aHours','4'); await p.click('#aSave'); await p.waitForTimeout(450);
rows = await logRows(p);
ok('a half day can be recorded', rows.find(r=>r.cls.includes('absrowlog')).hours==='−4.00',
   rows.find(r=>r.cls.includes('absrowlog')).hours);
ok('and the rest of the day is asked about again',
   rows.some(r=>r.cls.includes('gaprowlog')), JSON.stringify(rows.map(r=>r.cls)));
await p.click('#logBody button[data-absdel]'); await p.waitForTimeout(450);
ok('removing it puts things back',
   (await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).absences.length))===0);

console.log('\n━━ Clocking out on FMLA ━━');
await p.close();
// On the clock since 2 PM today, walking out at 6 PM — four paid hours in, four short.
p = await boot(ctx, {...seed(), activeStart:T(12,14)}, T(12,18));
ok('the button is there while you are on the clock', await p.isVisible('#fmlaOut'));
await p.click('#fmlaOut'); await p.waitForTimeout(600);
const rec = await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')));
console.log('       ' + JSON.stringify(rec.absences));
ok('the shift is banked', rec.sessions.length===3);
ok('the clock is stopped', rec.activeStart===null);
ok('and the rest of the scheduled day is recorded as FMLA',
   rec.absences.length===1 && rec.absences[0].kind==='fmla', JSON.stringify(rec.absences));
ok('four hours of it, not eight', rec.absences[0].hours===4, String(rec.absences[0].hours));
/* It stays after the clock-out and changes what it says — calling off means never coming
   in at all, which is the case most worth reaching in one tap. */
ok('the button stays once you are off the clock', await p.isVisible('#fmlaOut'));
ok('reading as a record rather than a clock-out',
   (await p.textContent('#fmlaOut')).includes('Record FMLA'), await p.textContent('#fmlaOut'));

console.log('\n━━ Working your whole day and then leaving books nothing ━━');
await p.close();
p = await boot(ctx, {...seed(), activeStart:T(12,14)}, T(12,22,45));
await p.click('#fmlaOut'); await p.waitForTimeout(600);
ok('no phantom absence', (await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).absences.length))===0);

console.log('\n━━ Offered on a day you are not rostered too ━━');
await p.close();
p = await boot(ctx, {...seed(), activeStart:T(14,10)}, T(14,14));   // Friday
ok('the button is still there', await p.isVisible('#fmlaOut'));
await p.click('#fmlaOut'); await p.waitForTimeout(500);
ok('but an unrostered day books nothing',
   (await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).absences.length))===0);

console.log('\n━━ An old backup with no absences in it still loads ━━');
await p.close();
const old = seed(); delete old.absences;
p = await boot(ctx, old, NOW);
ok('no crash, and the list starts empty',
   (await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).absences||[])).length===0);
ok('the log still draws', (await logRows(p)).length>0);

console.log('\n━━ On a phone ━━');
await p.close();
const mob = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  deviceScaleFactor:3,timezoneId:'America/New_York',locale:'en-US'});
p = await boot(mob, {...seed(), activeStart:T(12,14)}, T(12,18));
const m = await p.evaluate(()=>({
  pageW:document.documentElement.scrollWidth, winW:window.innerWidth,
  fmla:Math.round(document.getElementById('fmlaOut').getBoundingClientRect().height)
}));
ok('no sideways scroll', m.pageW<=m.winW+1, `${m.pageW} vs ${m.winW}`);
ok('the FMLA button is a real tap target', m.fmla>=40, `${m.fmla}px`);
await p.click('#fmlaOut'); await p.waitForTimeout(500);
await p.evaluate(()=>document.getElementById('log').scrollIntoView());
await p.click('#absAdd'); await p.waitForTimeout(400);
const f = await p.evaluate(()=>['aDate','aKind','aHours','aNote'].map(id=>({
  h:Math.round(document.getElementById(id).getBoundingClientRect().height),
  fs:parseFloat(getComputedStyle(document.getElementById(id)).fontSize)})));
ok('every field is tappable', f.every(x=>x.h>=40), JSON.stringify(f));
ok('and none of them make iOS zoom', f.every(x=>x.fs>=16), JSON.stringify(f));
ok('still no sideways scroll with the editor open',
   (await p.evaluate(()=>document.documentElement.scrollWidth))<=391);

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
