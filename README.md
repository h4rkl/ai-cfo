# AI CFO

AI CFO is a local-first Mac app for comparing the cost, delivery speed, and review burden of AI-assisted work against senior contractor delivery.

It is built for teams that design in Figma, ship through GitHub, and work with Codex (Sol, Terra, Luna) and Claude.

## What it does

- Model a delivery as a forecast, enter actuals, or import a usage CSV.
- Scan local Claude Code and Codex session logs to compare work that was actually completed.
- Reprice the same token mix across Codex and Claude models, API pricing, seat billing, and contractor rates.
- Refresh available model rates from OpenRouter, while retaining editable workspace overrides.
- Score each path using cost, calendar speed, and quality after review/rework.
- Export a one-page report as Markdown or HTML, or print it to PDF.

The default CFO score is **40% cost / 35% speed / 25% quality after rework**.

## Run locally

```bash
npm install
npm test
npm run dev          # http://127.0.0.1:5173
npm run app
open "AI CFO.app"
```

If `vite: command not found`, the local install is missing. Run `npm install` in this folder. Scripts call Vite via `node ./node_modules/vite/bin/vite.js`, so they do not depend on a global `vite`.

## How to use it

1. Pick a preset—landing page, feature PR, design system, full slice, or hotfix—or create a workflow.
2. Choose **Forecast**, **Actuals**, or **Import**. CSV imports accept `input_tokens`, `output_tokens`, and `cost`.
3. Choose API-token billing, seats only, or both; then set design, code, and review rates.
4. Toggle the models you want to compare. The Models screen supports manual prices and a rate refresh.
5. Open **Local usage** to scan completed Claude Code and Codex sessions, then compare their real token mix to models and contractors.
6. Read the comparison and report, then export Markdown or HTML (or print to PDF).

## Local usage and privacy

Local usage scans `~/.claude/projects` and `~/.codex/sessions` on the Mac running the app. It shows project, session title, model, tokens, and duration, then lets you reprice those sessions under different models and contractor rates.

Workspace data is stored locally in the app. Export the workspace JSON to move it between machines. The optional rate refresh requests public model pricing from OpenRouter; it does not upload session logs or workspace data.

## Pricing

Built-in rates are short-context API list prices as of **19 August 2026**, covering Codex GPT-5.6 Sol/Terra/Luna, gpt-5.3-codex, and Claude Opus 5, Sonnet 5, and Haiku 4.5. Prices change: refresh them or edit them directly before making a financial decision.

## Inspiration

- [semcod/costs](https://github.com/semcod/costs) — token pricing, review overhead, and hourly-rate ROI
- [Turtles-AI-Lab/ai-roi-calculator](https://github.com/Turtles-AI-Lab/ai-roi-calculator) — live inputs, break-even, and time-saved cash
- [SilentFleetKK/computecfo](https://github.com/SilentFleetKK/computecfo) — model value grades and project-level financial views
