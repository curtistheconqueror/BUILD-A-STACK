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
const srv = http.createServer((q,r)=>{ const R = ROOT;
  if(q.url.startsWith('/sw.js')){r.writeHead(200,{'Content-Type':'text/javascript'});return r.end(readFileSync(R+'sw.js'));}
  if(q.url.startsWith('/manifest')){r.writeHead(200,{'Content-Type':'application/manifest+json'});return r.end(readFileSync(R+'manifest.webmanifest'));}
  if(q.url.indexOf('.png')>-1){r.writeHead(404);return r.end();}
  r.writeHead(200,{'Content-Type':'text/html'});r.end(readFileSync(R+'index.html'));}).listen(8104);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const openAll=async pg=>{ try{ await pg.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open'))); }catch(e){} };
const b=await chromium.launch({executablePath: CHROME});
const num = s => parseFloat(String(s).replace(/[^0-9.\-]/g,''));
// The harness spends a second or two booting the page, so wall-clock readings land a
// tick or two past the seeded instant. Assert to the minute, not the second.
const hm = t => t.slice(0,5);          // 'HH:MM' out of 'HH:MM:SS'
const near = (a,b,tol=0.05) => Math.abs(a-b) <= tol;
const st = p => p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')));

// America/New_York, August 2026 (EDT = UTC-4). Built as UTC so the browser reads the hour we mean.
const D=(d,h,mi=0)=>Date.UTC(2026,7,d,h+4,mi);
const base={configured:true,cfg:{rate:38,otMultiplier:1.5,otMode:'weekly',weeklyThreshold:40,periodThreshold:80,
  weekStartDay:0,periodAnchor:'2026-08-02',periodLengthDays:14,payDateOffsetDays:13},
  sessions:[],activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false};

async function boot(ctx, seed, atMs){
  const p=await ctx.newPage();
  p.on('pageerror',e=>{console.log('  PAGE ERROR:',e.message);fails++;});
  p.on('console',m=>{if(m.type()==='error'){console.log('  CONSOLE ERROR:',m.text());fails++;}});
  await p.addInitScript(([k,v])=>{
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded','1');
    if (v) localStorage.setItem(k,JSON.stringify(v)); else localStorage.removeItem(k);
  },[KEY,seed]);
  await p.clock.install({time:new Date(atMs)});
  await p.goto('http://localhost:8104/'); await p.waitForTimeout(400); await openAll(p);
  return p;
}

let ctx = await b.newContext({viewport:{width:1000,height:1700},timezoneId:'America/New_York',locale:'en-US'});

console.log('\n━━ The exact scenario: clocked out 9:40, it is now 10:00 ━━');
// Shift began 6:00 AM, accidentally ended 9:40 AM. Now 10:00 AM.
let p = await boot(ctx, {...base, sessions:[{id:'oops',start:D(11,6),end:D(11,9,40),note:''}]}, D(11,10));
ok('offers to reopen', await p.isVisible('#resumeOpen'));
let money0 = num(await p.textContent('#permoney'));
ok('banked 3.67 h so far (6:00–9:40) = $139.33', near(money0,139.33), `$${money0}`);

await p.click('#resumeOpen'); await p.waitForTimeout(250);
let txt = await p.textContent('#resumeConfirm');
ok('confirm names the original start', txt.includes('6:00 AM'), txt);
ok('confirm names when it ended', txt.includes('9:40 AM'), txt);
ok('confirm spells out the 20 min being counted', /00:20:0\d/.test(txt), txt);
ok('confirm says that time counts as worked', txt.includes('counts as worked'), txt);

await p.click('#resumeYes'); await p.waitForTimeout(400);
ok('clock is running again', (await p.textContent('#punch')).includes('Clock Out'));
let s = await st(p);
ok('the ended shift is gone from the log', s.sessions.length===0, String(s.sessions.length));
ok('and it is live from the ORIGINAL 6:00 AM start', s.jobs[0].activeStart===D(11,6),
   `${new Date(s.jobs[0].activeStart).toISOString()} vs ${new Date(D(11,6)).toISOString()}`);
ok('timer shows 4 h on the clock, not 20 min', hm(await p.textContent('#timer'))==='04:00', await p.textContent('#timer'));
let money1 = num(await p.textContent('#permoney'));
ok('period total is now 4.00 h = $152.00 — the gap was paid', near(money1,152), `$${money1}`);
ok('nothing was lost: it went up by the 20 min, not down', money1 > money0, `${money0} → ${money1}`);

console.log('\n━━ It keeps running from there ━━');
await p.clock.fastForward('01:00:00'); await p.waitForTimeout(400);
ok('an hour later the timer reads 5 h', hm(await p.textContent('#timer'))==='05:00', await p.textContent('#timer'));
ok('and pay followed to $190.00', near(num(await p.textContent('#permoney')),190),
   await p.textContent('#permoney'));

console.log('\n━━ Clocking out afterwards banks one unbroken shift ━━');
await p.click('#punch'); await p.waitForTimeout(400);
s = await st(p);
ok('exactly one shift in the log', s.sessions.length===1, String(s.sessions.length));
ok('running 6:00 AM to 11:00 AM with no gap', s.sessions[0].start===D(11,6) && Math.abs(s.sessions[0].end-D(11,11))<5000,
   `${new Date(s.sessions[0].start).toISOString()} → ${new Date(s.sessions[0].end).toISOString()}`);
ok('log shows a single 5.00 h row', (await p.locator('#logBody tbody tr').count())===1,
   String(await p.locator('#logBody tbody tr').count()));

console.log('\n━━ Never mind leaves everything alone ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[{id:'oops',start:D(11,6),end:D(11,9,40),note:''}]}, D(11,10));
await p.click('#resumeOpen'); await p.waitForTimeout(200);
await p.click('#resumeNo'); await p.waitForTimeout(250);
ok('confirm closes', !(await p.isVisible('#resumeConfirm')));
ok('still clocked out', (await p.textContent('#punch')).includes('Clock In'));
s = await st(p);
ok('the shift is untouched', s.sessions.length===1 && s.sessions[0].end===D(11,9,40));

console.log('\n━━ Not offered when there is nothing to reopen ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[]}, D(11,10));
ok('hidden with an empty log', !(await p.isVisible('#resumeOpen')));
await p.close();
// Clocked out 9 hours ago — beyond the window, use the editor instead
p = await boot(ctx, {...base, sessions:[{id:'old',start:D(10,20),end:D(11,1)}]}, D(11,10));
ok('hidden once the shift is older than the window', !(await p.isVisible('#resumeOpen')));
await p.close();
// Currently clocked in
p = await boot(ctx, {...base, sessions:[{id:'a',start:D(11,6),end:D(11,9,40)}], activeStart:D(11,9,50)}, D(11,10));
ok('hidden while a shift is already running', !(await p.isVisible('#resumeOpen')));

console.log('\n━━ Reopening the most recent shift, not just any ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[
  {id:'early',start:D(11,4),end:D(11,5)},
  {id:'oops', start:D(11,6),end:D(11,9,40)}
]}, D(11,10));
await p.click('#resumeOpen'); await p.waitForTimeout(200);
await p.click('#resumeYes'); await p.waitForTimeout(400);
s = await st(p);
ok('only the latest shift was reopened', s.sessions.length===1 && s.sessions[0].id==='early',
   JSON.stringify(s.sessions.map(x=>x.id)));
ok('live from 6:00 AM', s.jobs[0].activeStart===D(11,6));

console.log('\n━━ A holiday shift stays a holiday shift ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[
  {id:'hol',start:D(11,6),end:D(11,9,40),adj:{mult:2}}
]}, D(11,10));
const holBefore = num(await p.textContent('#permoney'));
ok('3.67 h at double time = $278.67', near(holBefore,278.67,0.1), `$${holBefore}`);
await p.click('#resumeOpen'); await p.waitForTimeout(200);
await p.click('#resumeYes'); await p.waitForTimeout(400);
ok('live earnings still doubled after reopening — 4 h = $304.00',
   near(num(await p.textContent('#permoney')),304,0.1), await p.textContent('#permoney'));
