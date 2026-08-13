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
const srv = http.createServer((q, r) => {
  // Serve real MIME types: the app registers a service worker, and a text/html
  // response for sw.js makes the browser reject it with a console error.
  const R = ROOT;
  if (q.url.startsWith('/sw.js')) { r.writeHead(200,{'Content-Type':'text/javascript'}); return r.end(readFileSync(R+'sw.js')); }
  if (q.url.startsWith('/manifest')) { r.writeHead(200,{'Content-Type':'application/manifest+json'}); return r.end(readFileSync(R+'manifest.webmanifest')); }
  if (q.url.indexOf('.png') > -1) { r.writeHead(404); return r.end(); }
  r.writeHead(200,{'Content-Type':'text/html'}); r.end(readFileSync(R+'index.html'));
}).listen(8087);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const openAll=async pg=>{ try{ await pg.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open'))); }catch(e){} };
const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({timezoneId:'America/New_York',locale:'en-US',viewport:{width:900,height:1600}});
const jul=(d,h)=>+new Date(2026,6,d,h);
const seed=()=>({configured:true,
  cfg:{rate:38,periodAnchor:'2026-07-26',otMode:'period',periodLengthDays:14,payDateOffsetDays:13,weekStartDay:0},
  sessions:[{id:'a',start:jul(27,8),end:jul(27,18)},{id:'b',start:jul(28,8),end:jul(28,18)},
            {id:'c',start:jul(29,8),end:jul(29,18)}],
  activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false});
let p;
async function boot(){
  if(p) await p.close();
  p=await ctx.newPage();
  p.on('pageerror',e=>{console.log('  💥',e.message);fails++;});
  await p.addInitScript(([k,v])=>{if(sessionStorage.getItem('__s'))return;sessionStorage.setItem('__s','1');
    localStorage.setItem(k,JSON.stringify(v));},[KEY,seed()]);
  await p.clock.install({time:new Date('2026-07-30T17:00:00Z')});
  await p.goto('http://localhost:8087/'); await p.waitForTimeout(350); await openAll(p);
  await p.evaluate(()=>{document.querySelectorAll('#cfg details').forEach(d=>d.open=true)}); await p.waitForTimeout(150);
}
const N=async s=>parseFloat((await p.textContent(s)).replace(/[$,]/g,''));

console.log('\n━━ Rate can no longer be zeroed ━━');
await boot();
await p.fill('#cRate','0'); await p.dispatchEvent('#cRate','change'); await p.waitForTimeout(400);
ok('rate 0 refused', (await p.inputValue('#cRate'))==='38', await p.inputValue('#cRate'));
ok('money untouched', Math.abs(await N('#cumeGross')-1140)<0.01, await p.textContent('#cumeGross'));
ok('told why', (await p.textContent('#toast')).includes('more than zero'), await p.textContent('#toast'));
await p.fill('#cRate','-5'); await p.dispatchEvent('#cRate','change'); await p.waitForTimeout(400);
ok('negative rate refused', (await p.inputValue('#cRate'))==='38');
await p.fill('#cRate','45'); await p.dispatchEvent('#cRate','change'); await p.waitForTimeout(400);
ok('a real rate still works', Math.abs(await N('#cumeGross')-1350)<0.01, await p.textContent('#cumeGross'));

console.log('\n━━ Moving the pay period no longer looks like data loss ━━');
await boot();
await p.fill('#cAnchor','2026-07-30'); await p.dispatchEvent('#cAnchor','change'); await p.waitForTimeout(500);
const log=await p.textContent('#logBody');
ok('log does NOT say "No shifts logged"', !log.includes('No shifts logged'), log.trim().slice(0,60));
ok('log says the shifts are still saved', log.includes('3 shifts saved outside this pay period'), log.trim().slice(0,80));
ok('log says nothing was deleted', log.includes('Nothing has been deleted'));
ok('log points at the cause', log.includes('pay-period start date'));
ok('shifts really are still stored', (await p.evaluate(k=>JSON.parse(localStorage.getItem(k)).sessions.length,KEY))===3);

console.log('\n━━ ...and the change can be taken back ━━');
ok('an undo bar appeared', await p.isVisible('#cfgUndo'));
ok('it explains what happened', (await p.textContent('#cfgUndoTxt')).includes('outside this pay period'),
   await p.textContent('#cfgUndoTxt'));
await p.click('#cfgUndoBtn'); await p.waitForTimeout(500);
ok('period restored', (await p.textContent('#prange')).includes('Sun Jul 26'), await p.textContent('#prange'));
ok('money restored', Math.abs(await N('#cumeGross')-1140)<0.01, await p.textContent('#cumeGross'));
ok('all 3 rows back', (await p.locator('#logBody tbody tr').count())===3);
ok('undo bar cleared', !(await p.isVisible('#cfgUndo')));

console.log('\n━━ Same safety net for period length ━━');
await boot();
await p.fill('#cLen','1'); await p.dispatchEvent('#cLen','change'); await p.waitForTimeout(500);
ok('explains rather than showing empty', (await p.textContent('#logBody')).includes('saved outside this pay period'));
ok('undo offered', await p.isVisible('#cfgUndo'));
await p.click('#cfgUndoBtn'); await p.waitForTimeout(500);
ok('undone cleanly', Math.abs(await N('#cumeGross')-1140)<0.01 && (await p.locator('#logBody tbody tr').count())===3);

console.log('\n━━ A genuinely empty period still reads normally ━━');
const p2=await ctx.newPage();
await p2.addInitScript(([k,v])=>localStorage.setItem(k,JSON.stringify(v)),
  [KEY,{...seed(),sessions:[]}]);
await p2.clock.install({time:new Date('2026-07-30T17:00:00Z')});
await p2.goto('http://localhost:8087/'); await p2.waitForTimeout(400); await openAll(p2);
ok('no scary notice when there is genuinely nothing', (await p2.textContent('#logBody')).includes('No shifts logged this period yet'));
await p2.close();

console.log(`\n${fails===0?'✅':'❌'}  data-loss safety: ${fails} failure(s)\n`);
await b.close(); srv.close(); process.exit(fails?1:0);
