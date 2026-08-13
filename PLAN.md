# Build plan: professions, and more than one job

This is the roadmap for turning WiseWage from one person's hourly clock into an app that
knows what you do for a living and can hold more than one employer at once.

**If you are a session picking this repo up: read this before adding a feature.** There is
already one case in this repository's history — PR #6 — where a second lineage of this app
grew a feature the main lineage already had, because neither knew about the other. The
engine here is 620 assertions deep, with another ~1,500 driving the real page in
`tests/ui/`. Extend them; do not restart them.

---

## The idea underneath

What varies between professions is not a setting. It is **how money accrues**. There are
three models, and everything else follows from which one applies:

| Model | Money comes from | Examples |
|---|---|---|
| `clock` | Punch in, accrues per second, overtime rules apply | Nurse, transit operator, most hourly work |
| `units` | Log production, pays per unit above a threshold | Surgeon (wRVU), commission, piecework |
| `contract` | Fixed annual sum ÷ pay dates, plus stipends | Teacher |

Everything downstream of gross pay — the tax engine, year-to-date, projection, the net
breakdown, the exempt tracker, backup and restore — is **identical across all three** and is
already built. That shared half is the reason this is one codebase and not three apps.

A profession is therefore a **data record, not a code path**:

```js
var PROFESSIONS = {
  transit_operator: { group:'Transit',   role:'Operator', model:'clock',
                      otDefault:'weekly', premiums:['night'] },
  nurse:            { group:'Medical',   role:'Nurse',    model:'clock',
                      otDefault:'eighty80', otModes:['eighty80','weekly','daily'],
                      premiums:['night','weekend','charge','oncall','callback'],
                      callbackMin:2, deductions:['403b','457b'] },
  surgeon:          { group:'Medical',   role:'Surgeon',  model:'units', unit:'wRVU',
                      otModes:[], exempt:'29 CFR 541.304' },
  teacher:          { group:'Education', role:'Teacher',  model:'contract',
                      otModes:[], workMonths:10, payMonths:12,
                      stipends:true, pension:'TRS', ssExempt:true }
};
```

### Why a profession has to reach the tax engine, not just the UI

Illinois teachers in TRS pay **no Social Security at all**. They contribute 9% of creditable
earnings to TRS and pay Medicare only. Run a teacher through the current app and it deducts
6.2% that never leaves their check while omitting the 9% that does — wrong in both
directions at once. No checkbox fixes that. The profile has to drive `netBreakdown`.

The same logic runs the other way. Surgeons are exempt from overtime under 29 CFR 541.304,
teachers under the professional exemption. For those profiles the overtime engine should not
be *configured off* — it should not render at all.

---

## More than one job

The second employer is the deepest change in this plan, so it lands early and carefully.

### The shape

```js
state.jobs = [
  { id:'j1', name:'Pace', profession:'transit_operator', cfg:{…}, primary:true },
  { id:'j2', name:'…',    profession:'nurse',            cfg:{…} }
];
state.sessions = [ { …, jobId:'j1' }, … ];
```

Each job carries its **own complete `cfg`** — rate, schedule, overtime rule, holidays, banks,
differentials — and its **own profession**, because a second job is usually a different line
of work entirely.

### Each job builds its own ledger

This is the load-bearing decision. `buildLedger(sessions, cfg, now)` is called once per job
over that job's sessions, and the results are combined afterwards.

It is also legally correct. **Overtime does not combine across unrelated employers**: each
job has its own workweek and its own threshold. Forty hours at one employer plus ten at
another is not ten hours of overtime; it is fifty straight hours. Building separate ledgers
gets this right for free — and it means **the core of the engine does not change at all**.

### What *does* combine

Tax is per person, not per employer, and that gap is where the value is:

- **Year-to-date gross, hours and overtime** — summed across jobs.
- **Social Security overpayment.** Each employer withholds to the wage base independently.
  Two jobs can therefore push combined withholding past the annual maximum, and the excess is
  refundable as a credit at filing. The app can name the dollar figure.
- **Under-withholding.** Every employer withholds as though its job is your only income, so a
  second job is taxed from the bottom bracket up a second time while the combined total sits
  in a higher bracket. This is the single most common and most painful surprise of taking a
  second job, and the app already has everything needed to compute it exactly: withhold
  per job, compute the real liability on the combined figure, show the difference.

