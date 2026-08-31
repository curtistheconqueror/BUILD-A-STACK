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
  return p;
}
const openAll = p => p.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open')));

const mob=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  deviceScaleFactor:3,timezoneId:'America/New_York',locale:'en-US'});
let p=await boot(mob);

console.log('\n━━ Help lives in the section, not on the heading ━━');
/* First attempt put a ? on every section header. Twelve of them stacked down a page reads
   as clutter on a screen whose job is to look like a clock, and it advertises confusion
   where there mostly is none. */
ok('no question marks on the headings', (await p.locator('.helpq').count())===0,
   String(await p.locator('.helpq').count()));
ok('and no floating sheet to open', (await p.locator('#helpSheet').count())===0);
{
  const n = await p.locator('.helpnote').count();
  ok('every section carries its own note instead', n>10, String(n));
}

console.log('\n━━ A folded card costs nothing ━━');
await p.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.remove('open')));
await p.waitForTimeout(250);
ok('nothing shows while the cards are folded',
   (await p.locator('.helpnote:visible').count())===0,
   String(await p.locator('.helpnote:visible').count()));
await openAll(p); await p.waitForTimeout(250);
ok('and it is still shut when the card opens',
   (await p.locator('#totals .helpnote[open]').count())===0);

console.log('\n━━ It reads as ordinary content, not an overlay ━━');
/* The sheet was drawn on var(--card), which is deliberately translucent — the theme sets
   --card-solid separately for exactly this reason — so the page bled through the words.
   Inline content cannot have that problem, and this asserts it stayed inline. */
await p.locator('#totals .helpnote > summary').click(); await p.waitForTimeout(300);
{
  const box = await p.evaluate(()=>{
    const e=document.querySelector('#totals .helpnotebody'), cs=getComputedStyle(e);
    return {pos:cs.position, z:cs.zIndex};
  });
  ok('the note is in the flow', box.pos==='static', JSON.stringify(box));
  ok('and sits over nothing', box.z==='auto', JSON.stringify(box));
  const body = (await p.textContent('#totals .helpnotebody')).replace(/\s+/g,' ');
  ok('with text where it was tapped', body.length>40, body.slice(0,60));
}

console.log('\n━━ No table of contents ━━');
/* It used to list every other topic underneath, which is a menu nobody asked for while
   they are trying to read one paragraph. */
ok('no index of other topics', (await p.locator('[data-helpgo]').count())===0);
ok('the note names only its own section',
   (await p.locator('#totals .helpnote .helpnote').count())===0);

console.log('\n━━ Each note answers "how is this not that" ━━');
/* The brief: explain only what is ambiguous because it closely resembles another section
   or setting. A note restating its own heading teaches people the notes say nothing. */
{
  const topics = await p.evaluate(()=>Object.keys(HELP).map(k=>({
    k, title: HELP[k].title,
    text: HELP[k].body.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim() })));
  ok('every topic has real content', topics.every(t=>t.text.length>80),
     topics.filter(t=>t.text.length<=80).map(t=>t.k).join(','));
  /* The tell for a useless note: it never mentions anything but itself. Each of these
     draws a line against a named neighbour. */
  const CONTRASTS = {
    clock:'today', earnings:'week', calc:'overtime', units:'threshold',
    premiums:'differential', otmode:'week', anchor:'payday', makeup:'allowance',
    banks:'holiday', net:'medicare', ote:'progress', ytd:'log',
    progress:'threshold', extra:'lunch', log:'period', jobs:'job', backup:'csv',
    /* The paper time sheet records premises time; its neighbour is the decimal card's
       paid time, and confusing the two misstates both. */
    sheet:'decimal'
  };
  const missing = topics.filter(t=>CONTRASTS[t.k] &&
    !t.text.toLowerCase().includes(CONTRASTS[t.k])).map(t=>t.k);
  ok('and each draws a line against its neighbour', missing.length===0, missing.join(','));
  const untitled = topics.filter(t=>!CONTRASTS[t.k]).map(t=>t.k);
  ok('no topic is missing from that check', untitled.length===0, untitled.join(','));
}

console.log('\n━━ The overtime note, which is the one worth money ━━');
await p.evaluate(()=>{const d=document.querySelector('#cfg>details'); if(d)d.open=true;
  document.querySelectorAll('#cfg details').forEach(x=>x.open=true);});
await p.waitForTimeout(300);
{
  const t = (await p.textContent('#gPay .helpnotebody')).replace(/\s+/g,' ');
  ok('all six rules are told apart', (await p.locator('#gPay .helpnotebody dt').count())===6,
     String(await p.locator('#gPay .helpnotebody dt').count()));
  ok('including that per-shift never consults the week',
     /week is never consulted/i.test(t), t.slice(0,80));
}

console.log('\n━━ Wiring cannot drift ━━');
{
  const bad = await p.evaluate(()=>Object.keys(HELP_FOR).filter(k=>!HELP[HELP_FOR[k]]));
  ok('no section points at a topic that does not exist', bad.length===0, bad.join(','));
  const orphan = await p.evaluate(()=>{
    const used=new Set(Object.values(HELP_FOR));
    return Object.keys(HELP).filter(k=>!used.has(k));
  });
  ok('and no topic is written but never shown', orphan.length===0, orphan.join(','));
}

console.log('\n━━ On a phone ━━');
{
  const sw = await p.evaluate(()=>[document.documentElement.scrollWidth, window.innerWidth]);
  ok('no sideways scroll', sw[0]===sw[1], sw.join(' vs '));
  const box = await p.locator('#totals .helpnote > summary').boundingBox();
  ok('the row is a 44px tap target', box && box.height>=44, JSON.stringify(box));
  await p.locator('#totals .helpnote > summary').click(); await p.waitForTimeout(250);
  ok('and it shuts again', (await p.locator('#totals .helpnote[open]').count())===0);
}

console.log(fails? `\n❌  ${fails} failed` : '\n✅  all passed');
await b.close(); srv.close();
process.exit(fails?1:0);
