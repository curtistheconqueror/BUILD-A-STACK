import { chromium } from 'playwright';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// The app under test sits two directories up from tests/ui/.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
// Set PW_CHROME to point at a specific build; otherwise Playwright finds its own.
const CHROME = process.env.PW_CHROME || undefined;
// Scratch files (backups under test, screenshots) go to a temp dir, never the repo.
const TMP = join(process.env.TMPDIR || '/tmp', 'wisewage-tests');
try { (await import('node:fs')).mkdirSync(TMP, { recursive: true }); } catch {}


const KEY='payclock.v1';
const srv=http.createServer((q,r)=>{const R = ROOT;
 if(q.url.startsWith('/sw.js')){r.writeHead(200,{'Content-Type':'text/javascript'});return r.end(readFileSync(R+'sw.js'));}
 if(q.url.startsWith('/manifest')){r.writeHead(200,{'Content-Type':'application/manifest+json'});return r.end(readFileSync(R+'manifest.webmanifest'));}
 if(q.url.indexOf('.png')>-1){r.writeHead(404);return r.end();}
 r.writeHead(200,{'Content-Type':'text/html'});r.end(readFileSync(R+'index.html'));}).listen(8112);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const openAll=async pg=>{ try{ await pg.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open'))); }catch(e){} };
const b=await chromium.launch({executablePath: CHROME});
const D=(d,h,mi=0)=>Date.UTC(2026,6,d,h+4,mi);     // July 2026, America/New_York (EDT)

// Curtis's schedule: 2:00 PM to 10:30 PM. Period ending Sat Aug 1 2026 -> starts Sun Jul 19.
const base={configured:true,cfg:{rate:38,otMultiplier:1.5,otMode:'weekly',weeklyThreshold:40,periodThreshold:80,
  weekStartDay:0,periodAnchor:'2026-07-19',periodLengthDays:14,payDateOffsetDays:13,
  schedStart:'14:00',schedEnd:'22:30',clock24:false},
  sessions:[],activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false};

async function boot(ctx, seed, atMs){
  const p=await ctx.newPage();
  p.on('pageerror',e=>{console.log('  PAGE ERROR:',e.message);fails++;});
  p.on('console',m=>{if(m.type()==='error'){console.log('  CONSOLE ERROR:',m.text());fails++;}});
  await p.addInitScript(([k,v])=>{
    if (sessionStorage.getItem('__seeded')) return;   // a reload must read what the app saved
    sessionStorage.setItem('__seeded','1');
    localStorage.setItem(k,JSON.stringify(v));
  },[KEY,seed]);
  await p.clock.install({time:new Date(atMs)});
  await p.goto('http://localhost:8112/'); await p.waitForTimeout(500); await openAll(p);
  return p;
}
const ctx = await b.newContext({viewport:{width:1000,height:1800},timezoneId:'America/New_York',locale:'en-US'});

console.log('\n━━ The arithmetic an OT slip wants ━━');
// Clocked in 1:30 PM (30 min early), out 11:15 PM (45 min late) -> 0.50 before, 0.75 after
let p = await boot(ctx, {...base, sessions:[{id:'a',start:D(20,13,30),end:D(20,23,15)}]}, D(21,12));
ok('the section exists', await p.isVisible('#extra'));
let body = await p.textContent('#xBody');
ok('30 minutes early reads 0.50', body.includes('0.50'), body.replace(/\s+/g,' ').slice(0,160));
ok('45 minutes late reads 0.75', body.includes('0.75'), body.replace(/\s+/g,' ').slice(0,160));
ok('and they total 1.25 h', body.includes('1.25'), body.replace(/\s+/g,' ').slice(-200));
ok('the minutes are given too', body.includes('75 minutes'), body.replace(/\s+/g,' ').slice(-200));
ok('the schedule is spelled out', (await p.textContent('#xSched')).includes('2:00 PM')
   && (await p.textContent('#xSched')).includes('10:30 PM'), await p.textContent('#xSched'));

console.log('\n━━ A shift inside its hours claims nothing ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[{id:'a',start:D(20,14),end:D(20,22,30)}]}, D(21,12));
body = await p.textContent('#xBody');
ok('exactly on schedule shows nothing to claim', body.includes('Nothing outside your scheduled hours'),
   body.replace(/\s+/g,' ').slice(0,120));
await p.close();
// clocked in late and out early — still nothing, being short is not extra
p = await boot(ctx, {...base, sessions:[{id:'a',start:D(20,14,20),end:D(20,22,10)}]}, D(21,12));
ok('turning up late claims nothing either',
   (await p.textContent('#xBody')).includes('Nothing outside'), '');

console.log('\n━━ Clocking out after midnight ━━');
await p.close();
// in at 2 PM, out at 1:15 AM the next morning -> 2.75 h after a 10:30 PM end
p = await boot(ctx, {...base, sessions:[{id:'a',start:D(20,14),end:D(21,1,15)}]}, D(21,12));
body = await p.textContent('#xBody');
ok('past midnight counts as 2.75 after', body.includes('2.75'), body.replace(/\s+/g,' ').slice(0,180));
ok('nothing counted before', !body.includes('0.50'), body.replace(/\s+/g,' ').slice(0,180));

console.log('\n━━ A scheduled shift that itself runs past midnight ━━');
await p.close();
// scheduled 10 PM – 6 AM; clocked in 9:30 PM, out 6:45 AM -> 0.50 before, 0.75 after
p = await boot(ctx, {...base, cfg:{...base.cfg, schedStart:'22:00', schedEnd:'06:00'},
  sessions:[{id:'a',start:D(20,21,30),end:D(21,6,45)}]}, D(21,12));
body = await p.textContent('#xBody');
ok('0.50 before a 10 PM start', body.includes('0.50'), body.replace(/\s+/g,' ').slice(0,180));
ok('0.75 after a 6 AM end the next morning', body.includes('0.75'), body.replace(/\s+/g,' ').slice(0,180));
ok('the note says the end is next morning', (await p.textContent('#xSched')).includes('next morning'),
   await p.textContent('#xSched'));

console.log('\n━━ A whole pay period adds up ━━');
await p.close();
// five days, each a different amount either side
p = await boot(ctx, {...base, sessions:[
  {id:'m',start:D(20,13,30),end:D(20,23,0)},    // 0.50 + 0.50
  {id:'t',start:D(21,13,45),end:D(21,22,30)},   // 0.25 + 0
  {id:'w',start:D(22,14,0), end:D(22,23,30)},   // 0    + 1.00
  {id:'r',start:D(23,12,0), end:D(23,22,30)},   // 2.00 + 0
  {id:'f',start:D(24,14,0), end:D(24,22,30)}    // nothing
]}, D(25,12));
body = await p.textContent('#xBody');
ok('before totals 2.75 h', /Before the shift\s*2\.75 h/.test(body.replace(/\s+/g,' ')),
   body.replace(/\s+/g,' ').match(/Before the shift[^A]*/)?.[0]);
ok('after totals 1.50 h', /After the shift\s*1\.50 h/.test(body.replace(/\s+/g,' ')),
   body.replace(/\s+/g,' ').match(/After the shift[^E]*/)?.[0]);
ok('period extra time is 4.25 h', body.includes('4.25 h'), body.replace(/\s+/g,' ').slice(-220));
ok('the on-schedule day is left out of the list', !body.includes('Jul 24'), '');
ok('four days listed', (await p.locator('#xBody .xrow:not(.xhead)').count())===4,
   String(await p.locator('#xBody .xrow:not(.xhead)').count()));
ok('folded header carries the total', (await p.textContent('#sum_extra')).includes('4.25'),
   await p.textContent('#sum_extra'));
ok('priced at the overtime rate', body.includes('$242.25'), body.replace(/\s+/g,' ').slice(-200));

console.log('\n━━ Only this pay period ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[
  {id:'now',start:D(20,13,30),end:D(20,22,30)},   // in period (Jul 19 – Aug 1): 0.50
  {id:'old',start:D(10,10,0), end:D(10,22,30)}    // previous period: ignored
]}, D(21,12));
body = await p.textContent('#xBody');
ok('the earlier period is not counted', body.includes('0.50 h') && !body.includes('4.00'),
   body.replace(/\s+/g,' ').slice(-200));
ok('one row only', (await p.locator('#xBody .xrow:not(.xhead)').count())===1);

console.log('\n━━ The running shift counts as it goes ━━');
await p.close();
// clocked in 1:00 PM, now 3:00 PM -> 1.00 h before already banked
p = await boot(ctx, {...base, sessions:[], activeStart:D(20,13)}, D(20,15));
body = await p.textContent('#xBody');
ok('an hour early shows straight away', body.includes('1.00'), body.replace(/\s+/g,' ').slice(0,180));
ok('and is marked as running', body.toLowerCase().includes('running'), '');

console.log('\n━━ The schedule saves ━━');
await p.close();
p = await boot(ctx, base, D(21,12));
await p.evaluate(()=>{ document.querySelectorAll('#cfg details').forEach(d=>d.open=true); });
ok('start prefilled from settings', (await p.inputValue('#cSchedStart'))==='14:00', await p.inputValue('#cSchedStart'));
ok('end prefilled from settings', (await p.inputValue('#cSchedEnd'))==='22:30', await p.inputValue('#cSchedEnd'));
await p.fill('#cSchedStart','07:00'); await p.locator('#cSchedStart').blur(); await p.waitForTimeout(350);
ok('changing it is stored', (await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).cfg.schedStart))==='07:00');
ok('and the note follows', (await p.textContent('#xSched')).includes('7:00 AM'), await p.textContent('#xSched'));
await p.reload(); await p.waitForTimeout(500); await openAll(p);
ok('it survives a reload', (await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).cfg.schedStart))==='07:00');

