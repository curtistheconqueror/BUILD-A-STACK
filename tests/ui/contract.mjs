/* Salary under contract — ten months worked, twelve months paid.
   The number this card exists for: during the school year you have earned more than you
   have been paid, and the district is holding the difference. That balance IS the summer
   pay. No payslip anywhere shows it. */
import { chromium } from 'playwright';
import http from 'node:http'; import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
const TMP = join(process.env.TMPDIR || '/tmp', 'wisewage-tests');
mkdirSync(TMP, { recursive: true });
const CHROME = process.env.PW_CHROME || undefined;

const R = ROOT, KEY = 'payclock.v1';
const TY = {'.html':'text/html','.js':'text/javascript',
            '.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((q,r) => { let p = decodeURIComponent(q.url.split('?')[0]);
  if (p==='/'||p==='/index.html'){ r.writeHead(200,{'Content-Type':'text/html'});
    return r.end(readFileSync(R+'index.html')); }
  if (p==='/favicon.ico'){ r.writeHead(204); return r.end(); }
  const f = R+p; if (!existsSync(f)){ r.writeHead(404); return r.end('no'); }
  r.writeHead(200,{'Content-Type':TY[p.slice(p.lastIndexOf('.'))]||'application/octet-stream'});
  r.end(readFileSync(f));
}).listen(8204);
let fails = 0;
const ok = (n,c,x='') => { console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++; };

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport:{width:1100,height:2600},
                                 timezoneId:'America/Chicago', locale:'en-US' });

const CFG = { rate:0, otMultiplier:1.5, otMode:'weekly', weeklyThreshold:40, periodThreshold:80,
  dailyThreshold:8, shiftThreshold:8, weekStartDay:0, periodAnchor:'2026-08-09',
  periodLengthDays:14, payDateOffsetDays:13, schedStart:'07:30', schedEnd:'15:30',
  lunchMins:0, workDays:[false,true,true,true,true,true,false],
  holidays:[], banks:[], daysOff:[], vacations:[], premiums:[],
  salary:72000, contractCheques:26, contractStart:'2026-08-17', contractEnd:'2027-06-04' };

const SEED = { configured:true,
  jobs:[{ id:'j1', name:'District 214', profession:'teacher', primary:true,
          activeStart:null, activeAdj:null, cfg: JSON.parse(JSON.stringify(CFG)) }],
  activeJob:'j1', sessions:[], absences:[], units:[], stipends:[],
  unit:'sec', ui:{open:{}}, net:{} };

/* Noon on the last day of the contract — the moment the held balance is at its largest and
   the whole point of the card is on screen. */
const LAST_DAY = Date.UTC(2027, 5, 4, 17, 0);

async function boot(seed, at){
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  PAGE ERROR:', e.message); fails++; });
  p.on('console', m => { if (m.type()==='error'){ console.log('  CONSOLE ERROR:', m.text()); fails++; } });
  await p.addInitScript(([k,v]) => { if (sessionStorage.getItem('__s')) return;
    sessionStorage.setItem('__s','1');
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); },
    [KEY, seed === undefined ? null : seed]);
  await p.clock.install({ time:new Date(at) });
  await p.goto('http://localhost:8204/');
  await p.waitForFunction(() => typeof state !== 'undefined' && state.jobs, null, { timeout:15000 });
  await p.waitForTimeout(500);
  return p;
}
const seen = (p,sel) => p.evaluate(s => { const e = document.querySelector(s);
  return !!e && e.checkVisibility({contentVisibilityAuto:true, visibilityProperty:true}); }, sel);
const txt = (p,sel) => p.evaluate(s => (document.querySelector(s)?.textContent||'').trim(), sel);
const st  = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
const openCfg = async p => { await p.evaluate(() =>
  document.querySelectorAll('#cfg details').forEach(d => d.open = true)); await p.waitForTimeout(300); };

console.log('\n━━ A teacher is neither a clock nor a unit count ━━');
let p = await boot(SEED, LAST_DAY);
ok('the contract card is on screen', await seen(p, '#salary'));
ok('and open without being asked', await seen(p, '#salary .colbody'));
ok('there is no clock', !(await seen(p, '#hero')));
ok('no shift log', !(await seen(p, '#log')));
ok('no production card either', !(await seen(p, '#units')));
ok('the model says contract', (await p.evaluate(() => jobModel())) === 'contract');
ok('a teacher is in the Education group',
   (await p.evaluate(() => PROFESSIONS.teacher.group)) === 'Education');
