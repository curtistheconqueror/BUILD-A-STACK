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
 r.writeHead(200,{'Content-Type':'text/html'});r.end(readFileSync(R+'index.html'));}).listen(8111);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const openAll=async pg=>{ try{ await pg.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open'))); }catch(e){} };
const b=await chromium.launch({executablePath: CHROME});
const D=(d,h,mi=0)=>Date.UTC(2026,7,d,h+4,mi);
const st = p => p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')));

// 07:00 -> 19:30 spans morning and evening, so both halves of the clock are exercised.
const base={configured:true,cfg:{rate:38,otMultiplier:1.5,otMode:'weekly',weeklyThreshold:40,periodThreshold:80,
  weekStartDay:0,periodAnchor:'2026-08-02',periodLengthDays:14,payDateOffsetDays:13},
  sessions:[{id:'a',start:D(10,7),end:D(10,19,30)}],
  activeStart:null,unit:'sec',planOn:false,plannedHours:10,sound:false};

async function boot(ctx, seed, atMs){
  const p=await ctx.newPage();
  p.on('pageerror',e=>{console.log('  PAGE ERROR:',e.message);fails++;});
  p.on('console',m=>{if(m.type()==='error'){console.log('  CONSOLE ERROR:',m.text());fails++;}});
  await p.addInitScript(([k,v])=>{ localStorage.setItem(k,JSON.stringify(v)); },[KEY,seed]);
  await p.clock.install({time:new Date(atMs)});
  await p.goto('http://localhost:8111/'); await p.waitForTimeout(450); await openAll(p);
  await p.evaluate(()=>{ document.querySelectorAll('#cfg details').forEach(d=>d.open=true); });
  await p.waitForTimeout(150);
  return p;
}
const ctx = await b.newContext({viewport:{width:1000,height:1700},timezoneId:'America/New_York',
  locale:'en-US',acceptDownloads:true});

console.log('\n━━ 12-hour is still the default ━━');
let p = await boot(ctx, base, D(11,10));
ok('setting exists in Settings', await p.isVisible('#cClock24'));
ok('defaults to 12-hour', (await p.inputValue('#cClock24'))==='0', await p.inputValue('#cClock24'));
let log = await p.textContent('#logBody');
ok('the log reads 7:00 AM / 7:30 PM', log.includes('7:00 AM') && log.includes('7:30 PM'), log.replace(/\s+/g,' ').slice(0,110));

console.log('\n━━ Switching to 24-hour ━━');
await p.selectOption('#cClock24','1'); await p.waitForTimeout(400); await openAll(p);
await p.evaluate(()=>{ document.querySelectorAll('#cfg details').forEach(d=>d.open=true); });
log = await p.textContent('#logBody');
ok('the log reads 07:00 / 19:30', log.includes('07:00') && log.includes('19:30'), log.replace(/\s+/g,' ').slice(0,110));
ok('no AM or PM left anywhere in the log', !/\b[AP]M\b/.test(log), log.replace(/\s+/g,' ').slice(0,110));
ok('the morning hour is zero-padded, roster style', log.includes('07:00'), '');

console.log('\n━━ It reaches every place a clock time is printed ━━');
// a running shift, so the live lines are exercised too
await p.close();
p = await boot(ctx, {...base, cfg:{...base.cfg, clock24:true}, planOn:true, activeStart:D(11,6)}, D(11,10));
ok('auto-stop estimate is 24-hour', /\d\d:\d\d/.test(await p.textContent('#planEta')) &&
   !/[AP]M/.test(await p.textContent('#planEta')), await p.textContent('#planEta'));
ok('the shift log line for the running shift too',
   !/[AP]M/.test(await p.textContent('#logBody')), (await p.textContent('#logBody')).replace(/\s+/g,' ').slice(0,90));

// reopening an accidentally-ended shift quotes two clock times
await p.close();
p = await boot(ctx, {...base, cfg:{...base.cfg, clock24:true},
  sessions:[{id:'oops',start:D(11,6),end:D(11,9,40)}]}, D(11,10));
await p.click('#resumeOpen'); await p.waitForTimeout(250);
let conf = await p.textContent('#resumeConfirm');
ok('the reopen prompt is 24-hour', conf.includes('06:00') && conf.includes('09:40'), conf.replace(/\s+/g,' ').slice(0,120));
ok('and carries no AM/PM', !/[AP]M/.test(conf), conf.replace(/\s+/g,' ').slice(0,120));
await p.click('#resumeNo'); await p.waitForTimeout(200);

// the backdated clock-in preview
await p.click('#backOpen'); await p.waitForTimeout(300);
await p.fill('#bTime','08:00'); await p.waitForTimeout(350);
let prev = await p.textContent('#bPreview');
ok('backdated start preview is 24-hour', prev.includes('08:00') && !/[AP]M/.test(prev), prev.replace(/\s+/g,' ').slice(0,110));
await p.click('#bCancel'); await p.waitForTimeout(200);

// the shift editor preview
await p.click('#addShift'); await p.waitForTimeout(300);
await p.click('#eMode button[data-m="times"]'); await p.waitForTimeout(200);
await p.fill('#eIn','22:00'); await p.fill('#eOut','06:00'); await p.waitForTimeout(350);
let ep = await p.textContent('#ePreview');
ok('the editor preview is 24-hour across midnight', ep.includes('22:00') && ep.includes('06:00'), ep.replace(/\s+/g,' ').slice(0,120));
ok('editor preview has no AM/PM', !/[AP]M/.test(ep), ep.replace(/\s+/g,' ').slice(0,120));
await p.click('#eCancel'); await p.waitForTimeout(200);

console.log('\n━━ Exported CSV follows the setting ━━');
const dl = await Promise.all([p.waitForEvent('download'), p.click('#exportCsv')]).then(r=>r[0]);
await dl.saveAs(join(TMP, 'mil.csv'));
let csv = readFileSync(join(TMP, 'mil.csv'),'utf8');
ok('CSV clock times are 24-hour', csv.includes('06:00') && csv.includes('09:40'), csv.split('\n')[1].slice(0,120));
ok('CSV has no AM/PM', !/[AP]M/.test(csv), csv.split('\n')[1].slice(0,120));

console.log('\n━━ Midnight and noon, the two that trip formatters up ━━');
await p.close();
p = await boot(ctx, {...base, cfg:{...base.cfg, clock24:true},
  sessions:[{id:'mid',start:D(10,0),end:D(10,12)}]}, D(11,10));
log = await p.textContent('#logBody');
ok('midnight is 00:00, not 24:00 or 12:00', log.includes('00:00'), log.replace(/\s+/g,' ').slice(0,90));
ok('noon is 12:00', log.includes('12:00'), log.replace(/\s+/g,' ').slice(0,90));
await p.selectOption('#cClock24','0'); await p.waitForTimeout(400); await openAll(p);
await p.evaluate(()=>{ document.querySelectorAll('#cfg details').forEach(d=>d.open=true); });
log = await p.textContent('#logBody');
ok('back in 12-hour, midnight is 12:00 AM', log.includes('12:00 AM'), log.replace(/\s+/g,' ').slice(0,90));
ok('and noon is 12:00 PM', log.includes('12:00 PM'), log.replace(/\s+/g,' ').slice(0,90));

console.log('\n━━ The choice sticks ━━');
await p.selectOption('#cClock24','1'); await p.waitForTimeout(350);
ok('saved to settings', (await st(p)).cfg.clock24===true);
await p.reload(); await p.waitForTimeout(500); await openAll(p);
await p.evaluate(()=>{ document.querySelectorAll('#cfg details').forEach(d=>d.open=true); });
await p.waitForTimeout(150);
ok('still 24-hour after a reload', (await p.inputValue('#cClock24'))==='1');
ok('and the log is still 24-hour', !/[AP]M/.test(await p.textContent('#logBody')));

console.log('\n━━ It travels in a backup ━━');
const dl2 = await Promise.all([p.waitForEvent('download'), p.click('#backup')]).then(r=>r[0]);
await dl2.saveAs(join(TMP, 'mil-backup.json'));
ok('backup carries the setting', JSON.parse(readFileSync(join(TMP, 'mil-backup.json'),'utf8')).cfg.clock24===true);

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
