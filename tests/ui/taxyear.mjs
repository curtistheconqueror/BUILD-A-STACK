/* The tax tables perish every January. A stale table produces a wrong take-home rather
   than an obviously missing one, so the year is stated wherever net is shown and the app
   says so plainly once the calendar has moved past it. */
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
}).listen(8126);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const b=await chromium.launch({executablePath: CHROME});

const base=(net)=>({configured:true,cfg:{rate:38,otMultiplier:1.5,otMode:'weekly',weeklyThreshold:40,
  periodThreshold:80,dailyThreshold:8,weekStartDay:0,periodAnchor:'2026-07-26',
  periodLengthDays:14,payDateOffsetDays:13,schedStart:'14:00',schedEnd:'22:30',
  holidays:[],banks:[],daysOff:[]},
  sessions:[{id:'a',start:Date.UTC(2026,6,27,13),end:Date.UTC(2026,6,27,21)}],
  activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false,
  net:net,ui:{open:{hero:true},past:true,pastView:'net'}});
const NET_ON = {enabled:true,configured:true,view:'net',filing:'single',dependents:0,
  fedExempt:false,fedOverride:null,state:'IL',statePct:4.95,stateExempt:false,
  stateOverride:null,ficaOn:true,items:[]};

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
  await p.goto('http://localhost:8126/'); await p.waitForTimeout(650);
  await p.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open')));
  await p.waitForTimeout(300);
  return p;
}
const ctx = await b.newContext({viewport:{width:1100,height:2600},timezoneId:'America/New_York',locale:'en-US'});

console.log('\n━━ While the tables are current ━━');
let p = await boot(ctx, base(NET_ON), Date.UTC(2026,7,25,16));   // still 2026
ok('no warning banner', !(await p.isVisible('#taxStale')));
await p.click('#openNet').catch(()=>{});
await p.evaluate(()=>{ if (typeof openNetSetup==='function') openNetSetup(); });
await p.waitForTimeout(400);
ok('the deductions screen states the year', (await p.textContent('#taxYearNote')).includes('2026'),
   await p.textContent('#taxYearNote'));
ok('and does not cry wolf', !(await p.textContent('#taxYearNote')).includes('out of date'),
   await p.textContent('#taxYearNote'));
ok('past-period net says which year it used',
   (await p.textContent('#pastNote')).includes('2026 rates'), await p.textContent('#pastNote'));

console.log('\n━━ Once the calendar moves past it ━━');
await p.close();
p = await boot(ctx, base(NET_ON), Date.UTC(2027,2,10,16));       // March 2027
ok('the banner appears', await p.isVisible('#taxStale'));
let t = await p.textContent('#taxStaleTxt');
console.log('       ' + t.replace(/\s+/g,' '));
ok('it names the year the tables are for', t.includes('2026'), t);
ok('and how far out of date they are', t.includes('1 year out of date'), t);
ok('it says why that matters', t.includes('take-home here will be off'), t);
ok('and what to do instead', t.includes('override'), t);
ok('with a way to get there', await p.isVisible('#taxStaleGo'));
await p.click('#taxStaleGo'); await p.waitForTimeout(500);
ok('which opens the deductions screen', await p.isVisible('#netsetup'));
ok('carrying the same warning', (await p.textContent('#taxYearNote')).includes('out of date'),
   await p.textContent('#taxYearNote'));

console.log('\n━━ Two years on it says two ━━');
await p.close();
p = await boot(ctx, base(NET_ON), Date.UTC(2028,5,1,16));
ok('counts the years', (await p.textContent('#taxStaleTxt')).includes('2 years out of date'),
   await p.textContent('#taxStaleTxt'));

console.log('\n━━ It only warns when net pay is actually in use ━━');
await p.close();
p = await boot(ctx, base({enabled:false,configured:false,view:'gross',filing:'single',
  dependents:0,state:'IL',statePct:4.95,ficaOn:true,items:[]}), Date.UTC(2027,2,10,16));
ok('gross-only users are not nagged', !(await p.isVisible('#taxStale')));
ok('and the clock is unaffected', await p.isVisible('#timer'));

console.log('\n━━ The gross figures are untouched by any of this ━━');
await p.close();
// A 2026 shift viewed from 2027 is outside the current period — the app should say so
// rather than imply it is gone, and the gross figures for it must be unchanged.
p = await boot(ctx, base(NET_ON), Date.UTC(2027,2,10,16));
ok('the log says the shift is stored, just not in this period',
   (await p.textContent('#logBody')).includes('Nothing has been deleted'),
   (await p.textContent('#logBody')).replace(/\s+/g,' ').slice(0,120));
await p.close();
// And viewed from inside its own period, the gross is what it always was.
p = await boot(ctx, base(NET_ON), Date.UTC(2027,2,10,16));
const grossThen = await p.evaluate(()=>{
  const s=JSON.parse(localStorage.getItem('payclock.v1'));
  return s.sessions.length;
});
ok('the shift itself is still on file', grossThen===1, String(grossThen));
await p.close();
p = await boot(ctx, base(NET_ON), Date.UTC(2026,7,1,16));   // inside its period
ok('and prices at $304.00 there', (await p.textContent('#logBody')).includes('$304.00'),
   (await p.textContent('#logBody')).replace(/\s+/g,' ').slice(-90));

console.log('\n━━ On a phone the banner does not break the layout ━━');
await p.close();
const mob = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  deviceScaleFactor:3,timezoneId:'America/New_York',locale:'en-US'});
p = await boot(mob, base(NET_ON), Date.UTC(2027,2,10,16));
const m = await p.evaluate(()=>({
  pageW:document.documentElement.scrollWidth, winW:window.innerWidth,
  visible: !document.getElementById('taxStale').classList.contains('hide')
}));
ok('no sideways scroll', m.pageW<=m.winW+1, `${m.pageW} vs ${m.winW}`);
ok('and the banner is showing', m.visible);

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
