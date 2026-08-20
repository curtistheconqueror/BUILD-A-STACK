// Simulate the widget IIFE against a minimal DOM to find the crash.
import { readFileSync } from 'fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// Pull out every <script> block and concatenate (there's one).
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

// --- Minimal DOM shim ---
function makeEl(id){
  return {
    id,
    classList: {
      _s: new Set(id === 'wcard' ? ['card','hide'] : []),
      add(c){ this._s.add(c); },
      remove(c){ this._s.delete(c); },
      toggle(c, force){ force ? this._s.add(c) : this._s.delete(c); },
      contains(c){ return this._s.has(c); }
    },
    style: {},
    textContent: '',
    innerText: '',
    className: '',
    value: '',
    onclick: null,
    querySelectorAll(){ return []; },
    addEventListener(){},
  };
}

const ids = ['wcard','wstatus','wmoney','wsub','wpunch','wexpand','noStore','toast',
  'setup','hero','period','totals','progress','log','cfg','sAnchor','status','statusTxt',
  'money','liveline','timer','seg','seghint','punch','planOn','planHrs','planEta',
  'prange','payday','pleft','payin','otBadge','dGross','dDet','wkKey','wGross','wDet',
  'pGross','pDet','otLbl','otNum','barReg','barOt','p80Badge','cumeGross','cumeSub',
  'weeks','p80Lbl','p80Num','p80Reg','p80Ot','p80Note','logBody','editor','eTitle',
  'eMode','eDate','eHours','fHours','fIn','fOut','eIn','eOut','ePreview','eErr',
  'eSave','eCancel','logActions','addShift','exportCsv','clearPeriod','clearConfirm',
  'clearYes','clearNo','cRate','cMult','cMode','cWeekStart','cWeekThr','cPeriodThr',
  'cAnchor','cLen','cPayOff','cSound','backup','restore','restoreFile','wipe','sRestore',
  'sRate','sLen','sPay','sMode','sPreview','sErr','sSave'];
const els = {};
ids.forEach(id => els[id] = makeEl(id));

const localStore = {};
global.localStorage = {
  getItem: k => (k in localStore ? localStore[k] : null),
  setItem: (k,v) => { localStore[k] = String(v); },
  removeItem: k => { delete localStore[k]; },
};

global.document = {
  getElementById: id => els[id] || null,
  querySelectorAll: sel => {
    if (sel.includes(':not(#wcard)')) {
      // return fake siblings
      return [makeEl('x1'), makeEl('x2')];
    }
    return [];
  },
  addEventListener(){},
  body: makeEl('body'),
  hidden: false,
};

global.window = {
  addEventListener(){},
  BroadcastChannel: class { constructor(){} postMessage(){} set onmessage(f){} },
};
global.location = { search: '?widget=1', href: '' };
global.navigator = {};
global.setInterval = () => {};
global.setTimeout = () => {};
global.requestAnimationFrame = () => {};

try {
  eval(scripts);
  console.log('NO CRASH');
  console.log('wcard classes after run:', [...els.wcard.classList._s].join(' '));
  console.log('wstatus text:', els.wstatus.textContent);
  console.log('wmoney text:', els.wmoney.textContent);
  console.log('wpunch text:', els.wpunch.textContent);
} catch (e) {
  console.log('CRASH:', e.message);
  console.log(e.stack.split('\n').slice(0,4).join('\n'));
}