await p.click('#punch'); await p.waitForTimeout(400);
s = await st(p);
ok('and the multiplier is written back on clock-out', s.sessions[0].adj && s.sessions[0].adj.mult===2,
   JSON.stringify(s.sessions[0].adj));

console.log('\n━━ Auto-stop already past its target does not slam it shut ━━');
await p.close();
// 8 h target, but the shift already ran 9 h 40 m before the accidental clock-out.
p = await boot(ctx, {...base, planOn:true, plannedHours:8,
  sessions:[{id:'oops',start:D(11,0),end:D(11,9,40)}]}, D(11,10));
await p.click('#resumeOpen'); await p.waitForTimeout(200);
await p.click('#resumeYes'); await p.waitForTimeout(600);
ok('it stays on the clock instead of instantly ending', (await p.textContent('#punch')).includes('Clock Out'));
s = await st(p);
ok('auto-stop was stood down', s.planOn===false, String(s.planOn));
ok('and the checkbox reflects that', !(await p.isChecked('#planOn')));
ok('the toast explains why', (await p.textContent('#toast')).includes('Auto-stop'), await p.textContent('#toast'));
ok('full 10 h is on the clock', hm(await p.textContent('#timer'))==='10:00', await p.textContent('#timer'));

console.log('\n━━ Auto-stop still ahead of us keeps working ━━');
await p.close();
// 10 h target, shift began 6:00, accidental out at 9:40, now 10:00 -> should still stop at 16:00
p = await boot(ctx, {...base, planOn:true, plannedHours:10,
  sessions:[{id:'oops',start:D(11,6),end:D(11,9,40)}]}, D(11,10));
