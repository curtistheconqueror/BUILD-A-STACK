# Build-a-Stack — Master Roadmap

A single self-contained educational HTML page that teaches how a software stack
connects, built off the real Tradenificent infrastructure. Repo is **private**.
Phases use the existing `A·n / B·n` footer nomenclature, extended.

Legend: ✅ shipped · 🔄 partial · ⏳ planned · 💤 deferred (big build)

---

## ✅ Phase A — LEARN track (the glossary)  — COMPLETE
The concept tiers. 28 cards, 3 tiers, all with deep-dives.
- **A·1 Fundamentals** — 12 cards (cyan accent) ✅
- **A·2 Intermediate** — 10 cards (purple accent) ✅
- **A·3 Advanced** — 6 cards (pink accent): Observability, Containers, Orchestration, CI/CD, Redundancy & failover, Load balancing ✅
- **A·x Explores** — 4-box deep-dive on all 28 cards ✅
- **A·t Clickable jargon** — 34 terms with popup definitions ✅

## 🔄 Phase B — BUILD challenges (interactive)
- **B·1 / B·2** — 4 "wire the stack" drag/tap challenges ✅
- **B·3 Free-build canvas** ⏳ — drag any node onto a blank canvas, draw your own connections, live-validated. (The one remaining piece of the original Build phase.)

## 🔄 Phase C — ACCESS & platform
- **C·1 Touch / mobile responsive** ✅ — tap-to-place build, responsive ≤640px, tilt off on touch
- **C·2 iPad remote access** ✅ — private via Tailscale `serve` → `https://thecube.tail9732e3.ts.net`; push == what the iPad loads; pull-to-refresh
- **C·3 Reboot-proof the :8750 server** ⏳ — auto-start at logon (Task Scheduler) so the iPad link survives a reboot. *(Offered; recommended before leaving the house.)*
- **C·4 Sanitized "shell" edition** 💤 — a scrubbed public-safe copy (current cards name real infra), prerequisite for any truly public link.

---

## ⏭️ NEXT UP (do these first)

### Phase D — NEW TOP-LEVEL TABS (beside Learn / Build)
> **D·2 PROMOTED ✅ (`72d7906`)** — the Keyboard tab is now fused into the real app (4 tabs: Learn / Build / PC vs Mac / Keyboard), all 3 boards live. Sandbox `keyboardproto.html` retained for iteration. Remaining: the deferred touch/iPad + normal-mode-consistency polish, then optional more boards.

