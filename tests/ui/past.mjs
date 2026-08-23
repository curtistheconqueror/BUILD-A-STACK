/* Completed pay periods, inside the Pay period card. Anchor Sun Jul 26 2026, 14 days,
   payday 13 days after the last day:
     period 0  Jul 26 – Aug  8   paid Fri Aug 21
     period 1  Aug  9 – Aug 22   paid Fri Sep  4
     period 2  Aug 23 – Sep  5   paid Fri Sep 18   <- standing here */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// The app under test sits two directories up from tests/ui/.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
// Set PW_CHROME to point at a specific build; otherwise Playwright finds its own.
const CHROME = process.env.PW_CHROME || undefined;

const KEY='payclock.v1', R = ROOT;
const TYPES={'.html':'text/html','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{
  let path=decodeURIComponent(q.url.split('?')[0]);
  if(path==='/'||path==='/index.html'){r.writeHead(200,{'Content-Type':'text/html'});return r.end(readFileSync(R+'index.html'));}
  if(path==='/favicon.ico'){r.writeHead(204);return r.end();}
  const f=R+path;
  if(!existsSync(f)){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'Content-Type':TYPES[path.slice(path.lastIndexOf('.'))]||'application/octet-stream'});
  r.end(readFileSync(f));
}).listen(8122);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const b=await chromium.launch({executablePath: CHROME});
// America/New_York, EDT (UTC-4) in Jul/Aug 2026
const T=(mo,d,h,mi=0)=>Date.UTC(2026,mo-1,d,h+4,mi);
const sh=(id,mo,d,from,to)=>({id,start:T(mo,d,from),end:T(mo,d,to)});

const base={configured:true,cfg:{rate:38,otMultiplier:1.5,otMode:'weekly',weeklyThreshold:40,
  periodThreshold:80,dailyThreshold:8,weekStartDay:0,periodAnchor:'2026-07-26',
  periodLengthDays:14,payDateOffsetDays:13,schedStart:'09:00',schedEnd:'17:00',
  holidays:[],banks:[],daysOff:[]},
  sessions:[],activeStart:null,unit:'sec',planOn:false,plannedHours:8,sound:false};

async function boot(ctx, seed, atMs){
  const p=await ctx.newPage();
  p.on('pageerror',e=>{console.log('  PAGE ERROR:',e.message);fails++;});
  p.on('console',m=>{if(m.type()==='error'){console.log('  CONSOLE ERROR:',m.text());fails++;}});
  await p.addInitScript(([k,v])=>{
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded','1');
    localStorage.setItem(k,JSON.stringify(v));
  },[KEY,seed]);
  await p.clock.install({time:new Date(atMs)});
  await p.goto('http://localhost:8122/'); await p.waitForTimeout(600);
  await p.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open')));
  await p.waitForTimeout(300);
  return p;
}
const pastRows = p => p.evaluate(()=>[...document.querySelectorAll('#pastList .pastrow')].map(r=>({
  when: r.querySelector('.r1').textContent.trim(),
  amt:  r.querySelector('.amt').textContent.trim(),
  sub:  r.querySelector('.r2').innerText.replace(/\s+/g,' ').trim(),
  pay:  r.querySelector('.r2b').innerText.replace(/\s+/g,' ').trim()})));
const ctx = await b.newContext({viewport:{width:1100,height:2600},timezoneId:'America/New_York',locale:'en-US'});

// 16 h in period 0, 24 h in period 1, 8 h so far in period 2.
const WORK=[sh('a',7,27,9,17), sh('b',7,28,9,17),
            sh('c',8,10,9,17), sh('d',8,11,9,17), sh('e',8,12,9,17),
            sh('f',8,24,9,17)];

console.log('\n━━ It lives in the Pay period card ━━');
let p = await boot(ctx, {...base, sessions:WORK}, T(8,25,12));
ok('the button is inside the pay period section',
   await p.evaluate(()=>!!document.querySelector('#period #pastBtn')));
