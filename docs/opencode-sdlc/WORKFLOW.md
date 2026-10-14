# Workflow and Gate Contract

## Intake gate

Required:

- `00-request.md`
- `01-repository-profile.md`
- `02-requirements.md`
- `03-risk-assessment.md`

It passes when the repository context is sufficient, acceptance criteria are verifiable, risk/checks are explicit and no blocking product decision remains.

## Design gate

Required:

- `04-architecture.md`
- `05-test-strategy.md`
- `06-implementation-plan.md`

It passes when architecture, verification and task order agree. Low-risk work may document `NO_STRUCTURAL_CHANGE`, but cannot omit boundaries, failure behavior and rollback.

## Implementation gate

Required:

- `07-implementation-report.md`

It passes when approved tasks are implemented, the diff is controlled and focused verification has credible outcomes. It does not replace independent testing.

## Verification gate

Always required:

- `08-test-report.md`
- `09-review-report.md`

Conditionally required:

- `10-security-report.md`
- `11-performance-report.md`
- `12-devops-report.md`
- `13-documentation-report.md`

Structural validation rejects missing headings/placeholders. Technical validation rejects FAIL/BLOCKED verdicts.

## Final gate

Required:

- `14-judge-decision.md`

APPROVED requires all criteria and checks satisfied, no blocking finding and a recorded final gate PASS. When `human-approval` is required, the orchestrator must ask for and record an explicit human APPROVED decision before closure.

## Repair

The orchestrator calls `sdlc_begin_repair`. The tool increments `repairLoops` and refuses when `maxRepairLoops` is exhausted. The repair agent must reproduce or trace the failure, fix the owning invariant and provide focused evidence. Independent roles rerun the impacted checks.

## Stage versus gate

A stage records where work is occurring. A gate records whether the evidence from one or more stages is acceptable. Advancing a stage does not pass a gate.
