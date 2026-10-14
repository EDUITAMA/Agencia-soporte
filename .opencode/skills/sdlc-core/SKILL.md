---
name: sdlc-core
description: Operate the autonomous SDLC state machine, artifact contracts, gates and bounded repair protocol for an OpenCode run.
license: MIT
compatibility: opencode
metadata:
  category: orchestration
  scope: universal
---

# SDLC Core

Use this skill whenever work belongs to a `.sdlc/runs/<run-id>` execution.

## Operating contract

- Treat `state.json` as the stage and gate source of truth.
- Treat numbered Markdown reports as handoff contracts, not informal notes.
- Keep implementation facts in the worktree and evidence in reports.
- Do not declare a gate passed before `sdlc_validate_gate` returns `valid: true` and the responsible role has a passing technical verdict.
- Preserve failed evidence across repair cycles.

## Stage transitions

1. **Intake:** capture original request without reinterpretation.
2. **Discovery:** map stack, commands, architecture boundaries and relevant files.
3. **Requirements:** define scope, acceptance criteria, NFRs, assumptions and risk.
4. **Design:** decide architecture and verification approach.
5. **Planning:** produce ordered, independently verifiable tasks.
6. **Implementation:** make the smallest approved code and test changes.
7. **Verification:** execute tests and independent audits selected by risk.
8. **Judgment:** compare all acceptance criteria with evidence.
9. **Complete:** close approved, blocked or cancelled.

## Gate invariants

- A missing artifact is a failed structural gate.
- An artifact with placeholders is incomplete.
- A skipped test without reason is a finding.
- A command without its outcome is not evidence.
- An implementation that exceeds scope returns to planning or requirements.
- A final approval with an unresolved HIGH or CRITICAL finding is invalid.

## Repair routing

- Requirement mismatch -> `sdlc-requirements` then planner.
- Architectural incompatibility -> `sdlc-architect` then planner and developer.
- Code defect -> `sdlc-debugger` or developer.
- Missing/incorrect test -> `sdlc-test-engineer`.
- Security issue -> debugger/developer plus security recheck.
- Performance issue -> debugger/developer plus performance recheck.
- Pipeline/configuration issue -> developer plus DevOps recheck.
- Documentation gap -> docs agent.

Call `sdlc_begin_repair` before starting a repair. If denied because the budget is exhausted, close BLOCKED.
