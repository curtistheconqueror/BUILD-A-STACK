/* Going exempt from federal withholding: how long, and how much was not withheld. */
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
  const f=R+path; if(!existsSync(f)){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'Content-Type':TYPES[path.slice(path.lastIndexOf('.'))]||'application/octet-stream'});
  r.end(readFileSync(f));
}).listen(8171);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const b=await chromium.launch({executablePath: CHROME});
const T=(m,d,h=14,mi=0)=>Date.UTC(2026,m,d,h+5,mi);       // America/Chicago, CDT
// Six weeks of Mon-Fri eights: three weeks in June, three in July.
const ss=[]; let id=0;
for (const [m,days] of [[5,[1,2,3,4,5,8,9,10,11,12,15,16,17,18,19]],[6,[6,7,8,9,10,13,14,15,16,17,20,21,22,23,24]]])
  for (const d of days) ss.push({id:'s'+(id++),start:T(m,d,14),end:T(m,d,22,30)});
const seed=(net={})=>({configured:true,cfg:{rate:37.78,otMultiplier:1.5,otMode:'weekly',
  weeklyThreshold:40,periodThreshold:80,dailyThreshold:8,shiftThreshold:8,weekStartDay:0,
  periodAnchor:'2026-06-01',periodLengthDays:14,payDateOffsetDays:13,
  schedStart:'14:00',schedEnd:'22:30',lunchMins:30,
  workDays:[false,true,true,true,true,true,false],holidays:[],banks:[],daysOff:[],vacations:[],
  shiftDayRule:'majority',skewOn:false,skewMins:0,makeUpOn:false,nightOn:false},
  sessions:ss,absences:[],activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false,
  ui:{open:{}},
  net:{ytdShow:true,enabled:false,configured:true,otBreak:true,filing:'single',dependents:0,
       ficaOn:true,statePct:4.95,items:[],fedExempt:false,...net}});
async function boot(ctx, st, atMs){
  const p=await ctx.newPage();
  p.on('pageerror',e=>{console.log('  PAGE ERROR:',e.message);fails++;});
  p.on('console',m=>{if(m.type()==='error'){console.log('  CONSOLE ERROR:',m.text());fails++;}});
  await p.addInitScript(([k,v])=>{
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded','1'); localStorage.setItem(k,JSON.stringify(v));
  },[KEY,st]);
  await p.clock.install({time:new Date(atMs)});
  await p.goto('http://localhost:8171/'); await p.waitForTimeout(650);
  await p.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open')));
  await p.waitForTimeout(400);
  return p;
}
const ctx = await b.newContext({viewport:{width:1100,height:2800},timezoneId:'America/Chicago',locale:'en-US'});
const NOW = T(6,27,12);          // Mon Jul 27, noon

console.log('\n━━ Not exempt: the block stays shut ━━');
let p = await boot(ctx, seed(), NOW);
ok('the switch is there', await p.isVisible('#exOn'));
ok('and off', !(await p.isChecked('#exOn')));
ok('nothing to fill in yet', !(await p.isVisible('#exBody')));

console.log('\n━━ Turning it on asks for the date ━━');
await p.click('#exOn'); await p.waitForTimeout(500);
ok('the fields appear', await p.isVisible('#exFrom') && await p.isVisible('#exTo'));
let out = await p.textContent('#exOut');
ok('it asks rather than guessing', out.includes('date you went exempt'), out);
ok('and the deductions screen agrees', await p.evaluate(()=>{
  const n=JSON.parse(localStorage.getItem('payclock.v1')).net; return n.fedExempt===true; }));

console.log('\n━━ Exempt since July 1 ━━');
await p.fill('#exFrom','2026-07-01'); await p.dispatchEvent('#exFrom','change'); await p.waitForTimeout(700);
out = (await p.textContent('#exOut')).replace(/\s+/g,' ');
console.log('       ' + out);
const shown = parseFloat((await p.textContent('#exOut')).match(/\$([\d,]+\.\d\d)/)[1].replace(/,/g,''));
ok('a real figure, not zero', shown>0, '$'+shown.toFixed(2));
ok('it says what it is', out.includes('federal tax not withheld'), out);
ok('how long', /2[0-9] days and counting/.test(out), out);
ok('since when', out.includes('Jul 1'), out);
ok('on how much pay', /on \$[\d,]+\.\d\d of pay/.test(out), out);
ok('and never calls it owed', !/owed/i.test(out), out);
ok('but says to set it aside if you claimed exempt', out.includes('set aside'), out);
ok('while allowing you might genuinely owe nothing', out.includes('owe nothing at filing'), out);
const eta = await p.textContent('#exEta');
ok('the summary line carries the figure', eta.includes('not withheld'), eta);

console.log('\n━━ June is outside the window, so it is not counted ━━');
await p.fill('#exFrom','2026-06-01'); await p.dispatchEvent('#exFrom','change'); await p.waitForTimeout(700);
const all = parseFloat((await p.textContent('#exOut')).match(/\$([\d,]+\.\d\d)/)[1].replace(/,/g,''));
console.log('       from Jun 1: $' + all.toFixed(2) + '   from Jul 1: $' + shown.toFixed(2));
ok('a longer window is worth more', all>shown, `${all} vs ${shown}`);

console.log('\n━━ Closing the window stops the clock ━━');
await p.fill('#exFrom','2026-07-01'); await p.dispatchEvent('#exFrom','change'); await p.waitForTimeout(400);
await p.fill('#exTo','2026-07-10'); await p.dispatchEvent('#exTo','change'); await p.waitForTimeout(700);
out = (await p.textContent('#exOut')).replace(/\s+/g,' ');
console.log('       ' + out);
const closed = parseFloat(out.match(/\$([\d,]+\.\d\d)/)[1].replace(/,/g,''));
ok('less than the open-ended window', closed<shown, `${closed} vs ${shown}`);
ok('it says through which date', out.includes('through Fri Jul 10'), out);
ok('and drops "and counting"', !out.includes('and counting'), out);

