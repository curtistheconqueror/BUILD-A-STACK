/* The shop clock. The machine at work runs a minute or two behind the phone, and it is the
   machine that prints the card — so with the offset on, every punch the app shows is the
   one the machine stamped, while hours and pay stay exactly where they were. */
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
}).listen(8137);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const b=await chromium.launch({executablePath: CHROME});
const T=(d,h,mi=0,s=0)=>Date.UTC(2026,7,d,h+4,mi,s);   // America/New_York, EDT

// Curtis: Sun-Thu, 14:00-22:30, half-hour lunch. Period Sun Aug 9.
const seed=(cfg={})=>({configured:true,cfg:{rate:38,otMultiplier:1.5,otMode:'shift',
  weeklyThreshold:40,periodThreshold:80,dailyThreshold:8,shiftThreshold:8,weekStartDay:0,
  periodAnchor:'2026-08-09',periodLengthDays:14,payDateOffsetDays:13,
  schedStart:'14:00',schedEnd:'22:30',lunchMins:30,
  workDays:[true,true,true,true,true,false,false],holidays:[],banks:[],daysOff:[],
  shiftDayRule:'majority',skewOn:false,skewMins:0,...cfg},
  sessions:[{id:'a',start:T(9,12,15,40),end:T(9,22,30)},
            {id:'b',start:T(10,13,58),end:T(10,23,5)}],
  activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false,ui:{open:{},tc:true}});

async function boot(ctx, st, atMs){
  const p=await ctx.newPage();
  p.on('pageerror',e=>{console.log('  PAGE ERROR:',e.message);fails++;});
  p.on('console',m=>{if(m.type()==='error'){console.log('  CONSOLE ERROR:',m.text());fails++;}});
  await p.addInitScript(([k,v])=>{
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded','1');
    localStorage.setItem(k,JSON.stringify(v));
  },[KEY,st]);
  await p.clock.install({time:new Date(atMs)});
  await p.goto('http://localhost:8137/'); await p.waitForTimeout(650);
  await p.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open')));
  await p.evaluate(()=>{ document.querySelectorAll('#cfg details').forEach(d=>d.open=true); });
  await p.waitForTimeout(400);
  return p;
}
/* Keyed by shift, not by position — the log runs newest first while the claim list runs
   oldest first, and indexing blindly reads the wrong shift. */
const punches = p => p.evaluate(()=>{
  const o = {};
  document.querySelectorAll('#logBody tbody tr[data-row]').forEach(tr=>{
    o[tr.dataset.row] = (tr.querySelector('.c-in')?.textContent||'').trim()
      + ' – ' + (tr.querySelector('.c-out')?.textContent||'').trim();
  });
  return o;
});
const xrows = p => p.evaluate(()=>[...document.querySelectorAll('#xBody .xrow:not(.xhead)')]
  .map(r=>r.querySelector('.xt').textContent.trim()+' | '+r.querySelector('.xb').textContent.trim()));
const totals = p => p.evaluate(()=>({
  hours:[...document.querySelectorAll('#logBody tbody tr')].map(tr=>tr.querySelector('.c-hours')?.textContent.trim()),
  period:document.getElementById('sum_period')?.textContent.trim(),
  ytd:document.getElementById('sum_ytd')?.textContent.trim()}));

const ctx = await b.newContext({viewport:{width:1100,height:2600},timezoneId:'America/New_York',locale:'en-US'});
const NOW = T(12,12);

console.log('\n━━ Off by default, and nothing moves ━━');
let p = await boot(ctx, seed(), NOW);
ok('the toggle is in Settings', await p.isVisible('#cSkewOn'));
ok('and starts off', (await p.inputValue('#cSkewOn'))==='0', await p.inputValue('#cSkewOn'));
ok('at zero minutes', (await p.inputValue('#cSkewMins'))==='0', await p.inputValue('#cSkewMins'));
let note = await p.textContent('#cSkewNote');
ok('saying so plainly', note.includes('exactly what this phone stamped'), note);
const punchOff = await punches(p), xOff = await xrows(p), totOff = await totals(p);
console.log('       punches ' + JSON.stringify(punchOff));
console.log('       claim   ' + JSON.stringify(xOff));
ok('the log shows the phone stamp', punchOff.a.startsWith('12:15 PM'), punchOff.a);
ok('and the claim is 1.75', xOff[0].endsWith('1.75'), xOff[0]);