console.log('\n━━ Reads in 24-hour too ━━');
await p.close();
p = await boot(ctx, {...base, cfg:{...base.cfg, clock24:true},
  sessions:[{id:'a',start:D(20,13,30),end:D(20,23,15)}]}, D(21,12));
ok('the schedule note is 24-hour', (await p.textContent('#xSched')).includes('14:00')
   && (await p.textContent('#xSched')).includes('22:30'), await p.textContent('#xSched'));
ok('the rows are 24-hour', !/[AP]M/.test(await p.textContent('#xBody')),
   (await p.textContent('#xBody')).replace(/\s+/g,' ').slice(0,140));

console.log('\n━━ Matches the payroll conversion chart, minute for minute ━━');
// Every row of the chart Pace hands out, checked against what the app prints.
const CHART = {1:'0.02',2:'0.03',3:'0.05',4:'0.07',5:'0.08',6:'0.10',7:'0.12',8:'0.13',9:'0.15',10:'0.17',
 11:'0.18',12:'0.20',13:'0.22',14:'0.23',15:'0.25',16:'0.27',17:'0.28',18:'0.30',19:'0.32',20:'0.33',
 21:'0.35',22:'0.37',23:'0.38',24:'0.40',25:'0.42',26:'0.43',27:'0.45',28:'0.47',29:'0.48',30:'0.50',
 31:'0.52',32:'0.53',33:'0.55',34:'0.57',35:'0.58',36:'0.60',37:'0.62',38:'0.63',39:'0.65',40:'0.67',
 41:'0.68',42:'0.70',43:'0.72',44:'0.73',45:'0.75',46:'0.77',47:'0.78',48:'0.80',49:'0.82',50:'0.83',
 51:'0.85',52:'0.87',53:'0.88',54:'0.90',55:'0.92',56:'0.93',57:'0.95',58:'0.97',59:'0.98',60:'1.00'};