- **D·1 "PC vs Mac" tab** ✅ SHIPPED (`57f1db3`) — side-by-side cheat-sheet, 6 categories / 29 rows: big picture, files & paths, keys & shortcuts (Ctrl↔Cmd), terminal (cmd equivalents), installing software, why devs care. Data-driven `PCMAC` array + renderer; N-tab `TABS` table; responsive.
- **D·2 "Keyboard" tab** 🔄 IN SANDBOX (`Downloads\keyboardproto.html`, NOT yet promoted into the app). Through **v7**: **multi-board selector** — all variants kept for teaching (no "winner"). **Standard** (full-size 104-key ANSI) + **Advanced** (Logi K860, 106-key split w/ numpad, media F-row, Easy-Switch, dual Win/Mac legends) both done. Engine shared: single-click = focus (dots on partners), double-click = 🔒 hold then single-click partners to reveal connections one at a time; "Show all" toggle; Stack-Map relationship lines; ~55 shortcuts; 4 color-coded categories (edit=cyan, nav=green, win=purple, sys=pink) + clickable legend filter; key-press thunk + optional sound. **Advanced-only mode** toggle (Advanced board only): dims everything but the K860's exclusive abilities (Easy-Switch/media/brightness/Lock/Fn/dual-OS), each w/ "what a standard board needs instead"; ability **links** drawn where real (Fn→F-row, Lock→Win+L, TaskView→Win+Tab). **DEFERRED polish (Curtis OK'd to hold 2026-06-14):** make normal-mode consistent — a persistent ⚡ marker on bonus keys + show their real K860 description in normal mode (F-keys currently show generic "function key" until Advanced-only is on). **Next:** Stage 2 = **Mac board** (⌘/⌥/Control + Mac shortcut set) as 3rd selector card; later promote into the app as the 4th top-level tab.
- **D·3 "Live-key practice" mode** 💡 PLANNED (Curtis's idea, 2026-06-14) — let a person press the REAL keys on their physical keyboard and watch the on-screen board respond. Tech: `keydown`/`keyup` + `event.code` (position) + `ctrlKey/altKey/shiftKey/metaKey` to detect combos; light up pressed keys live. Two flavors: **Mirror** (press anything → it lights + explains) and **Practice/quiz** ("Press Copy" → ✓). **Key constraint:** OS-level combos (Win+L, Ctrl+Alt+Del, Alt+Tab) are caught by Windows *before* the browser and CANNOT be intercepted/practiced; browser combos (Ctrl+W/T/N) are reserved too. So tag each combo `practiceable` — safe app-level ones (Ctrl+C/V/B/I, arrows, Shift+arrows…) get `preventDefault()` and real practice; reserved ones stay click-to-learn with a "🔒 the OS grabs this" note. Desktop/laptop only (needs a physical keyboard); hide + fall back to click mode on touch. Natural feeder into Phase E (learn by doing).

*(B·3 free-build canvas can slot in here too — small relative to D.)*

---

## 💤 THE BIG DEFERRED BUILDS (after D)

### Phase E — "TECH NOOB" guided journey  ← SINGLE BIGGEST BUILD
The most interactive section in the whole project. Walks a true beginner by the
hand, starting from **"turn on your computer,"** and prompts them to actually DO
things to get acclimated and become more tech-savvy. Pre-req knowledge before
anyone attempts to build a stack.
- **E·1 Knowledge pre-test** — gauge what they know: how to bookmark, what extensions are, how history is logged, what cache is and how it affects them.
- **E·2 Guided step-by-step** — do-this-now prompts; learn by performing, not reading.
- **E·3 Feature deep-dives** — each simple feature: what it is + how it affects YOU.
- **E·4 "Did You Know / Fun Fact" engine** — occasional popup with a brief, jaw-dropping fact about PCs, features, AI, etc. (reusable popup system).
- **E·5 Cool-tricks library** — shortcuts and clever moves that make them feel powerful.
- **E·6 Mastery / graduation** — progress tracking → "you're ready to Build a Stack."

### Phase F — "PHONE SAVVY" section
Technological differences between phone and PC; what's possible on each; how to
navigate a phone as expertly as a PC.
- **F·1 Phone vs PC** — the mental-model differences, capabilities, limits.
- **F·2 Android mastery** — expert navigation, gestures, settings.
- **F·3 iPhone mastery** — same, for iOS.
- **F·4 Expert phone tricks** — power-user moves on mobile.

### Phase G — "YOUR STACK" analyzer (the long-term vision)
Make the "Your Stack" tab real: analyze a person's ACTUAL stack.
- A browser page can't scan a machine (sandboxed), so this needs a small
  **downloadable companion scanner** (Node/Python) that lists the user's ports /
  services → outputs JSON → the page ingests it and draws THEIR stack.
- The single self-contained HTML file doubles as that download.

---

## Cross-cutting notes
- **Presentation vs build order:** for a real beginner, Phase **E (Tech Noob)** is
  the natural *first* tab in the final product — we just *build* it later.
- **Repo stays PRIVATE** until a sanitized shell edition exists (C·4).
- **One self-contained file** remains the rule (offline, no build step, doubles as
  the future downloadable package).
- **Reusable systems to design once, reuse everywhere:** the popup/“Did You Know”
  engine (E·4) and the interactive "do this now" prompt pattern (E·2) will also
  benefit the Keyboard tab (D·2) and Phone section (F).
