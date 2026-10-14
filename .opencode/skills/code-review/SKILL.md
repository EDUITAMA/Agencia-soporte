---
name: code-review
description: Perform an independent, evidence-based review of correctness, compatibility, maintainability, tests and operational behavior with severity-ranked findings.
license: MIT
compatibility: opencode
metadata:
  category: quality
  scope: universal
---

# Code Review

## Review order

1. Compare diff with requirements and approved plan.
2. Trace changed execution paths and data flow.
3. Inspect tests for behavior, omissions and false confidence.
4. Check compatibility, failure behavior and observability.
5. Evaluate maintainability only after correctness.

## Finding standard

Every actionable finding must contain:

- severity: CRITICAL, HIGH, MEDIUM or LOW;
- file and precise location/symbol;
- concrete failing scenario or invariant;
- impact;
- evidence or reproduction;
- smallest credible remediation.

Do not report speculative style preferences as defects. Consolidate duplicate symptoms under one root finding.

## Severity

- **CRITICAL:** exploitable security, irreversible loss, broad outage or invalid core behavior.
- **HIGH:** likely production defect, contract break, authorization flaw or serious regression.
- **MEDIUM:** limited defect, missing important edge case, operability or maintainability risk.
- **LOW:** minor robustness, clarity or consistency issue with real but limited impact.

## Required review dimensions

Correctness, edge cases, compatibility, error handling, concurrency/idempotency, security boundaries, performance traps, resource cleanup, observability, dependency use, migrations, test adequacy and documentation impact.

## Verdict

PASS only with no unresolved CRITICAL/HIGH finding and no unmet acceptance criterion. PASS_WITH_WARNINGS may contain explicit non-blocking MEDIUM/LOW findings. Otherwise FAIL.
