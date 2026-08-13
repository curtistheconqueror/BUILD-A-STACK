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


const KEY='payclock.v1', R = ROOT;
const srv=http.createServer((q,r)=>{
  const u=q.url||'/';
  if(u.startsWith('/sw.js')){r.writeHead(200,{'Content-Type':'text/javascript'});return r.end(readFileSync(R+'sw.js'));}
  if(u.startsWith('/manifest')){r.writeHead(200,{'Content-Type':'application/manifest+json'});return r.end(readFileSync(R+'manifest.webmanifest'));}
  if(u.indexOf('.png')>-1){r.writeHead(404);return r.end();}
  r.writeHead(200,{'Content-Type':'text/html'});r.end(readFileSync(R+'index.html'));
}).listen(8083);
let fails=0; const ok=(n,c,x='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${x?'  → '+x:''}`); if(!c)fails++;};
const openAll=async pg=>{ try{ await pg.evaluate(()=>document.querySelectorAll('.col').forEach(c=>c.classList.add('open'))); }catch(e){} };
const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({timezoneId:'America/New_York',locale:'en-US',viewport:{width:900,height:1900},acceptDownloads:true});
const jul=(d,h)=>+new Date(2026,6,d,h);
const seed=(o={})=>({configured:true,
  cfg:{rate:38,periodAnchor:'2026-07-26',otMode:'period',periodLengthDays:14,payDateOffsetDays:13,weekStartDay:0},
  sessions:o.sessions||[],activeStart:o.activeStart||null,unit:'sec',planOn:false,plannedHours:8,sound:false,
  ...(o.extra||{})});
let p;
async function boot(st,url){
  if(p) await p.close();
  p=await ctx.newPage(); p.on('pageerror',e=>{console.log('  💥',e.message);fails++;});
  p.on('console',m=>{if(m.type()==='error'){console.log('  💥',m.text());fails++;}});
  await p.addInitScript(([k,v])=>{if(sessionStorage.getItem('__s'))return;sessionStorage.setItem('__s','1');
    localStorage.setItem(k,JSON.stringify(v));},[KEY,st]);
  await p.clock.install({time:new Date('2026-07-30T21:00:00Z')});
  await p.goto('http://localhost:8083/'+(url||'')); await p.waitForTimeout(400); await openAll(p);
}
const T=s=>p.textContent(s), N=async s=>parseFloat((await T(s)).replace(/[$,−]/g,''));

// expected tax math at $38, single/0dep, IL, biweekly=26
const fed=g=>{const t=Math.max(0,g*26-16100);let x=0;const br=[[0,.10],[12400,.12],[50400,.22],[105700,.24]];
  for(let i=0;i<br.length;i++){const hi=i+1<br.length?br[i+1][0]:Infinity;if(t<=br[i][0])break;x+=(Math.min(t,hi)-br[i][0])*br[i][1];}
  return x/26;};
const taxes=g=>fed(g)+g*0.0495+g*0.062+g*0.0145;

console.log('\n━━ The interview appears the first time you pick NET ━━');
await boot(seed({sessions:[{id:'a',start:jul(29,8),end:jul(29,18)}]}));   // 10 h = $380 gross
ok('toggle shows GROSS active', await p.evaluate(()=>document.querySelector('#payMode button[data-p="gross"]').classList.contains('on')));
await p.click('#payMode button[data-p="net"]'); await p.waitForTimeout(300);
ok('setup interview opens', await p.isVisible('#netsetup'));
ok('asks filing status', await p.isVisible('#nFiling'));
ok('asks dependents', await p.isVisible('#nDeps'));
ok('IL 4.95% preset', (await p.inputValue('#nStatePct'))==='4.95');
ok('FICA on by default', await p.isChecked('#nFica'));
ok('healthcare and dues rows seeded', (await p.locator('.nitem').count())===2);
ok('preview shows standard-check take-home', (await T('#nPreview')).includes('80 h check'), (await T('#nPreview')).replace(/\s+/g,' ').slice(0,80));

console.log('\n━━ Cancel = stays gross; nothing forced ━━');
await p.click('#nCancel'); await p.waitForTimeout(250);
ok('interview closed', !(await p.isVisible('#netsetup')));
ok('still on GROSS', await p.evaluate(()=>document.querySelector('#payMode button[data-p="gross"]').classList.contains('on')));

console.log('\n━━ Complete the interview with your numbers ━━');
await p.click('#payMode button[data-p="net"]'); await p.waitForTimeout(250);
await p.fill('.nitem[data-id="health"] input[data-f="amount"]','150'); await p.waitForTimeout(150);
await p.fill('.nitem[data-id="dues"] input[data-f="amount"]','60'); await p.waitForTimeout(150);
await p.click('#nAdd'); await p.waitForTimeout(150);
const newRow = await p.locator('.nitem').nth(2);
await newRow.locator('input[data-f="name"]').fill('401k loan');
await newRow.locator('input[data-f="amount"]').fill('120'); await p.waitForTimeout(250);
const pv=await T('#nPreview');
ok('preview includes fixed $330', pv.includes('330'), pv.replace(/\s+/g,' ').slice(-90));
await p.click('#nSave'); await p.waitForTimeout(400);
ok('interview closes on save', !(await p.isVisible('#netsetup')));
ok('NET is now active', await p.evaluate(()=>document.querySelector('#payMode button[data-p="net"]').classList.contains('on')));

console.log('\n━━ Default view: net is the big number, gross the small line ━━');
// 10 h worked, $380 gross. frac=10/80. fixed applied=330*.125=41.25, health pre applied 18.75
const gross=380, frac=10/80, preApp=150*frac, postApp=(60+120)*frac;
const taxable=gross-preApp;
const expTax=fed(taxable)+taxable*(0.0495+0.062+0.0145);
const expNet=gross-preApp-expTax-postApp;
const shown=await N('#cumeGross');
ok('period progress big number is NET', Math.abs(shown-expNet)<0.75, `shown $${shown} vs expected ~$${expNet.toFixed(2)}`);
ok('label says Kept', (await T('#progress .cumelbl')).includes('Kept'), await T('#progress .cumelbl'));
ok('sub-line shows gross', (await T('#cumeSub')).includes('380.00'), await T('#cumeSub'));
ok('sub-line shows deductions', (await T('#cumeSub')).toLowerCase().includes('deductions'));
ok('hero netline visible when clocked out', await p.isVisible('#netline'));
await p.screenshot({path:join(TMP, '30-net-default.png'), fullPage:true});

console.log('\n━━ Live session counts in net ━━');
await p.click('#punch'); await p.waitForTimeout(250);
await p.clock.fastForward(2*3600_000); await p.waitForTimeout(300);
const big=await N('#money');
ok('session net is positive and below gross', big>30 && big<76, `$${big} for 2 h ($76 gross)`);
ok('netline shows the shift gross', (await T('#netline')).includes('76.0'), await T('#netline'));
await p.click('#punch'); await p.waitForTimeout(250);

console.log('\n━━ Hole view: start negative, climb to green ━━');
await boot(seed({extra:{net:{enabled:true,configured:true,view:'hole',filing:'single',dependents:0,
  fedExempt:false,fedOverride:null,statePct:4.95,stateExempt:false,stateOverride:null,ficaOn:true,
  items:[{id:'h',name:'Health',amount:150,pretax:true},{id:'d',name:'Dues',amount:60,pretax:false},
         {id:'l',name:'401k loan',amount:120,pretax:false}]}}}));
ok('with nothing worked, shows -330', Math.abs(Math.abs(await N('#money'))-330)<0.01 &&
   (await T('#money')).includes('-'), await T('#money'));
ok('big number is red (inhole)', await p.evaluate(()=>document.getElementById('money').classList.contains('inhole')));
ok('netline says how far to green', (await T('#netline')).includes('to go until'), await T('#netline'));
await p.screenshot({path:join(TMP, '31-hole-start.png'), fullPage:true});

await p.click('#punch'); await p.waitForTimeout(250);
await p.clock.fastForward(11*3600_000); await p.waitForTimeout(350);   // 11 h on the clock
const holeNow=parseFloat((await T('#money')).replace(/[$,\u2212-]/g,''));
const g11=38*11, tax11=fed(g11-150)+ (g11-150)*(0.0495+0.062+0.0145);
const expHole=Math.abs(g11-150-tax11-180-0);   // full fixed up front: pre 150, post 180
ok('after 11 h the hole is nearly closed', Math.abs(holeNow-expHole)<1.2,
   `shown $${holeNow.toFixed(2)} vs expected ~$${expHole.toFixed(2)}`);
await p.clock.fastForward(3*3600_000); await p.waitForTimeout(350);    // push clearly into green
ok('crosses into the green', !(await T('#money')).includes('-'), await T('#money'));
ok('red state cleared', !(await p.evaluate(()=>document.getElementById('money').classList.contains('inhole'))));
ok('netline flips to in the green', (await T('#netline')).includes('in the green'), await T('#netline'));
await p.screenshot({path:join(TMP, '32-hole-green.png'), fullPage:true});
await p.click('#punch'); await p.waitForTimeout(250);

console.log('\n━━ Toggling back to GROSS restores the old face ━━');
await p.click('#payMode button[data-p="gross"]'); await p.waitForTimeout(300);
ok('netline hidden', !(await p.isVisible('#netline')));
ok('progress label back to Earned', (await T('#progress .cumelbl')).includes('Earned'));
await p.click('#payMode button[data-p="net"]'); await p.waitForTimeout(300);
ok('NET returns without re-interview', !(await p.isVisible('#netsetup')) && await p.isVisible('#netline'));

console.log('\n━━ Everything survives a reload ━━');
await p.reload(); await p.waitForTimeout(450); await openAll(p);
ok('still in NET mode', await p.isVisible('#netline'));
ok('still hole view, still shows period figure', (await T('#netline')).length>3, await T('#netline'));

console.log('\n━━ Backup carries the whole net setup ━━');
await p.evaluate(()=>{document.querySelectorAll('#cfg details').forEach(d=>d.open=true);});
const dl=await Promise.all([p.waitForEvent('download'),p.click('#backup')]).then(r=>r[0]);
await dl.saveAs(join(TMP, 'net-backup.json'));
const bk=JSON.parse(readFileSync(join(TMP, 'net-backup.json'),'utf8'));
ok('backup has net config', bk.net && bk.net.configured===true && bk.net.items.length===3);
await p.click('#wipe'); await p.waitForTimeout(150); await p.click('#wipe'); await p.waitForTimeout(400);
await p.setInputFiles('#restoreFile',join(TMP, 'net-backup.json')); await p.waitForTimeout(500); await openAll(p);
ok('restore brings net mode back', await p.isVisible('#netline'));

console.log('\n━━ Widget mode shows net too ━━');
await boot(seed({sessions:[{id:'a',start:jul(29,8),end:jul(29,18)}],extra:{net:{enabled:true,configured:true,view:'net',
  filing:'single',dependents:0,fedExempt:false,fedOverride:null,statePct:4.95,stateExempt:false,stateOverride:null,
  ficaOn:true,items:[{id:'h',name:'Health',amount:150,pretax:true}]}}}), '?widget=1');
const wm=parseFloat((await T('#wmoney')).replace(/[$,\u2212-]/g,''));
ok('widget big number is net, not gross', wm>0 && wm<380*0.9, `$${wm} (gross $380)`);
ok('widget sub says net', (await T('#wsub')).includes('net'), await T('#wsub'));

console.log('\n━━ Gross-mode regression: nothing changed when net is off ━━');
await boot(seed({sessions:[{id:'a',start:jul(29,8),end:jul(29,18)}]}));
ok('big number is plain gross', (await T('#money'))==='$0.00');
ok('no netline', !(await p.isVisible('#netline')));
ok('progress shows gross $380', Math.abs((await N('#cumeGross')))-380<0.01, await T('#cumeGross'));
ok('label is Earned', (await T('#progress .cumelbl')).includes('Earned'));

console.log(`\n${fails===0?'✅':'❌'}  net pay UI: ${fails} failure(s)\n`);
await b.close(); srv.close(); process.exit(fails?1:0);