console.log('\n━━ Carrying in what was not withheld before ━━');
await p.fill('#exCarried','900'); await p.dispatchEvent('#exCarried','change'); await p.waitForTimeout(700);
out = (await p.textContent('#exOut')).replace(/\s+/g,' ');
const withC = parseFloat(out.match(/\$([\d,]+\.\d\d)/)[1].replace(/,/g,''));
ok('it is added on', Math.abs(withC-(closed+900))<0.02, `${withC} vs ${(closed+900).toFixed(2)}`);
ok('and shown separately', out.includes('including $900.00 carried in'), out);

console.log('\n━━ Switching it off puts everything away ━━');
await p.click('#exOn'); await p.waitForTimeout(500);
ok('the block closes', !(await p.isVisible('#exBody')));
ok('the summary clears', (await p.textContent('#exEta'))==='');
ok('and the deductions flag follows', await p.evaluate(()=>
  JSON.parse(localStorage.getItem('payclock.v1')).net.fedExempt===false));

console.log('\n━━ It survives a reload ━━');
await p.click('#exOn'); await p.waitForTimeout(600);
await p.reload(); await p.waitForTimeout(800);
await p.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open')));
await p.waitForTimeout(400);
ok('still exempt', await p.isChecked('#exOn'));
ok('dates remembered', (await p.inputValue('#exFrom'))==='2026-07-01', await p.inputValue('#exFrom'));
ok('and the carry-in', (await p.inputValue('#exCarried'))==='900', await p.inputValue('#exCarried'));

console.log('\n━━ On a phone ━━');
await p.close();
const mob = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  deviceScaleFactor:3,timezoneId:'America/Chicago',locale:'en-US'});
p = await boot(mob, seed({fedExempt:true,exemptFrom:'2026-07-01'}), NOW);
const m = await p.evaluate(()=>({
  w:document.documentElement.scrollWidth, win:window.innerWidth,
  f:['exFrom','exTo','exCarried'].map(id=>({
    h:Math.round(document.getElementById(id).getBoundingClientRect().height),
    fs:parseFloat(getComputedStyle(document.getElementById(id)).fontSize)})),
  box:Math.round(document.getElementById('exOut').getBoundingClientRect().right)}));
ok('no sideways scroll', m.w<=m.win+1, `${m.w} vs ${m.win}`);
ok('every field is tappable', m.f.every(x=>x.h>=40), JSON.stringify(m.f));
ok('and none makes iOS zoom', m.f.every(x=>x.fs>=16), JSON.stringify(m.f));
ok('the figure box fits', m.box<=m.win, `${m.box} vs ${m.win}`);

console.log('\n━━ Overtime is in the figure, and it says so ━━');
await p.close();
// Same six weeks, but the last four July days run four hours long.
const otSs = ss.map(s=>{
  const d = new Date(s.start), long = d.getUTCMonth()===6 && [20,21,22,23].includes(d.getUTCDate());
  return long ? {...s, end:s.end + 4*3600e3} : s;
});
const otSeed = seed({fedExempt:true, exemptFrom:'2026-07-01'});
otSeed.sessions = otSs;
p = await boot(ctx, otSeed, NOW);
out = (await p.textContent('#exOut')).replace(/\s+/g,' ');
console.log('       ' + out);
ok('it names the overtime', /overtime included — \d+\.\d\d h of it/.test(out), out);
ok('and there is a real amount of it',
   parseFloat(out.match(/included — ([\d.]+) h/)[1]) > 10, out);
ok('the effective rate is spelled out', /that is \d+\.\d% of the pay/.test(out), out);
const pct = parseFloat(out.match(/that is ([\d.]+)% of the pay/)[1]);
ok('and it is a believable federal rate', pct>5 && pct<18, pct+'%');

// The plain-weeks page had no overtime, so no such line at all.
const plain = await boot(ctx, seed({fedExempt:true, exemptFrom:'2026-07-01'}), NOW);
const plainOut = (await plain.textContent('#exOut')).replace(/\s+/g,' ');
ok('a week with no overtime does not mention it', !plainOut.includes('overtime'), plainOut);
const otFig = parseFloat(out.match(/\$([\d,]+\.\d\d)/)[1].replace(/,/g,''));
const plainFig = parseFloat(plainOut.match(/\$([\d,]+\.\d\d)/)[1].replace(/,/g,''));
ok('overtime raises what was not withheld', otFig>plainFig, `${otFig} vs ${plainFig}`);
await plain.close();
await p.close();

console.log('\n━━ It settles per pay period, it does not tick ━━');
// Walking every pay period of the year is not work a phone should do once a second, so
// the figure is cached until something real changes. On the clock it must hold still.
const tick = await boot(ctx, {...otSeed, activeStart: NOW - 3600e3}, NOW);
const before = await tick.textContent('#exOut');
const t0 = await tick.textContent('#timer');
await tick.clock.fastForward(45000);            // 45 seconds on the clock
await tick.waitForTimeout(500);
ok('the shift timer is running', (await tick.textContent('#timer'))!==t0,
   t0 + ' → ' + await tick.textContent('#timer'));
ok('but 45 s does not move the exempt figure', (await tick.textContent('#exOut'))===before,
   before.replace(/\s+/g,' ').slice(0,58));

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
