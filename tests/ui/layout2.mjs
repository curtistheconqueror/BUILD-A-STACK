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
const srv=http.createServer((q,r)=>{const R = ROOT;
 if(q.url.startsWith('/sw.js')){r.writeHead(200,{'Content-Type':'text/javascript'});return r.end(readFileSync(R+'sw.js'));}
 if(q.url.startsWith('/manifest')){r.writeHead(200,{'Content-Type':'application/manifest+json'});return r.end(readFileSync(R+'manifest.webmanifest'));}
 if(q.url.indexOf('.png')>-1){r.writeHead(404);return r.end();}
 r.writeHead(200,{'Content-Type':'text/html'});r.end(readFileSync(R+'index.html'));}).listen(8115);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const openAll=async pg=>{ try{ await pg.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open'))); }catch(e){} };
const b=await chromium.launch({executablePath: CHROME});
const D=(d,h,mi=0)=>Date.UTC(2026,7,d,h+4,mi);   // August 2026, America/New_York

const base={configured:true,cfg:{rate:38,otMultiplier:1.5,otMode:'weekly',weeklyThreshold:40,
  periodThreshold:80,dailyThreshold:8,weekStartDay:0,periodAnchor:'2026-08-02',
  periodLengthDays:14,payDateOffsetDays:13,schedStart:'14:00',schedEnd:'22:30'},
  sessions:[{id:'a',start:D(10,12,33),end:D(10,23,3)}],
  activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false};

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
  await p.goto('http://localhost:8115/'); await p.waitForTimeout(500); await openAll(p);
  return p;
}
const order = p => p.evaluate(()=>[...document.querySelectorAll('.wrap > section.card')]
  .filter(s=>!s.classList.contains('hide')).map(s=>s.id));
const ctx = await b.newContext({viewport:{width:1100,height:2400},timezoneId:'America/New_York',locale:'en-US'});

console.log('\n━━ The sections sit where they were asked to ━━');
let p = await boot(ctx, base, D(11,12));
let ids = await order(p);
console.log('       ' + ids.join(' → '));
const at = id => ids.indexOf(id);
ok('Pay period now comes before Pay period progress', at('period') < at('progress'),
   `period ${at('period')}, progress ${at('progress')}`);
ok('and both still sit under Earnings', at('totals') < at('period'));
ok('Year to date has moved below the decimal section', at('ytd') > at('extra'),
   `extra ${at('extra')}, ytd ${at('ytd')}`);
ok('which is still after the shift log', at('extra') > at('log'));
ok('the calculator is still last before Settings', at('calc') === ids.length-2 || at('calc') > at('ytd'));

console.log('\n━━ The section is renamed ━━');
let h = await p.textContent('#extra h2');
ok('titled Decimal Time Conversion', h.includes('Decimal Time Conversion'), h.trim());
ok('and says what it is for', h.includes('OT sheets'), h.trim());

console.log('\n━━ The chart is folded away until asked for ━━');
ok('the chart is hidden on a first visit', !(await p.isVisible('#xChart')));
ok('but the button that opens it is there', await p.isVisible('#xChartBtn'));
ok('and says so', (await p.getAttribute('#xChartBtn','aria-expanded'))==='false');
await p.click('#xChartBtn'); await p.waitForTimeout(250);
ok('pressing it shows the chart', await p.isVisible('#xChart'));
ok('and the button flips its state', (await p.getAttribute('#xChartBtn','aria-expanded'))==='true');
ok('pressing the chart header did not fold the whole section',
   await p.isVisible('#extra .colbody') && (await p.locator('#extra').getAttribute('class')).includes('open'));

console.log('\n━━ Every figure on the chart ━━');
const chart = await p.evaluate(()=>[...document.querySelectorAll('#xChart .chartrow')]
  .map(r=>({m:+r.querySelector('.m').textContent, h:r.querySelector('.h').textContent})));
ok('sixty minutes are listed', chart.length===60, String(chart.length));
ok('in order, 1 through 60', chart.every((r,i)=>r.m===i+1), JSON.stringify(chart.slice(0,3)));
// the printed PACE chart, spot-checked against the values Curtis sent
const KNOWN = {1:'0.02',5:'0.08',7:'0.12',15:'0.25',22:'0.37',30:'0.50',
               38:'0.63',45:'0.75',47:'0.78',52:'0.87',59:'0.98',60:'1.00'};
let bad=[];
for (const [m,v] of Object.entries(KNOWN)){
  const row = chart.find(r=>r.m===+m);
  if (!row || row.h!==v) bad.push(`${m}min→${row?row.h:'missing'} want ${v}`);
}
ok('every value matches the printed chart', bad.length===0, bad.join(', '));
ok('the whole column reads minutes ÷ 60 to two places',
   chart.every(r=>r.h===(Math.round(r.m/60*100)/100).toFixed(2)));

console.log('\n━━ The chart and the totals cannot drift apart ━━');
// 12:33 → 14:00 is 1 h 27 min before; 22:30 → 23:03 is 33 min after.
const body = await p.textContent('#xBody');
ok('the shift is priced from the same rounding', body.includes('1.45') && body.includes('0.55'),
   body.replace(/\s+/g,' ').slice(0,200));
ok('and the total is the two added', body.includes('2.00'), body.replace(/\s+/g,' ').slice(-160));

console.log('\n━━ Pressing again hides it, and the choice sticks ━━');
await p.click('#xChartBtn'); await p.waitForTimeout(250);
ok('hidden again', !(await p.isVisible('#xChart')));
await p.click('#xChartBtn'); await p.waitForTimeout(200);
await p.reload(); await p.waitForTimeout(500); await openAll(p);
ok('still open after a reload', await p.isVisible('#xChart'));

console.log('\n━━ Auto clock-in: the setting ━━');
await p.close();
p = await boot(ctx, base, D(12,13));      // 1 PM, before the 2 PM start
ok('sits above auto-stop', await p.evaluate(()=>{
  const a=document.getElementById('autoOn').closest('.planrow');
  const b=document.getElementById('planOn').closest('.planrow');
  return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); }));
