# Build-a-Stack

An interactive, frictionless way to learn **how real software systems connect** — ports, processes, APIs, sockets, bridges, gateways, webhooks, watchdogs, MCPs — and then **wire one together yourself**.

It's built off a real, working trading-operations stack, so every concept is grounded in a concrete example and taught in three honest layers:

> **what it is → how the real stack uses it → how a production-grade version would differ, and why.**

That last layer matters: senior engineering isn't "always do it the textbook way" — it's making the right tradeoff for your constraints and *knowing your debt*. This tool teaches both layers, so the knowledge sticks in a concrete way.

## Use it

Open **`index.html`** in any modern browser (Chrome recommended). No build, no server, no dependencies — it's a single self-contained file (HTML/SVG + Web Audio).

- **📖 Learn** — a glossary of the fundamentals. Each card is collapsible: *What it is · In your stack · Pragmatic vs production.*
- **🔧 Build** — drag-and-connect challenges. Drag the pieces into the slots where they belong; a piece that doesn't fit bounces back with a buzz; complete the branch and the data flow lights up.

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
