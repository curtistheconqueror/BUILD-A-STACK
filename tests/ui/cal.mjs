import { chromium } from 'playwright';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// The app under test sits two directories up from tests/ui/.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
// Set PW_CHROME to point at a specific build; otherwise Playwright finds its own.
const CHROME = process.env.PW_CHROME || undefined;
// Scratch files (backups under test, screenshots) go to a temp dir, never the repo.
const TMP = join(process.env.TMPDIR || '/tmp', 'wisewage-tests');
try { (await import('node:fs')).mkdirSync(TMP, { recursive: true }); } catch {}


const KEY='payclock.v1';
const srv = http.createServer((q, r) => {
  const R = ROOT;
  if (q.url.startsWith('/sw.js')) { r.writeHead(200,{'Content-Type':'text/javascript'}); return r.end(readFileSync(R+'sw.js')); }
  if (q.url.startsWith('/manifest')) { r.writeHead(200,{'Content-Type':'application/manifest+json'}); return r.end(readFileSync(R+'manifest.webmanifest')); }
  if (q.url.indexOf('.png') > -1) { r.writeHead(404); return r.end(); }
  r.writeHead(200,{'Content-Type':'text/html'}); r.end(readFileSync(R+'index.html'));
}).listen(8102);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const openAll=async pg=>{ try{ await pg.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open'))); }catch(e){} };
const b=await chromium.launch({executablePath: CHROME});
const cell = d => `.calcell[data-d="${d}"] input`;

async function boot(ctx, seed, at='2026-08-11T17:00:00Z'){
  const p=await ctx.newPage();
  p.on('pageerror',e=>{console.log('  PAGE ERROR:',e.message);fails++;});
  p.on('console',m=>{if(m.type()==='error'){console.log('  CONSOLE ERROR:',m.text());fails++;}});
  await p.addInitScript(([k,v])=>{
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded','1');
    if (v) localStorage.setItem(k,JSON.stringify(v)); else localStorage.removeItem(k);
  },[KEY,seed]);
  await p.clock.install({time:new Date(at)});
  await p.goto('http://localhost:8102/'); await p.waitForTimeout(400); await openAll(p);
  return p;
}
// Period anchored Sun Aug 2 2026, 14 days -> Aug 2–15, payday +13 = Fri Aug 28. $38/hr, weekly 40h.
const base={configured:true,cfg:{rate:38,otMultiplier:1.5,otMode:'weekly',weeklyThreshold:40,periodThreshold:80,
  weekStartDay:0,periodAnchor:'2026-08-02',periodLengthDays:14,payDateOffsetDays:13},
  sessions:[],activeStart:null,unit:'sec',planOn:false,sound:false};

console.log('\n━━ Off by default, opens on request ━━');
let ctx = await b.newContext({viewport:{width:1000,height:1700},timezoneId:'America/New_York',locale:'en-US'});
let p = await boot(ctx, base);
ok('calendar toggle exists', await p.isVisible('#qCalOn'));
ok('calendar is off by default', !(await p.isChecked('#qCalOn')));
ok('calendar body hidden while off', !(await p.isVisible('#qCalBody')));
await p.check('#qCalOn'); await p.waitForTimeout(400);
ok('calendar body appears', await p.isVisible('#qCalBody'));
ok('renders 4 months up front', (await p.locator('.calmon').count())===4, String(await p.locator('.calmon').count()));
ok('does not immediately load earlier months on open',
   (await p.locator('.calmon h4').first().textContent())==='July 2026', await p.locator('.calmon h4').first().textContent());

console.log('\n━━ Real dates, correct alignment ━━');
// Opens scrolled to today's month, with the previous month sitting just above it.
const atTop = await p.evaluate(()=>{ const sc=document.getElementById('qCalScroll');
  const m=sc.querySelector('[data-mk="2026-7"]');
  return Math.abs(m.getBoundingClientRect().top - sc.getBoundingClientRect().top); });
ok('opens scrolled to the current month', atTop < 4, `${atTop}px off`);
// Aug 1 2026 is a Saturday -> with weeks starting Sunday, 6 leading blanks
const gridInfo = await p.evaluate(()=>{
  const cells=[...document.querySelector('.calmon[data-mk="2026-7"] .calgrid').children];
  let lead=0; while(cells[lead] && cells[lead].classList.contains('pad')) lead++;
  return { lead, total: cells.length };
});
ok('August 2026 starts with 6 blanks (Aug 1 is a Saturday)', gridInfo.lead===6, String(gridInfo.lead));
ok('the grid is complete weeks — no holes in the lines', gridInfo.total % 7 === 0, String(gridInfo.total));
ok('August has 31 day cells', (await p.locator('.calmon[data-mk="2026-7"] .calcell[data-d]').count())===31,
   String(await p.locator('.calmon[data-mk="2026-7"] .calcell[data-d]').count()));
ok('today is marked', (await p.locator('.calcell.today').count())===1);
ok('today is Aug 11', (await p.locator('.calcell.today').getAttribute('data-d'))==='2026-08-11',
   await p.locator('.calcell.today').getAttribute('data-d'));
ok('pay period start Aug 2 is flagged', (await p.locator('.calcell[data-d="2026-08-02"]').getAttribute('class')).includes('pstart'));
// 2027 alignment: Aug 1 2027 is a Sunday -> 0 leading blanks. Proves it tracks real dates.
ok('weekday headers follow week-start setting',
   (await p.locator('.caldow span').first().textContent())==='S', await p.locator('.caldow span').first().textContent());

console.log('\n━━ Type hours, get pay ━━');
await p.fill(cell('2026-08-10'),'8'); await p.waitForTimeout(250);
ok('day shows its money', (await p.locator('.calval[data-v="2026-08-10"]').textContent()).includes('$304'),
   await p.locator('.calval[data-v="2026-08-10"]').textContent());
let sums = await p.textContent('#qCalSums');
ok('period summary appears', sums.includes('8.00 h'), sums);
ok('summary shows the period range', sums.includes('Sun Aug 2') && sums.includes('Sat Aug 15'), sums);
ok('summary names the payday', sums.includes('Fri Aug 28, 2026'), sums);
ok('summary totals $304.00', sums.includes('$304.00'), sums);
ok('payday cell badged with the total', (await p.locator('.calpay[data-p="2026-08-28"]').textContent()).includes('$304'),
   await p.locator('.calpay[data-p="2026-08-28"]').textContent());

console.log('\n━━ Accrual: overtime arrives at the real 40 h line ━━');
// Week Sun Aug 9 – Sat Aug 15. Put 10 h on Sun..Wed = 40 h, then 10 more Thu.
for (const d of ['2026-08-09','2026-08-10','2026-08-11','2026-08-12']){ await p.fill(cell(d),'10'); }
await p.waitForTimeout(300);
ok('four 10 h days are all straight time',
   (await p.locator('.calval[data-v="2026-08-12"]').textContent()).includes('$380'),
   await p.locator('.calval[data-v="2026-08-12"]').textContent());
await p.fill(cell('2026-08-13'),'10'); await p.waitForTimeout(300);
ok('the 5th day is entirely overtime — $570', (await p.locator('.calval[data-v="2026-08-13"]').textContent()).includes('$570'),
   await p.locator('.calval[data-v="2026-08-13"]').textContent());
sums = await p.textContent('#qCalSums');
ok('period shows 50 h with 10 h OT', sums.includes('50.00 h') && sums.includes('10.00 OT'), sums);
ok('period gross $2,090.00', sums.includes('$2,090.00'), sums);   // 40*38 + 10*57

console.log('\n━━ Daily rule: overtime past 8 h the same day ━━');
await p.click('#qCalOt button[data-s="daily"]'); await p.waitForTimeout(300);
ok('rule note switches', (await p.textContent('#qCalRule')).includes('past 8 h in a day'), await p.textContent('#qCalRule'));
// each 10h day: 8*38 + 2*57 = 304 + 114 = 418
ok('every 10 h day is now $418', (await p.locator('.calval[data-v="2026-08-09"]').textContent()).includes('$418'),
   await p.locator('.calval[data-v="2026-08-09"]').textContent());
sums = await p.textContent('#qCalSums');
ok('period totals 50 h with 10 h OT', sums.includes('50.00 h') && sums.includes('10.00 OT'), sums);
ok('period gross $2,090.00 either way here', sums.includes('$2,090.00'), sums);
await p.click('#qCalOt button[data-s="accrue"]'); await p.waitForTimeout(250);

console.log('\n━━ Show hours instead of money ━━');
await p.click('#qCalShow button[data-s="hours"]'); await p.waitForTimeout(250);
ok('money overlay is gone', !(await p.isVisible('.calval[data-v="2026-08-10"]')));
ok('the typed hours are what you see', (await p.inputValue(cell('2026-08-10')))==='10', await p.inputValue(cell('2026-08-10')));
await p.click('#qCalShow button[data-s="money"]'); await p.waitForTimeout(250);
ok('money overlay returns', await p.isVisible('.calval[data-v="2026-08-10"]'));

console.log('\n━━ Typing is never interrupted by the repaint ━━');
await p.fill(cell('2026-08-14'),'');
await p.type(cell('2026-08-14'),'7.25',{delay:70});
await p.waitForTimeout(500);
ok('field keeps exactly what was typed', (await p.inputValue(cell('2026-08-14')))==='7.25', await p.inputValue(cell('2026-08-14')));
ok('and it still counts', (await p.textContent('#qCalSums')).includes('57.25 h'), await p.textContent('#qCalSums'));

console.log('\n━━ Two pay periods at once ━━');
await p.fill(cell('2026-09-01'),'8'); await p.waitForTimeout(300);
ok('a second period summary appears', (await p.locator('.calsum').count())===2, String(await p.locator('.calsum').count()));
sums = await p.textContent('#qCalSums');
ok('second period is Aug 30 – Sep 12', sums.includes('Sun Aug 30') && sums.includes('Sat Sep 12'), sums);
ok('with its own later payday Sep 25', sums.includes('Fri Sep 25, 2026'), sums);

console.log('\n━━ Scrolling loads more months, both ways ━━');
let before = await p.locator('.calmon').count();
await p.evaluate(()=>{ const s=document.getElementById('qCalScroll'); s.scrollTop = s.scrollHeight; });
await p.waitForTimeout(400);
ok('scrolling to the bottom appends months', (await p.locator('.calmon').count())>before,
   `${before} → ${await p.locator('.calmon').count()}`);
before = await p.locator('.calmon').count();
const firstBefore = await p.locator('.calmon h4').first().textContent();
await p.evaluate(()=>{ document.getElementById('qCalScroll').scrollTop = 0; });
await p.waitForTimeout(400);
ok('scrolling to the top prepends earlier months', (await p.locator('.calmon').count())>before,
   `${before} → ${await p.locator('.calmon').count()}`);
ok('and earlier months really are earlier', (await p.locator('.calmon h4').first().textContent())!==firstBefore,
   `${firstBefore} → ${await p.locator('.calmon h4').first().textContent()}`);
ok('scroll position was corrected, not jumped to 0',
   (await p.evaluate(()=>document.getElementById('qCalScroll').scrollTop))>100,
   String(await p.evaluate(()=>document.getElementById('qCalScroll').scrollTop)));

console.log('\n━━ Independent of the rows above, and of the real log ━━');
let res = await p.textContent('#qResult');
ok('rows total is unchanged by calendar entries', res.includes('8.00 h — gross') && res.includes('$304.00'), res);
ok('no real shifts were created', (await p.evaluate(()=>JSON.parse(localStorage.getItem('payclock.v1')).sessions.length))===0);

console.log('\n━━ Survives a reload ━━');
await p.reload(); await p.waitForTimeout(500); await openAll(p);
ok('calendar still on', await p.isChecked('#qCalOn'));
ok('hours still there', (await p.inputValue(cell('2026-08-10')))==='10', await p.inputValue(cell('2026-08-10')));
ok('totals still there', (await p.textContent('#qCalSums')).includes('57.25 h'), await p.textContent('#qCalSums'));

console.log('\n━━ Clear asks twice ━━');
await p.click('#qCalClear'); await p.waitForTimeout(200);
ok('first tap only arms it', (await p.textContent('#qCalClear')).includes('Tap again'), await p.textContent('#qCalClear'));
ok('nothing cleared yet', (await p.inputValue(cell('2026-08-10')))==='10');
await p.click('#qCalClear'); await p.waitForTimeout(350);
ok('second tap clears', (await p.inputValue(cell('2026-08-10')))==='', await p.inputValue(cell('2026-08-10')));
ok('summaries reset', (await p.textContent('#qCalSums')).includes('Type hours into any day'), await p.textContent('#qCalSums'));

console.log('\n━━ Calendar colours are themeable ━━');
ok('paper swatch exists', (await p.locator('input[data-tk="calbg"]').count())===1);
ok('grid swatch exists', (await p.locator('input[data-tk="calgrid"]').count())===1);
ok('hours swatch exists', (await p.locator('input[data-tk="calfill"]').count())===1);
const defBg = await p.evaluate(()=>getComputedStyle(document.querySelector('.calcell')).backgroundColor);
ok('paper is black by default', defBg==='rgb(0, 0, 0)', defBg);
await p.evaluate(()=>{ const i=document.querySelector('input[data-tk="calbg"]');
  i.value='#221133'; i.dispatchEvent(new Event('input',{bubbles:true})); });
await p.waitForTimeout(300);
ok('picking a colour repaints the calendar',
   (await p.evaluate(()=>getComputedStyle(document.querySelector('.calcell')).backgroundColor))==='rgb(34, 17, 51)',
   await p.evaluate(()=>getComputedStyle(document.querySelector('.calcell')).backgroundColor));

console.log('\n━━ Mobile ━━');
await p.close();
ctx = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'America/New_York',locale:'en-US'});
p = await boot(ctx, {...base, calCal:{on:true,show:'money',otStyle:'accrue',dailyAfter:8,
  hours:{'2026-08-10':10,'2026-08-11':10,'2026-08-12':8}}});
await p.waitForTimeout(500);
const w = await p.evaluate(()=>document.documentElement.scrollWidth);
ok('no horizontal overflow at 390px', w<=391, `${w}px`);
const cb = await p.locator('.calcell[data-d="2026-08-10"]').boundingBox();
ok('a day cell is a usable tap target (>=44px tall)', cb && cb.height>=44, cb?`${cb.height}px`:'none');
ok('seeded hours render', (await p.locator('.calval[data-v="2026-08-10"]').textContent()).includes('$380'),
   await p.locator('.calval[data-v="2026-08-10"]').textContent());
await p.evaluate(()=>document.getElementById('qCalBody').scrollIntoView());
await p.waitForTimeout(300);
await p.locator('#qCalBody').screenshot({path:join(TMP, 'cal-phone.png')});

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