ok('off to begin with', !(await p.isChecked('#autoOn')));
ok('the day picker stays out of the way until it is on', !(await p.isVisible('#autoDays')));
await p.check('#autoOn'); await p.waitForTimeout(250);
ok('turning it on reveals the days', await p.isVisible('#autoDays'));
ok('every day is on to start with',
   (await p.locator('#autoDays button.on').count())===7,
   String(await p.locator('#autoDays button.on').count()));
await p.fill('#autoAt','14:00'); await p.locator('#autoAt').blur(); await p.waitForTimeout(300);
ok('it counts down to the start', (await p.textContent('#autoEta')).includes('starts in'),
   await p.textContent('#autoEta'));
ok('nothing has started yet', !(await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).jobs[0].activeStart)));

console.log('\n━━ It starts the shift when the time arrives ━━');
await p.clock.fastForward('01:05:00'); await p.waitForTimeout(600);
let st = await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')));
ok('the clock is running', !!st.jobs[0].activeStart);
ok('started at 2:00, not at 3:05', new Date(st.jobs[0].activeStart).getUTCHours()===18,
   new Date(st.jobs[0].activeStart).toISOString());
ok('and it says it started itself', await p.isVisible('#autoConfirm'));
ok('naming the time', (await p.textContent('#autoTxt')).includes('2:00 PM'), await p.textContent('#autoTxt'));

console.log('\n━━ Opening the app late still gets the earlier minutes ━━');
await p.close();
// app opened at 3:47 PM with a 2:00 PM start it never saw
p = await boot(ctx, {...base, autoOn:true, autoAt:'14:00'}, D(13,15,47));
st = await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')));
ok('the clock is already running on open', !!st.jobs[0].activeStart);
ok('backdated to 2:00 PM', new Date(st.jobs[0].activeStart).getUTCHours()===18 && new Date(st.jobs[0].activeStart).getUTCMinutes()===0,
   new Date(st.jobs[0].activeStart).toISOString());
ok('the timer shows 1:47, not 0:00', (await p.textContent('#timer')).startsWith('01:47'),
   await p.textContent('#timer'));
ok('the notice explains the gap', (await p.textContent('#autoTxt')).includes('1:47'),
   await p.textContent('#autoTxt'));

console.log('\n━━ Undo puts it back ━━');
await p.click('#autoUndo'); await p.waitForTimeout(300);
st = await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')));
ok('clocked out again', !st.jobs[0].activeStart);
ok('and nothing was banked', st.sessions.length===base.sessions.length, String(st.sessions.length));
ok('the notice is gone', !(await p.isVisible('#autoConfirm')));
await p.waitForTimeout(600);
ok('it does not immediately start again', !(await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).jobs[0].activeStart)));

console.log('\n━━ It will not resurrect a day that is already over ━━');
await p.close();
// 11 PM, nine hours past a 2 PM start — that shift is finished, not starting
p = await boot(ctx, {...base, autoOn:true, autoAt:'14:00', sessions:[]}, D(13,23));
ok('no shift is started', !(await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).jobs[0].activeStart)));
ok('and no notice is shown', !(await p.isVisible('#autoConfirm')));

console.log('\n━━ It stands down when the day is already logged ━━');
await p.close();
p = await boot(ctx, {...base, autoOn:true, autoAt:'14:00',
  sessions:[{id:'done',start:D(13,13,50),end:D(13,17)}]}, D(13,17,30));