ok('folded away to start with', !(await p.isVisible('#pastBody')));
ok('and says so', (await p.getAttribute('#pastBtn','aria-expanded'))==='false');
ok('the header counts what is behind you', (await p.textContent('#pastSum')).includes('2 completed'),
   await p.textContent('#pastSum'));

console.log('\n━━ Opening it ━━');
await p.click('#pastBtn'); await p.waitForTimeout(400);
ok('it opens', await p.isVisible('#pastBody'));
ok('the button flips', (await p.getAttribute('#pastBtn','aria-expanded'))==='true');
ok('the whole section did not fold', await p.isVisible('#prange'));
let rows = await pastRows(p);
console.log(rows.map(r=>`       ${r.when}  ${r.amt}  ${r.sub}  ${r.pay}`).join('\n'));
ok('two completed periods', rows.length===2, String(rows.length));

console.log('\n━━ The one that just ended ━━');
ok('newest first — Aug 9 to Aug 22', rows[0].when.includes('Aug 9') && rows[0].when.includes('Aug 22'),
   rows[0].when);
ok('24 hours', rows[0].sub.includes('24.00 h'), rows[0].sub);
ok('$912.00 gross', rows[0].amt==='$912.00', rows[0].amt);
ok('payday Fri Sep 4', rows[0].pay.includes('Sep 4'), rows[0].pay);
ok('not paid yet', rows[0].pay.includes('DUE') && rows[0].pay.includes('pays'), rows[0].pay);

console.log('\n━━ The one before it ━━');
ok('Jul 26 to Aug 8', rows[1].when.includes('Jul 26') && rows[1].when.includes('Aug 8'), rows[1].when);
ok('16 hours', rows[1].sub.includes('16.00 h'), rows[1].sub);
ok('$608.00', rows[1].amt==='$608.00', rows[1].amt);
ok('already paid, Aug 21', rows[1].pay.includes('PAID') && rows[1].pay.includes('Aug 21'), rows[1].pay);

console.log('\n━━ The period you are standing in is not in the list ━━');
ok('no Aug 23 row', !rows.some(r=>r.when.includes('Aug 23')), JSON.stringify(rows.map(r=>r.when)));
ok('but it is still the live one above', (await p.textContent('#prange')).includes('Aug 23'),
   await p.textContent('#prange'));

console.log('\n━━ Gross and net toggle ━━');
ok('gross is the default', await p.evaluate(()=>
   document.querySelector('#pastView button[data-v="gross"]').classList.contains('on')));
await p.click('#pastView button[data-v="net"]'); await p.waitForTimeout(400);
rows = await pastRows(p);
console.log(rows.map(r=>`       ${r.when}  ${r.amt}  ${r.sub}`).join('\n'));
ok('the amount changed to net', rows[0].amt!=='$912.00', rows[0].amt);
ok('and is less than gross', parseFloat(rows[0].amt.replace(/[$,]/g,''))<912,
   rows[0].amt);
const detail = await p.evaluate(()=>document.querySelector('#pastList .pastrow').innerText.replace(/\s+/g,' '));
ok('gross is still shown alongside it', detail.includes('gross $912.00'), detail);
ok('and what was withheld', detail.includes('withheld'), detail);
ok('the hours are still there', rows[0].sub.includes('24.00 h'), rows[0].sub);
ok('a note explains what the estimate is based on', await p.isVisible('#pastNote'));
await p.click('#pastView button[data-v="gross"]'); await p.waitForTimeout(400);
ok('switching back restores gross', (await pastRows(p))[0].amt==='$912.00');