ok('and an aide beside them is still on a clock',
   (await p.evaluate(() => PROFESSIONS.para.model)) === 'clock');

console.log('\n━━ Earned, paid, and the gap between them ━━');
/* $72,000 over 26 cheques is $2,769.23. By the last day of school 20 have been handed over. */
ok('the whole salary is earned', (await txt(p, '#sEarned')) === '$72,000.00', await txt(p, '#sEarned'));
ok('and the card says so', /100% of the contract/.test(await txt(p, '#sEarnedDet')),
   await txt(p, '#sEarnedDet'));
ok('twenty checks have been paid', /20 of 26 checks/.test(await txt(p, '#sPaidDet')),
   await txt(p, '#sPaidDet'));
ok('at $2,769.23 each', /\$2,769\.23 each/.test(await txt(p, '#sPaidDet')), await txt(p, '#sPaidDet'));
ok('which is $55,384.60 so far', (await txt(p, '#sPaid')) === '$55,384.60', await txt(p, '#sPaid'));
ok('leaving $16,615.40 held', (await txt(p, '#sHeld')) === '$16,615.40', await txt(p, '#sHeld'));
ok('exactly six checks of it', /^6\.0 checks/.test(await txt(p, '#sHeldDet')), await txt(p, '#sHeldDet'));

console.log('\n━━ It says whose money it is ━━');
const note = (await txt(p, '#sNote')).replace(/\s+/g,' ');
ok('naming the amount held', /holding \$16,615\.40/.test(note), note.slice(0,90));
ok('in checks as well as dollars', /about 6\.0 checks/.test(note), note.slice(0,130));
ok('and what it is for', /that is what the summer is paid from/i.test(note), note.slice(60,190));
/* The sentence that matters to someone who has been told the summer is a perk. */
ok('it is not extra and not the district’s',
   /not extra/.test(note) && /not the district/.test(note), note.slice(-130));
ok('the bar totals the contract year', /Of \$72,000\.00 this contract year/.test(await txt(p,'#sBarLbl')),
   await txt(p, '#sBarLbl'));
ok('and splits paid from held', /\$55,384\.60 paid · \$16,615\.40 held/.test(await txt(p,'#sBarNum')),
   await txt(p, '#sBarNum'));
const bars = await p.evaluate(() => ({ paid: document.getElementById('sBarPaid').style.width,
                                       held: document.getElementById('sBarHeld').style.width }));
ok('the bar is drawn to scale', bars.paid === '76.9%' && bars.held === '23.1%',
   bars.paid + ' / ' + bars.held);

console.log('\n━━ The balance drains over the summer ━━');
await p.close();
p = await boot(SEED, Date.UTC(2027, 7, 20, 17, 0));      // late August, contract nearly paid out
const late = { held: await txt(p, '#sHeld'), paid: await txt(p, '#sPaidDet') };
ok('almost everything has been handed over now', /2[56] of 26 checks/.test(late.paid), late.paid);
ok('so very little is still held',
   parseFloat(late.held.replace(/[$,]/g,'')) < 3000, late.held);
ok('and the card counts down what is left',
   /check.* left to come/.test(await txt(p, '#sNote')), (await txt(p,'#sNote')).slice(0,120));
await p.close();

console.log('\n━━ Before it starts, nothing has been earned ━━');
p = await boot(SEED, Date.UTC(2026, 6, 1, 17, 0));       // July, before the contract begins
ok('nothing earned yet', (await txt(p, '#sEarned')) === '$0.00', await txt(p, '#sEarned'));
ok('and nothing reported as held', (await txt(p, '#sHeld')) === '$0.00', await txt(p, '#sHeld'));
/* "You owe the district" would be both wrong and frightening. */
ok('never a negative figure', !/-/.test(await txt(p, '#sHeld')), await txt(p, '#sHeld'));
await p.close();

console.log('\n━━ Stipends ━━');
p = await boot(SEED, LAST_DAY);
ok('the list starts empty', /No stipends/.test(await txt(p, '#stList')), await txt(p, '#stList'));
await p.click('#stAdd'); await p.waitForTimeout(400);
ok('it will not add one with no name', /What is the stipend for/.test(await txt(p, '#toast')),
   await txt(p, '#toast'));
await p.fill('#stName', 'Head track coach'); await p.click('#stAdd'); await p.waitForTimeout(400);
ok('nor with no amount', /How much is it a year/.test(await txt(p, '#toast')), await txt(p, '#toast'));
await p.fill('#stAmt', '5200'); await p.click('#stAdd'); await p.waitForTimeout(600);
ok('it confirms what was added', /Head track coach added/.test(await txt(p, '#toast')),
   await txt(p, '#toast'));