console.log('\n━━ Two minutes fast: the app shows what the machine printed ━━');
await p.selectOption('#cSkewOn','1'); await p.waitForTimeout(250);
await p.fill('#cSkewMins','2'); await p.dispatchEvent('#cSkewMins','change'); await p.waitForTimeout(500);
await p.evaluate(()=>{ document.querySelectorAll('#cfg details').forEach(d=>d.open=true); });
await p.waitForTimeout(300);
const punchOn = await punches(p), xOn = await xrows(p), totOn = await totals(p);
console.log('       punches ' + JSON.stringify(punchOn));
console.log('       claim   ' + JSON.stringify(xOn));
ok('the 12:15 punch now reads 12:13', punchOn.a.startsWith('12:13 PM'), punchOn.a);
ok('and the clock-out moves with it', punchOn.a.includes('10:28 PM'), punchOn.a);
ok('so the claim grows to 1.78', xOn[0].endsWith('1.78'), xOn[0]);

console.log('\n━━ Hours and pay do not budge ━━');
console.log('       off ' + JSON.stringify(totOff));
console.log('       on  ' + JSON.stringify(totOn));
ok('the hours per shift are unchanged', JSON.stringify(totOff.hours)===JSON.stringify(totOn.hours),
   JSON.stringify(totOff.hours)+' vs '+JSON.stringify(totOn.hours));
ok('the period total is unchanged', totOff.period===totOn.period, totOff.period+' vs '+totOn.period);
ok('and year to date is unchanged', totOff.ytd===totOn.ytd, totOff.ytd+' vs '+totOn.ytd);

console.log('\n━━ It says whose clock you are reading ━━');
note = await p.textContent('#cSkewNote');
console.log('       ' + note);
ok('both clocks, side by side', /this phone reads/.test(note) && /machine reads/.test(note), note);
ok('and it promises the pay is untouched', /hours and pay are untouched/i.test(note), note);
const xs = await p.textContent('#xSched');
console.log('       ' + xs);
ok('the slip section says it too', xs.includes('shop clock'), xs);
ok('naming the direction', xs.includes('2 min behind'), xs);

console.log('\n━━ Nothing stored was rewritten ━━');
const stored = await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).sessions.map(s=>s.start));
ok('the stamps are still the phone\'s', stored[0]===T(9,12,15,40), String(stored[0])+' vs '+T(9,12,15,40));
ok('and the setting saved',
   await p.evaluate(()=>{const c=JSON.parse(localStorage.getItem('payclock.v1')).cfg; return c.skewOn===true&&c.skewMins===2;}));

console.log('\n━━ Turning it back off restores every figure ━━');
await p.selectOption('#cSkewOn','0'); await p.waitForTimeout(500);
ok('the punches come back', JSON.stringify(await punches(p))===JSON.stringify(punchOff));
ok('and so does the claim',  JSON.stringify(await xrows(p))===JSON.stringify(xOff));

console.log('\n━━ What you type is what the machine says ━━');
await p.close();
p = await boot(ctx, seed({skewOn:true,skewMins:2}), NOW);
const trip = await p.evaluate(()=>{
  const s = state.sessions[0];
  const shown = { d: shopDateValue(s.start), t: shopTimeValue(s.start) };
  return { shown: shown, back: shopStamp(shown.d, shown.t), raw: toMinute(s.start) };
});
console.log('       shows ' + JSON.stringify(trip.shown));
ok('a field shows the machine time', trip.shown.t==='12:13', trip.shown.t);
ok('and saving it unchanged puts the same stamp back', trip.back===trip.raw,
   trip.back+' vs '+trip.raw);

console.log('\n━━ A shift edited through the dialog keeps its place ━━');
await p.click('#pickEdit'); await p.waitForTimeout(300);
await p.click('#logBody tbody tr[data-row="a"]'); await p.waitForTimeout(400);
const inShown = await p.inputValue('#eIn');
ok('the editor opens on the machine time', inShown==='12:13', inShown);
await p.click('#eSave'); await p.waitForTimeout(500);
const after = await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).sessions.find(s=>s.id==='a').start);
ok('saving without a change does not drift the punch', after===T(9,12,15,0), String(after)+' vs '+T(9,12,15,0));
ok('and the log still reads 12:13', (await punches(p)).a.startsWith('12:13 PM'), (await punches(p)).a);

