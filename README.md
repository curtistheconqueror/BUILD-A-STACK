# Build-a-Stack

An interactive, frictionless way to learn **how real software systems connect** — ports, processes, APIs, sockets, bridges, gateways, webhooks, watchdogs, MCPs — and then **wire one together yourself**.

It's built off a real, working trading-operations stack, so every concept is grounded in a concrete example and taught in three honest layers:

> **what it is → how the real stack uses it → how a production-grade version would differ, and why.**

That last layer matters: senior engineering isn't "always do it the textbook way" — it's making the right tradeoff for your constraints and *knowing your debt*. This tool teaches both layers, so the knowledge sticks in a concrete way.

## Use it

Open **`index.html`** in any modern browser (Chrome recommended). No build, no server, no dependencies — it's a single self-contained file (HTML/SVG + Web Audio).

- **📖 Learn** — a glossary of the fundamentals. Each card is collapsible: *What it is · In your stack · Pragmatic vs production.*
- **🔧 Build** — drag-and-connect challenges. Drag the pieces into the slots where they belong; a piece that doesn't fit bounces back with a buzz; complete the branch and the data flow lights up.

## Pay Clock

`pay-clock.html` is a separate single-file widget in the same spirit — open it directly, no server, works offline.

Clock in and your earnings climb in real time at your hourly rate. Toggle whether the number steps every **second**, **minute**, or **hour**; the elapsed timer always runs live. Set a target for the day and it stops itself when you hit it.

- **Overtime at 1.5×**, switching *mid-shift* — cross the threshold at hour 39 and the rest of that same shift bills at the OT rate, split correctly rather than rounded into one bucket. Two rules to choose from: **40 h per week** (resets each week — how US payroll normally works) or **80 h cumulative per pay period**.
- **Pay-period aware** — knows the current period, the payday, and how long is left in both; rolls itself over to a fresh period on schedule and starts the counters again. Anchored to one start date and repeated from there, so it never needs reconfiguring.
- **Survives everything** — every figure derives from wall-clock timestamps, not from counting ticks, so refreshing, backgrounding the tab, or sleeping the machine mid-shift all recover the correct amount.
- Editable shift log, CSV export, and settings for rate, thresholds, week start, period length, and payday offset.

Figures are **gross**, before taxes and deductions. Data is stored only in your own browser.

```
npm test     # 62 assertions against the pay engine — no dependencies
```

The tests extract the engine straight out of `pay-clock.html`, so what's verified is exactly what ships.

## Horn Circuit

`horn-circuit.html` is a standalone, interactive schematic of a bus horn circuit — same self-contained spirit (open it directly, works offline, HTML/SVG + Web Audio). It's built for phone and auto-fits up to iPad; you scroll top-to-bottom to follow the wiring rather than cramming it onto one screen.

Press the **horn button** at the top and current lights up through the whole system, color-coded: battery feed, the small horn-button circuit, the ground return, and full horn power after the relay. Toggle it on and off to watch the current move through each stage.

It traces the real setup in four stops:

- **Steering wheel** — the horn button: plastic cover over a brass cap, held up by a return spring; press it and the cap meets the brass contact ring to close the switch.
- **Steering column** — the rotating contact: a big **brass slip-ring plate**, near the column's own diameter, sits high on the shaft (insulated from it, since the shaft is ground) and turns with the wheel. A spring-loaded **brass roller** mounted below presses *up* into its underside, so the horn-button circuit bridges the rotating and fixed halves at any steering angle. A black wire carries it from the roller's mount down to the relay.
- **Relay & power** — a small coil current pulls the armature shut and switches full battery power (via a fuse) through to the horns.
- **Twin horns** — high note and low note, each with two wires, switched on the power side and permanently grounded to the frame plus a redundant ground wire; the frame carries the return back to the battery.

A **turn-wheel** toggle spins the roller and plate so you can see the slip-ring contact hold while steering, and a **sound** toggle plays a two-note electric horn.

### Fault scenarios & diagnosis

A **scenario** selector turns the same diagram into a diagnostic bench. Beyond *healthy*, it injects the faults that actually strand a bus — a bad horn, a bad ground, one dead horn, an open in the trigger path, a dead short that blows the fuse, and a stuck-on horn — and animates exactly where the current stops, with a marker at the fault (open · short · dead).

It's framed around the two sides of a relay circuit: the **control side** (the coil, and the button/slip-ring that trigger it) versus the **load side** (the contacts out to the horns). The relay is the *power router* on the boundary, so the **click** is the key clue — a click proves the whole control side works and sends you *downstream* to the load side; no click means the fault is *upstream*. The headline case, *relay clicks but no horn*, spotlights the relay as the only thing working and routes power right up to the dead horns. A live readout gives the symptom, what it rules out, the fault zone, and the likely fix, with a full symptom→cause table below the diagram.

### Probe the circuit

A **🔦 probe** toggle turns the diagram into a bench with a virtual test light: nine tappable test points (battery, fuse, all four relay terminals, and each horn's power and ground) read out 12 V / 0 V / ground-good / open for whatever scenario and button state is live — including the classic trigger-wire tell: 12 V at terminal 85 with the button up, pulled to ~0 V when a healthy button grounds it. Readings land in a sticky bar with a one-line "what this proves."

**🎯 Guided diagnosis** deals a mystery fault (markers hidden), states only the symptom, and coaches the probe sequence step by step — click first, then bisect the remaining half — logging each reading until you're asked to call the fix. Answer right and the diagram reveals the fault; a dice button deals the next mystery.

### Resting potential

An **⚡ potential** toggle shows the voltage that's already sitting in part of the circuit before you ever press the button — a slow ambient pulse, distinct from the marching-dash current-flow animation, since nothing is actually moving yet. Everything up to an *open* switch is electrically hot at rest: battery → fuse → the relay coil → the trigger wire, all the way up through the slip ring to the button's contact ring, plus battery → fuse → the relay's other input — while everything past that switch (the relay's output side, the horns) carries no potential at all until it closes. The glow is fault-aware — in the control-open scenario it stops exactly at the broken slip-ring contact instead of reaching the button — and hands off to the real current-flow animation the instant you press. Locked out during guided diagnosis, since it would give the mystery away.

## Roadmap

- **Phase A — Learn (glossary)**
  - A·1 ✅ Fundamentals: port, process, Node.js, API, HTTP, WebSocket, bridge, gateway, webhook, watchdog, push-vs-poll, MCP
  - A·2 Intermediate: IPC / file-feed, message bus, CDP, env vars, secrets, reverse proxy, health checks
  - A·3 Advanced: observability, supervisors (Docker/systemd/k8s), CI/CD, redundancy
- **Phase B — Build (sandbox)**
  - B·1 ✅ The market-data feed challenge
  - B·2 More branches: execution path, alerts path, observe path
  - B·3 Free-build canvas — drag any node and draw your own connections, validated live
- **Phase C — Polish:** hints, scoring, a pragmatic↔production overlay, touch support
- **Phase D — Packaging:** externalize the nodes + connection rules + glossary into a JSON config → one engine, many editions (your stack / a blank shell for someone else's stack / a generic "build a stack with AI" course)
- **Phase E — Distribution:** single-file export, brandable, host or embed

## Status

**MVP** — Phase A·1 (12 fundamental concepts) + Phase B·1 (the market-data-feed challenge).

---

*Self-contained HTML/SVG + Web Audio. Built iteratively with AI assistance.*
