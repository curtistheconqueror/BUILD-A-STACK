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
}).listen(8079);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({timezoneId:'America/New_York',locale:'en-US',viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const jul=(d,h)=>+new Date(2026,6,d,h);
const seed={configured:true,
  cfg:{rate:38,periodAnchor:'2026-07-26',otMode:'period',periodLengthDays:14,payDateOffsetDays:13,weekStartDay:0},
  sessions:[{id:'a',start:jul(28,9),end:jul(28,17)},{id:'b',start:jul(29,9),end:jul(29,19)}],
  activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false};
const p=await ctx.newPage();
p.on('pageerror',e=>{console.log('  💥',e.message);fails++;});
p.on('console',m=>{if(m.type()==='error'){console.log('  💥',m.text());fails++;}});
await p.addInitScript(([k,v])=>{if(sessionStorage.getItem('__s'))return;sessionStorage.setItem('__s','1');
  localStorage.setItem(k,JSON.stringify(v));},[KEY,seed]);
await p.clock.install({time:new Date('2026-07-30T21:00:00Z')});
await p.goto('http://localhost:8079/'); await p.waitForTimeout(450);
const T=s=>p.textContent(s);
const isOpen=id=>p.evaluate(i=>document.getElementById(i).classList.contains('open'),id);
const bodyVisible=id=>p.evaluate(i=>{const el=document.querySelector('#'+i+' .colbody');
  return !!el && getComputedStyle(el).display!=='none';},id);

console.log('\n━━ Compressed by default — except the clock, which introduces the app ━━');
ok('hero starts OPEN so newcomers see what this is', await isOpen('hero') && await bodyVisible('hero'));
for (const id of ['totals','progress','period','ytd','log'])
  ok(`${id} starts folded`, !(await isOpen(id)) && !(await bodyVisible(id)));
ok('section titles default green', await p.evaluate(()=>
  getComputedStyle(document.querySelector('#totals > h2')).color)==='rgb(81, 224, 138)',
  await p.evaluate(()=>getComputedStyle(document.querySelector('#totals > h2')).color));
ok('titles are the bigger size', await p.evaluate(()=>
  parseFloat(getComputedStyle(document.querySelector('#totals > h2')).fontSize))>=14);

console.log('\n━━ Folded is not blind: live summaries on every header ━━');
ok('earnings summary', (await T('#sum_totals')).includes('today'), await T('#sum_totals'));
ok('progress summary shows period money', (await T('#sum_progress')).includes('$684.00'), await T('#sum_progress'));
ok('period summary shows payday', (await T('#sum_period')).includes('Aug 21'), await T('#sum_period'));
ok('ytd summary shows the figure', (await T('#sum_ytd')).includes('$684.00'), await T('#sum_ytd'));
ok('log summary counts shifts', (await T('#sum_log')).includes('2 shifts'), await T('#sum_log'));

console.log('\n━━ Folded clock still works one-tap ━━');
await p.click('#heroChev'); await p.waitForTimeout(250);      // fold it first
ok('hero folds on demand', !(await isOpen('hero')));
ok('strip shows money', (await T('#hmoney')).startsWith('$'), await T('#hmoney'));
await p.click('#punchMini'); await p.waitForTimeout(250);
ok('one tap clocks in from the folded strip', (await T('#statusTxt')).includes('On the clock'));
await p.clock.fastForward(3600_000); await p.waitForTimeout(300);
ok('strip money ticks live while folded', parseFloat((await T('#hmoney')).replace(/[$,]/g,''))>=38, await T('#hmoney'));
ok('log summary notes the running shift', (await T('#sum_log')).includes('running'), await T('#sum_log'));
await p.click('#punchMini'); await p.waitForTimeout(250);
ok('and clocks out again', (await T('#statusTxt')).includes('Clocked out'));

console.log('\n━━ Sections open independently — no accordion ━━');
await p.click('#ytd > h2'); await p.waitForTimeout(250);
ok('YTD opened by itself', await isOpen('ytd'));
ok('...without its neighbours', !(await isOpen('progress')) && !(await isOpen('period')) && !(await isOpen('log')));
await p.click('#log > h2'); await p.waitForTimeout(250);
ok('log opens too, YTD stays open', await isOpen('log') && await isOpen('ytd'));
ok('open log is fully functional', await p.isVisible('#addShift'));
await p.click('#ytd > h2'); await p.waitForTimeout(250);
ok('YTD folds back alone', !(await isOpen('ytd')) && await isOpen('log'));

console.log('\n━━ Hero expands to the full clock ━━');
await p.click('#heroChev'); await p.waitForTimeout(250);
ok('hero opens', await isOpen('hero'));
ok('full controls appear', await p.isVisible('#seg') && await p.isVisible('#punch') && await p.isVisible('#payMode'));
ok('strip mini-button hides when open (no two punch buttons)', !(await p.isVisible('#punchMini')));

console.log('\n━━ Layout choices persist ━━');
await p.reload(); await p.waitForTimeout(450);
ok('hero open after reload (was explicitly opened)', await isOpen('hero'));
ok('log still open', await isOpen('log'));
ok('the rest still folded', !(await isOpen('ytd')) && !(await isOpen('progress')) && !(await isOpen('period')) && !(await isOpen('totals')));

console.log('\n━━ Order and hygiene ━━');
const order=await p.evaluate(()=>[...document.querySelectorAll('section.card')].map(s=>s.id).filter(Boolean));
const WANT=['hero','totals','period','progress','log','extra','ytd'];
ok('order: '+WANT.join(', '), JSON.stringify(order.filter(i=>WANT.includes(i)))===JSON.stringify(WANT),
   order.join(','));
const of=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
ok('no sideways scroll', of<=0, of+'px');
const collapsedH=await p.evaluate(()=>{document.querySelectorAll('.col').forEach(c=>c.classList.remove('open'));
  return document.body.scrollHeight;});
ok('fully folded page is genuinely compact (under 2.5 screens)', collapsedH<844*2.5, collapsedH+'px tall');

console.log(`\n${fails===0?'✅':'❌'}  collapsible layout: ${fails} failure(s)\n`);
await b.close(); srv.close(); process.exit(fails?1:0);