console.log('\n━━ Auto clock-in fires so the punch reads the time you asked for ━━');
await p.close();
p = await boot(ctx, {...seed({skewOn:true,skewMins:2}), autoOn:true, autoAt:'13:55',
  autoDays:[true,true,true,true,true,false,false], sessions:[]}, T(12,12));
/* The countdown is to a phone moment, so read the moment itself: set for 13:55 on the
   machine, a phone running 2 min fast has to wait until 13:57 for the punch to read 13:55. */
const fire = await p.evaluate(()=>({ at: autoInAt(Date.now()), shows: ptime(autoInAt(Date.now())) }));
console.log('       fires ' + new Date(fire.at).toString() + ', shows ' + fire.shows);
ok('the phone waits the extra two minutes', fire.at===T(12,13,57), String(fire.at)+' vs '+T(12,13,57));
ok('so the punch reads the time you asked for', fire.shows==='1:55 PM', fire.shows);

console.log('\n━━ A phone that runs slow instead ━━');
await p.close();
p = await boot(ctx, seed({skewOn:true,skewMins:-3}), NOW);
const slow = await xrows(p), slowP = await punches(p);
console.log('       ' + JSON.stringify(slowP) + ' ' + JSON.stringify(slow));
ok('the machine reads later', slowP.a.startsWith('12:18 PM'), slowP.a);
ok('so there is less to claim', slow[0].endsWith('1.70'), slow[0]);
ok('and the note names that direction', (await p.textContent('#xSched')).includes('3 min ahead of'),
   await p.textContent('#xSched'));

console.log('\n━━ Nonsense is refused ━━');
await p.close();
p = await boot(ctx, seed({skewOn:true,skewMins:0}), NOW);
await p.fill('#cSkewMins','400'); await p.dispatchEvent('#cSkewMins','change'); await p.waitForTimeout(400);
ok('a wild offset is clamped', (await p.inputValue('#cSkewMins'))==='30', await p.inputValue('#cSkewMins'));
await p.fill('#cSkewMins','1.6'); await p.dispatchEvent('#cSkewMins','change'); await p.waitForTimeout(400);
ok('and a fraction is rounded to a whole minute', (await p.inputValue('#cSkewMins'))==='2',
   await p.inputValue('#cSkewMins'));
await p.selectOption('#cSkewOn','1'); await p.waitForTimeout(300);
await p.fill('#cSkewMins','0'); await p.dispatchEvent('#cSkewMins','change'); await p.waitForTimeout(400);
await p.evaluate(()=>{ document.querySelectorAll('#cfg details').forEach(d=>d.open=true); }); await p.waitForTimeout(250);
ok('on-but-zero says it does nothing', (await p.textContent('#cSkewNote')).includes('nothing moves'),
   await p.textContent('#cSkewNote'));

console.log('\n━━ On a phone ━━');
await p.close();
const mob = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  deviceScaleFactor:3,timezoneId:'America/New_York',locale:'en-US'});
p = await boot(mob, seed({skewOn:true,skewMins:2}), NOW);
const m = await p.evaluate(()=>({
  pageW:document.documentElement.scrollWidth, winW:window.innerWidth,
  sel:Math.round(document.getElementById('cSkewOn').getBoundingClientRect().height),
  num:Math.round(document.getElementById('cSkewMins').getBoundingClientRect().height),
  fsA:parseFloat(getComputedStyle(document.getElementById('cSkewOn')).fontSize),
  fsB:parseFloat(getComputedStyle(document.getElementById('cSkewMins')).fontSize)
}));
ok('no sideways scroll', m.pageW<=m.winW+1, `${m.pageW} vs ${m.winW}`);
ok('the toggle is tappable', m.sel>=40, `${m.sel}px`);
ok('the minutes box is tappable', m.num>=40, `${m.num}px`);
ok('and neither makes iOS zoom', m.fsA>=16 && m.fsB>=16, `${m.fsA}/${m.fsB}px`);

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