await p.close();
p = await boot(ctx, base, D(21,12));
const mismatches = await p.evaluate((chart)=>{
  const bad=[];
  for (const m in chart){
    // clocked in exactly m minutes before the 2:00 PM start
    const start = new Date(2026,6,20,14,0).getTime() - m*60000;
    const x = extraTime(start, new Date(2026,6,20,22,30).getTime(), 14*60, 22*60+30);
    const got = chartHours(x.before).toFixed(2);
    if (got !== chart[m]) bad.push(`${m} min: chart ${chart[m]}, app ${got}`);
  }
  return bad;
}, CHART);
ok('all 60 rows of the chart agree', mismatches.length===0, mismatches.slice(0,5).join(' | '));

console.log('\n━━ Added up the way the slip is, not the way a calculator would ━━');
await p.close();
// two 47-minute entries: 0.78 + 0.78 = 1.56 on the slip; adding the minutes first gives 1.57
p = await boot(ctx, {...base, sessions:[
  {id:'a',start:D(20,13,13),end:D(20,22,30)},   // 47 min early
  {id:'b',start:D(21,13,13),end:D(21,22,30)}    // 47 min early
]}, D(22,12));
body = await p.textContent('#xBody');
ok('each entry reads 0.78', (body.match(/0\.78/g)||[]).length===2, body.replace(/\s+/g,' ').slice(0,180));
ok('the total is 1.56, as the slip adds it', /Before the shift\s*1\.56 h/.test(body.replace(/\s+/g,' ')),
   body.replace(/\s+/g,' ').match(/Before the shift[^A]*/)?.[0]);
ok('not 1.57, which is what rounding the total would give', !body.includes('1.57'), '');
ok('the raw minutes are still shown', body.includes('94 minutes'), body.replace(/\s+/g,' ').slice(-190));

console.log('\n━━ Seconds are settled to the minute that is printed, not the one underneath ━━');
await p.close();
/* Clocked in at 1:30:37 PM. The screen reads 1:30 PM and that is what goes on the slip,
   so the span anyone would write down is 1:30 to 2:00 — a clean half hour. Measuring the
   raw stamp instead gave 29 min 23 s and printed 0.48 beside a punch that said 1:30. */
p = await boot(ctx, {...base, sessions:[{id:'a',start:D(20,13,30)+37000,end:D(20,22,30)}]}, D(21,12));
let secs = (await p.textContent('#xBody')).replace(/\s+/g,' ');
ok('a punch reading 1:30 claims the full 0.50 to 2:00', secs.includes('0.50'), secs.slice(0,150));
ok('not 0.48, which is the seconds showing through', !secs.includes('0.48'), secs.slice(0,150));
ok('and the minutes line agrees', secs.includes('30 minutes'), secs.slice(0,160));

console.log('\n━━ Mobile ━━');
await p.close();
const m = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  timezoneId:'America/New_York',locale:'en-US'});
p = await boot(m, {...base, sessions:[{id:'a',start:D(20,13,30),end:D(20,23,15)}]}, D(21,12));
ok('no horizontal overflow', (await p.evaluate(()=>document.documentElement.scrollWidth))<=391,
   String(await p.evaluate(()=>document.documentElement.scrollWidth)));
await p.evaluate(()=>document.getElementById('extra').scrollIntoView());
await p.waitForTimeout(300);
await p.locator('#extra').screenshot({path:join(TMP, 'extra-phone.png')});

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
