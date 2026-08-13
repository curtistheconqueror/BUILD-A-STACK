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
 r.writeHead(200,{'Content-Type':'text/html'});r.end(readFileSync(R+'index.html'));}).listen(8107);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const b=await chromium.launch({executablePath: CHROME});
const st = p => p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')));
const D=(d,h,mi=0)=>Date.UTC(2026,7,d,h+4,mi);

// Curtis's real case: a genuine 7 h shift on Aug 5, then an accidental 1-minute one after it.
const base={configured:true,cfg:{rate:38,otMultiplier:1.5,otMode:'weekly',weeklyThreshold:40,periodThreshold:80,
  weekStartDay:0,periodAnchor:'2026-08-02',periodLengthDays:14,payDateOffsetDays:13},
  sessions:[{id:'real',start:D(5,7),end:D(5,14)},{id:'oops',start:D(5,14,30),end:D(5,14,31)}],
  activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false};

async function boot(ctx, seed, atMs){
  const p=await ctx.newPage();
  p.on('pageerror',e=>{console.log('  PAGE ERROR:',e.message);fails++;});
  p.on('console',m=>{if(m.type()==='error'){console.log('  CONSOLE ERROR:',m.text());fails++;}});
  await p.addInitScript(([k,v])=>{ localStorage.setItem(k,JSON.stringify(v)); },[KEY,seed]);
  await p.clock.install({time:new Date(atMs)});
  await p.goto('http://localhost:8107/'); await p.waitForTimeout(450);
  await p.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open')));
  await p.waitForTimeout(200);
  return p;
}

console.log('\n━━ Phone: the log stacks, so nothing overlaps or slides ━━');
let ctx = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'America/New_York',locale:'en-US'});
let p = await boot(ctx, base, D(5,15));
let geo = await p.evaluate(()=>{
  const wrap=document.querySelector('#logBody .logscroll');
  return { scroll:wrap.scrollWidth, client:wrap.clientWidth,
           rowButtons: document.querySelectorAll('#logBody tbody button').length };
});
ok('the log never scrolls sideways', geo.scroll<=geo.client, `${geo.scroll} vs ${geo.client}`);
ok('rows carry no buttons at all — nothing to overlap', geo.rowButtons===0, String(geo.rowButtons));
ok('rows are stacked, not laid out as a table',
   (await p.evaluate(()=>getComputedStyle(document.querySelector('#logBody tbody tr')).display))==='flex');
ok('a shift with no overtime shows no stray dash', !(await p.isVisible('#logBody td.noot')));
for (const sel of ['#pickEdit','#pickDelete','#addShift']){
  const bx = await p.locator(sel).boundingBox();
  ok(`${sel} is a real tap target`, bx && bx.height>=44, bx?`${bx.height}px`:'none');
}
ok('both shifts still listed', (await p.locator('#logBody tbody tr').count())===2,
   String(await p.locator('#logBody tbody tr').count()));

console.log('\n━━ The two Aug 5 rows are told apart at a glance ━━');
let body = await p.textContent('#logBody');
ok('the accidental one reads 0.02 h', body.includes('0.02'), body.replace(/\s+/g,' ').slice(0,140));
ok('the real one reads 7.00 h', body.includes('7.00'), '');
ok('their clock-in times distinguish them', body.includes('7:00 AM') && body.includes('2:30 PM'), '');

console.log('\n━━ Deleting the accidental shift, from the button then the row ━━');
ok('no picking prompt before you ask for one', !(await p.isVisible('#pickBar')));
await p.click('#pickDelete'); await p.waitForTimeout(250);
ok('it prompts you to tap a shift', (await p.textContent('#pickTxt')).includes('delete'), await p.textContent('#pickTxt'));
ok('rows light up as targets',
   (await p.evaluate(()=>document.getElementById('logBody').classList.contains('picking'))));
// Rows are newest first, so the 1-minute shift is row 0.
await p.locator('#logBody tbody tr').first().click();
await p.waitForTimeout(250);
ok('the prompt clears once a shift is picked', !(await p.isVisible('#pickBar')));
ok('it asks before deleting', (await p.textContent('#logBody')).includes('Delete?'));
ok('the confirm buttons are on-screen too', await p.evaluate(()=>{
  const y=document.querySelector('#logBody button[data-del-yes]').getBoundingClientRect();
  return y.right<=390 && y.left>=0; }));
await p.locator('#logBody button[data-del-yes]').click();
await p.waitForTimeout(350);
let s = await st(p);
ok('only the accidental shift was removed', s.sessions.length===1 && s.sessions[0].id==='real',
   JSON.stringify(s.sessions.map(x=>x.id)));
ok('one row left', (await p.locator('#logBody tbody tr').count())===1);
ok('period total dropped to 7.00 h', (await p.textContent('#logBody')).includes('7.00'), '');

console.log('\n━━ Declining a delete changes nothing ━━');
await p.click('#pickDelete'); await p.waitForTimeout(200);
await p.locator('#logBody tbody tr').first().click();
await p.waitForTimeout(200);
await p.locator('#logBody button[data-del-no]').click();
await p.waitForTimeout(250);
s = await st(p);
ok('the shift survives', s.sessions.length===1 && s.sessions[0].id==='real');

console.log('\n━━ Editing works the same way ━━');
await p.close();
p = await boot(ctx, base, D(5,15));
await p.click('#pickEdit'); await p.waitForTimeout(250);
ok('prompts you to tap a shift to edit', (await p.textContent('#pickTxt')).includes('edit'), await p.textContent('#pickTxt'));
await p.locator('#logBody tbody tr').last().click();     // the real 7 h shift
await p.waitForTimeout(300);
ok('the editor opens', await p.isVisible('#editor'));
ok('loaded with that shift', (await p.textContent('#eTitle')).toLowerCase().includes('edit'), await p.textContent('#eTitle'));
ok('and the prompt is gone', !(await p.isVisible('#pickBar')));
await p.click('#eCancel'); await p.waitForTimeout(200);