await p.click('#resumeOpen'); await p.waitForTimeout(200);
await p.click('#resumeYes'); await p.waitForTimeout(400);
s = await st(p);
ok('auto-stop left armed', s.planOn===true);
ok('and it points at 4:00 PM', (await p.textContent('#planEta')).includes('4:00 PM'), await p.textContent('#planEta'));
await p.clock.fastForward('06:00:00'); await p.waitForTimeout(500);
ok('it fires on time', (await p.textContent('#punch')).includes('Clock In'));
s = await st(p);
ok('banking one 10.00 h shift', s.sessions.length===1 && Math.abs((s.sessions[0].end-s.sessions[0].start)-10*3600000)<5000,
   String((s.sessions[0].end-s.sessions[0].start)/3600000)+' h');

console.log('\n━━ Survives a reload mid-reopened-shift ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[{id:'oops',start:D(11,6),end:D(11,9,40),adj:{diff:2}}]}, D(11,10));
await p.click('#resumeOpen'); await p.waitForTimeout(200);
await p.click('#resumeYes'); await p.waitForTimeout(400);
await p.reload(); await p.waitForTimeout(500); await openAll(p);
ok('still on the clock after a reload', (await p.textContent('#punch')).includes('Clock Out'));
ok('still from 6:00 AM', hm(await p.textContent('#timer'))==='04:00', await p.textContent('#timer'));
ok('differential survived the reload — 4 h at $40 = $160.00',
   near(num(await p.textContent('#permoney')),160), await p.textContent('#permoney'));

console.log('\n━━ Judged by the shift, not the calendar ━━');
await p.close();
// Curtis's example: night shift starts 10 PM, stray tap clocks out at 5 AM, noticed 5:20.
// Seven hours in — plainly still the same shift, and the date rolling over is irrelevant.
p = await boot(ctx, {...base, sessions:[{id:'night',start:D(10,22),end:D(11,5)}]}, D(11,5,20));
ok('a 10 PM shift that lost its clock at 5 AM is offered', await p.isVisible('#resumeOpen'));
await p.click('#resumeOpen'); await p.waitForTimeout(250);
ok('and it names the 10:00 PM start', (await p.textContent('#resumeConfirm')).includes('10:00 PM'),
   await p.textContent('#resumeConfirm'));
await p.click('#resumeYes'); await p.waitForTimeout(400);
s = await st(p);
ok('reopened straight across midnight', s.jobs[0].activeStart===D(10,22), new Date(s.jobs[0].activeStart).toISOString());
ok('7 h 20 m on the clock', hm(await p.textContent('#timer'))==='07:20', await p.textContent('#timer'));

console.log('\n━━ And it keeps running as long as you like, overtime included ━━');
await p.clock.fastForward('04:00:00'); await p.waitForTimeout(400);
ok('still running 11 h 20 m in, well past any limit on the offer',
   hm(await p.textContent('#timer'))==='11:20', await p.textContent('#timer'));

console.log('\n━━ A shift too long to still be running is not offered ━━');
await p.close();
// plannedHours 8 -> the offer covers 14 h from the start. This one is 15 h in, and the
// stray tap was only minutes ago, so it is the span that rules it out, not the gap.
p = await boot(ctx, {...base, sessions:[{id:'marathon',start:D(10,6),end:D(10,20,45)}]}, D(10,21));
ok('15 h after its start it is no longer offered', !(await p.isVisible('#resumeOpen')));
await p.close();
// Same shape, comfortably inside the span.
p = await boot(ctx, {...base, sessions:[{id:'long',start:D(10,20),end:D(11,6)}]}, D(11,6,15));
ok('a 10 h overnight noticed 15 min later is offered', await p.isVisible('#resumeOpen'));

console.log('\n━━ A bigger daily target stretches the offer to match ━━');
await p.close();
// plannedHours 12 -> 18 h of span. The same 15 h shift now qualifies.
p = await boot(ctx, {...base, plannedHours:12, sessions:[{id:'marathon',start:D(10,6),end:D(10,20,45)}]}, D(10,21));
ok('with a 12 h target the same 15 h shift is offered', await p.isVisible('#resumeOpen'));

console.log('\n━━ Noticing too late is still refused ━━');
await p.close();
// A pocket keeps a phone for hours, so noticing six hours later still counts.
p = await boot(ctx, {...base, sessions:[{id:'am',start:D(11,6),end:D(11,9)}]}, D(11,15));
ok('noticing 6 h later is still an accident worth reopening', await p.isVisible('#resumeOpen'));
await p.close();
// Eleven hours later is not. The span is still inside the limit, so it is the gap alone
// that rules this one out.
p = await boot(ctx, {...base, sessions:[{id:'am',start:D(11,6),end:D(11,9)}]}, D(11,20));
ok('11 h later is past noticing', !(await p.isVisible('#resumeOpen')));
await p.close();
p = await boot(ctx, {...base, sessions:[{id:'am',start:D(11,6),end:D(11,9)}]}, D(11,11));
ok('but noticing 2 h later is fine', await p.isVisible('#resumeOpen'));

console.log('\n━━ Yesterday stays out of reach ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[{id:'yday',start:D(10,8),end:D(10,16)}]}, D(11,8));
ok('yesterday afternoon is not offered', !(await p.isVisible('#resumeOpen')));
await p.close();
p = await boot(ctx, {...base, sessions:[{id:'lastnight',start:D(10,15),end:D(10,23)}]}, D(11,8));
ok('last night is not offered this morning', !(await p.isVisible('#resumeOpen')));

console.log('\n━━ Mobile ━━');
await p.close();
ctx = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'America/New_York',locale:'en-US'});
p = await boot(ctx, {...base, sessions:[{id:'oops',start:D(11,6),end:D(11,9,40)}]}, D(11,10));
const bb = await p.locator('#resumeOpen').boundingBox();
ok('button is a real tap target', bb && bb.height>=44, bb?`${bb.height}px`:'none');
await p.click('#resumeOpen'); await p.waitForTimeout(250);
for (const sel of ['#resumeYes','#resumeNo']){
  const bx = await p.locator(sel).boundingBox();
  ok(`${sel} >= 44px tall`, bx && bx.height>=44, bx?`${bx.height}px`:'none');
}
ok('no horizontal overflow at 390px', (await p.evaluate(()=>document.documentElement.scrollWidth))<=391);
await p.evaluate(()=>document.getElementById('resumeConfirm').scrollIntoView());
await p.waitForTimeout(250);
await p.locator('#hero').screenshot({path:join(TMP, 'resume-phone.png')});

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
