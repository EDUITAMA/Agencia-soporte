# Test Strategy

- Run ID: {{RUN_ID}}
- Risk level: {{RISK}}

## Traceability Matrix

| Criterion | Case ID | Level | Scenario | Expected result | Evidence |
|---|---|---|---|---|---|
| AC-01 | TC-01 | unit/integration/contract/e2e | {{SCENARIO}} | {{EXPECTED}} | {{TEST_OR_COMMAND}} |

## Test Levels

- Unit: {{SCOPE_AND_REASON}}
- Integration/component: {{SCOPE_AND_REASON}}
- Contract: {{SCOPE_AND_REASON_OR_NOT_REQUIRED}}
- End-to-end: {{SCOPE_AND_REASON_OR_NOT_REQUIRED}}
- Security/performance/migration: {{SCOPE_AND_REASON_OR_NOT_REQUIRED}}

## Negative and Edge Cases

- {{CASE}}

## Test Commands

| Order | Purpose | Command | Expected scope |
|---|---|---|---|
| 1 | Focused | {{COMMAND}} | {{SCOPE}} |
| 2 | Regression | {{COMMAND}} | {{SCOPE}} |

## Exit Criteria

- Every applicable acceptance criterion has passing evidence.
- Required broader suites and static checks pass.
- No unexplained skipped or flaky test.
- Coverage/other confidence evidence meets repository or risk policy.
