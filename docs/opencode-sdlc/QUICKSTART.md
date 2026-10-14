# Quickstart

## 1. Confirm OpenCode

From the target repository:

```bash
opencode --version
```

Open OpenCode, connect a provider with `/connect`, and inspect available model IDs with `/models`.

## 2. Validate installation

The following paths should exist:

```text
.opencode/agents/sdlc-orchestrator.md
.opencode/tools/sdlc.js
.opencode/commands/sdlc-start.md
.sdlc/config/policy.json
```

Run the local static validator when Node.js is available:

```bash
node .sdlc/bin/validate-installation.mjs
```

## 3. Configure models (optional but recommended)

The kit works immediately by inheriting the active model. For separation of duties, edit `.sdlc/config/models.json` using exact IDs shown by `/models`, then run:

```text
/sdlc-models apply
```

Recommended capability routing:

| Role | Capability |
|---|---|
| repo scout, docs | fast/economical |
| requirements, planner | balanced reasoning |
| architect, security, judge | deep reasoning |
| developer, debugger, test engineer | strong coding/tool use |
| reviewer and judge | different family/provider from developer when available |

## 4. Run

Interactive:

```text
/sdlc-start Implementar una API de ... con estos criterios ...
```

Plan only:

```text
/sdlc-plan Diseñar ...
```

Non-interactive guarded automation:

```bash
.sdlc/bin/run-auto.sh "Implementar ..."
```

`--auto` approves requests that would normally ask, but explicit deny rules still block deployment, publication, destructive operations and protected files.

## 5. Inspect or resume

```text
/sdlc-status current
/sdlc-resume current
```

Artifacts are stored under `.sdlc/runs/<run-id>/`.

## 6. Interpret outcomes

- `APPROVED`: final judge passed and no human gate remains.
- `BLOCKED`: evidence or a decision is missing, a required check failed, or repair budget was exhausted.
- `CANCELLED`: the run was intentionally stopped.

A blocked run should contain the exact owner, failed evidence and reconsideration requirement in `14-judge-decision.md` or the latest failed report.

## Optional AXET workstation smoke test

Before the first real project run, you can verify all configured models from PowerShell:

```powershell
.\.sdlc\bin\test-axet-models.ps1
```

This is optional. Normal SDLC startup also validates that the pinned AXET model references exist before delegating work.
