/* The hospital rule: over 8 in a day OR over 80 in the period, no hour counted twice. */
import { chromium } from 'playwright';
import http from 'node:http'; import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// The app under test sits two directories up from tests/ui/.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
// Set PW_CHROME to point at a specific build; otherwise Playwright finds its own.
const CHROME = process.env.PW_CHROME || undefined;

const R = ROOT, KEY='payclock.v1';
const TY={'.html':'text/html','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);
  if(p==='/'||p==='/index.html'){r.writeHead(200,{'Content-Type':'text/html'});return r.end(readFileSync(R+'index.html'));}
  if(p==='/favicon.ico'){r.writeHead(204);return r.end();}
  const f=R+p; if(!existsSync(f)){r.writeHead(404);return r.end('no');}
  r.writeHead(200,{'Content-Type':TY[p.slice(p.lastIndexOf('.'))]||'application/octet-stream'});r.end(readFileSync(f));
}).listen(8181);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:2400},isMobile:true,hasTouch:true,
  deviceScaleFactor:3,timezoneId:'America/Chicago',locale:'en-US'});
const T=(d,h)=>Date.UTC(2026,7,d,h+5,0);                 // America/Chicago, CDT
// Six twelve-hour days across the period: 72 hours, 24 of them overtime under 8/80.
const ss=[9,10,11,16,17,18].map(d=>({id:'s'+d,start:T(d,7),end:T(d,19)}));
const seed=(mode)=>({configured:true,cfg:{rate:40,otMultiplier:1.5,otMode:mode,
  weeklyThreshold:40,periodThreshold:80,dailyThreshold:8,shiftThreshold:8,weekStartDay:0,
  periodAnchor:'2026-08-09',periodLengthDays:14,payDateOffsetDays:13,
  schedStart:'07:00',schedEnd:'19:00',lunchMins:0,
  workDays:[true,true,true,false,false,false,true],holidays:[],banks:[],daysOff:[],vacations:[],
  shiftDayRule:'majority',skewOn:false,makeUpOn:false,nightOn:false},
  sessions:ss,absences:[],activeStart:null,unit:'sec',ui:{open:{}},net:{}});
async function boot(mode, at){
  const p=await ctx.newPage();
  p.on('pageerror',e=>{console.log('  PAGE ERROR:',e.message);fails++;});
  p.on('console',m=>{if(m.type()==='error'){console.log('  CONSOLE ERROR:',m.text());fails++;}});
  await p.addInitScript(([k,v])=>{if(sessionStorage.getItem('__s'))return;
    sessionStorage.setItem('__s','1');localStorage.setItem(k,JSON.stringify(v));},[KEY,seed(mode)]);
  await p.clock.install({time:new Date(at)});
  await p.goto('http://localhost:8181/'); await p.waitForTimeout(700);
  await p.evaluate(()=>{document.querySelectorAll('.col').forEach(c=>c.classList.add('open'));
    document.querySelectorAll('#cfg details').forEach(d=>d.open=true);});
  await p.waitForTimeout(400); return p;
}
const NOW=T(22,12);

console.log('\n━━ The mode is offered ━━');
let p=await boot('weekly', NOW);
const opts=await p.$$eval('#cMode option',os=>os.map(o=>o.value));
ok('Settings lists it', opts.includes('eighty80'), opts.join(','));
const setup=await p.$$eval('#sMode button',bs=>bs.map(b=>b.dataset.m));
ok('and first-run setup offers it', setup.includes('eighty80'), setup.join(','));
const lbl=await p.$eval('#sMode button[data-m="eighty80"]',b=>b.textContent);
ok('it names who may lawfully use it', /hospital/i.test(lbl) && /agreement/i.test(lbl), lbl.slice(0,90));

console.log('\n━━ Six twelve-hour days: 72 hours ━━');
const weekly=await p.evaluate(()=>{
  const l=buildLedger(state.sessions,state.cfg,Date.now());
  const t=sumRange(l.parts, +ymd('2026-08-09'), +ymd('2026-08-23'));
  return {h:t.hours, ot:t.otHours, g:t.gross};});
ok('under a 40-hour week that is 72 hours', Math.abs(weekly.h-72)<0.01, weekly.h);
ok('and not one hour of overtime', weekly.ot===0, weekly.ot);
await p.close();

p=await boot('eighty80', NOW);
const e80=await p.evaluate(()=>{
  const l=buildLedger(state.sessions,state.cfg,Date.now());
  const t=sumRange(l.parts, +ymd('2026-08-09'), +ymd('2026-08-23'));
  return {h:t.hours, ot:t.otHours, reg:t.regHours, g:t.gross};});
ok('under 8 and 80 the same shifts are still 72 hours', Math.abs(e80.h-72)<0.01, e80.h);
ok('but 24 of them are overtime', Math.abs(e80.ot-24)<0.01, e80.ot);
ok('straight time is the other 48', Math.abs(e80.reg-48)<0.01, e80.reg);
ok('worth $480 more a period', Math.abs((e80.g-weekly.g)-480)<0.01,
   '$'+(e80.g-weekly.g).toFixed(2));

console.log('\n━━ The screen says so ━━');
const lblOt=await p.textContent('#otLbl');
ok('the bar names both thresholds', /8 h/.test(lblOt) && /80 h this period/.test(lblOt), lblOt);
/* The period bar has to describe 8 and 80 as the rule in force, not as a milestone
   belonging to some other rule you could switch to. */
const p80=(await p.textContent('#p80Note')).replace(/\s+/g,' ');
ok('the period bar states the other half of the rule', /80|straight time/.test(p80), p80);
ok('and never tells you to switch to what you already have',
   !/switch/i.test(p80), p80);
ok('it names the daily half too', /pass 8 h|whatever the day says/.test(p80), p80);
const per=(await p.textContent('#pGross'));
ok('the period tile still shows money', /\$\d/.test(per), per);

console.log('\n━━ Switching modes is live and reversible ━━');
await p.selectOption('#cMode','weekly'); await p.waitForTimeout(600);
const back=await p.evaluate(()=>{const l=buildLedger(state.sessions,state.cfg,Date.now());
  return sumRange(l.parts, +ymd('2026-08-09'), +ymd('2026-08-23')).otHours;});
ok('switching back to weekly drops the overtime again', back===0, back);
await p.selectOption('#cMode','eighty80'); await p.waitForTimeout(600);
const again=await p.evaluate(()=>{const l=buildLedger(state.sessions,state.cfg,Date.now());
  return sumRange(l.parts, +ymd('2026-08-09'), +ymd('2026-08-23')).otHours;});
ok('and switching back returns it', Math.abs(again-24)<0.01, again);
ok('the choice is remembered', await p.evaluate(()=>
  JSON.parse(localStorage.getItem('payclock.v1')).jobs[0].cfg.otMode)==='eighty80');

console.log('\n━━ On a phone ━━');
const m=await p.evaluate(()=>({w:document.documentElement.scrollWidth,win:innerWidth}));
ok('no sideways scroll', m.w<=m.win+1, `${m.w} vs ${m.win}`);

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close(); process.exit(fails===0?0:1);