console.log('\n━━ Overtime shows per period ━━');
await p.close();
const heavy=[];
for (let d=26; d<=31; d++) heavy.push(sh('h'+d,7,d,8,20));   // 6 x 12 h = 72 h in period 0
p = await boot(ctx, {...base, sessions:heavy.concat([sh('z',8,24,9,17)])}, T(8,25,12));
await p.click('#pastBtn'); await p.waitForTimeout(400);
rows = await pastRows(p);
ok('72 h in that period', rows[0].sub.includes('72.00 h'), rows[0].sub);
ok('with the overtime called out', /\d+\.\d\d h OT/.test(rows[0].sub), rows[0].sub);
// 40 straight + 32 OT = 40*38 + 32*57 = 1520 + 1824 = 3344
ok('and priced with it — $3,344.00', rows[0].amt==='$3,344.00', rows[0].amt);

console.log('\n━━ A period you did not work is left out ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[sh('a',7,27,9,17), sh('f',8,24,9,17)]}, T(8,25,12));
await p.click('#pastBtn'); await p.waitForTimeout(400);
rows = await pastRows(p);
ok('only the period with work in it', rows.length===1, String(rows.length));
ok('which is Jul 26 – Aug 8', rows[0].when.includes('Jul 26'), rows[0].when);
ok('the header counts one', (await p.textContent('#pastSum')).includes('1 completed'),
   await p.textContent('#pastSum'));

console.log('\n━━ Before anything has completed ━━');
await p.close();
p = await boot(ctx, {...base, sessions:[sh('a',7,27,9,17)]}, T(7,30,12));   // still in period 0
ok('the header says nothing', (await p.textContent('#pastSum'))==='', await p.textContent('#pastSum'));
await p.click('#pastBtn'); await p.waitForTimeout(400);
ok('and it explains rather than showing an empty box',
   (await p.textContent('#pastList')).includes('once it ends'), await p.textContent('#pastList'));

console.log('\n━━ Holidays and booked days are in the totals ━━');
await p.close();
p = await boot(ctx, {...base, sessions:WORK, cfg:{...base.cfg,
  banks:[{id:'float',name:'Floating holiday',count:4,hours:8,ot:true,slots:['Birthday','Anniversary','MLK Day','Extra floater']}],
  daysOff:[{id:'x',bank:'float',slot:0,date:'2026-08-11',hours:8}]}}, T(8,25,12));
await p.click('#pastBtn'); await p.waitForTimeout(400);
rows = await pastRows(p);
ok('the floater is counted — 32 h', rows[0].sub.includes('32.00 h'), rows[0].sub);
ok('and paid — $1,216.00', rows[0].amt==='$1,216.00', rows[0].amt);

console.log('\n━━ The choice sticks ━━');
await p.reload(); await p.waitForTimeout(700);
await p.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open')));
await p.waitForTimeout(300);
ok('still open after a reload', await p.isVisible('#pastBody'));
await p.click('#pastView button[data-v="net"]'); await p.waitForTimeout(400);
await p.reload(); await p.waitForTimeout(700);
await p.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open')));
await p.waitForTimeout(300);
ok('and still on net', await p.evaluate(()=>
   document.querySelector('#pastView button[data-v="net"]').classList.contains('on')));
await p.click('#pastBtn'); await p.waitForTimeout(350);
ok('closing it sticks too', !(await p.isVisible('#pastBody')));

console.log('\n━━ The live clock is unaffected ━━');
await p.close();
p = await boot(ctx, {...base, sessions:WORK, activeStart:T(8,25,9)}, T(8,25,12));
await p.click('#pastBtn'); await p.waitForTimeout(400);
ok('the timer still runs', /^0?3:00:0\d$/.test(await p.textContent('#timer')), await p.textContent('#timer'));
const before = await p.textContent('#timer');
await p.clock.fastForward('00:00:03'); await p.waitForTimeout(400);
ok('and keeps ticking with the list open', (await p.textContent('#timer'))!==before,
   before + ' → ' + await p.textContent('#timer'));
ok('the running shift is not in the completed list',
   !(await pastRows(p)).some(r=>r.when.includes('Aug 23')));

console.log('\n━━ On a phone ━━');
await p.close();
const mob = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  deviceScaleFactor:3,timezoneId:'America/New_York',locale:'en-US'});
p = await boot(mob, {...base, sessions:WORK}, T(8,25,12));
await p.click('#pastBtn'); await p.waitForTimeout(400);
const m = await p.evaluate(()=>({
  pageW:document.documentElement.scrollWidth, winW:window.innerWidth,
  btn:Math.round(document.getElementById('pastBtn').getBoundingClientRect().height),
  row:Math.round(document.querySelector('.pastrow').getBoundingClientRect().height),
  amtVisible: document.querySelector('.pastrow .amt').getBoundingClientRect().right <= window.innerWidth
}));
ok('no sideways scroll', m.pageW<=m.winW+1, `${m.pageW} vs ${m.winW}`);
ok('the button is a real tap target', m.btn>=40, `${m.btn}px`);
ok('rows are readable', m.row>=40, `${m.row}px`);
ok('and the amount is on screen', m.amtVisible);