await p.fill('#stName', 'Yearbook'); await p.fill('#stAmt', '1800');
await p.click('#stAdd'); await p.waitForTimeout(600);
ok('two stipends listed', (await p.$$eval('#stList .jobrow', r => r.length)) === 2);
ok('totalling $7,000 a year', /\$7,000\.00.* a year on top of the contract/.test(
   (await txt(p, '#stList')).replace(/\s+/g,' ')), (await txt(p,'#stList')).replace(/\s+/g,' ').slice(-150));
ok('and it says the pension applies to them',
   /creditable earnings/.test(await txt(p, '#stList')), (await txt(p,'#stList')).slice(-120));

console.log('\n━━ They change the money, not just the list ━━');
ok('the contract year is now worth $79,000',
   /Of \$79,000\.00 this contract year/.test(await txt(p, '#sBarLbl')), await txt(p, '#sBarLbl'));
ok('so each check grows to $3,038.46', /\$3,038\.46 each/.test(await txt(p, '#sPaidDet')),
   await txt(p, '#sPaidDet'));
ok('and more has been earned by now', (await txt(p, '#sEarned')) === '$79,000.00',
   await txt(p, '#sEarned'));
/* The list ends with a note, so :last-child is not a row — take the last actual row. */
await p.locator('#stList .jobrow').last().locator('button[data-sdel]').click();
await p.waitForTimeout(600);
ok('removing one puts the figures back',
   /Of \$77,200\.00 this contract year/.test(await txt(p, '#sBarLbl')), await txt(p, '#sBarLbl'));
ok('one left in storage', (await st(p)).stipends.length === 1);
ok('stamped with its job', (await st(p)).stipends[0].jobId === 'j1');

console.log('\n━━ Settings carry the contract ━━');
await openCfg(p);
ok('there is a contract group', await seen(p, '#gContract'));
ok('the clock groups are gone', !(await seen(p, '#gPay')) && !(await seen(p, '#gSched')));
ok('and so is the production group', !(await seen(p, '#gUnits')));
ok('the salary is filled in', (await p.inputValue('#cSalary')) === '72000', await p.inputValue('#cSalary'));
ok('with the check count', (await p.inputValue('#cCheques')) === '26', await p.inputValue('#cCheques'));
ok('and both dates', (await p.inputValue('#cConStart')) === '2026-08-17'
   && (await p.inputValue('#cConEnd')) === '2027-06-04', await p.inputValue('#cConStart'));
const cn = (await txt(p, '#cConNote')).replace(/\s+/g,' ');
ok('the note prices a check', /\$2,838\.46/.test(cn) || /each/.test(cn), cn.slice(0,140));
ok('and names the contract length', /-day contract/.test(cn), cn.slice(-60));
await p.fill('#cSalary', '80000'); await p.dispatchEvent('#cSalary','change');
await p.waitForTimeout(600);
ok('changing the salary saves', (await st(p)).jobs[0].cfg.salary === 80000,
   String((await st(p)).jobs[0].cfg.salary));
ok('and re-prices the card', /Of \$85,200\.00 this contract year/.test(await txt(p,'#sBarLbl')),
   await txt(p, '#sBarLbl'));
await p.fill('#cCheques', '21'); await p.dispatchEvent('#cCheques','change');
await p.waitForTimeout(600);
ok('fewer checks means bigger ones', /21 checks/.test(await txt(p,'#sPaidDet'))
   || /of 21 checks/.test(await txt(p,'#sPaidDet')), await txt(p, '#sPaidDet'));
ok('the folded summary spells it out',
   /\$80,000\.00 over 21 checks/.test(await txt(p, '#sumContract')), await txt(p, '#sumContract'));
await p.close();

console.log('\n━━ Picking the profession suggests the pension without touching it ━━');
const plain = JSON.parse(JSON.stringify(SEED));
plain.jobs[0].profession = '';
p = await boot(plain, LAST_DAY);
await openCfg(p);
await p.selectOption('#jobList select[data-jprof]', 'teacher'); await p.waitForTimeout(800);
const t = await txt(p, '#toast');
ok('it says the district may be outside Social Security',
   /outside Social Security/.test(t), t);
ok('and names the rate', /TRS is 9%/.test(t), t);
ok('and tells you how to check', /no OASDI line on your stub/.test(t), t);
/* A tax setting shared across every job, wrong in thirty-five states, that moves real money
   on every cheque. Suggested out loud, never applied. */
