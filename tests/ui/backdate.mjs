import { chromium } from 'playwright';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// The app under test sits two directories up from tests/ui/.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
// Set PW_CHROME to point at a specific build; otherwise Playwright finds its own.
const CHROME = process.env.PW_CHROME || undefined;

const KEY='payclock.v1', R = ROOT;
const srv=http.createServer((q,r)=>{
  const u=q.url||'/';
  if(u.startsWith('/sw.js')){r.writeHead(200,{'Content-Type':'text/javascript'});return r.end(readFileSync(R+'sw.js'));}
  if(u.startsWith('/manifest')){r.writeHead(200,{'Content-Type':'application/manifest+json'});return r.end(readFileSync(R+'manifest.webmanifest'));}
  if(u.indexOf('.png')>-1){r.writeHead(404);return r.end();}
  r.writeHead(200,{'Content-Type':'text/html'});r.end(readFileSync(R+'index.html'));
}).listen(8085);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const openAll=async pg=>{ try{ await pg.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open'))); }catch(e){} };
const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({timezoneId:'America/New_York',locale:'en-US',viewport:{width:900,height:1600}});
/* Built in the browser's timezone, not this process's. new Date(y,m,d,h) here is UTC,
   which lands four hours off the New York page and quietly moved every fixture. */
const jul=(d,h)=>Date.UTC(2026,6,d,h+4);          // July = EDT, UTC-4
const seed=(o={})=>({configured:true,
  cfg:{rate:38,periodAnchor:'2026-07-26',otMode:'period',periodLengthDays:14,payDateOffsetDays:13,weekStartDay:0,...(o.cfg||{})},
  sessions:o.sessions||[],activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false});
let p;
async function boot(st){
  if(p) await p.close();
  p=await ctx.newPage(); p.on('pageerror',e=>{console.log('  💥',e.message);fails++;});
  p.on('console',m=>{if(m.type()==='error'){console.log('  💥',m.text());fails++;}});
  await p.addInitScript(([k,v])=>{if(sessionStorage.getItem('__s'))return;sessionStorage.setItem('__s','1');
    localStorage.setItem(k,JSON.stringify(v));},[KEY,st||seed()]);
  await p.clock.install({time:new Date('2026-07-30T21:00:00Z')});   // Thu Jul 30, 5:00 PM ET
  await p.goto('http://localhost:8085/'); await p.waitForTimeout(400); await openAll(p);
}
const T=s=>p.textContent(s), N=async s=>parseFloat((await T(s)).replace(/[$,]/g,''));

console.log('\n━━ The control appears only when you are clocked out ━━');
await boot();
ok('offered when idle', await p.isVisible('#backOpen'));
await p.click('#punch'); await p.waitForTimeout(250);
ok('hidden while a shift runs', !(await p.isVisible('#backOpen')));
await p.click('#punch'); await p.waitForTimeout(250);
ok('back when clocked out', await p.isVisible('#backOpen'));

console.log('\n━━ Mode 1: I started at 1:00 PM (it is now 5:00 PM) ━━');
await boot();
await p.click('#backOpen'); await p.waitForTimeout(250);
ok('panel opens', await p.isVisible('#backdate'));
ok('defaults to two hours ago', (await p.inputValue('#bTime'))==='15:00', await p.inputValue('#bTime'));
await p.fill('#bTime','13:00'); await p.waitForTimeout(300);
ok('preview says 4.00 h', (await T('#bPreview')).includes('4.00 h'), (await T('#bPreview')).replace(/\s+/g,' ').slice(0,90));
ok('preview prices it near $152', /\$152\.0\d/.test(await T('#bPreview')), (await T('#bPreview')).match(/\$[\d.]+/)[0]);
await p.click('#bStart'); await p.waitForTimeout(400);
ok('clock is running', (await T('#statusTxt')).includes('On the clock'));
ok('timer already at ~04:00', /^04:00:0\d$/.test(await T('#timer')), await T('#timer'));
// Derived from wall-clock time, so page-boot latency legitimately adds a cent or two.
ok('money already at $152', Math.abs(await N('#money')-152)<0.10, await T('#money'));
ok('today total agrees', Math.abs(await N('#dGross')-152)<0.05, await T('#dGross'));

console.log('\n━━ ...and it keeps ticking from there ━━');
await p.clock.fastForward(30*60_000); await p.waitForTimeout(250);
ok('30 min later reads ~04:30', /^04:30:0\d$/.test(await T('#timer')), await T('#timer'));
ok('money now $171.00', Math.abs(await N('#money')-171)<0.05, await T('#money'));
await p.reload(); await p.waitForTimeout(400); await openAll(p);
ok('survives a reload', (await T('#timer')).startsWith('04:30') && (await T('#statusTxt')).includes('On the clock'), await T('#timer'));

console.log('\n━━ Mode 2: hours already in ━━');
await boot();
await p.click('#backOpen'); await p.click('#bMode button[data-m="hours"]'); await p.waitForTimeout(200);
await p.fill('#bHours','6.5'); await p.waitForTimeout(300);
ok('preview says 6.50 h', (await T('#bPreview')).includes('6.50 h'), (await T('#bPreview')).replace(/\s+/g,' ').slice(0,80));
ok('preview prices it $247.00', (await T('#bPreview')).includes('$247.00'));
await p.click('#bStart'); await p.waitForTimeout(400);
ok('timer starts at 06:30:00', (await T('#timer'))==='06:30:00', await T('#timer'));

console.log('\n━━ Mode 3: I have already earned $304 ━━');
await boot();
await p.click('#backOpen'); await p.click('#bMode button[data-m="earned"]'); await p.waitForTimeout(200);
await p.fill('#bEarned','304'); await p.waitForTimeout(400);
ok('solves to 8.00 h', (await T('#bPreview')).includes('8.00 h'), (await T('#bPreview')).replace(/\s+/g,' ').slice(0,80));
await p.click('#bStart'); await p.waitForTimeout(400);
ok('timer starts at 08:00:00', (await T('#timer'))==='08:00:00', await T('#timer'));
ok('money reads $304', Math.abs(await N('#money')-304)<0.05, await T('#money'));

console.log('\n━━ Earnings mode solves correctly across the overtime line ━━');
// 78 h already banked this period; $304 of NEW pay is 2 h straight + rest at $57
await boot(seed({sessions:[
  {id:'a',start:jul(26,8),end:jul(26,8)+10*3600e3},{id:'b',start:jul(27,8),end:jul(27,8)+10*3600e3},
  {id:'c',start:jul(28,8),end:jul(28,8)+10*3600e3},{id:'d',start:jul(29,8),end:jul(29,8)+10*3600e3},
  {id:'e',start:jul(30,0),end:jul(30,0)+10*3600e3},{id:'f',start:jul(25,8),end:jul(25,8)+10*3600e3},
  {id:'g',start:jul(24,8),end:jul(24,8)+10*3600e3},{id:'h',start:jul(23,8),end:jul(23,8)+8*3600e3}]}));
await p.click('#backOpen'); await p.click('#bMode button[data-m="earned"]'); await p.waitForTimeout(200);
await p.fill('#bEarned','200'); await p.waitForTimeout(500);
const pv=await T('#bPreview');
ok('preview produced an hours figure', /\d+\.\d\d h/.test(pv), pv.replace(/\s+/g,' ').slice(0,100));
await p.click('#bStart'); await p.waitForTimeout(400);
ok('resulting session pay matches the $200 asked for', Math.abs(await N('#money')-200)<0.5, await T('#money'));

console.log('\n━━ Guards ━━');
await boot();
await p.click('#backOpen'); await p.waitForTimeout(200);
await p.fill('#bTime','23:00'); await p.waitForTimeout(300);   // later today = future
await p.click('#bStart'); await p.waitForTimeout(300);
ok('refuses a future start', await p.isVisible('#bErr'), await T('#bErr'));
ok('still clocked out', (await T('#statusTxt')).includes('Clocked out'));
await p.click('#bMode button[data-m="hours"]'); await p.fill('#bHours','0'); await p.waitForTimeout(250);
await p.click('#bStart'); await p.waitForTimeout(300);
ok('refuses zero hours', await p.isVisible('#bErr'), await T('#bErr'));

console.log('\n━━ Warns if it would double-count logged hours ━━');
await boot(seed({sessions:[{id:'x',start:jul(30,12),end:jul(30,16)}]}));
await p.click('#backOpen'); await p.fill('#bTime','13:00'); await p.waitForTimeout(350);
ok('flags the overlap', (await T('#bPreview')).includes('counted twice'), (await T('#bPreview')).replace(/\s+/g,' ').slice(-90));

console.log('\n━━ Cancel changes nothing ━━');
await boot();
await p.click('#backOpen'); await p.fill('#bTime','09:00'); await p.waitForTimeout(250);
await p.click('#bCancel'); await p.waitForTimeout(250);
ok('panel closed', !(await p.isVisible('#backdate')));
ok('still clocked out', (await T('#statusTxt')).includes('Clocked out'));
ok('nothing banked', (await T('#dGross'))==='$0.00', await T('#dGross'));

console.log(`\n${fails===0?'✅':'❌'}  backdated start: ${fails} failure(s)\n`);
await b.close(); srv.close(); process.exit(fails?1:0);
