import { chromium } from 'playwright';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// The app under test sits two directories up from tests/ui/.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
// Set PW_CHROME to point at a specific build; otherwise Playwright finds its own.
const CHROME = process.env.PW_CHROME || undefined;

const KEY='payclock.v1';
const srv=http.createServer((q,r)=>{const R = ROOT;
 if(q.url.startsWith('/sw.js')){r.writeHead(200,{'Content-Type':'text/javascript'});return r.end(readFileSync(R+'sw.js'));}
 if(q.url.startsWith('/manifest')){r.writeHead(200,{'Content-Type':'application/manifest+json'});return r.end(readFileSync(R+'manifest.webmanifest'));}
 if(q.url.indexOf('.png')>-1){r.writeHead(404);return r.end();}
 r.writeHead(200,{'Content-Type':'text/html'});r.end(readFileSync(R+'index.html'));}).listen(8113);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const openAll=async pg=>{ try{ await pg.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open'))); }catch(e){} };
const b=await chromium.launch({executablePath: CHROME});
const D=(d,h,mi=0)=>Date.UTC(2026,7,d,h+4,mi);   // August 2026, America/New_York
const num = s => parseFloat(String(s).replace(/[^0-9.\-]/g,''));

// Five 10-hour days, Sun Aug 9 – Thu Aug 13. Period Sun Aug 2 – Sat Aug 15.
// Weekly 40 h  -> only the 5th day is overtime: 10 h OT
// Daily 8 h    -> every day gives 2 h over: 10 h OT as well, but spread across all five
const FIVE_TENS = [9,10,11,12,13].map(d=>({id:'d'+d, start:D(d,8), end:D(d,18)}));
const base={configured:true,cfg:{rate:38,otMultiplier:1.5,otMode:'weekly',weeklyThreshold:40,
  periodThreshold:80,dailyThreshold:8,weekStartDay:0,periodAnchor:'2026-08-02',
  periodLengthDays:14,payDateOffsetDays:13},
  sessions:FIVE_TENS,activeStart:null,unit:'sec',planOn:false,plannedHours:10,sound:false};

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
  await p.goto('http://localhost:8113/'); await p.waitForTimeout(500); await openAll(p);
  await p.evaluate(()=>{ document.querySelectorAll('#cfg details').forEach(d=>d.open=true); });
  await p.waitForTimeout(150);
  return p;
}
// per-row OT figures straight out of the log table
const rowOt = p => p.evaluate(()=>[...document.querySelectorAll('#logBody tbody tr')]
  .map(tr=>({ day: tr.querySelector('.c-day')?.textContent.trim(),
              ot: tr.querySelector('.otcol')?.textContent.trim() })));
const ctx = await b.newContext({viewport:{width:1100,height:1900},timezoneId:'America/New_York',locale:'en-US'});

console.log('\n━━ The option exists ━━');
let p = await boot(ctx, base, D(14,12));
ok('Settings offers a daily rule', (await p.textContent('#cMode')).includes('Daily'), await p.textContent('#cMode'));
ok('and a daily threshold to go with it', await p.isVisible('#cDailyThr'));
ok('it defaults to 8 h', (await p.inputValue('#cDailyThr'))==='8', await p.inputValue('#cDailyThr'));

console.log('\n━━ Weekly rule: only the fifth day is overtime ━━');
let rows = await rowOt(p);
ok('five days logged', rows.length===5, String(rows.length));
ok('four days show no overtime', rows.filter(r=>r.ot==='—').length===4, JSON.stringify(rows.map(r=>r.ot)));
ok('one day carries all 10 h of it', rows.filter(r=>r.ot==='10.00').length===1, JSON.stringify(rows.map(r=>r.ot)));
let log = await p.textContent('#logBody');
ok('period total 50 h', log.includes('50.00'), '');
// 40 straight + 10 OT = 40*38 + 10*57 = 1520 + 570 = 2090
ok('period gross $2,090.00', log.includes('$2,090.00'), log.replace(/\s+/g,' ').slice(-140));

console.log('\n━━ Switch to daily: the log recalculates itself ━━');
await p.selectOption('#cMode','daily'); await p.waitForTimeout(500); await openAll(p);
rows = await rowOt(p);
ok('now every day shows overtime', rows.filter(r=>r.ot==='2.00').length===5, JSON.stringify(rows.map(r=>r.ot)));
ok('no day is left at none', rows.filter(r=>r.ot==='—').length===0, JSON.stringify(rows.map(r=>r.ot)));
log = await p.textContent('#logBody');
ok('the OT total is still 10 h', log.includes('10.00'), '');
ok('and the pay still comes to $2,090.00', log.includes('$2,090.00'), log.replace(/\s+/g,' ').slice(-140));
ok('every row is flagged as an overtime row',
   (await p.locator('#logBody tbody tr.otrow').count())===5,
   String(await p.locator('#logBody tbody tr.otrow').count()));

console.log('\n━━ Where daily and weekly genuinely disagree ━━');
await p.close();
// Three 12-hour days = 36 h. Under 40, so weekly says no overtime at all.
// Daily says 4 h over on each of them = 12 h of overtime.
const THREE_TWELVES=[9,10,11].map(d=>({id:'t'+d,start:D(d,8),end:D(d,20)}));
p = await boot(ctx, {...base, sessions:THREE_TWELVES}, D(12,12));
log = await p.textContent('#logBody');
ok('weekly rule: 36 h with no overtime', log.includes('36.00') && (await rowOt(p)).every(r=>r.ot==='—'),
   JSON.stringify((await rowOt(p)).map(r=>r.ot)));
ok('paid straight through — $1,368.00', log.includes('$1,368.00'), log.replace(/\s+/g,' ').slice(-130));
await p.selectOption('#cMode','daily'); await p.waitForTimeout(500); await openAll(p);
rows = await rowOt(p);
ok('daily rule: 4 h over on each day', rows.filter(r=>r.ot==='4.00').length===3, JSON.stringify(rows.map(r=>r.ot)));
log = await p.textContent('#logBody');
ok('12 h of overtime in total', log.includes('12.00'), '');
// 24 straight + 12 OT = 24*38 + 12*57 = 912 + 684 = 1596
ok('and the pay rises to $1,596.00', log.includes('$1,596.00'), log.replace(/\s+/g,' ').slice(-130));

console.log('\n━━ Every other section follows the same choice ━━');
ok('the earnings bar counts today, not the week',
   (await p.textContent('#otLbl')).includes('Today toward 8'), await p.textContent('#otLbl'));
ok('the period bar names the daily rule', (await p.textContent('#p80Note')).includes('8 h daily'),
   (await p.textContent('#p80Note')).slice(0,120));
const ytd = await p.textContent('#ytd');
ok('year to date counts 12 h of overtime', ytd.includes('12.00'), ytd.replace(/\s+/g,' ').slice(0,150));

console.log('\n━━ A long day crossing midnight is split by day, not lumped ━━');
await p.close();
// 8 PM to 8 AM = 12 h, but 4 h fall on one day and 8 h on the next.
// Daily 8 h: day one has 4 h (none over), day two has 8 h (none over) -> no overtime at all.
p = await boot(ctx, {...base, cfg:{...base.cfg,otMode:'daily'},
  sessions:[{id:'night',start:D(10,20),end:D(11,8)}]}, D(12,12));
log = await p.textContent('#logBody');
ok('12 h logged', log.includes('12.00'), log.replace(/\s+/g,' ').slice(0,120));
ok('no overtime — neither day passed 8 h on its own',
   (await rowOt(p)).every(r=>r.ot==='—'), JSON.stringify((await rowOt(p)).map(r=>r.ot)));
ok('paid straight — $456.00', log.includes('$456.00'), log.replace(/\s+/g,' ').slice(-120));

console.log('\n━━ The threshold is yours to set ━━');
await p.close();
p = await boot(ctx, {...base, cfg:{...base.cfg,otMode:'daily'}, sessions:THREE_TWELVES}, D(12,12));
await p.fill('#cDailyThr','10'); await p.locator('#cDailyThr').blur();
await p.waitForTimeout(500); await openAll(p);
rows = await rowOt(p);
ok('a 10 h threshold leaves 2 h over each day', rows.filter(r=>r.ot==='2.00').length===3,
   JSON.stringify(rows.map(r=>r.ot)));
ok('the bar follows it', (await p.textContent('#otLbl')).includes('Today toward 10'), await p.textContent('#otLbl'));

console.log('\n━━ The choice sticks ━━');
await p.reload(); await p.waitForTimeout(500); await openAll(p);
ok('still on the daily rule', (await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).cfg.otMode))==='daily');
ok('and still at 10 h', (await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).cfg.dailyThreshold))===10);

console.log('\n━━ Switching back restores the weekly picture exactly ━━');
await p.evaluate(()=>{ document.querySelectorAll('#cfg details').forEach(d=>d.open=true); });
await p.fill('#cDailyThr','8'); await p.locator('#cDailyThr').blur(); await p.waitForTimeout(300);
await p.selectOption('#cMode','weekly'); await p.waitForTimeout(500); await openAll(p);
ok('36 h back to no overtime', (await rowOt(p)).every(r=>r.ot==='—'),
   JSON.stringify((await rowOt(p)).map(r=>r.ot)));
ok('and back to $1,368.00', (await p.textContent('#logBody')).includes('$1,368.00'), '');

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
