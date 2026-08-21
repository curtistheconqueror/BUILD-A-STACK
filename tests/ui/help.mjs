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
}).listen(8210);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const b=await chromium.launch({executablePath: CHROME});

const jul=(d,h)=>+new Date(2026,6,d,h);
const seed={configured:true,
  cfg:{rate:38,periodAnchor:'2026-07-26',otMode:'period',periodLengthDays:14,payDateOffsetDays:13,weekStartDay:0},
  sessions:[{id:'a',start:jul(28,9),end:jul(28,17)},{id:'b',start:jul(29,9),end:jul(29,19)}],
  activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false};

async function boot(ctx){
  const p=await ctx.newPage();
  p.on('pageerror',e=>{console.log('  💥',e.message);fails++;});
  p.on('console',m=>{if(m.type()==='error'){console.log('  💥',m.text());fails++;}});
  await p.addInitScript(([k,v])=>{if(sessionStorage.getItem('__s'))return;sessionStorage.setItem('__s','1');
    localStorage.setItem(k,JSON.stringify(v));},[KEY,seed]);
  await p.goto('http://localhost:8210/');
  await p.waitForFunction(()=>typeof state!=='undefined',null,{timeout:15000});
  await p.waitForTimeout(400);
  await p.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open')));
  return p;
}

const desk=await b.newContext({timezoneId:'America/New_York',locale:'en-US',viewport:{width:900,height:1600}});
let p=await boot(desk);

console.log('\n━━ Every question mark opens something that exists ━━');
/* The failure this guards against is silent: a ? wired to a topic that was renamed or
   never written opens the fallback topic, which looks like help and answers the wrong
   question. */
{
  const missing = await p.evaluate(()=>[...document.querySelectorAll('[data-help]')]
    .map(x=>x.dataset.help).filter(k=>!HELP[k]));
  ok('no button points at a missing topic', missing.length===0, missing.join(','));
  const n = await p.locator('[data-help]').count();
  ok('and there are buttons to press', n>10, String(n));
}

console.log('\n━━ Every topic can be reached without browsing ━━');
/* A topic only reachable from the index is a topic nobody finds when they need it. */
{
  const orphans = await p.evaluate(()=>{
    const reach=new Set([...document.querySelectorAll('[data-help]')].map(x=>x.dataset.help));
    return Object.keys(HELP).filter(k=>!reach.has(k));
  });
  ok('no topic is index-only', orphans.length===0, orphans.join(','));
}

console.log('\n━━ Opening help does not fold the section underneath it ━━');
/* Section headers toggle the fold on click. Without stopPropagation the ? would answer
   the question and collapse the thing being asked about in the same tap. */
{
  const before = await p.evaluate(()=>document.getElementById('log').classList.contains('open'));
  await p.locator('#log .helpq').click(); await p.waitForTimeout(300);
  ok('the sheet opens', await p.isVisible('#helpSheet'));
  ok('on the topic that was asked for', (await p.textContent('#helpBody h3')).includes('shift log'),
     await p.textContent('#helpBody h3'));
  ok('and the section is still open',
     (await p.evaluate(()=>document.getElementById('log').classList.contains('open')))===before);
}

console.log('\n━━ It doubles as a manual ━━');
{
  const listed = await p.locator('[data-helpgo]').count();
  const total = await p.evaluate(()=>Object.keys(HELP).length);
  ok('every other topic is listed', listed===total-1, listed+' of '+total);
  await p.locator('[data-helpgo="otmode"]').click(); await p.waitForTimeout(300);
  ok('and any of them can be jumped to',
     (await p.textContent('#helpBody h3')).includes('overtime rule'), await p.textContent('#helpBody h3'));
  ok('the topic just left is no longer in its own index',
     (await p.locator('[data-helpgo="otmode"]').count())===0);
}

console.log('\n━━ The overtime rules are all explained, because that one costs money ━━');
{
  const dts = await p.locator('#helpBody dt').count();
  ok('all six rules are described', dts===6, String(dts));
  const body = (await p.textContent('#helpBody')).replace(/\s+/g,' ');
  ok('including that a per-shift rule ignores the week',
     /over 40 in the week earns you nothing extra/i.test(body), body.slice(0,80));
}

