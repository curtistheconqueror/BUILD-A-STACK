/* Appearance: text size, water, colour cycling, and a colour per section. */
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
}).listen(8186);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const b=await chromium.launch({executablePath: CHROME});
const T=(d,h)=>Date.UTC(2026,7,d,h+5,0);
const seed={configured:true,cfg:{rate:37.78,otMultiplier:1.5,otMode:'weekly',weeklyThreshold:40,
  periodThreshold:80,dailyThreshold:8,shiftThreshold:8,weekStartDay:0,periodAnchor:'2026-08-09',
  periodLengthDays:14,payDateOffsetDays:13,schedStart:'14:00',schedEnd:'22:30',lunchMins:30,
  workDays:[true,true,true,true,true,false,false]},
  sessions:[{id:'a',start:T(10,14),end:T(10,22)+30*60000}],absences:[],activeStart:null,
  unit:'sec',ui:{open:{}},net:{}};
const ctx=await b.newContext({viewport:{width:390,height:900},isMobile:true,hasTouch:true,
  deviceScaleFactor:3,timezoneId:'America/Chicago',locale:'en-US'});
const p=await ctx.newPage();
p.on('pageerror',e=>{console.log('  PAGE ERROR:',e.message);fails++;});
p.on('console',m=>{if(m.type()==='error'){console.log('  CONSOLE ERROR:',m.text());fails++;}});
await p.addInitScript(([k,v])=>{if(sessionStorage.getItem('__s'))return;
  sessionStorage.setItem('__s','1');localStorage.setItem(k,JSON.stringify(v));},[KEY,seed]);
await p.clock.install({time:new Date(T(12,16))});
await p.goto('http://localhost:8186/'); await p.waitForTimeout(700);
const openCfg=async()=>{await p.evaluate(()=>{document.querySelectorAll('#cfg details').forEach(d=>d.open=true);});
  await p.waitForTimeout(350);};
await openCfg();

console.log('\n━━ The section-heading colour was already there ━━');
const keys=await p.$$eval('#swatches input[data-tk]',es=>es.map(e=>e.dataset.tk));
ok('a swatch for section titles exists', keys.includes('sect'), keys.join(','));

console.log('\n━━ Text size ━━');
const h0=await p.evaluate(()=>Math.round(document.querySelector('h1').getBoundingClientRect().height));
await p.selectOption('#tSize','1.5'); await p.waitForTimeout(500);
const z=await p.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--tzoom').trim());
const h1=await p.evaluate(()=>Math.round(document.querySelector('h1').getBoundingClientRect().height));
ok('the zoom variable is set', z==='1.5', z);
ok('and everything genuinely gets bigger', h1>h0*1.3, `${h0}px → ${h1}px`);
const wide=await p.evaluate(()=>({w:document.documentElement.scrollWidth,win:innerWidth}));
ok('without breaking the page sideways', wide.w<=wide.win+1, `${wide.w} vs ${wide.win}`);
await p.selectOption('#tSize','1'); await p.waitForTimeout(400);

console.log('\n━━ Water ━━');
await p.selectOption('#tBgStyle','water'); await p.waitForTimeout(500);
const w=await p.evaluate(()=>{const c=document.getElementById('totals'),s=getComputedStyle(c);
  return {cls:document.body.className, blur:s.backdropFilter||s.webkitBackdropFilter,
    radius:s.borderTopLeftRadius, shadow:s.boxShadow,
    glint:getComputedStyle(c,'::before').animationName};});
ok('the body carries the water class', /\bwater\b/.test(w.cls), w.cls);
/* Deliberately modest — the heavy blur cost more than half the frame rate, and the water
   is carried by the caustics rather than by how hard the GPU is working. */
ok('cards get a backdrop blur', /blur\(9px\)/.test(w.blur), w.blur);
ok('and a rounder edge', parseFloat(w.radius)>=20, w.radius);
ok('with an inner rim light', /inset/.test(w.shadow), w.shadow.slice(0,52)+'…');
ok('it is not just flat mode', !/\bflat\b/.test(w.cls), w.cls);

// Caustics: two noise layers, drifting opposite ways, moved by transform rather than by
// background-position — the whole reason this runs at frame rate.
const c=await p.evaluate(()=>{const e=document.getElementById('totals');
  const a=getComputedStyle(e,'::before'), b=getComputedStyle(e,'::after');
  return {an:a.animationName, bn:b.animationName, aimg:a.backgroundImage.slice(0,24),
    bimg:b.backgroundImage.slice(0,24), height:a.height,
    will:a.willChange, opacity:a.opacity};});
ok('two caustic layers drift', c.an==='drift1' && c.bn==='drift2', c.an+' / '+c.bn);
ok('both are generated noise, not fetched', /data:image\/svg/.test(c.aimg)&&/data:image\/svg/.test(c.bimg));
ok('they are promoted for the compositor', /transform/.test(c.will), c.will);
ok('and sit under the readable content',
   (await p.evaluate(()=>getComputedStyle(document.querySelector('#totals>*')).zIndex))==='1');

