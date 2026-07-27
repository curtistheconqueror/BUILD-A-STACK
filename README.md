# Pay Clock

A live earnings clock. Clock in and watch your pay climb in real time — through straight time, into overtime, across pay periods.

One self-contained HTML file. No build, no server, no dependencies. Open it and it works, online or off.

> **This branch stands alone.** It shares no history with the rest of the repository and contains only this app, so it can be lifted into its own repository at any time. See [Splitting this out](#splitting-this-out-into-its-own-repo).

## Use it

**On a computer** — download `index.html` and open it. That's it. (Viewing it on GitHub shows the source code rather than the page; that's just how GitHub displays `.html` files.)

**On a phone** — once this branch is served over HTTPS (see [Hosting](#hosting)), open the URL and choose **Add to Home Screen** on iOS, or **Install app** on Android. You get an icon that opens fullscreen with no browser bars and runs with no signal.

## What it does

**Earnings that move.** Clock in and the counter climbs at your hourly rate. The **SEC / MIN / HR** toggle sets how the number steps — every second, every minute, or every hour — while the elapsed timer runs live regardless. At $38/hr that's $0.0106 a second, $0.6333 a minute.

**Overtime at 1.5×, switching mid-shift.** Cross the threshold at hour 39 and the *rest of that same shift* bills at the overtime rate, split at the exact crossing point rather than rounded into whichever bucket the shift started in. Two rules:

| Rule | Threshold | Resets |
|---|---|---|
| Weekly *(default)* | 40 h | Every week, on your chosen start day |
| Pay period | 80 h | Every pay period |

Weekly is how US payroll normally calculates overtime — it's owed per workweek, and a slow week can't cancel out overtime already earned in a busy one. That's why it's the default. The 80 h rule is there if your employer genuinely runs a cumulative period.

**A period total that keeps climbing.** The weekly figures reset each week, but *Pay period progress* holds a cumulative total that runs from day one to payday, with a card per week beneath it and a bar counting down the hours until every remaining hour bills at overtime.

**Pay periods that keep themselves.** Set one start date and a length; they repeat from there forever, rolling over on schedule and starting the counters fresh. No reconfiguring every two weeks.

**Stop on your terms.** Clock out by hand, or set a target for the day and it stops itself the moment you reach it — counting hours you already banked earlier that day.

**A shift log you can correct.** Add shifts you forgot, by duration (*date + 10 hours*) or exact clock times, with a live preview of the hours and pay before you save. Edit or delete any of them. A shift running past midnight is understood as overnight rather than rejected. Export to CSV to check against a real paystub.

## It survives real life

Every figure derives from wall-clock timestamps, never from counting ticks. Refresh the page, background the tab, sleep the machine mid-shift — it recovers the correct amount instead of drifting or losing time. Data persists in the browser, and two open tabs stay in sync rather than overwriting each other.

## First run

Nothing personal ships in this file. The first launch asks for your hourly rate, when your current pay period started, how long a period is, when payday lands, and which overtime rule applies — previewing the resulting period and overtime rate before you save. Those values live in your browser and nowhere else.

Change any of them later under **Settings**.

## Hosting

GitHub Pages serves this branch directly, because the app sits at the branch root:

**Settings → Pages → Source: Deploy from a branch → Branch: `pay-clock` / `(root)`**

The published URL is what you install from on a phone. Pages on a private repository requires a paid GitHub plan; on a free plan the repository must be public. Nothing personal is in the code either way — your numbers are entered at first run and stay on your device.

## Splitting this out into its own repo

This branch is an orphan: no shared history, no files from the parent project, app at the root. Moving it is a push, not a migration.

```sh
# create an empty repo on GitHub first (no README, no .gitignore), then:
git clone --single-branch --branch pay-clock <this-repo-url> pay-clock
cd pay-clock
git remote set-url origin <new-repo-url>
git branch -m pay-clock main
git push -u origin main
```

Full history comes with it, nothing needs rewriting, and the Pages setting moves to `main` / `(root)`.

## Tests

```sh
npm test
```

62 assertions, no dependencies. They cover period and week boundaries, both overtime rules, mid-shift threshold crossings, overnight and DST-spanning shifts, period rollover, auto-stop targets, and the SEC/MIN/HR stepping.

The suite extracts the pay engine directly out of `index.html`, so what's tested is exactly what ships — there's no second copy to fall out of sync.

## Files

| | |
|---|---|
| `index.html` | The entire app — markup, styling, pay engine, UI |
| `manifest.webmanifest`, `sw.js`, `icons/` | Home-screen install and offline cache |
| `tests/` | The engine test suite |

## Worth knowing

- Figures are **gross** — before taxes and deductions. This won't match your take-home.
- Data lives only in the browser you use it in. Nothing is sent anywhere, and nothing syncs between devices — so clock in and out in one place, or your hours end up split across copies.
- This is your own record, not your employer's system of record.
