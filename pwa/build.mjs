/**
 * Build the installable phone-app version of the widget.
 *
 *   node pwa/build.mjs [outDir]      # default: pwa/dist
 *
 * Generates index.html from pay-clock.html by adding the manifest link, iOS
 * home-screen meta, notch-safe padding, and service-worker registration, then
 * copies the static assets alongside it. The app itself is never duplicated —
 * pay-clock.html stays the single source of truth.
 *
 * Serve the output over https (GitHub Pages works) and the page becomes
 * installable: Share -> Add to Home Screen on iOS, Install app on Android.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(here, 'dist');

const HEAD = `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#05080f" />
<meta name="description" content="Clock in and watch your pay accrue in real time." />
<link rel="manifest" href="./manifest.webmanifest" />
<link rel="apple-touch-icon" href="./apple-touch-icon.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Pay Clock" />`;

const SAFE_AREA = `.wrap{max-width:780px;margin:0 auto;
    padding:calc(26px + env(safe-area-inset-top)) calc(20px + env(safe-area-inset-right))
            calc(90px + env(safe-area-inset-bottom)) calc(20px + env(safe-area-inset-left))}`;

const REGISTER = `
/* Offline support. Registration failing is not fatal — the app still runs, it just
   needs a connection to load next time. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('./sw.js').catch(function(){});
  });
}
</script>
</body>`;

let html = readFileSync(join(root, 'pay-clock.html'), 'utf8');

// Each replacement must actually land — a silent miss would ship a page that
// looks fine in a browser but refuses to install.
const steps = [
  ['viewport meta', '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />', HEAD],
  ['safe-area padding', '.wrap{max-width:780px;margin:0 auto;padding:26px 20px 90px}', SAFE_AREA],
  ['service worker', '</script>\n</body>', REGISTER],
];
for (const [label, from, to] of steps) {
  if (!html.includes(from)) { console.error(`FATAL: could not apply ${label} — pay-clock.html changed shape`); process.exit(1); }
  html = html.replace(from, to);
}

mkdirSync(join(out, 'icons'), { recursive: true });
writeFileSync(join(out, 'index.html'), html);

const assets = ['manifest.webmanifest', 'sw.js', 'apple-touch-icon.png',
                'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];
for (const a of assets) {
  const src = join(here, a);
  if (!existsSync(src)) { console.error(`FATAL: missing asset ${a}`); process.exit(1); }
  copyFileSync(src, join(out, a));
}

console.log(`built ${assets.length + 1} files -> ${out}`);
console.log('serve that directory over https and it installs to a home screen.');
