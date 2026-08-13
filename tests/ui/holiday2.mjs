/* Stage 2: the holiday actually pays. Thanksgiving 2026 is Thu Nov 26; the roster is
   Sun–Thu, so either side means Wed Nov 25 and Sun Nov 29. */
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
}).listen(8120);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const b=await chromium.launch({executablePath: CHROME});
// November 2026, America/New_York (EST, UTC-5)
const N=(d,h,mi=0)=>Date.UTC(2026,10,d,h+5,mi);
const shift=(id,d,from,to)=>({id,start:N(d,from),end:N(d,to)});

const base={configured:true,cfg:{rate:38,otMultiplier:1.5,otMode:'weekly',weeklyThreshold:40,
  periodThreshold:80,dailyThreshold:8,weekStartDay:0,periodAnchor:'2026-11-22',
  periodLengthDays:14,payDateOffsetDays:13,schedStart:'09:00',schedEnd:'17:00'},
  sessions:[],activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false,
  calCal:{on:true,show:'money',otStyle:'accrue',dailyAfter:8,hours:{}}};

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
  await p.goto('http://localhost:8120/'); await p.waitForTimeout(600);
  await p.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open')));
  await p.waitForTimeout(250);
  return p;
}
const logRows = p => p.evaluate(()=>[...document.querySelectorAll('#logBody tbody tr')].map(tr=>({
  day: tr.querySelector('.c-day')?.innerText.trim().replace(/\s+/g,' '),
  in:  tr.querySelector('.c-in')?.textContent.trim(),
  hrs: tr.querySelector('.c-hours')?.textContent.trim(),
  ot:  tr.querySelector('.otcol')?.textContent.trim(),
  gross: tr.querySelector('.c-gross')?.textContent.trim(),
  hol: tr.classList.contains('holrowlog'),
  row: tr.getAttribute('data-row')})));
const foot = p => p.evaluate(()=>document.querySelector('#logBody tfoot')?.innerText.replace(/\s+/g,' '));
const ctx = await b.newContext({viewport:{width:1100,height:2600},timezoneId:'America/New_York',locale:'en-US'});

// Wed Nov 25 and Sun Nov 29, 8 h each. Sunday is a new week and a new... no: the period
// is Nov 22 – Dec 5, so both land in one period.
const WED = shift('wed',25,9,17), SUN = shift('sun',29,9,17), THU = shift('thu',26,9,17);

console.log('\n━━ Not qualified yet: nothing is paid ━━');
let p = await boot(ctx, {...base, sessions:[WED]}, N(27,12));   // the Friday after
let rows = await logRows(p);
ok('only the Wednesday shift is logged', rows.length===1, JSON.stringify(rows.map(r=>r.day)));
ok('no holiday row', !rows.some(r=>r.hol));
ok('the period total is 8 h', (await foot(p)).includes('8.00'), await foot(p));
ok('and $304.00', (await foot(p)).includes('$304.00'), await foot(p));
let hols = await p.textContent('#qCalHols');
ok('Thanksgiving shows as pending', hols.includes('PENDING'), hols.replace(/\s+/g,' ').slice(0,220));
ok('and says what is still needed', hols.includes('needs Sun Nov 29'), hols.replace(/\s+/g,' ').slice(0,260));