### Seamlessness rules

1. **One job looks exactly like today.** No switcher, no chips, no combined view, no new
   vocabulary. A user who never adds a second job never learns this exists.
2. **Migration is silent and idempotent.** On load, an old save has its `state.cfg` wrapped
   into `jobs[0]` and every session stamped with that job's id. It runs once and is a no-op
   thereafter.
3. **Two clocks cannot run unnoticed.** Clocking in on a second job while the first is
   running is allowed — people do work back-to-back shifts and split days — but overlapping
   time is flagged plainly rather than silently double-counted.

---

## Stages

Every stage ends with the full harness green and its own new suite. **No stage begins before
the previous one's smoke test is reported.**

### Stage 0 — Settings, regrouped *(done)*

Fifty controls in one flat list became seven collapsible groups — pay & overtime, pay
period & payday, your schedule, premiums, time off, appearance, your data — each carrying a
live one-line reading of its own settings so a folded group still tells you what is inside
it. Done before the rest because Stages 3 and 5 both land *inside* Settings, and because
"do not render the pay & overtime group for a surgeon" is one decision where hiding nine
scattered fields is nine chances to miss one. The grouping is the seam the profession layer
needs.

### Stage 1 — Fix what is already wrong *(done)*

No new UI. These were live defects in the shipped app.

| Fix | What it was doing |
|---|---|
| **8/80 overtime mode** | FLSA §7(j) lets hospitals pay overtime over 8 in a day *or* 80 in 14 days, both at once with a credit rule. None of the four existing modes could express it. Worth $480 a period — about $12,500 a year — to a nurse on three twelves. |
| **Cumulative Social Security** | The cap was applied per cheque rather than against year-to-date wages. Annual total right, every individual cheque wrong: $439.96 a period all year where payroll withholds $1,430.77 for eight cheques and nothing after. |
| **Additional Medicare 0.9%** | Not modelled at all. $3,600 on a $600,000 year. |
| **FLSA qualified overtime** | Derived from the configured rule and multiplier rather than from federal law. Three twelves a week under 8/80 is 24 hours of contractual overtime, 36 hours worked, and *zero* qualified — the app was claiming all 24. |
| **UI suite into the repo** | 53 suites and ~1,500 assertions lived in an ephemeral scratchpad that died with the session. Now `tests/ui/` with a runner, portable paths, and `npm run test:ui`. |

Crossing the Social Security base and the surtax threshold together produces the opposite of
what it sounds like: the cheque gets **bigger**, because losing 6.2% dwarfs picking up 0.9%.
A per-period cap hid that entirely.

Engine suite: 548 → 620 assertions.

### Stage 2 — The job layer, invisible *(done)*

Introduce `state.jobs`, the migration, `jobId` on sessions, per-job ledgers and the combining
layer. **Ship it with the UI completely unchanged and exactly one job.**

*Smoke test:* every pre-existing UI suite passes **untouched**. That is the proof the
refactor is safe — if the app looks identical to a test written before the refactor, the
refactor did not break it.

### Stage 3 — The second job, visible *(done)*

Add, name, edit and remove jobs. A job switcher that only appears at two or more. Clocking in
against a specific job. The overlap guard. Per-job and combined views of every tile.

*Smoke test:* a new suite covering add/switch/remove, overlap, per-job overtime independence,
and — critically — that removing the second job returns the interface exactly to Stage 2.

### Stage 4 — Cross-job tax intelligence *(done)*

Combined year-to-date. Social Security overpayment detection with the refundable figure.
The under-withholding estimate with what to do about it.

*Smoke test:* engine assertions against hand-computed two-job scenarios, including one that
crosses the wage base and one that crosses a bracket.

### Stage 5 — The profession layer *(partly done)*

The `PROFESSIONS` table, the setup wizard (field → role → state), and profile-driven
rendering. Ships with `transit_operator` and `nurse` — both `clock`, so the mechanism is
proven without a new earning model.

Existing users are migrated to `transit_operator` silently and see no change.

