# Model routing — AXET only

This profile pins every SDLC role to an explicit `axet/<model-id>` reference. There is no provider autodetection and no fallback to OpenCode Zen, GitHub Copilot, or any other provider.

## Role map

| Role | Model |
|---|---|
| `sdlc-orchestrator` | `axet/gpt-5.6-terra` |
| `sdlc-repo-scout` | `axet/gpt-5.6-luna` |
| `sdlc-requirements` | `axet/gpt-5.6-terra` |
| `sdlc-architect` | `axet/eu.anthropic.claude-sonnet-5` |
| `sdlc-test-designer` | `axet/gpt-5.4-2026-03-05` |
| `sdlc-planner` | `axet/gpt-5.6-terra` |
| `sdlc-developer` | `axet/gpt-5.3-codex` |
| `sdlc-test-engineer` | `axet/gpt-5.4-2026-03-05` |
| `sdlc-reviewer` | `axet/eu.anthropic.claude-sonnet-5` |
| `sdlc-security` | `axet/eu.anthropic.claude-sonnet-4-6` |
| `sdlc-performance` | `axet/gpt-5.4-2026-03-05` |
| `sdlc-devops` | `axet/gpt-5.3-codex` |
| `sdlc-docs` | `axet/gpt-5.4-mini` |
| `sdlc-debugger` | `axet/gpt-5.3-codex` |
| `sdlc-judge` | `axet/gpt-5.6-terra` |

## Startup validation

The primary orchestrator already starts on `axet/gpt-5.6-terra`. At the beginning of an SDLC flow it calls `sdlc_apply_models` only to verify that every pinned AXET model is present in `opencode models`. If one is missing, the flow stops before delegation.

## Manual checks

Use `opencode models axet` (or `opencode models`) to inspect availability. A direct smoke test can be run with:

```text
opencode run --model axet/eu.anthropic.claude-sonnet-5 "Responde exactamente: OK"
```

Repeat with the other configured AXET model IDs when validating a workstation.
