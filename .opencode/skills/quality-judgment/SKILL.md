---
name: quality-judgment
description: Make an independent final approval decision by tracing requirements to implementation, tests, audits, residual risks and gate evidence.
license: MIT
compatibility: opencode
metadata:
  category: governance
  scope: universal
---

# Quality Judgment

## Independence

Do not modify code, tests or upstream reports. Do not invent missing evidence. Treat developer claims as inputs, not proof.

## Decision procedure

1. Confirm gate structure with `state.json` and required artifacts.
2. Trace every acceptance criterion to implementation location and test/verification evidence.
3. Reconcile contradictory reports by inspecting the narrow relevant evidence.
4. Confirm required risk checks ran or were legitimately NOT_REQUIRED.
5. Review unresolved findings and residual risk.
6. Check scope, compatibility, rollback and human-gate requirements.

## Approval conditions

APPROVED requires:

- all acceptance criteria satisfied;
- required tests passing with credible scope;
- no unresolved CRITICAL/HIGH finding;
- no unexplained build, lint, type or test regression;
- required security/performance/DevOps/docs checks passing;
- residual risk explicit and acceptable under policy;
- no required human decision outstanding.

REJECTED must identify the blocking evidence, owner role, earliest stage to revisit and exact reconsideration evidence.

## Anti-bias rules

- More files or tests do not imply quality.
- High coverage does not compensate for wrong assertions.
- A successful command does not prove untested requirements.
- A clean review does not override a failed test.
- Confidence language is not evidence.
