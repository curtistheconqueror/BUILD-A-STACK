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
}).listen(8099);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const openAll=async pg=>{ try{ await pg.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open'))); }catch(e){} };
const b=await chromium.launch({executablePath: CHROME});
const num = s => parseFloat(String(s).replace(/[^0-9.\-]/g,''));
// Open the deduction interview from the calculator and wait for it to actually be up.
const openDed = async pg => { await pg.click('#qEditDed');
  await pg.waitForSelector('#netsetup:not(.hide)', {timeout:8000}); await pg.waitForTimeout(700); };
// The note's button must survive a re-render: one real tap, right after typing in a row.
const oneTapOpens = async pg => { await pg.click('#qEditDed'); await pg.waitForTimeout(400);
  return !(await pg.evaluate(()=>document.getElementById('netsetup').classList.contains('hide'))); };

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
  await p.goto('http://localhost:8099/'); await p.waitForTimeout(400); await openAll(p);
  return p;
}

// August 2026 wall-clock in America/New_York (EDT = UTC-4). Built as UTC so the seed
// means the same hour in the browser as it reads here, whatever the runner's own zone is.
const D=(d,h,mi=0)=>Date.UTC(2026,7,d,h+4,mi);
// Period Sun Aug 2 -> Sat Aug 15. Weekly OT at 40h. $38/hr.
const base={configured:true,cfg:{rate:38,otMultiplier:1.5,otMode:'weekly',weeklyThreshold:40,periodThreshold:80,
  periodAnchor:'2026-08-02',periodLengthDays:14,payDateOffsetDays:13},
  activeStart:null,unit:'sec',planOn:false,plannedHours:10,sound:false};

console.log('\n━━ State picker ━━');
let ctx = await b.newContext({viewport:{width:1000,height:1700},timezoneId:'America/New_York',locale:'en-US'});
let p = await boot(ctx, {...base, sessions:[]});
await p.click('#qPayMode button[data-p="net"]'); await p.waitForTimeout(250);
await openDed(p);
ok('state dropdown exists in the interview', await p.isVisible('#nState'));
const nStates = await p.locator('#nState option').count();
ok('lists 50 states + DC', nStates===51, String(nStates));
ok('defaults to Illinois', (await p.inputValue('#nState'))==='IL', await p.inputValue('#nState'));
ok('Illinois described as exact/flat', (await p.textContent('#nStateNote')).includes('flat 4.95%') && (await p.textContent('#nStateNote')).includes('Exact'), await p.textContent('#nStateNote'));

await p.selectOption('#nState','TX'); await p.waitForTimeout(200);
ok('Texas sets the rate to 0', (await p.inputValue('#nStatePct'))==='0', await p.inputValue('#nStatePct'));
ok('Texas note says no state income tax', (await p.textContent('#nStateNote')).includes('no state income tax'), await p.textContent('#nStateNote'));

await p.selectOption('#nState','PA'); await p.waitForTimeout(200);
ok('Pennsylvania flat 3.07%', (await p.inputValue('#nStatePct'))==='3.07', await p.inputValue('#nStatePct'));

await p.selectOption('#nState','CA'); await p.waitForTimeout(200);
ok('California is flagged as an estimate, not exact', (await p.textContent('#nStateNote')).includes('estimate'), await p.textContent('#nStateNote'));
ok('California note steers to the paystub override', (await p.textContent('#nStateNote')).includes('paystub'), await p.textContent('#nStateNote'));

console.log('\n━━ State choice actually changes the tax ━━');
await p.selectOption('#nState','IL'); await p.click('#nSave'); await p.waitForTimeout(300); await openAll(p);
await p.fill('#qRows .qrow input[data-f=hours]','80'); await p.waitForTimeout(200);
const ilState = num(await p.locator('#qResult .qline', {hasText:'State'}).locator('b').textContent());
ok('Illinois state tax on $3,040 is ~$150.48', Math.abs(ilState-150.48)<0.02, `$${ilState}`);

// Regression: typing in a row then tapping the note's button used to need two taps —
// the blur re-rendered the note and replaced the button mid-press, so no click fired.
ok('one tap opens the interview right after typing in a row', await oneTapOpens(p));
await p.waitForTimeout(700);
await p.selectOption('#nState','TX'); await p.click('#nSave'); await p.waitForTimeout(300); await openAll(p);
const txState = num(await p.locator('#qResult .qline', {hasText:'State'}).locator('b').textContent());
ok('Texas state tax is $0.00', txState===0, `$${txState}`);
let note = await p.textContent('#qNetNote');
ok('note names the state', note.includes('Texas'), note);
ok('note says no income tax for TX', note.includes('no income tax'), note);
await openDed(p);
await p.selectOption('#nState','IL'); await p.click('#nSave'); await p.waitForTimeout(300); await openAll(p);

console.log('\n━━ Sync: clocked out, past shifts only ━━');
await p.close();
// Mon Aug 10: two 10h days already logged (Aug 10 + Aug 11 morning). 20h banked.
p = await boot(ctx, {...base, sessions:[
  {id:'a',start:D(10,8),end:D(10,18)},        // 10 h
  {id:'b',start:D(11,8),end:D(11,14)}         // 6 h
]});
ok('sync toggle exists near the top', await p.isVisible('#qSync'));
ok('sync is off by default', !(await p.isChecked('#qSync')));
ok('banked panel hidden while off', !(await p.isVisible('#qBanked')));
await p.check('#qSync'); await p.waitForTimeout(250);
ok('banked panel appears', await p.isVisible('#qBanked'));
let bank = await p.textContent('#qBanked');
ok('banked hours = 16.00 h', bank.includes('16.00 h'), bank);
ok('banked gross = $608.00', bank.includes('$608.00'), bank);   // 16 * 38
ok('says 24 h left before overtime', bank.includes('24.00 h left before overtime'), bank);
ok('payday note explains it is this period', (await p.textContent('#qPaydayNote')).includes('period you are working now'), await p.textContent('#qPaydayNote'));
ok('payday field locked while synced', await p.locator('#qPayday').isDisabled());

console.log('\n━━ Sync: rows add on top of what is banked ━━');
await p.click('#qPayMode button[data-p="gross"]'); await p.waitForTimeout(150);
await p.fill('#qRows .qrow input[data-f=hours]','24'); await p.waitForTimeout(250);
let res = await p.textContent('#qResult');
ok('banked line shown first', res.includes('16.00 h already banked') && res.includes('$608.00'), res);
ok('planned row shown separately', res.includes('24.00 h regular @ $38.00'), res);
ok('total is 40.00 h', res.includes('40.00 h — gross'), res);
ok('total gross $1,520.00', res.includes('$1,520.00'), res);   // 40 * 38

console.log('\n━━ Sync: running clock counts, live ━━');
await p.close();
// Clocked in at 8am Aug 11 EDT; "now" is 1pm EDT (17:00Z) -> 5 h elapsed today.
p = await boot(ctx, {...base, sessions:[{id:'a',start:D(10,8),end:D(10,18)}], activeStart:D(11,8)});
await p.check('#qSync'); await p.waitForTimeout(300);
bank = await p.textContent('#qBanked');
ok('counts the running shift', bank.includes('Counting the shift running right now'), bank);
let h1 = parseFloat(bank.match(/([\d.]+) h/)[1]);
ok('10 banked + ~5 live = ~15 h', Math.abs(h1-15)<0.05, `${h1} h`);
await p.clock.fastForward('01:00:00'); await p.waitForTimeout(400);
bank = await p.textContent('#qBanked');
let h2 = parseFloat(bank.match(/([\d.]+) h/)[1]);
ok('an hour later it has climbed to ~16 h on its own', Math.abs(h2-16)<0.05, `${h2} h`);

console.log('\n━━ Sync: auto-stop counts the day out to its target ━━');
await p.close();
// Same shift, but auto-stop armed at 10 h/day -> today should count the full 10, not 5.
p = await boot(ctx, {...base, sessions:[{id:'a',start:D(10,8),end:D(10,18)}],
  activeStart:D(11,8), planOn:true, plannedHours:10});
await p.check('#qSync'); await p.waitForTimeout(300);
bank = await p.textContent('#qBanked');
ok('says it is counting out to the auto-stop', bank.includes('auto-stop at'), bank);
let h3 = parseFloat(bank.match(/([\d.]+) h/)[1]);
ok('10 banked + full 10 planned = 20 h, not 15', Math.abs(h3-20)<0.05, `${h3} h`);
ok('and prices it at $760.00', bank.includes('$760.00'), bank);   // 20 * 38

console.log('\n━━ Sync: overtime position is reported from the real ledger ━━');
await p.close();
// 38 h already this week -> 2 h to go before OT.
p = await boot(ctx, {...base, sessions:[
  {id:'a',start:D(9,8),end:D(9,20)},   // Sun 12 h
  {id:'b',start:D(10,8),end:D(10,20)}, // Mon 12 h
  {id:'c',start:D(11,8),end:D(11,22)}  // Tue 14 h
]});
await p.check('#qSync'); await p.waitForTimeout(300);
bank = await p.textContent('#qBanked');
ok('38 h banked', bank.includes('38.00 h'), bank);
ok('says 2 h left before overtime', bank.includes('2.00 h left before overtime'), bank);

console.log('\n━━ Sync: past the threshold says so plainly ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[
  {id:'a',start:D(9,6),end:D(9,22)},   // 16
  {id:'b',start:D(10,6),end:D(10,22)}, // 16
  {id:'c',start:D(11,6),end:D(11,20)}  // 14  => 46 h
]});
await p.check('#qSync'); await p.waitForTimeout(300);
bank = await p.textContent('#qBanked');
ok('past 40 h is stated plainly', bank.includes('past 40 h'), bank);
ok('no negative "hours left" message', !bank.includes('-'), bank);

