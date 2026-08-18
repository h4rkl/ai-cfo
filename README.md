# AI CFO

A standalone Mac app that finds the sweet spot between **model spend**, **contractor cost**, and **time-to-delivery**.

Built for teams that ship with **Codex** (Sol / Terra / Luna) and **Claude**, design in **Figma**, and deliver through **GitHub**.

## What it answers

- What does this delivery cost on Sol vs Terra vs Luna vs Opus 5 vs Sonnet 5 vs Haiku?
- What would the same Figma + GitHub work cost at senior contractor rates?
- How much human review and rework is still on the AI path?
- Which path wins when cash, calendar, and quality are scored together?

## Distilled from

- [semcod/costs](https://github.com/semcod/costs) — token × price, human-review overhead, ROI vs hourly rate
- [Turtles-AI-Lab/ai-roi-calculator](https://github.com/Turtles-AI-Lab/ai-roi-calculator) — live sliders, break-even, time-saved cash
- [SilentFleetKK/computecfo](https://github.com/SilentFleetKK/computecfo) — model value grades, independent project books, budget-aware briefing

Plus a CFO score that is **40% cost / 35% speed / 25% quality after rework**, and a one-page report.

## Restated brief

Pull this Mac’s real Claude Code and Codex work the same way CodexBar does — by reading local session logs (and optionally the `codexbar` / OAuth surfaces). Show **what was actually delivered** (project, session title, model, tokens, hours). Then **reprice that same work** under different variables: Sol vs Terra vs Luna vs Opus vs Sonnet vs Haiku, API tokens vs seat-only billing, and senior contractor rates, so you can see the spend and time-to-delivery gap.

## Run on Mac

```bash
npm install
npm test
npm run dev          # http://127.0.0.1:5173
npm run app
open "AI CFO.app"
```

If `vite: command not found`, the local install is missing. Run `npm install` in this folder. Scripts call Vite via `node ./node_modules/vite/bin/vite.js`, so they do not depend on a global `vite`.

**Local usage** (Claude Code + Codex, CodexBar-style): open the **Local usage** tab and scan. That reads `~/.claude/projects` and `~/.codex/sessions`, lists completed sessions, and lets you compare their real token mix against other models and contractors.

## How to use it

1. Pick a preset (landing page, feature PR, design system, full slice, hotfix) or create a workflow.
2. Choose how you know the cost: **Forecast** tokens from hours, type **Actuals**, or **Import** a usage CSV (`input_tokens`, `output_tokens`, `cost`).
3. Choose billing: **API tokens**, **seats only**, or **both**.
4. Set design / code / review hourly rates. First run defaults to senior US contractors: **$150 design / $200 code**.
5. Toggle Codex and Claude models. Edit list prices on the Models screen.
6. Read the sweet-spot compass and ledger. Export a markdown or HTML report, or print to PDF.

Everything is stored locally in the app. Export the workspace JSON to move it between machines.

## Pricing vintage

Builtin rates are **August 2026** short-context list prices (OpenAI GPT-5.6 Sol/Terra/Luna, gpt-5.3-codex, Claude Opus 5 / Sonnet 5 / Haiku 4.5). Override them anytime. They will go stale; the Models screen is the source of truth for your books.