**Shipped so far:** the `PROFESSIONS` table grouped by field and role, a per-job picker in
Settings, the same question on the first-run screen (optional, and it visibly preselects the
overtime rule rather than deciding behind your back), and `applyProfession()` — the one
function that decides which settings groups a profession is worth showing. Transit operator,
nurse, tech, trades and a plain hourly option.

A profession suggests; it never corrects. Change the overtime rule yourself and the job is
marked as decided, so picking a profession later will not quietly put it back.

**Still to build here** — two pieces of the nurse profile that are not data:

- **Stacking premiums.** Night *and* weekend *and* charge can apply to the same hour. The
  engine currently has one differential window. This becomes a list of windows, each with its
  own rate and day mask, summed for any hour they overlap.
- **Callback minimums.** Being called in pays a guaranteed floor — commonly two to four hours
  — however short the actual work. That is a floor, not a rate, and no existing structure has
  that shape. It also interacts with overtime: the guaranteed hours count as hours worked.

*Smoke test:* each profile renders only its own controls; switching profession does not
destroy data; the Illinois and Indiana legal notes appear on the right profiles; three
premiums stack correctly on one hour; a twenty-minute callback pays the full minimum and that
minimum counts toward the overtime threshold.

### Stage 6 — The `units` model

The surgeon profile. wRVU logging with a built-in procedure table, threshold and conversion
factor with optional tiers, and the pace projection — year-to-date ÷ elapsed year, projected
to 31 December, with a "what if I run at 110%?" control built on the existing what-if panel.

Values are stamped with the fee-schedule year they came from, the same way the tax table is,
because CMS revises them annually — the 2026 schedule cut wRVUs for several proceduralist
specialties.

*Smoke test:* pace projection against hand-computed run rates; threshold and tier boundaries;
no clock or overtime controls render anywhere in this profile.

### Stage 7 — The `contract` model

The teacher profile. Annual salary over a 10-month-worked / 12-month-paid calendar so summer
checks show correctly, stipends as discrete line items, and the pension/no-Social-Security
handling.

*Smoke test:* the summer months pay correctly; TRS replaces Social Security in the net
breakdown; stipends fall outside the base contract.

---

### Where a given profession actually gets built

The dividing line is simple: **if the profession is still a clock, it is mostly data. If it
is not, it needs a new earning model.**

| Profession | Lands in | Why there |
|---|---|---|
| Transit operator | Stage 5 | Already the shipped behaviour; becomes the default profile |
| Nurse | Stage 1 + Stage 5 | 8/80 is engine work and a live defect; the profile, stacking premiums and callback minimums come with the profession layer |
| Surgeon / physician | Stage 6 | No clock exists in this job at all — `units` is a genuinely different way money arrives |
| Teacher | Stage 7 | `contract` plus a pension that replaces Social Security |

### Stage 8 — OT Expectancy

Two numbers. **OT Expectancy**: expected overtime per period and per year, seasonally
adjusted and trend-aware. **P(income ≥ target)**: the probability of clearing $90k, $100k,
$120k this year. A projection states one confident number and is usually wrong; a
probability is honest about a variable income and is what someone would actually want
before signing a loan.

The second number is the product. Overtime is *variable income*, and mortgage underwriting
typically wants a two-year history before counting any of it, discounting or excluding it
outright when it is declining. So three different true numbers matter, and only this app
has the shift-level record to tell them apart: what you earned, what a lender would count,
and what you can personally count on — your floor, the worst period in two years.

Computed by **Monte Carlo resampling from the user's own history**, not a normal curve.
Overtime is zero-inflated and right-skewed — many periods with none, occasional very large
ones — and a bell curve smears both away into confident nonsense. For each remaining period
of the year, draw a real observed outcome from the same month or season, sum the year,
repeat ten thousand times, count what fraction cleared the target. It never assumes a
shape because it never needs one, and 10,000 × 26 draws is milliseconds on a phone.

The metrics underneath: level (rolling 3, 6 and 26-period averages), trend, consistency
(the variance that becomes the confidence band), frequency (share of periods with any OT
at all), floor, and dependence (OT as a share of total income).

"A credit score for income" sets three requirements that are easy to miss:

- **It moves slowly.** One monster week must not take a probability from 34% to 71%.
  Updates per pay period, smoothed.
