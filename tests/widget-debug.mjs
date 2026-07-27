import { chromium } from 'playwright';

const URL = 'https://curtistheconqueror.github.io/BUILD-A-STACK/?widget=1';
const browser = await chromium.launch();
const page = await browser.newPage();

const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// What does the DOM look like?
const report = await page.evaluate(() => {
  const w = document.getElementById('wcard');
  const cs = w ? getComputedStyle(w) : null;
  return {
    bodyClass: document.body.className,
    wcardExists: !!w,
    wcardClasses: w ? w.className : null,
    wcardDisplay: cs ? cs.display : null,
    wcardVisibility: cs ? cs.visibility : null,
    wcardRect: w ? JSON.stringify(w.getBoundingClientRect()) : null,
    wstatus: document.getElementById('wstatus')?.textContent,
    wmoney: document.getElementById('wmoney')?.textContent,
    wpunch: document.getElementById('wpunch')?.textContent,
    visibleText: document.body.innerText.slice(0, 300),
  };
});

console.log(JSON.stringify(report, null, 2));
console.log('ERRORS:', errors.length ? errors : 'none');

await page.screenshot({ path: '/tmp/widget.png', fullPage: true });
await browser.close();