console.log('\n━━ Cancelling a pick leaves everything alone ━━');
await p.click('#pickDelete'); await p.waitForTimeout(200);
ok('picking is on', await p.evaluate(()=>document.getElementById('logBody').classList.contains('picking')));
await p.click('#pickCancel'); await p.waitForTimeout(250);
ok('prompt closed', !(await p.isVisible('#pickBar')));
ok('rows are no longer targets', !(await p.evaluate(()=>document.getElementById('logBody').classList.contains('picking'))));
ok('both shifts untouched', (await st(p)).sessions.length===2);

console.log('\n━━ The running shift cannot be picked ━━');
await p.close();
p = await boot(ctx, {...base, activeStart:D(5,14,45)}, D(5,15));
await p.click('#pickDelete'); await p.waitForTimeout(250);
const liveRows = await p.locator('#logBody tbody tr.live').count();
ok('the live shift is listed', liveRows===1, String(liveRows));
await p.locator('#logBody tbody tr.live').click(); await p.waitForTimeout(250);
ok('tapping it does nothing — still picking', await p.isVisible('#pickBar'));
ok('and nothing was queued for deletion', !(await p.textContent('#logBody')).includes('Delete?'));
await p.click('#pickCancel'); await p.waitForTimeout(150);

console.log('\n━━ Nothing to pick is said, not silently ignored ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[]}, D(5,15));
await p.click('#pickDelete'); await p.waitForTimeout(300);
ok('it says there is nothing to pick', (await p.textContent('#toast')).includes('No finished shifts'),
   await p.textContent('#toast'));
ok('and does not enter picking mode', !(await p.isVisible('#pickBar')));

console.log('\n━━ Reopen now targets the shift underneath ━━');
// Before the delete, "clocked out by accident" pointed at the 1-minute shift.
await p.close();
p = await boot(ctx, base, D(5,15));
await p.click('#resumeOpen'); await p.waitForTimeout(250);
ok('before deleting, it offers the 2:30 PM accident', (await p.textContent('#resumeConfirm')).includes('2:30 PM'),
   await p.textContent('#resumeConfirm'));
await p.click('#resumeNo'); await p.waitForTimeout(150);
await p.click('#pickDelete'); await p.waitForTimeout(200);
await p.locator('#logBody tbody tr').first().click();
await p.waitForTimeout(200);
await p.locator('#logBody button[data-del-yes]').click();
await p.waitForTimeout(350);
ok('still offered after the delete', await p.isVisible('#resumeOpen'));
await p.click('#resumeOpen'); await p.waitForTimeout(250);
let txt = await p.textContent('#resumeConfirm');
ok('now it offers the real 7:00 AM shift', txt.includes('7:00 AM'), txt);
ok('and knows it ended 2:00 PM', txt.includes('2:00 PM'), txt);
await p.click('#resumeYes'); await p.waitForTimeout(400);
s = await st(p);
ok('reopened from 7:00 AM', s.jobs[0].activeStart===D(5,7), new Date(s.jobs[0].activeStart).toISOString());
ok('log is now empty — it is the running shift', s.sessions.length===0, String(s.sessions.length));
ok('8 h on the clock (7 worked + the hour since)', (await p.textContent('#timer')).slice(0,5)==='08:00',
   await p.textContent('#timer'));

console.log('\n━━ Deleting the last shift withdraws the reopen offer ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[{id:'only',start:D(5,7),end:D(5,14)}]}, D(5,15));
ok('offered while a shift exists', await p.isVisible('#resumeOpen'));
await p.click('#pickDelete'); await p.waitForTimeout(200);
await p.locator('#logBody tbody tr').first().click();
await p.waitForTimeout(200);
await p.locator('#logBody button[data-del-yes]').click();
await p.waitForTimeout(350);
ok('withdrawn once nothing is left to reopen', !(await p.isVisible('#resumeOpen')));

console.log('\n━━ Desktop keeps the full table ━━');
await p.close();
ctx = await b.newContext({viewport:{width:1100,height:1400},timezoneId:'America/New_York',locale:'en-US'});
p = await boot(ctx, base, D(5,15));
ok('OT column shown on a wide screen', await p.isVisible('#logBody .otcol'));
ok('weekday shown on a wide screen', await p.isVisible('#logBody .dow'));
ok('rows still carry no buttons on a wide screen',
   (await p.evaluate(()=>document.querySelectorAll('#logBody tbody button').length))===0);
ok('still a real table on a wide screen',
   (await p.evaluate(()=>getComputedStyle(document.querySelector('#logBody tbody tr')).display))==='table-row');
await p.click('#pickDelete'); await p.waitForTimeout(200);
await p.locator('#logBody tbody tr').first().click(); await p.waitForTimeout(250);
ok('the same pick-then-tap flow works on a wide screen',
   (await p.textContent('#logBody')).includes('Delete?'));
await p.locator('#logBody button[data-del-yes]').click(); await p.waitForTimeout(300);
ok('and it deletes', (await st(p)).sessions.length===1, String((await st(p)).sessions.length));
const cols = await p.evaluate(()=>({
  head:[...document.querySelectorAll('#logBody thead th')].filter(c=>getComputedStyle(c).display!=='none').length,
  foot:[...document.querySelectorAll('#logBody tfoot td')].filter(c=>getComputedStyle(c).display!=='none').length
}));
ok('header and footer stay column-aligned', cols.head===7 && cols.foot===5, JSON.stringify(cols));
await p.locator('#log').screenshot({path:join(TMP, 'log-desktop.png')});

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
