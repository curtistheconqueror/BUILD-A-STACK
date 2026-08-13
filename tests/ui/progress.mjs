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
  // Serve real MIME types: the app registers a service worker, and a text/html
  // response for sw.js makes the browser reject it with a console error.
  const R = ROOT;
  if (q.url.startsWith('/sw.js')) { r.writeHead(200,{'Content-Type':'text/javascript'}); return r.end(readFileSync(R+'sw.js')); }
  if (q.url.startsWith('/manifest')) { r.writeHead(200,{'Content-Type':'application/manifest+json'}); return r.end(readFileSync(R+'manifest.webmanifest')); }
  if (q.url.indexOf('.png') > -1) { r.writeHead(404); return r.end(); }
  r.writeHead(200,{'Content-Type':'text/html'}); r.end(readFileSync(R+'index.html'));
}).listen(8093);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const openAll=async pg=>{ try{ await pg.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open'))); }catch(e){} };
const b = await chromium.launch({executablePath: CHROME});
const ctx = await b.newContext({timezoneId:'America/New_York',locale:'en-US',viewport:{width:900,height:1700},deviceScaleFactor:2});

const day=(d,h)=>+new Date(2026,6,d,h);
const sh=(id,d,h,len)=>({id,start:day(d,h),end:day(d,h+len)});
const seed=(sessions,mode)=>({configured:true,
  cfg:{rate:38,periodAnchor:'2026-07-26',otMode:mode||'weekly'},
  sessions,activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false});

let page=null;
async function boot(iso,st){
  if(page) await page.close();
  page = await ctx.newPage();
  page.on('pageerror',e=>{console.log('  PAGE ERROR:',e.message);fails++;});
  page.on('console',m=>{if(m.type()==='error'){console.log('  CONSOLE ERROR:',m.text());fails++;}});
  await page.addInitScript(([k,v])=>localStorage.setItem(k,JSON.stringify(v)),[KEY,st]);
  await page.clock.install({time:new Date(iso)});
  await page.goto('http://localhost:8093/'); await page.waitForTimeout(350); await openAll(page);
}
const T=s=>page.textContent(s);
const num=async s=>parseFloat((await T(s)).replace(/[$,]/g,''));

console.log('\nThe complaint: week 2 must not zero the running total');
// 10 h/day Sun-Thu of week 1 = 50 h, then it is week 2 (Mon Aug 3).
const wk1 = [26,27,28,29,30].map(d=>sh('a'+d,d,8,10));
await boot('2026-08-03T17:00:00Z', seed(wk1,'weekly'));   // Mon Aug 3, week 2
ok('weekly tile HAS reset to $0 (unchanged, as asked)', (await T('#wGross'))==='$0.00', await T('#wGross'));
ok('but the new cumulative keeps the week-1 money',
   Math.abs(await num('#cumeGross') - (40*38+10*57)) < 0.01, await T('#cumeGross'));
ok('cumulative shows all 50 h', (await T('#cumeSub')).includes('50.00 h'), await T('#cumeSub'));
ok('cumulative breaks out the OT', (await T('#cumeSub')).includes('10.00 h of it OT'), await T('#cumeSub'));
ok('cumulative names the payday', (await T('#cumeSub')).includes('Aug 21'), await T('#cumeSub'));

console.log('\nWeek-by-week breakdown, week 2 starting fresh');
const wks = await page.locator('.wk').count();
ok('two week cards for a 14-day period', wks===2, String(wks));
const w1 = await page.locator('.wk').nth(0).textContent();
const w2 = await page.locator('.wk').nth(1).textContent();
ok('week 1 shows its own $2,090.00', w1.includes('$2,090.00'), w1.replace(/\s+/g,' '));
ok('week 1 dated Jul 26 - Aug 1', w1.includes('Jul 26') && w1.includes('Aug 1'), '');
ok('week 2 starts from $0.00', w2.includes('$0.00'), w2.replace(/\s+/g,' '));
ok('week 2 dated Aug 2 - Aug 8', w2.includes('Aug 2') && w2.includes('Aug 8'), '');
ok('current week is marked', (await page.locator('.wk.now').count())===1);
ok('the marked one is week 2', (await page.locator('.wk.now').textContent()).includes('Aug 2'));

console.log('\nThe 80-hour line');
ok('bar counts cumulative period hours', (await T('#p80Num'))==='50.00 / 80 h', await T('#p80Num'));
ok('says how far to 80', (await T('#p80Note')).includes('30.00 h'), await T('#p80Note'));
ok('on weekly rule, says so honestly', (await T('#p80Note')).includes('40 h weekly'), await T('#p80Note'));
await page.screenshot({path:join(TMP, '13-progress.png'), fullPage:true});

console.log('\nOn the 80 h rule, past the line');
// 9 days x 10 h = 90 h, viewed on day 10.
const nine = [26,27,28,29,30,31].map(d=>sh('b'+d,d,8,10))
  .concat([1,2,3].map(d=>({id:'c'+d,start:+new Date(2026,7,d,8),end:+new Date(2026,7,d,18)})));
await boot('2026-08-04T17:00:00Z', seed(nine,'period'));
ok('90 h cumulative', (await T('#p80Num'))==='90.00 / 80 h', await T('#p80Num'));
ok('badge marks past 80 h', (await T('#p80Badge')).includes('past 80'), await T('#p80Badge'));
ok('states every remaining hour is OT', (await T('#p80Note')).includes('Every hour for the rest of this period'), await T('#p80Note'));
ok('names the OT rate', (await T('#p80Note')).includes('$57.00'), await T('#p80Note'));
ok('counts the OT hours so far', (await T('#p80Note')).includes('10.00 h so far'), await T('#p80Note'));
ok('cumulative = 80x38 + 10x57', Math.abs(await num('#cumeGross') - (80*38+10*57)) < 0.01, await T('#cumeGross'));
await page.screenshot({path:join(TMP, '14-past80.png'), fullPage:true});

console.log('\nApproaching 80 on the 80 h rule');
await boot('2026-08-02T17:00:00Z', seed([26,27,28,29,30,31].map(d=>sh('d'+d,d,8,10)),'period'));
ok('60 h so far', (await T('#p80Num'))==='60.00 / 80 h', await T('#p80Num'));
ok('counts down 20 h to the OT line', (await T('#p80Note')).includes('20.00 h'), await T('#p80Note'));
ok('promises the rate past it', (await T('#p80Note')).includes('$57.00'), await T('#p80Note'));
ok('no past-80 badge yet', (await T('#p80Badge')).trim()==='' , await T('#p80Badge'));

console.log('\nNew period resets the cumulative, as it should');
await boot('2026-08-09T17:00:00Z', seed(wk1,'weekly'));
ok('cumulative back to $0.00 in the new period', (await T('#cumeGross'))==='$0.00', await T('#cumeGross'));
ok('week cards are fresh', (await page.locator('.wk').nth(0).textContent()).includes('$0.00'));

console.log('\nA 1-week pay period shows one card');
await boot('2026-07-30T17:00:00Z', {configured:true,
  cfg:{rate:38,periodAnchor:'2026-07-26',periodLengthDays:7,otMode:'weekly'},
  sessions:[sh('e',27,8,8)],activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false});
ok('one week card', (await page.locator('.wk').count())===1, String(await page.locator('.wk').count()));

console.log('\nLive shift feeds the cumulative');
await boot('2026-07-30T17:00:00Z', seed(wk1,'weekly'));
const before = await num('#cumeGross');
await page.click('#punch'); await page.clock.fastForward(3600_000); await page.waitForTimeout(250);
ok('cumulative grew by an hour of pay', (await num('#cumeGross')) > before, `${before} → ${await num('#cumeGross')}`);

const of = await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
ok('no horizontal overflow', of<=0, of+'px');
console.log(`\n${fails===0?'✅':'❌'}  progress section: ${fails} failure(s)\n`);
await b.close(); srv.close(); process.exit(fails?1:0);