ok('a shift already covering 2 PM means nothing is started',
   !(await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).jobs[0].activeStart)));
ok('and the logged shift is untouched',
   (await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).sessions.length))===1);

console.log('\n━━ A day it is switched off for is left alone ━━');
await p.close();
// Aug 14 2026 is a Friday — turn Friday off
p = await boot(ctx, {...base, autoOn:true, autoAt:'14:00', sessions:[],
  autoDays:[true,true,true,true,true,false,true]}, D(14,15));
ok('Friday off means no shift', !(await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).jobs[0].activeStart)));
await p.close();
p = await boot(ctx, {...base, autoOn:true, autoAt:'14:00', sessions:[],
  autoDays:[true,true,true,true,true,false,true]}, D(13,15));   // Thursday, still on
ok('Thursday on means it starts', !!(await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).jobs[0].activeStart)));

console.log('\n━━ Switching it on mid-afternoon does not reach backwards ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[]}, D(12,20));       // 8 PM
await p.check('#autoOn'); await p.waitForTimeout(200);
await p.fill('#autoAt','14:00'); await p.locator('#autoAt').blur(); await p.waitForTimeout(600);
ok('no shift is invented for six hours ago',
   !(await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).jobs[0].activeStart)));
ok('today is marked as handled',
   (await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).autoLast))==='2026-08-12',
   await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).autoLast));

console.log('\n━━ Auto-stop still works alongside it ━━');
await p.close();
p = await boot(ctx, {...base, autoOn:true, autoAt:'14:00', sessions:[],
  planOn:true, plannedHours:8}, D(13,13,55));
await p.clock.fastForward('00:10:00'); await p.waitForTimeout(500);
ok('auto clock-in started the shift', !!(await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).jobs[0].activeStart)));
await p.clock.fastForward('08:10:00'); await p.waitForTimeout(700);
st = await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')));
ok('auto-stop ended it at the 8 h target', !st.jobs[0].activeStart && st.sessions.length===1,
   JSON.stringify(st.sessions));
ok('and banked exactly 8 h', st.sessions.length===1 &&
   Math.abs((st.sessions[0].end-st.sessions[0].start)/3600000 - 8) < 0.01,
   st.sessions.length ? String((st.sessions[0].end-st.sessions[0].start)/3600000) : 'none');

console.log('\n━━ It survives a reload and a backup ━━');
await p.close();
p = await boot(ctx, {...base, autoOn:true, autoAt:'14:00',
  autoDays:[true,true,true,true,true,false,false]}, D(12,10));
await p.reload(); await p.waitForTimeout(500); await openAll(p);
ok('still on after a reload', await p.isChecked('#autoOn'));
ok('still 14:00', (await p.inputValue('#autoAt'))==='14:00', await p.inputValue('#autoAt'));
ok('and Fri/Sat still off', (await p.locator('#autoDays button.on').count())===5,
   String(await p.locator('#autoDays button.on').count()));

console.log('\n━━ On a phone ━━');
await p.close();
const mob = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  deviceScaleFactor:3,timezoneId:'America/New_York',locale:'en-US'});
p = await boot(mob, {...base, autoOn:true, autoAt:'14:00'}, D(12,10));
await p.click('#xChartBtn'); await p.waitForTimeout(300);
const m = await p.evaluate(()=>{
  const g=document.querySelector('#xChart .chartgrid');
  const r=document.querySelector('#xChart .chartrow');
  return { cols:getComputedStyle(g).gridTemplateColumns.split(' ').length,
           pageW:document.documentElement.scrollWidth, winW:window.innerWidth,
           rowW:Math.round(r.getBoundingClientRect().width),
           btnH:Math.round(document.getElementById('xChartBtn').getBoundingClientRect().height),
           timeH:Math.round(document.getElementById('autoAt').getBoundingClientRect().height),
           timeFs:parseFloat(getComputedStyle(document.getElementById('autoAt')).fontSize) };
});
ok('the chart drops to two columns', m.cols===2, String(m.cols));
ok('the page still does not scroll sideways', m.pageW<=m.winW+1, `${m.pageW} vs ${m.winW}`);
ok('a chart row is readable', m.rowW>=120, `${m.rowW}px`);
ok('the chart button is a real tap target', m.btnH>=40, `${m.btnH}px`);
ok('the time field will not make iOS zoom', m.timeFs>=16, `${m.timeFs}px`);
ok('and is tappable', m.timeH>=40, `${m.timeH}px`);
const dayBtns = await p.evaluate(()=>[...document.querySelectorAll('#autoDays button')]
  .map(b=>Math.round(b.getBoundingClientRect().height)));
ok('so are the day buttons', dayBtns.every(h=>h>=28), JSON.stringify(dayBtns));

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
