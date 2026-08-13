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


const KEY='payclock.v1', R = ROOT;
const srv=http.createServer((q,r)=>{
  const u=q.url||'/';
  if(u.startsWith('/sw.js')){r.writeHead(200,{'Content-Type':'text/javascript'});return r.end(readFileSync(R+'sw.js'));}
  if(u.startsWith('/manifest')){r.writeHead(200,{'Content-Type':'application/manifest+json'});return r.end(readFileSync(R+'manifest.webmanifest'));}
  if(u.indexOf('.png')>-1){r.writeHead(404);return r.end();}
  r.writeHead(200,{'Content-Type':'text/html'});r.end(readFileSync(R+'index.html'));
}).listen(8084);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const openAll=async pg=>{ try{ await pg.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open'))); }catch(e){} };
const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({timezoneId:'America/New_York',locale:'en-US',viewport:{width:900,height:1700},deviceScaleFactor:2});
const jul=(d,h)=>+new Date(2026,6,d,h);
const seed={configured:true,
  cfg:{rate:38,periodAnchor:'2026-07-26',otMode:'period',periodLengthDays:14,payDateOffsetDays:13,weekStartDay:0},
  sessions:[{id:'a',start:jul(29,8),end:jul(29,18)}],activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false};
let p;
async function boot(st){
  if(p) await p.close();
  p=await ctx.newPage(); p.on('pageerror',e=>{console.log('  💥',e.message);fails++;});
  p.on('console',m=>{if(m.type()==='error'){console.log('  💥',m.text());fails++;}});
  await p.addInitScript(([k,v])=>{if(sessionStorage.getItem('__s'))return;sessionStorage.setItem('__s','1');
    localStorage.setItem(k,JSON.stringify(v));},[KEY,st||seed]);
  await p.clock.install({time:new Date('2026-07-30T21:00:00Z')});
  await p.goto('http://localhost:8084/'); await p.waitForTimeout(400); await openAll(p);
  await p.evaluate(()=>{document.querySelectorAll('#cfg details').forEach(d=>d.open=true)}); await p.waitForTimeout(200);
}
const cssVar=n=>p.evaluate(v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim(),n);
const colorOf=sel=>p.evaluate(s=>{const e=document.querySelector(s);
  const c=getComputedStyle(e); return c.webkitTextFillColor&&c.webkitTextFillColor!=='rgba(0, 0, 0, 0)'?c.webkitTextFillColor:c.color;},sel);
const bodyBg=()=>p.evaluate(()=>getComputedStyle(document.body).backgroundColor);

console.log('\n━━ The panel is there ━━');
await boot();
ok('presets offered', (await p.locator('.preset').count())===6, String(await p.locator('.preset').count()));
// 13 app colours + 3 calendar colours (paper, grid, hours)
ok('individual colour pickers', (await p.locator('.sw input[type=color]').count())===16, String(await p.locator('.sw input[type=color]').count()));
ok('font picker', await p.isVisible('#tFont'));
ok('background style picker', await p.isVisible('#tBgStyle'));

console.log('\n━━ "Background completely black, all text white" ━━');
await p.click('.preset[data-preset="black"]'); await p.waitForTimeout(400);
ok('background is black', await bodyBg()==='rgb(0, 0, 0)', await bodyBg());
ok('main text is white', await cssVar('--ink')==='#ffffff', await cssVar('--ink'));
ok('session clock is white', (await colorOf('.money'))==='rgb(255, 255, 255)', await colorOf('.money'));
ok('title is white too', (await colorOf('h1'))==='rgb(255, 255, 255)', await colorOf('h1'));
ok('glow layer removed', await p.evaluate(()=>getComputedStyle(document.querySelector('.bg')).display)==='none');
await p.screenshot({path:join(TMP, '20-black.png'), fullPage:true});

console.log('\n━━ "Pay period total blue, session clock green" ━━');
await p.fill('.sw input[data-tk="period"]','#1d4ed8'); await p.dispatchEvent('.sw input[data-tk="period"]','input');
await p.fill('.sw input[data-tk="session"]','#22c55e'); await p.dispatchEvent('.sw input[data-tk="session"]','input');
await p.waitForTimeout(400);
ok('period total is blue', (await colorOf('.cumeval'))==='rgb(29, 78, 216)', await colorOf('.cumeval'));
ok('session clock is green', (await colorOf('.money'))==='rgb(34, 197, 94)', await colorOf('.money'));
ok('background still black', await bodyBg()==='rgb(0, 0, 0)', await bodyBg());
await p.screenshot({path:join(TMP, '21-custom.png'), fullPage:true});

console.log('\n━━ Choices survive a reload ━━');
await p.reload(); await p.waitForTimeout(500); await openAll(p);
ok('still black', await bodyBg()==='rgb(0, 0, 0)', await bodyBg());
ok('period still blue', (await colorOf('.cumeval'))==='rgb(29, 78, 216)', await colorOf('.cumeval'));
ok('session still green', (await colorOf('.money'))==='rgb(34, 197, 94)', await colorOf('.money'));
ok('pickers show the saved values', (await p.inputValue('.sw input[data-tk="period"]'))==='#1d4ed8');

console.log('\n━━ Every preset applies cleanly ━━');
for (const name of ['midnight','money','terminal','paper','ocean']){
  // keep Settings open — clicking the summary again would collapse it
  await p.evaluate(()=>{document.querySelectorAll('#cfg details').forEach(d=>d.open=true);});
  await p.click(`.preset[data-preset="${name}"]`); await p.waitForTimeout(350);
  const bg=await bodyBg(), ink=await cssVar('--ink');
  const readable = bg!==ink && /^rgb/.test(bg);
  ok(`${name} applies`, readable, `bg ${bg} · ink ${ink}`);
}
await p.screenshot({path:join(TMP, '22-paper.png'), fullPage:true});

console.log('\n━━ Fonts ━━');
await p.evaluate(()=>{document.querySelectorAll('#cfg details').forEach(d=>d.open=true);});
await p.selectOption('#tFont','ui-monospace, \'SF Mono\', Menlo, Consolas, monospace'); await p.waitForTimeout(350);
ok('monospace applied', (await p.evaluate(()=>getComputedStyle(document.body).fontFamily)).toLowerCase().includes('mono'),
   await p.evaluate(()=>getComputedStyle(document.body).fontFamily));
await p.selectOption('#tFont',''); await p.waitForTimeout(300);
ok('back to system default', !(await p.evaluate(()=>getComputedStyle(document.body).fontFamily)).toLowerCase().includes('mono'));

console.log('\n━━ Theming never touches the money ━━');
ok('shift still logged', (await p.locator('#logBody tbody tr').count())===1);
ok('period total intact', Math.abs(parseFloat((await p.textContent('#cumeGross')).replace(/[$,]/g,''))-380)<0.01,
   await p.textContent('#cumeGross'));

console.log('\n━━ Reset, and backup carries the theme ━━');
await p.evaluate(()=>{document.querySelectorAll('#cfg details').forEach(d=>d.open=true);});
await p.click('.preset[data-preset="terminal"]'); await p.waitForTimeout(300);
const dl=await Promise.all([p.waitForEvent('download'),p.click('#backup')]).then(r=>r[0]);
await dl.saveAs(join(TMP, 'theme-backup.json'));
ok('backup includes the theme', JSON.parse(readFileSync(join(TMP, 'theme-backup.json'),'utf8')).theme.preset==='terminal');
await p.click('#themeReset'); await p.waitForTimeout(400);
ok('reset returns to the default', (await cssVar('--ink'))==='#eaf1ff', await cssVar('--ink'));
await p.setInputFiles('#restoreFile',join(TMP, 'theme-backup.json')); await p.waitForTimeout(600);
ok('restore brings the theme back', (await cssVar('--ink'))==='#33ff66', await cssVar('--ink'));

console.log('\n━━ Widget mode is themed too ━━');
await p.goto('http://localhost:8084/?widget=1'); await p.waitForTimeout(500); await openAll(p);
ok('widget uses the theme', (await bodyBg())==='rgb(0, 0, 0)', await bodyBg());
await p.screenshot({path:join(TMP, '23-widget-themed.png')});

console.log(`\n${fails===0?'✅':'❌'}  theming: ${fails} failure(s)\n`);
await b.close(); srv.close(); process.exit(fails?1:0);
