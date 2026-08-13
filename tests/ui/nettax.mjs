import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// The app under test sits two directories up from tests/ui/.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
// Set PW_CHROME to point at a specific build; otherwise Playwright finds its own.
const CHROME = process.env.PW_CHROME || undefined;

const html = readFileSync(ROOT + 'index.html','utf8');
const m = html.match(/\/\* ==ENGINE-START==[\s\S]*?\*\/([\s\S]*?)\/\* ==ENGINE-END== \*\//);
const E = new Function(m[1] + `return {TAX2026,bracketTax,fedWithholding,netBreakdown,periodNetView};`)();
let pass=0,fail=0;
const ok=(n,c,x='')=>{ if(c){pass++;console.log('  ok   '+n);} else {fail++;console.log('  FAIL '+n+(x?'  → '+x:''));} };
const near=(n,g,w,tol=0.01)=>ok(n,Math.abs(g-w)<=tol,`got ${g.toFixed(4)}, want ${w.toFixed(4)}`);
const N={filing:'single',dependents:0,ficaOn:true,statePct:4.95};
const CFG={periodLengthDays:14};

console.log('\nHand-checked: $38/hr x 80 h biweekly, single, 0 dependents, Illinois');
// annual 79,040 - 16,100 std = 62,940 taxable
// fed: 1,240 + 4,560 + 2,758.80 = 8,558.80 / 26 = 329.1846
const bd = E.netBreakdown(3040, 0, 0, N, 26);
near('federal per period', bd.fed, 8558.80/26);
near('Illinois 4.95%', bd.state, 3040*0.0495);
near('Social Security 6.2%', bd.ss, 188.48);
near('Medicare 1.45%', bd.medicare, 44.08);
near('net check', bd.net, 3040 - 8558.80/26 - 150.48 - 188.48 - 44.08);
console.log(`    -> take-home on a standard check: $${bd.net.toFixed(2)} of $3,040.00 (${(100*bd.net/3040).toFixed(1)}%)`);

console.log('\nOT scales the taxes (the "preset unless OT" behavior)');
const ot = E.netBreakdown(3040+10*57, 0, 0, N, 26);   // +10 OT hours
ok('gross up by $570', Math.abs(ot.gross-bd.gross-570)<0.01);
ok('federal withholding rose', ot.fed > bd.fed, `${bd.fed.toFixed(2)} -> ${ot.fed.toFixed(2)}`);
ok('and by more than 12% of the extra (22% bracket)', (ot.fed-bd.fed) > 0.12*570, (ot.fed-bd.fed).toFixed(2));
near('state rose by 4.95% of extra', ot.state-bd.state, 570*0.0495);

console.log('\nPre-tax vs post-tax');
const pre  = E.netBreakdown(3040, 200, 0, N, 26);   // $200 health premium pre-tax
const post = E.netBreakdown(3040, 0, 200, N, 26);   // same $200 after tax
ok('pre-tax lowers the tax bill', pre.taxes < bd.taxes, `${bd.taxes.toFixed(2)} -> ${pre.taxes.toFixed(2)}`);
near('post-tax does not', post.taxes, bd.taxes);
ok('so pre-tax nets more than post-tax', pre.net > post.net, `${pre.net.toFixed(2)} vs ${post.net.toFixed(2)}`);
near('post-tax net = plain net - 200', post.net, bd.net-200);

console.log('\nDependents, exemption, overrides');
const dep = E.netBreakdown(3040, 0, 0, {...N,dependents:2}, 26);
near('2 dependents cut fed by 2x2200/26', bd.fed-dep.fed, 4400/26);
ok('fed never negative', E.netBreakdown(500,0,0,{...N,dependents:9},26).fed===0);
ok('fed exempt zeroes it', E.netBreakdown(3040,0,0,{...N,fedExempt:true},26).fed===0);
near('fed override honored', E.netBreakdown(3040,0,0,{...N,fedOverride:300},26).fed, 300);
near('state override honored', E.netBreakdown(3040,0,0,{...N,stateOverride:100},26).state, 100);
ok('fica off zeroes both', (()=>{const b=E.netBreakdown(3040,0,0,{...N,ficaOn:false},26);return b.ss===0&&b.medicare===0;})());

console.log('\nThe two views');
const items=[{name:'Health',amount:150,pretax:true},{name:'Dues',amount:60,pretax:false},{name:'401k loan',amount:120,pretax:false}];
// default view at 0 hours: everything zero
const v0 = E.periodNetView(0, 0, items, N, CFG, 'net');
near('default view starts at 0', v0.net, 0);
// hole view at 0 hours: minus all fixed
const h0 = E.periodNetView(0, 0, items, N, CFG, 'hole');
near('hole view starts at -330', h0.net, -330);
// both end identically at a full 80 h
const vEnd = E.periodNetView(3040, 80, items, N, CFG, 'net');
const hEnd = E.periodNetView(3040, 80, items, N, CFG, 'hole');
near('views agree at 80 h', vEnd.net, hEnd.net);
ok('default view climbs monotonically', (()=>{
  let last=-1;
  for(let h=1;h<=80;h++){const v=E.periodNetView(38*h,h,items,N,CFG,'net').net; if(v<last)return false; last=v;}
  return true;})());
// hole crossing: find where it turns positive and confirm it's after covering fixed
let cross=0;
for(let h=1;h<=80;h++){ if(E.periodNetView(38*h,h,items,N,CFG,'hole').net>=0){cross=h;break;} }
ok('hole crosses into the green mid-period', cross>5 && cross<25, `at hour ${cross}`);
console.log(`    -> with these deductions you'd be "absolutely in the plus" ${cross} hours in`);

console.log('\nEdges');
ok('zero gross never NaN', Number.isFinite(E.netBreakdown(0,0,0,N,26).net));
ok('pre-tax larger than gross clamps', E.netBreakdown(100,500,0,N,26).taxable===0);
near('SS honors the wage base', E.netBreakdown(10000,0,0,N,26).ss, (184500/26)*0.062);

console.log('\nOvertime tax break (2025-2028 law)');
const CFGR={periodLengthDays:14, rate:38, otMultiplier:1.5};
// 90 h period: 80 straight + 10 OT. Premium = 10 x $19 = $190.
const on  = E.periodNetView(80*38+10*57, 90, [], {...N,otBreak:true},  CFGR, 'hole', 10, 0);
const off = E.periodNetView(80*38+10*57, 90, [], {...N,otBreak:false}, CFGR, 'hole', 10, 0);
near('deducts exactly the $190 premium', on.otDeducted, 190);
ok('federal drops with the break on', on.fed < off.fed, `${off.fed.toFixed(2)} -> ${on.fed.toFixed(2)}`);
near('by 22% of the premium (bracket rate)', off.fed-on.fed, 190*0.22/1, 0.5);
near('FICA untouched by the break', on.ss+on.medicare, off.ss+off.medicare);
near('state untouched by the break', on.state, off.state);
// cap: if $12,400 of premium already used this year, only $100 of room remains
const capped = E.periodNetView(80*38+10*57, 90, [], {...N,otBreak:true}, CFGR, 'hole', 10, 12400);
near('cap limits the deduction to the room left', capped.otDeducted, 100);
const spent = E.periodNetView(80*38+10*57, 90, [], {...N,otBreak:true}, CFGR, 'hole', 10, 12500);
near('no room, no deduction', spent.otDeducted, 0);
near('married cap is $25,000', E.TAX2026.otCap.married, 25000);
ok('no OT hours, no deduction', !E.periodNetView(3040, 80, [], {...N,otBreak:true}, CFGR, 'hole', 0, 0).otDeducted);

console.log(`\n${fail===0?'✅':'❌'}  net tax engine: ${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
