#!/usr/bin/env python3
"""Generate the 'AI Tools, Agents & Your Stack' briefing PDF for Build-a-Stack."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, KeepTogether,
)

# ---- palette ----
NAVY = colors.HexColor("#0b1f3a")
BLUE = colors.HexColor("#2563eb")
BLUE_D = colors.HexColor("#1d4ed8")
INK = colors.HexColor("#1a1f29")
GREY = colors.HexColor("#5b6472")
LIGHT = colors.HexColor("#f6f8fb")
LINE = colors.HexColor("#d7dde6")
CALL_BG = colors.HexColor("#f0f5ff")
WARN_BG = colors.HexColor("#fff7ed")
WARN_BAR = colors.HexColor("#d97706")
SAFE_BG = colors.HexColor("#f0fdf4")
SAFE_BAR = colors.HexColor("#16a34a")

styles = getSampleStyleSheet()
def S(name, **kw):
    parent = kw.pop("parent", styles["Normal"])
    return ParagraphStyle(name, parent=parent, **kw)

body   = S("body", fontName="Helvetica", fontSize=10.5, leading=15, textColor=INK, spaceAfter=5)
lead   = S("lead", parent=body, fontSize=11.5, textColor=colors.HexColor("#2b3442"))
h1     = S("h1", fontName="Helvetica-Bold", fontSize=23, leading=26, textColor=NAVY, spaceAfter=2)
sub    = S("sub", fontName="Helvetica", fontSize=11, leading=14, textColor=GREY, spaceAfter=2)
meta   = S("meta", fontName="Helvetica", fontSize=8.5, leading=11, textColor=colors.HexColor("#8a93a3"), spaceAfter=2)
h2     = S("h2", fontName="Helvetica-Bold", fontSize=14.5, leading=18, textColor=NAVY, spaceBefore=16, spaceAfter=4)
h3     = S("h3", fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=BLUE_D, spaceBefore=9, spaceAfter=2)
cell   = S("cell", fontName="Helvetica", fontSize=9.5, leading=13, textColor=INK)
cellh  = S("cellh", fontName="Helvetica-Bold", fontSize=9.5, leading=13, textColor=colors.white)
callp  = S("callp", parent=body, fontSize=10, leading=14)
foot   = S("foot", fontName="Helvetica", fontSize=8.5, leading=11.5, textColor=colors.HexColor("#8a93a3"))

def cot(text, bg, bar, style=callp):
    """Callout box: a bordered, shaded table cell with a colored left bar."""
    inner = Paragraph(text, style)
    t = Table([["", inner]], colWidths=[3, None])
    t.setStyle(TableStyle([
        ("BACKGROUND", (1, 0), (1, 0), bg),
        ("BACKGROUND", (0, 0), (0, 0), bar),
        ("LEFTPADDING", (1, 0), (1, 0), 10), ("RIGHTPADDING", (1, 0), (1, 0), 10),
        ("TOPPADDING", (1, 0), (1, 0), 8), ("BOTTOMPADDING", (1, 0), (1, 0), 8),
        ("LEFTPADDING", (0, 0), (0, 0), 0), ("RIGHTPADDING", (0, 0), (0, 0), 0),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return t

def datatable(rows, header=True):
    data = [[Paragraph(c, cellh if (header and i == 0) else cell) for c in r]
            for i, r in enumerate(rows)]
    t = Table(data, colWidths=None, repeatRows=1 if header else 0)
    st = [
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    if header:
        st += [("BACKGROUND", (0, 0), (-1, 0), NAVY),
               ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT])]
    t.setStyle(TableStyle(st))
    return t

F = []  # flowables
def P(text, style=body): F.append(Paragraph(text, style))
def SP(h=4): F.append(Spacer(1, h))

# ---------- header ----------
P("AI Tools, Agents &amp; Your Stack", h1)
P("A plain-English briefing &mdash; turning &ldquo;am I behind?&rdquo; into a teachable concept for Build-a-Stack", sub)
P("Build-a-Stack companion doc &middot; Phase A&middot;3 candidate material &middot; Drafted June 2026", meta)
SP(6)
F.append(cot("<b>The one-sentence takeaway:</b> You are not behind. You already run a serious automation stack. "
             "The thing the industry is buzzing about is a <i>different kind of brain</i> &mdash; a reasoning agent &mdash; "
             "that can plug into the body you&rsquo;ve already built. Whether to use one is an engineering tradeoff, "
             "not a race to catch up.", CALL_BG, BLUE))

# ---------- 1 ----------
P("1 &middot; Three tools everyone name-drops", h2)
P("They get lumped together, but they are three different categories. Sorting them out removes most of the "
  "&ldquo;I feel behind&rdquo; feeling.")
F.append(datatable([
    ["Tool", "What it actually is", "Who is in control"],
    ["<b>Devin</b>", "An autonomous &ldquo;AI software engineer&rdquo; (a product). You hand it a ticket; it plans, "
     "codes, runs, and opens a pull request.", "The AI"],
    ["<b>Cursor</b>", "An AI-powered code <i>editor</i> (a VS Code fork). A human writes code, supercharged by AI "
     "autocomplete, inline edits, and a codebase-aware chat.", "You"],
    ["<b>LangGraph</b>", "A <i>library</i> (Python/JS) for <i>building</i> multi-step AI agents &mdash; loops, memory, "
     "branching. Not something you write code <i>in</i>; it&rsquo;s plumbing you build <i>with</i>.", "N/A &mdash; a building block"],
]))
SP(6)
F.append(cot("<b>Key split:</b> Devin and Cursor <i>compete</i> over &ldquo;help me write code faster.&rdquo; "
             "LangGraph isn&rsquo;t in that race at all &mdash; it&rsquo;s a component for <i>making</i> AI software. "
             "And the agentic workflow you&rsquo;re using right now (an AI committing and pushing to your repo) is the "
             "<i>same category</i> as Devin. You&rsquo;re already doing it.", CALL_BG, BLUE))

# ---------- 2 ----------
P("2 &middot; The big idea: automation vs. a reasoning agent", h2)
P("This is the distinction worth internalizing. Everything else is detail.", lead)
P("What you have today &mdash; deterministic automation", h3)
P("Your bots are <b>rule-followers</b>. You wrote the logic ahead of time:")
F.append(cot("<i>WHEN websocket price crosses X AND a TradingView alert fires &rarr; place trade. "
             "IF a position drifts &rarr; the supervisor bot flattens it.</i>", CALL_BG, BLUE))
P("The bot doesn&rsquo;t <i>decide</i> in any human sense &mdash; it evaluates conditions you predefined and runs the "
  "matching branch. <b>Same inputs &rarr; same output, every time.</b> Your supervisor bots watching other bots are "
  "still rules (&ldquo;if a child bot stops heart-beating, restart it&rdquo;) &mdash; that pattern is a "
  "<b>watchdog</b>, already in your glossary. This is predictable, auditable, and &mdash; crucial for trading &mdash; "
  "<b>provable</b>.")
P("What an AI agent adds &mdash; reasoning over a model", h3)
P("An LLM agent doesn&rsquo;t run your if/then. It <b>interprets a situation in natural language and chooses what to "
  "do</b>, including things you never explicitly coded:")
F.append(cot("<i>Observe (market data, news, positions) &rarr; reason in plain language about what&rsquo;s happening "
             "&rarr; pick an action from the tools you gave it (place trade, resize, alert you, do nothing) &rarr; "
             "see the result &rarr; reason again.</i>", CALL_BG, BLUE))
SP(4)
F.append(datatable([
    ["Your bots", "An AI agent"],
    ["<b>Execute rules</b> you wrote", "<b>Decides</b> what to do"],
    ["Same input &rarr; same output", "Same input &rarr; <i>maybe different</i> output"],
    ["You can <b>prove</b> its behavior", "You can only <b>observe</b> its behavior"],
    ["&ldquo;Cross X &rarr; buy&rdquo;", "&ldquo;Price crossed X, but volume is thin and there&rsquo;s a Fed headline &mdash; I&rsquo;ll wait&rdquo;"],
]))
SP(5)
P("That last row is the entire point: an agent can weigh <b>fuzzy, unstructured information</b> (a news headline, an "
  "ambiguous pattern) and handle situations <b>you didn&rsquo;t anticipate</b> &mdash; things you can&rsquo;t easily "
  "encode as if/then.")

# ---------- 3 ----------
P("3 &middot; &ldquo;But wasn&rsquo;t I already doing this?&rdquo;", h2)
P("<b>Partly &mdash; and it&rsquo;s the hard part.</b> Websockets, TradingView alerts, execution, supervisors: "
  "that&rsquo;s the <i>plumbing</i> an agent also needs. <b>You&rsquo;ve built the body.</b> An AI agent is just a "
  "<i>different brain</i> plugged into that same body.")
P("The piece you don&rsquo;t have is a non-deterministic LLM sitting in the decision seat instead of your hand-written "
  "rules. That brain &mdash; its multi-step reasoning loop, memory, and branching &mdash; is exactly what a library "
  "like <b>LangGraph</b> helps you build.")

# ---------- 4 ----------
F.append(KeepTogether([
    Paragraph("4 &middot; The honest warning (this matters for trading)", h2),
    cot("<b>An LLM agent is non-deterministic.</b> Same market, run it twice, it might do two different things. In a "
        "chatbot that&rsquo;s fine. On a path that <b>places real trades with real money</b>, that property is dangerous:"
        "<br/>&bull;&nbsp; You can&rsquo;t fully predict it."
        "<br/>&bull;&nbsp; It can &ldquo;hallucinate&rdquo; a reason and act on it."
        "<br/>&bull;&nbsp; Backtesting is murky &mdash; past behavior doesn&rsquo;t guarantee future behavior."
        "<br/>&bull;&nbsp; Latency: an LLM &ldquo;thinks&rdquo; in seconds; your websocket bots react in milliseconds.",
        WARN_BG, WARN_BAR),
]))
P("The mature pattern", h3)
P("Not &ldquo;replace my bots with an AI agent.&rdquo; Instead:")
P("&bull;&nbsp; <b>Keep deterministic bots on the trigger/execution path</b> &mdash; fast, provable, safe.")
P("&bull;&nbsp; <b>Put the AI agent in an advisory / supervisory seat</b> &mdash; it watches, reasons over the fuzzy "
  "stuff (news, regime shifts, &ldquo;does this setup still make sense?&rdquo;), and either <i>alerts you</i> or "
  "<i>adjusts parameters within hard guardrails</i>. The actual trade trigger stays rule-based, with circuit breakers "
  "the agent <b>cannot</b> override.")
P("That buys you the agent&rsquo;s judgment <b>without</b> handing a slot machine your order-entry.")

# ---------- 5 ----------
F.append(KeepTogether([
    Paragraph("5 &middot; Your plan: the agent as a &ldquo;cube entity&rdquo;", h2),
    cot("<b>Decision:</b> if an LLM agent is added, it will be a <b>cube entity</b> &mdash; a class of agent in the "
        "stack that <b>never places trades</b>. It observes, reasons, and reports.<br/><br/>"
        "This is the <b>safest, most measurable</b> way to test whether agent reasoning is actually effective: it sits "
        "beside the proven deterministic path, its calls can be logged and compared against what actually happened, and "
        "a bad call costs <i>nothing</i> because it has no authority to execute. You get a clean read on signal quality "
        "before ever granting it more responsibility.", SAFE_BG, SAFE_BAR),
]))
P("This maps onto the &ldquo;know your debt&rdquo; philosophy Build-a-Stack already teaches: adopt the new capability "
  "deliberately, in its safest form, with a way to measure the tradeoff.")

# ---------- 6 ----------
P("6 &middot; So, which tools should you actually care about?", h2)
F.append(datatable([
    ["Tool", "Verdict for you"],
    ["<b>Cursor</b>", "Optional convenience. A nicer local editor, but a sidegrade to the Claude Code workflow you "
     "already use. Not a gap."],
    ["<b>Devin</b>", "Not needed. You already run an equivalent agentic coding workflow. Swapping tools, not gaining a "
     "capability."],
    ["<b>LangGraph</b>", "Only relevant <i>if/when</i> you build the cube-entity advisory agent. Then it&rsquo;s the "
     "right kind of building block for the reasoning loop."],
]))

# ---------- 7 ----------
P("7 &middot; How this folds into Build-a-Stack", h2)
P("Build-a-Stack already teaches the plumbing &mdash; ports, processes, websockets, watchdogs, and <b>MCP</b> (the very "
  "protocol this whole agent world runs on). The natural next teaching unit:")
P("&bull;&nbsp; <b>Glossary card &mdash; &ldquo;Rule-bot vs. AI agent&rdquo;:</b> same body, different brain; "
  "deterministic vs. reasoning; provable vs. observable &mdash; taught in the existing three layers "
  "(what it is &rarr; how the real stack uses it &rarr; pragmatic vs. production tradeoff).")
P("&bull;&nbsp; <b>Glossary card &mdash; &ldquo;Cube entity / advisory agent&rdquo;:</b> the guardrail pattern &mdash; "
  "an agent that reasons but cannot execute, and why that&rsquo;s the safe, measurable way to adopt one.")
P("&bull;&nbsp; <b>Build challenge:</b> wire an advisory agent that observes the data feed and emits an alert &mdash; "
  "but is physically prevented from connecting to the execution path.")

SP(8)
F.append(HRFlowable(width="100%", thickness=0.6, color=LINE, spaceAfter=6))
P("Build-a-Stack &mdash; an interactive way to learn how real software systems connect, grounded in a real "
  "trading-operations stack. Taught in three honest layers: what it is &rarr; how the real stack uses it &rarr; how a "
  "production-grade version would differ, and why. This companion document is candidate source material for the Phase "
  "A&middot;3 glossary and a future build challenge.", foot)

doc = SimpleDocTemplate(
    "/home/user/BUILD-A-STACK/docs/ai-agents-vs-automation.pdf", pagesize=A4,
    leftMargin=18*mm, rightMargin=18*mm, topMargin=18*mm, bottomMargin=16*mm,
    title="AI Tools, Agents & Your Stack — Build-a-Stack briefing",
    author="Build-a-Stack",
)
doc.build(F)
print("PDF built OK")