const d = await st(p);
ok('but nothing was actually switched on',
   !(d.net && d.net.pension), JSON.stringify(d.net && d.net.pension));
ok('and Social Security is untouched',
   !d.net || d.net.ssOn !== false, String(d.net && d.net.ssOn));
ok('the profession did save', d.jobs[0].profession === 'teacher', d.jobs[0].profession);
ok('and the card swapped in', await seen(p, '#salary'));
await p.close();

console.log('\n━━ Two jobs, two kinds of work ━━');
const two = JSON.parse(JSON.stringify(SEED));
two.stipends = [{ id:'s1', jobId:'j1', name:'Coach', amount:5200 }];
two.jobs.push({ id:'j2', name:'Summer camp', profession:'para', primary:false,
                activeStart:null, activeAdj:null,
                cfg: Object.assign(JSON.parse(JSON.stringify(CFG)), { rate:22, salary:0 }) });
p = await boot(two, LAST_DAY);
ok('the teaching job shows the contract', await seen(p, '#salary'));
await p.evaluate(() => { state.activeJob='j2'; save(); syncControls(); applyStage();
  lastHeavySig=''; render(); });
await p.waitForTimeout(700);
ok('the aide job shows a clock instead', await seen(p, '#hero'));
ok('and no contract card', !(await seen(p, '#salary')));
await p.evaluate(() => { state.activeJob='j1'; save(); syncControls(); applyStage();
  lastHeavySig=''; render(); });
await p.waitForTimeout(700);
ok('switching back brings the contract', await seen(p, '#salary'));
ok('with its stipend intact', (await p.$$eval('#stList .jobrow', r => r.length)) === 1);

console.log('\n━━ Backup carries it all ━━');
await openCfg(p);
const dl = await Promise.all([p.waitForEvent('download'), p.click('#backup')]).then(r => r[0]);
const file = join(TMP, 'contract-backup.json');
await dl.saveAs(file);
const saved = JSON.parse(readFileSync(file, 'utf8'));
ok('the stipends are in the file', Array.isArray(saved.stipends) && saved.stipends.length === 1,
   String(saved.stipends && saved.stipends.length));
ok('and the contract is on the job', saved.jobs[0].cfg.salary === 72000,
   String(saved.jobs[0].cfg.salary));
await p.evaluate(() => { state.stipends = []; save(); lastHeavySig=''; render(); });
await p.waitForTimeout(400);
ok('cleared out', /No stipends/.test(await txt(p, '#stList')));
await p.setInputFiles('#restoreFile', file); await p.waitForTimeout(900);
ok('and restored', (await p.$$eval('#stList .jobrow', r => r.length)) === 1);
ok('still a teacher afterwards', (await p.evaluate(() => jobModel())) === 'contract');
await p.close();

console.log('\n━━ On a phone ━━');
const mob = await b.newContext({ viewport:{width:390,height:900}, isMobile:true, hasTouch:true,
  deviceScaleFactor:3, timezoneId:'America/Chicago', locale:'en-US' });
const q = await mob.newPage();
q.on('pageerror', e => { console.log('  PAGE ERROR:', e.message); fails++; });
await q.addInitScript(([k,v]) => { if (sessionStorage.getItem('__s')) return;
  sessionStorage.setItem('__s','1'); localStorage.setItem(k, JSON.stringify(v)); }, [KEY, SEED]);
await q.clock.install({ time:new Date(LAST_DAY) });
await q.goto('http://localhost:8204/'); await q.waitForTimeout(900);
const m = await q.evaluate(() => {
  const small = [...document.querySelectorAll('#salary button, #salary input')]
    .filter(e => e.checkVisibility({contentVisibilityAuto:true, visibilityProperty:true}))
    .filter(e => e.getBoundingClientRect().height < 44)
    .map(e => (e.id||e.type) + ':' + Math.round(e.getBoundingClientRect().height));
  return { w:document.documentElement.scrollWidth, win:innerWidth, small,
           tiles:[...document.querySelectorAll('#salary .tile')].length };
});
ok('no sideways scroll', m.w <= m.win+1, `${m.w} vs ${m.win}`);
ok('three tiles', m.tiles === 3, String(m.tiles));
ok('every control is finger-sized', m.small.length === 0, m.small.join(', '));
ok('and the held figure is readable', (await txt(q, '#sHeld')) === '$16,615.40', await txt(q, '#sHeld'));

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close(); process.exit(fails===0?0:1);
