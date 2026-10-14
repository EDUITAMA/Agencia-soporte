---
description: Inspect or apply per-role model routing from .sdlc/config/models.json.
agent: sdlc-orchestrator
---

Manage SDLC model routing. Requested action: `$ARGUMENTS`.

- For blank or `show`: read `.sdlc/config/models.json`, report inherited/configured roles and warn when developer, reviewer/security and judge lack model independence. Do not edit.
- For `apply`: call `sdlc_apply_models`. It accepts either full `provider/model-id` references or bare model IDs and resolves bare IDs by exact match against `opencode models`. Report resolved routing, changed agent files and backup location.
- For assignments such as `sdlc-developer=gpt-5.3-codex` or `sdlc-judge=provider/model`: update only named keys in `.sdlc/config/models.json`, preserve all others, then call `sdlc_apply_models`.
- When `_strictNoFallback` is true, an unavailable AXET model is blocking. Never fall back to OpenCode Zen, Copilot, or another provider.

Never invent model IDs. Bare IDs must exactly match an available model ID returned by OpenCode.
