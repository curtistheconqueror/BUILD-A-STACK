import { chromium } from 'playwright';
import http from 'node:http'; import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// The app under test sits two directories up from tests/ui/.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
// Set PW_CHROME to point at a specific build; otherwise Playwright finds its own.
const CHROME = process.env.PW_CHROME || undefined;

const R = ROOT, KEY='payclock.v1';
const T={'.html':'text/html','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);
  if(p==='/'||p==='/index.html'){r.writeHead(200,{'Content-Type':'text/html'});return r.end(readFileSync(R+'index.html'));}
  if(p==='/favicon.ico'){r.writeHead(204);return r.end();}
  const f=R+p; if(!existsSync(f)){r.writeHead(404);return r.end('no');}
  r.writeHead(200,{'Content-Type':T[p.slice(p.lastIndexOf('.'))]||'application/octet-stream'});r.end(readFileSync(f));
}).listen(8177);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  deviceScaleFactor:3,timezoneId:'America/Chicago',locale:'en-US'});
const seed={configured:true,cfg:{rate:37.78,otMultiplier:1.5,otMode:'weekly',weeklyThreshold:40,
  periodThreshold:80,dailyThreshold:8,shiftThreshold:8,weekStartDay:0,periodAnchor:'2026-08-01',
  periodLengthDays:14,payDateOffsetDays:13,schedStart:'14:00',schedEnd:'22:30',lunchMins:30,
  workDays:[false,true,true,true,true,true,false]},sessions:[],absences:[],activeStart:null,
  unit:'sec',ui:{open:{}},net:{}};
const p=await ctx.newPage();
p.on('pageerror',e=>{console.log('  PAGE ERROR:',e.message);fails++;});
p.on('console',m=>{if(m.type()==='error'){console.log('  CONSOLE ERROR:',m.text());fails++;}});
await p.addInitScript(([k,v])=>{if(sessionStorage.getItem('__s'))return;
  sessionStorage.setItem('__s','1');localStorage.setItem(k,JSON.stringify(v));},[KEY,seed]);
await p.goto('http://localhost:8177/'); await p.waitForTimeout(700);

console.log('\n━━ The name ━━');
ok('the header reads WiseWage', (await p.textContent('h1'))==='WiseWage', await p.textContent('h1'));
const sub=(await p.textContent('header .sub')).replace(/\s+/g,' ');
ok('the old name is kept in front of the tagline', sub.startsWith('Pay Clock ·'), sub);
ok('and the tagline survives', sub.includes('straight time into overtime'), sub);
ok('the tab title is renamed', (await p.title()).startsWith('WiseWage'), await p.title());
ok('the iOS home-screen name is renamed',
   (await p.getAttribute('meta[name="apple-mobile-web-app-title"]','content'))==='WiseWage');
const mf=await (await fetch('http://localhost:8177/manifest.webmanifest')).json();
ok('the manifest name is renamed', mf.name==='WiseWage' && mf.short_name==='WiseWage', mf.name);

console.log('\n━━ It still looks right on a phone ━━');
const m=await p.evaluate(()=>{const h=document.querySelector('h1'),s=document.querySelector('header .sub'),
  w=document.querySelector('.was');
  return {hw:Math.round(h.getBoundingClientRect().width), win:innerWidth,
    scroll:document.documentElement.scrollWidth,
    subLines:Math.round(s.getBoundingClientRect().height/parseFloat(getComputedStyle(s).lineHeight)),
    wasColor:getComputedStyle(w).color, subColor:getComputedStyle(s).color,
    wasWeight:getComputedStyle(w).fontWeight};});
ok('no sideways scroll', m.scroll<=m.win+1, `${m.scroll} vs ${m.win}`);
ok('the title fits the screen', m.hw<=m.win, `${m.hw} vs ${m.win}`);
ok('the old name is brighter than the tagline', m.wasColor!==m.subColor, m.wasColor+' vs '+m.subColor);
ok('and heavier', +m.wasWeight>=700, m.wasWeight);

console.log('\n━━ Backups made under the old name still restore ━━');
const r=await p.evaluate(()=>{
  const old=JSON.stringify({app:'pay-clock',version:1,sessions:[{id:'x',start:1,end:2}],cfg:{rate:9}});
  const nu =JSON.stringify({app:'wisewage', version:1,sessions:[{id:'y',start:1,end:2}],cfg:{rate:9}});
  const bad=JSON.stringify({app:'something-else',version:1,sessions:[]});
  const seen=[]; const t=window.toast; window.toast=m=>seen.push(m);
  restoreFrom(old); restoreFrom(nu); restoreFrom(bad); window.toast=t;
  return {seen, name:APP_NAME, id:APP_ID};});
ok('a pay-clock backup is not rejected', !/not a .* backup/.test(r.seen[0]||''), r.seen[0]);
ok('a wisewage backup is not rejected',  !/not a .* backup/.test(r.seen[1]||''), r.seen[1]);
ok('a foreign file still is', /not a WiseWage backup/.test(r.seen[2]||''), r.seen[2]);
ok('new backups carry the new id', r.id==='wisewage' && r.name==='WiseWage', r.id);

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close(); process.exit(fails===0?0:1);