console.log('\n━━ Working the day after earns it ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[WED,SUN]}, N(30,12));   // the Monday after
rows = await logRows(p);
ok('three rows now — two shifts and the holiday', rows.length===3, JSON.stringify(rows.map(r=>r.day)));
const hrow = rows.find(r=>r.hol);
ok('one of them is the holiday', !!hrow, JSON.stringify(rows));
ok('named on the row', hrow && hrow.day.includes('Thanksgiving'), hrow&&hrow.day);
ok('marked HOLIDAY instead of a clock-in time', hrow && hrow.in==='HOLIDAY', hrow&&hrow.in);
ok('worth 8 hours', hrow && hrow.hrs==='8.00', hrow&&hrow.hrs);
ok('at straight time — $304.00', hrow && hrow.gross==='$304.00', hrow&&hrow.gross);
ok('with no overtime on itself', hrow && hrow.ot==='—', hrow&&hrow.ot);
ok('it cannot be picked for editing or deleting', hrow && hrow.row===null, String(hrow&&hrow.row));
let f = await foot(p);
ok('the period total is 24 h', f.includes('24.00'), f);
ok('and $912.00', f.includes('$912.00'), f);
hols = await p.textContent('#qCalHols');
ok('the legend says EARNED', hols.includes('EARNED'), hols.replace(/\s+/g,' ').slice(0,200));
ok('and prices it', hols.includes('$304'), hols.replace(/\s+/g,' ').slice(0,240));

console.log('\n━━ Working the holiday pays on top ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[WED,THU,SUN]}, N(30,12));
rows = await logRows(p);
ok('four rows', rows.length===4, JSON.stringify(rows.map(r=>r.day)));
ok('the Thursday shift is there in its own right',
   rows.some(r=>!r.hol && r.day.includes('Nov 26')), JSON.stringify(rows.map(r=>r.day+':'+r.hol)));
ok('and the holiday alongside it', rows.some(r=>r.hol && r.day.includes('Nov 26')));
f = await foot(p);
ok('32 h in total', f.includes('32.00'), f);
ok('$1,216.00 — exactly 8 h more than not working it', f.includes('$1,216.00'), f);

console.log('\n━━ Missing a side loses it ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[WED,THU]}, N(30,12));   // no Sunday
rows = await logRows(p);
ok('no holiday row', !rows.some(r=>r.hol), JSON.stringify(rows.map(r=>r.day)));
f = await foot(p);
ok('only the hours worked count — 16 h', f.includes('16.00'), f);
ok('$608.00', f.includes('$608.00'), f);
hols = await p.textContent('#qCalHols');
ok('the legend says MISSED', hols.includes('MISSED'), hols.replace(/\s+/g,' ').slice(0,220));
ok('and names the day that was not worked', hols.includes('Sun Nov 29 not worked'),
   hols.replace(/\s+/g,' ').slice(0,260));

console.log('\n━━ The holiday pushes worked hours into overtime ━━');
await p.close();
// Sun 22 – Thu 26 at 9 h each = 45 h in the week, plus the 8 h holiday.
const week = [22,23,24,25,26].map(d=>shift('w'+d,d,9,18));
p = await boot(ctx, {...base, sessions:week.concat([SUN])}, N(30,12));
f = await foot(p);
ok('61 h banked for the period', f.includes('61.00'), f);       // 45 + 8 SUN + 8 holiday
rows = await logRows(p);
const thuRow = rows.find(r=>!r.hol && r.day.includes('Nov 26'));
/* The holiday pays flat and adds nothing to the overtime bucket, so the week's own hours
   are what push past 40: 45 worked, 5 of them overtime, and Thursday carries them. */
ok('the holiday itself pushes nothing into overtime', thuRow && thuRow.ot==='5.00', thuRow&&thuRow.ot);
const holRow2 = rows.find(r=>r.hol);
ok('while the holiday credit itself stays straight', holRow2 && holRow2.ot==='—', holRow2&&holRow2.ot);
ok('and is still $304.00', holRow2 && holRow2.gross==='$304.00', holRow2&&holRow2.gross);

console.log('\n━━ It reaches the other sections too ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[WED,SUN]}, N(30,12));
const per = await p.textContent('#permoney');
ok('the pay-period tile includes it', per.includes('912'), per);
const ytd = await p.textContent('#ytd');
ok('year to date includes it', ytd.includes('912') || ytd.includes('$912'), ytd.replace(/\s+/g,' ').slice(0,200));
const cume = await p.textContent('#cumeGross');
ok('so does the progress card', cume.includes('912'), cume);
ok('and its hours', (await p.textContent('#cumeSub')).includes('24.00'), await p.textContent('#cumeSub'));

console.log('\n━━ Turning the either-side rule off ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[WED]}, N(30,12));
await p.evaluate(()=>{ document.querySelectorAll('#cfg details').forEach(d=>d.open=true); });
await p.waitForTimeout(200);
ok('with the rule on, nothing yet', !(await logRows(p)).some(r=>r.hol));
await p.selectOption('#cHolAdj','0'); await p.waitForTimeout(500);
ok('with it off, the holiday pays on its own', (await logRows(p)).some(r=>r.hol));
ok('and the total rises to $608.00', (await foot(p)).includes('$608.00'), await foot(p));
await p.selectOption('#cHolAdj','1'); await p.waitForTimeout(500);
ok('turning it back on takes it away again', !(await logRows(p)).some(r=>r.hol));

console.log('\n━━ Changing what a holiday is worth ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[WED,SUN]}, N(30,12));
await p.evaluate(()=>{ document.querySelectorAll('#cfg details').forEach(d=>d.open=true); });
await p.fill('#cHolHours','12'); await p.locator('#cHolHours').blur(); await p.waitForTimeout(500);
rows = await logRows(p);
ok('12 h now', rows.find(r=>r.hol)?.hrs==='12.00', rows.find(r=>r.hol)?.hrs);
ok('worth $456.00', rows.find(r=>r.hol)?.gross==='$456.00', rows.find(r=>r.hol)?.gross);
ok('and the period total follows', (await foot(p)).includes('28.00'), await foot(p));

console.log('\n━━ Switching a holiday off removes its pay ━━');
await p.fill('#cHolHours','8'); await p.locator('#cHolHours').blur(); await p.waitForTimeout(400);
const thxIdx = await p.evaluate(()=>[...document.querySelectorAll('#cHolList .hnm')]
  .findIndex(n=>n.textContent.includes('Thanksgiving')));
await p.locator('#cHolList .hon').nth(thxIdx).uncheck(); await p.waitForTimeout(500);
ok('the holiday row is gone', !(await logRows(p)).some(r=>r.hol));
ok('and the total is back to 16 h', (await foot(p)).includes('16.00'), await foot(p));
await p.locator('#cHolList .hon').nth(thxIdx).check(); await p.waitForTimeout(500);
ok('switching it back on restores it', (await logRows(p)).some(r=>r.hol));

console.log('\n━━ A holiday that does not count toward overtime ━━');
await p.close();
p = await boot(ctx, {...base, sessions:week.concat([SUN])}, N(30,12));
await p.evaluate(()=>{ document.querySelectorAll('#cfg details').forEach(d=>d.open=true); });
await p.waitForTimeout(200);
const i2 = await p.evaluate(()=>[...document.querySelectorAll('#cHolList .hnm')]
  .findIndex(n=>n.textContent.includes('Thanksgiving')));
await p.locator('#cHolList button[data-hedit]').nth(i2).click(); await p.waitForTimeout(300);
await p.selectOption('#hOt','0'); await p.click('#hSave'); await p.waitForTimeout(600);
rows = await logRows(p);
const thuRow2 = rows.find(r=>!r.hol && r.day.includes('Nov 26'));
ok('the worked hours go back to 5 h of overtime', thuRow2 && thuRow2.ot==='5.00', thuRow2&&thuRow2.ot);
ok('the holiday is still paid', rows.some(r=>r.hol && r.gross==='$304.00'),
   JSON.stringify(rows.filter(r=>r.hol)));
ok('and the period total is unchanged at 61 h', (await foot(p)).includes('61.00'), await foot(p));

console.log('\n━━ The calculator is untouched ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[WED,SUN], calCal:{on:true,show:'money',otStyle:'accrue',
  dailyAfter:8,hours:{'2026-11-26':0}}}, N(30,12));
await p.evaluate(()=>document.getElementById('calc').classList.add('open'));
await p.waitForTimeout(400);
const sums = await p.textContent('#qCalSums');
ok('typing nothing into the calendar prices nothing', !sums.includes('$304'),
   sums.replace(/\s+/g,' ').slice(0,160));

console.log('\n━━ On a phone ━━');
await p.close();
const mob = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  deviceScaleFactor:3,timezoneId:'America/New_York',locale:'en-US'});
p = await boot(mob, {...base, sessions:[WED,SUN]}, N(30,12));
const m = await p.evaluate(()=>({
  pageW:document.documentElement.scrollWidth, winW:window.innerWidth,
  holVisible: !!document.querySelector('tr.holrowlog'),
  legend: !!document.querySelector('#qCalHols .calhol .s')
}));
ok('no sideways scroll', m.pageW<=m.winW+1, `${m.pageW} vs ${m.winW}`);
ok('the holiday row shows', m.holVisible);
ok('and the legend badge shows', m.legend);

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