console.log('\n━━ Sync survives reload, and unchecking restores the free payday ━━');
await p.reload(); await p.waitForTimeout(450); await openAll(p);
ok('sync still on after reload', await p.isChecked('#qSync'));
ok('banked panel still shown', await p.isVisible('#qBanked'));
await p.uncheck('#qSync'); await p.waitForTimeout(250);
ok('banked panel hidden again', !(await p.isVisible('#qBanked')));
ok('payday editable again', !(await p.locator('#qPayday').isDisabled()));
res = await p.textContent('#qResult');
ok('totals drop back to rows only', !res.includes('already banked'), res);

console.log('\n━━ Mobile ━━');
await p.close();
ctx = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'America/New_York',locale:'en-US'});
p = await boot(ctx, {...base, sessions:[{id:'a',start:D(10,8),end:D(10,18)}]});
await p.check('#qSync'); await p.waitForTimeout(300);
const w = await p.evaluate(()=>document.documentElement.scrollWidth);
ok('no horizontal overflow at 390px', w<=391, `${w}px`);
await p.click('#qPayMode button[data-p="net"]'); await p.waitForTimeout(250);
await p.evaluate(()=>document.getElementById('calc').scrollIntoView());
await p.waitForTimeout(200);
await p.locator('#calc').screenshot({path:join(TMP, 'calc-sync.png')});

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