// The clock card is deliberately exempt from the backdrop filter: it repaints every second.
const hero=await p.evaluate(()=>{const s=getComputedStyle(document.getElementById('hero'));
  return s.backdropFilter||s.webkitBackdropFilter;});
ok('the live clock card takes no backdrop filter', /none/.test(hero), hero);

console.log('\n━━ Water depth ━━');
await openCfg();
ok('the depth control appears only in water mode', await p.isVisible('#tWater'));
const op=async()=>p.evaluate(()=>getComputedStyle(document.getElementById('totals'),'::before').opacity);
await p.selectOption('#tWater','calm'); await p.waitForTimeout(400);
const calm=await op();
await p.selectOption('#tWater','deep'); await p.waitForTimeout(400);
const deep=await op();
ok('deep is stronger than calm', parseFloat(deep)>parseFloat(calm), calm+' → '+deep);
ok('and even deep stays out of the way', parseFloat(deep)<=0.45, deep);
await p.selectOption('#tBgStyle','glow'); await p.waitForTimeout(400);
await openCfg();
ok('the depth control hides again off water', !(await p.isVisible('#tWater')));
await p.selectOption('#tBgStyle','water'); await p.waitForTimeout(400);

console.log('\n━━ Colour cycling ━━');
for (const [mode, cls] of [['cycle','rgb-cycle'],['wave','rgb-wave'],['pulse','rgb-pulse']]){
  await p.selectOption('#tRgb',mode); await p.waitForTimeout(400);
  const got=await p.evaluate(()=>document.body.className);
  ok('"'+mode+'" applies its class', got.includes(cls), got);
}
await p.selectOption('#tRgb','wave'); await p.waitForTimeout(500);
const hues=await p.evaluate(()=>[...document.querySelectorAll('.card')].slice(0,4)
  .map(c=>getComputedStyle(c).getPropertyValue('--hoff').trim()));
ok('wave offsets each card', new Set(hues).size>1, hues.join(','));
await p.selectOption('#tRgb',''); await p.waitForTimeout(400);
ok('and "still" clears them all',
   !/rgb-/.test(await p.evaluate(()=>document.body.className)),
   await p.evaluate(()=>document.body.className));

console.log('\n━━ A colour per section ━━');
await openCfg();
const rows=await p.$$eval('#secCols input[data-sec]',es=>es.map(e=>e.dataset.sec));
ok('every section and settings group has a row', rows.length===18, rows.length+': '+rows.join(','));
ok('Settings is one of them', rows.includes('cfg'));
ok('and so are the settings groups', rows.includes('gPay')&&rows.includes('gData'));
await p.evaluate(()=>{const i=document.querySelector('#secCols input[data-sec="totals"]');
  i.value='#ff00aa'; i.dispatchEvent(new Event('input',{bubbles:true}));});
await p.waitForTimeout(500);
const one=await p.evaluate(()=>{const e=document.getElementById('totals');
  return {sect:e.style.getPropertyValue('--c-sect'), ca:e.style.getPropertyValue('--ca'),
    other:document.getElementById('log').style.getPropertyValue('--c-sect')};});
ok('the chosen section takes the colour', one.sect==='#ff00aa', one.sect);
ok('its left rail follows the heading', one.ca==='#ff00aa', one.ca);
ok('and no other section moved', one.other==='', JSON.stringify(one.other));
const stored=await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).theme.sections);
ok('it is remembered', stored && stored.totals==='#ff00aa', JSON.stringify(stored));
await p.reload(); await p.waitForTimeout(800);
ok('and survives a reload',
   (await p.evaluate(()=>document.getElementById('totals').style.getPropertyValue('--c-sect')))==='#ff00aa');
await openCfg();
await p.click('#secColsReset'); await p.waitForTimeout(500);
ok('reset puts them all back',
   (await p.evaluate(()=>document.getElementById('totals').style.getPropertyValue('--c-sect')))==='');

console.log('\n━━ Everything survives together ━━');
await p.selectOption('#tSize','1.3'); await p.selectOption('#tBgStyle','water');
await p.selectOption('#tRgb','wave'); await p.selectOption('#tFont','Georgia, \'Times New Roman\', serif');
await p.waitForTimeout(600);
const all=await p.evaluate(()=>({cls:document.body.className,
  w:document.documentElement.scrollWidth,win:innerWidth,
  font:getComputedStyle(document.body).fontFamily}));
ok('water, wave, large text and a serif at once', /water/.test(all.cls)&&/rgb-wave/.test(all.cls), all.cls);
ok('still no sideways scroll', all.w<=all.win+1, `${all.w} vs ${all.win}`);
ok('and the font applied', /Georgia/.test(all.font), all.font);

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close(); process.exit(fails===0?0:1);