- **It is improvable, and says how.** "Six more OT hours a period takes P($100k) from 34%
  to 61%" turns a verdict into a lever.
- **It is showable.** A score exists to be handed to someone else, so this needs an export:
  the number, the history behind it, and the method stated.

**The constraint that shapes the whole feature:** resampling needs real periods to draw
from, and seasonality needs two winters to distinguish "December is busy" from "last
December was busy." So it ships with manual history entry — OT by month off old paystubs or
a W-2 — and below a minimum it refuses to show a probability rather than showing a bad one.
A score that lies is worse than no score, and this one exists specifically to be trusted by
someone who is not the user.

#### Attached paystubs

History entries can carry photographs of the stubs behind them. **The app never reads
them.** The photo is evidence for the person being asked to trust the number, not input for
the app: the export shows each figure with its source beside it, and a human does the
checking.

OCR was considered and rejected. Tesseract.js is roughly 2 MB of code plus ~10 MB of
language data against an app that is currently 400 KB, it normally fetches that data from a
CDN — which breaks offline-first outright — and paystubs are dense multi-column tables,
which is the format OCR handles worst. Enormous, frequently wrong, and wrong inside the one
feature whose whole purpose is being believed. The cheap version of the same win is showing
the photo *inside* the app next to the entry fields, so the number is read off the image
without switching apps.

Three consequences:

- **Images go in IndexedDB, downscaled on import.** The entire shift history is about 50 KB
  of JSON; one phone photo is 2–5 MB, and localStorage caps out around 5–10 MB. The first
  stub would break it.
- **Images stay out of the default backup.** Embedding them turns a 50 KB file into 40 MB
  and something that cannot be emailed. Including them is an explicit choice, with a plain
  warning: that file then carries a name, an address and partial account numbers.
- **Redaction before storage.** Most of a stub is irrelevant to proving overtime — the
  overtime line and the date are the point. Let people black out the rest first.

And the wording matters: the app says **"3 stubs attached"**, never "verified". A
user-attached photo proves nothing to the app, which cannot tell a real stub from something
typed up in a text editor. Claiming otherwise would poison exactly the credibility this
feature exists to build.

Lands after Stage 4, which builds the cross-job income picture — expectancy over combined
jobs is the useful version.

*Smoke test:* the resampler reproduces a known distribution; probabilities move the right
way with target, trend and variance; the seasonal index recovers a planted winter effect;
and below the history minimum no probability is shown at all.

### Stage 9 — WiseWage Lite

Not a second file, and not a smaller app. **A performance profile.**

The temptation is a stripped `lite.html`, and PR #6 in this repository is the worked example
of why not: two lineages of this app, one of which grew a feature the other already had,
neither aware of the other. A Lite build would need the whole engine, which is the part that
must not be duplicated.

It also aims at the wrong thing. Measured on 220 shifts with every section open:

| | |
|---|---|
| render, median | 1.6–1.8 ms |
| frame rate, glow background | 56 fps |
| frame rate, flat | 60 fps |
| frame rate, water as first written | 26 fps |

**The JavaScript is nearly free; the battery goes to compositing.** A Lite that removes
features while keeping the animated background and the per-second tick would save almost
nothing. A Lite that keeps every feature and stops animating would save most of it. Fewer
features is not the lever — less painting is.

So: one switch that stops the background grid, the title sheen, the hero scan line and the
caustics; steps money per minute rather than per second; and skips the heavy sub-renderers
for folded sections. Same file, same engine, nothing to drift.

**What this asks of every stage before it:** each visual effect must be switchable from one
place. Build them that way and Lite is a flip; build them scattered and Lite is a rewrite.

*Smoke test:* frame rate and render cost measured on and off against the numbers above;
every feature still reachable in Lite; the switch surviving a reload.

## Ordering, and why

Fixes first, because they are wrong today and every later stage inherits them.

The job layer before the profession layer, because it touches deeper structure — sessions and
config — and the profession layer should land on ground that has stopped moving. A second job
is also usually a different profession, so the job record has to exist before `profession` has
anywhere to live.

The invisible refactor (Stage 2) before the visible feature (Stage 3), so that the risky part
is proven by tests that predate it.
