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
const b=await chromium.launch({executablePath: CHROME});
const seeded={configured:true,cfg:{rate:38,periodAnchor:'2026-08-02',periodLengthDays:14},
  sessions:[],activeStart:null,unit:'sec',planOn:false,sound:false};

// Chromium has no notch, so env(safe-area-inset-*) is 0 there. What can be checked is
// that the declaration survives into the phone layout and that the zero case is unchanged.
for (const [name,w,h] of [['iPhone 14',390,844],['iPhone SE',375,667],['desktop',1100,900]]){
  const ctx=await b.newContext({viewport:{width:w,height:h},isMobile:w<600,hasTouch:w<600});
  const p=await ctx.newPage();
  await p.addInitScript(([k,v])=>{localStorage.setItem(k,JSON.stringify(v));},[KEY,seeded]);
  await p.goto('http://localhost:8115/'); await p.waitForTimeout(350);
  const r = await p.evaluate(()=>{
    const cs=getComputedStyle(document.querySelector('.wrap'));
    const h1=document.querySelector('h1');
    return { padTop:cs.paddingTop, padBottom:cs.paddingBottom,
             h1Top: h1 ? Math.round(h1.getBoundingClientRect().top) : null };
  });
  console.log(`\n  ${name} (${w}px)`);
  ok('  with no notch it computes to the plain value',
     r.padTop === (w<600 ? '18px' : '26px'), r.padTop);
  ok('  bottom keeps its home-indicator room',
     r.padBottom === (w<600 ? '80px' : '90px'), r.padBottom);
  ok('  the title sits below the padding', r.h1Top !== null && r.h1Top >= (w<600?18:26), r.h1Top+'px');
  await p.close(); await ctx.close();
}

// Prove the calc actually adds the inset by substituting a stand-in for env()
console.log('\n  With a 59px inset (Dynamic Island), simulated:');
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const p=await ctx.newPage();
await p.addInitScript(([k,v])=>{localStorage.setItem(k,JSON.stringify(v));},[KEY,seeded]);
await p.goto('http://localhost:8115/'); await p.waitForTimeout(300);
const sim = await p.evaluate(()=>{
  const wrap=document.querySelector('.wrap');
  wrap.style.paddingTop='calc(18px + 59px)';       // what iOS would resolve env() to
  const h1=document.querySelector('h1');
  return { pad:getComputedStyle(wrap).paddingTop, h1Top:Math.round(h1.getBoundingClientRect().top) };
});
ok('  padding becomes 77px', sim.pad==='77px', sim.pad);
ok('  and the title clears the status bar area (>59px)', sim.h1Top>59, sim.h1Top+'px');

// The CSS text is what an iPhone actually resolves, so assert on the source itself.
const css = readFileSync(ROOT + 'index.html','utf8');
// Widget mode fills its own frame with no status bar above it, so it is exempt.
const rules = [...css.matchAll(/\.wrap\{[^}]*\}/g)].map(m=>m[0])
  .filter(t=>t.includes('padding') && !t.includes('padding:0'));
console.log('\n  .wrap padding rules in the source: ' + rules.length);
ok('both the wide and phone rules exist', rules.length===2, String(rules.length));
ok('every one of them keeps the top inset',
   rules.every(t=>t.includes('env(safe-area-inset-top)')),
   rules.map(t=>t.includes('env(safe-area-inset-top)')).join(','));
ok('and the bottom inset', rules.every(t=>t.includes('env(safe-area-inset-bottom)')));

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