console.log('\n━━ By pay month lists the cheques, not just the total ━━');
/* It used to name the paydays on one line with no amounts — "paydays Wed Sep 2 and Wed
   Sep 16" — which says when money arrives but not how much arrives on each. That is the
   question a calendar month is being asked. */
{
  const p2 = await boot(ctx, {...base, sessions: WORK, ui:{mon:true}}, T(8,24,12));
  await p2.evaluate(()=>{ uiOpen().mon = true; save(); lastHeavySig=''; render(); });
  await p2.waitForTimeout(500);
  const rows = await p2.evaluate(()=>[...document.querySelectorAll('#monList .monrow')].map(r=>({
    month: r.querySelector('.m').textContent.trim(),
    total: r.querySelector('.amt').textContent.trim(),
    count: r.querySelector('.subr').textContent.trim(),
    cheques: [...r.querySelectorAll('.chq')].map(c=>({
      date: c.querySelector('.cd').textContent.trim(),
      amt:  c.querySelector('.ca').textContent.trim(),
      paid: c.classList.contains('paid') })) })));
  const num = v => parseFloat(String(v).replace(/[^0-9.]/g,''));
  ok('there are months to show', rows.length>0, String(rows.length));
  ok('every month breaks into at least one cheque',
     rows.every(r=>r.cheques.length>0),
     rows.map(r=>r.month+':'+r.cheques.length).join(' '));
  /* The invariant worth guarding: the lines have to add up to the figure above them. */
  const off = rows.filter(r=>Math.abs(r.cheques.reduce((a,c)=>a+num(c.amt),0)-num(r.total))>0.01);
  ok('and the cheques sum to the month total', off.length===0,
     off.map(r=>r.month+' '+r.total).join(' | '));
  ok('each cheque carries its own date and amount',
     rows.every(r=>r.cheques.every(c=>/\w/.test(c.date) && /\d/.test(c.amt))),
     JSON.stringify(rows[0]&&rows[0].cheques));
  ok('the count agrees with the lines drawn',
     rows.every(r=>r.cheques.length===1 ? /one payday/.test(r.count)
                                        : r.count.indexOf(String(r.cheques.length))===0),
     rows.map(r=>r.count+'/'+r.cheques.length).join(' '));
  /* A cheque already in the bank should not look like one still coming. */
  const anyPaid = rows.some(r=>r.cheques.some(c=>c.paid));
  ok('a cheque already paid is marked as such', anyPaid,
     JSON.stringify(rows.map(r=>r.cheques.map(c=>c.paid))));
  ok('the old one-line payday string is gone',
     !/paydays\s+\w{3}\s/.test(await p2.textContent('#monList')),
     (await p2.textContent('#monList')).slice(0,90));
  await p2.close();
}

console.log(`\n${fails===0?'✅':'❌'}  ${fails===0?'all passed':fails+' failed'}`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
