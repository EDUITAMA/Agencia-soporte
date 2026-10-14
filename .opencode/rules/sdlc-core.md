# SDLC Core Protocol

## Objective

Deliver the smallest correct and maintainable change that satisfies approved requirements, preserves repository conventions and produces enough evidence for an independent decision.

## Source of truth

For each run, use `.sdlc/runs/<run-id>/`:

1. `00-request.md` records the original request.
2. `state.json` records stage, risk, required checks, repair budget and gate decisions.
3. Numbered reports are immutable handoff contracts. A later agent may append corrections with a timestamp but must not silently erase prior evidence.
4. Source code and tests in the worktree are the implementation truth.
5. Command output is evidence only when the exact command and result are recorded.

## State machine

`intake -> discovery -> requirements -> design -> planning -> implementation -> verification -> judgment -> complete`

A failed verification or judgment moves to `repair`, then returns only to the earliest impacted stage. Do not restart from discovery unless repository facts changed.

## Gates

- **Intake gate:** repository profile, requirements and risk assessment are complete.
- **Design gate:** architecture, test strategy and implementation plan are complete and mutually consistent.
- **Implementation gate:** planned change exists, scope is controlled and implementation report is complete.
- **Verification gate:** required tests and independent audits have evidence and passing verdicts.
- **Final gate:** the judge can map every acceptance criterion to evidence, with no unresolved blocker.

The custom `sdlc_validate_gate` tool is authoritative for artifact presence and structural completeness. Passing its structural validation does not replace technical judgment.

## Role separation

- Orchestrator coordinates and owns state; it does not implement product code.
- Developer implements; it does not approve its own change.
- Test designer defines verification before implementation where practical.
- Test engineer independently creates and runs tests; it must not weaken valid tests to make the build pass.
- Review, security, performance and DevOps agents inspect and report; they do not hide findings.
- Judge makes the final evidence-based decision and never fixes code.
- Debugger repairs demonstrated defects after a failed gate and documents causal evidence.

## Artifact discipline

Each report must:

- identify run ID and scope;
- distinguish observed facts, assumptions and decisions;
- reference relevant files and commands;
- include explicit PASS, FAIL, APPROVED, REJECTED or NOT_REQUIRED status where the template requests it;
- avoid unresolved placeholders;
- remain concise enough for the next agent to consume without reading the entire conversation.

## Repair protocol

1. Classify the failure: requirement, design, code, test, security, performance, delivery or documentation.
2. Name one owner agent.
3. Call `sdlc_begin_repair` before modifying anything.
4. Repair only the demonstrated cause and its necessary consequences.
5. Rerun the failing check plus dependent checks.
6. Preserve prior failure evidence and add new evidence.
7. Stop when the configured repair budget is exhausted.

## Completion

A run may close `APPROVED` only when the final gate is recorded PASS and `14-judge-decision.md` contains an APPROVED decision. Otherwise close `BLOCKED` or `CANCELLED` with the precise reason and required human action.

## Authoritative project root and timeout recovery

- Obtain the project root from `sdlc_project_context`; never trust the provider/bridge process current directory.
- Every delegated task receives the absolute project root.
- A timeout does not imply failure. Check stage checkpoint, expected artifact and Git status before retrying.
- Mutating stages must be idempotent and persist their report before returning.
- Never blindly repeat a mutating stage after a provider timeout.
