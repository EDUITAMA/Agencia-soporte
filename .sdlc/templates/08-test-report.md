# Test Report

- Run ID: {{RUN_ID}}

## Environment

- Runtime/tool versions: {{VALUE}}
- Relevant configuration/fixtures: {{VALUE}}
- Limitations: {{VALUE}}

## Commands and Results

| Command | Scope | Result/exit | Duration | Evidence |
|---|---|---|---|---|
| {{COMMAND}} | {{SCOPE}} | {{RESULT}} | {{DURATION}} | {{REFERENCE}} |

## Requirement Coverage

| Criterion | Test cases | Result | Evidence |
|---|---|---|---|
| AC-01 | TC-01 | PASS/FAIL | {{TEST_LOCATION_OR_OUTPUT}} |

## Failures

| ID | Classification | Reproduction | Expected vs actual | Owner |
|---|---|---|---|---|
| {{FAILURE_OR_NONE}} | product/test/environment/pre-existing | {{VALUE}} | {{VALUE}} | {{ROLE}} |

## Flakiness

- Retries performed: {{VALUE}}
- Non-determinism observed: {{VALUE}}
- Skipped tests and reason: {{VALUE}}

## Verdict

{{PASS_PASS_WITH_WARNINGS_FAIL_BLOCKED}}
