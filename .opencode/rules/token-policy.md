# Token and Context Policy

## Goal

Spend model context on decisions and evidence, not on repeated repository content.

## Mandatory sequence

1. Read the current run state and the latest upstream artifact.
2. Search filenames and symbols before opening files.
3. Read only relevant ranges; expand only when dependencies require it.
4. Prefer `git diff`, focused tests and repository profiles over full-tree re-analysis.
5. Load only the skills explicitly required by the current role.
6. Write durable findings to the run artifact, then return a short status to the orchestrator.

## Context layers

- **Layer 0:** `state.json` and a one-paragraph task summary.
- **Layer 1:** upstream report for the current stage.
- **Layer 2:** relevant diff, symbols, manifests and tests.
- **Layer 3:** broader repository exploration only when an unresolved dependency requires it.

Never jump to Layer 3 merely for confidence.

## Output limits

Unless evidence requires more detail:

- subagent return to parent: at most 350 words;
- orchestrator progress update: at most 200 words;
- list only changed or relevant files;
- do not paste full source files or full command logs into chat;
- store detailed evidence in the run report and summarize it.

## Cost-aware routing

Use economical models for repository mapping, documentation and simple deterministic checks. Use stronger reasoning for ambiguous requirements, architecture, security and judgment. Use coding-specialized models for implementation and test creation. Independence is more important than model size for the judge.

## Reuse

Do not rediscover stable facts already recorded in `01-repository-profile.md`. Update only the sections invalidated by new evidence. Do not rerun successful checks unless the repair can affect them.

## Stop rules

Stop reading when enough evidence exists to make the required decision. Stop iterating when the repair budget is exhausted. Ask the orchestrator for a human decision instead of consuming context on unresolved business ambiguity.