console.log('\n━━ The words match the app they describe ━━');
/* Three topics shipped wrong in the first draft: the calculator was said to apply your
   overtime rule when it only applies your multiplier, the production model was described
   with the salaried model's vocabulary, and the earnings card was said to show "this shift"
   when it is labelled Today. Prose is not self-checking, so anchor it to the screen. */
{
  /* The previous block left the sheet open, and it is a modal — its backdrop swallows any
     tap meant for the page underneath. */
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  await p.locator('#totals .helpq').click(); await p.waitForTimeout(300);
  const earn = (await p.textContent('#helpBody')).replace(/\s+/g,' ');
  /* The tile captions themselves — read from the card so a rename there fails this rather
     than leaving the help quietly describing a screen that no longer says that. */
  const cardLabels = await p.evaluate(()=>[...document.querySelectorAll('#totals .tgrid .tile .k')]
    .map(e=>e.textContent.trim().toLowerCase()));
  ok('the card has its three captions', cardLabels.length===3, cardLabels.join('|'));
  ok('the earnings topic names the periods the card actually shows',
     !/this shift/i.test(earn) && /today/i.test(earn), earn.slice(0,110));
  /* Matched on the stem, not the whole caption: the middle tile is relabelled with the live
     week ("Week of Sun Aug 16"), and prose cannot be expected to track a date. */
  ok('and the three spans it names are the three the card shows',
     ['today','week','period'].every(w=>earn.toLowerCase().includes(w)),
     cardLabels.join('|'));

  await p.locator('[data-helpgo="calc"]').click(); await p.waitForTimeout(300);
  const calc = (await p.textContent('#helpBody')).replace(/\s+/g,' ');
  ok('the calculator topic does not claim to apply the overtime rule',
     !/at your rate and your overtime rule/i.test(calc), calc.slice(0,140));
  ok('and says which part you decide', /you decide|you say how many/i.test(calc), calc.slice(0,160));

  await p.locator('[data-helpgo="units"]').click(); await p.waitForTimeout(300);
  const units = (await p.textContent('#helpBody')).replace(/\s+/g,' ');
  ok('the production topic uses its own model’s words, not the salaried one’s',
     !/stipend/i.test(units) && /threshold/i.test(units), units.slice(0,160));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
}

console.log('\n━━ It closes the ways people expect ━━');
await p.keyboard.press('Escape'); await p.waitForTimeout(250);
ok('Escape closes it', !(await p.isVisible('#helpSheet')));
await p.locator('#ytd .helpq').click(); await p.waitForTimeout(250);
await p.mouse.click(8,8); await p.waitForTimeout(250);
ok('tapping outside closes it', !(await p.isVisible('#helpSheet')));
await p.locator('#ytd .helpq').click(); await p.waitForTimeout(250);
await p.click('#helpClose'); await p.waitForTimeout(250);
ok('and so does the close button', !(await p.isVisible('#helpSheet')));
ok('it is not showing at rest', !(await p.isVisible('#helpSheet')));

console.log('\n━━ On a phone ━━');
await p.close();
const mob=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  deviceScaleFactor:3,timezoneId:'America/New_York',locale:'en-US'});
p=await boot(mob);
/* The clock has no h2 — it is a strip already carrying a status, a total, a punch button
   and a chevron. A ? added carelessly there pushes the page sideways. */
ok('the clock has a door of its own', (await p.locator('#hero .helpq').count())===1);
{
  const sw = await p.evaluate(()=>[document.documentElement.scrollWidth, window.innerWidth]);
  ok('and the page still does not scroll sideways', sw[0]===sw[1], sw.join(' vs '));
  const box = await p.locator('#hero .helpq').boundingBox();
  ok('the button sits inside the viewport', box && box.x>=0 && box.x+box.width<=390, JSON.stringify(box));
}
{
  const before = await p.evaluate(()=>document.getElementById('hero').classList.contains('open'));
  await p.locator('#hero .helpq').click(); await p.waitForTimeout(350);
  ok('tapping it opens help', await p.isVisible('#helpSheet'));
  ok('about the clock', (await p.textContent('#helpBody h3')).includes('clock'),
     await p.textContent('#helpBody h3'));
  /* The strip expands the clock when tapped anywhere else, so this is the collision. */
  ok('and does not expand or collapse the clock',
     (await p.evaluate(()=>document.getElementById('hero').classList.contains('open')))===before);
  const card = await p.locator('.helpcard').boundingBox();
  ok('the sheet fits the screen', card && card.width<=390 && card.height<=844,
     JSON.stringify(card));
}
/* Shipped at 22px first time out, which is the size this app refuses to ship anywhere else.
   Five suites caught it. Asserted here too so the rule is stated where the button lives, not
   only as a side effect of a sweep somewhere else. */
{
  const tiny = await p.evaluate(()=>[...document.querySelectorAll('.helpq')]
    .filter(b=>b.offsetParent!==null)
    .map(b=>b.getBoundingClientRect())
    .filter(r=>r.height<44 || r.width<44).length);
  ok('every ? is a real 44px tap target', tiny===0, String(tiny));
  const ring = await p.evaluate(()=>{
    const b=document.querySelector('#ytd .helpq');
    return b ? getComputedStyle(b,'::before').width : null;
  });
  ok('while the ring it draws stays small', ring==='22px', String(ring));
}

console.log(fails? `\n❌  ${fails} failed` : '\n✅  all passed');
await b.close(); srv.close();
process.exit(fails?1:0);
