---
name: test-engineering
description: Design and execute risk-based tests with acceptance-criterion traceability, negative cases, determinism, coverage evidence and honest failure reporting.
license: MIT
compatibility: opencode
metadata:
  category: quality
  scope: universal
---

# Test Engineering

## Strategy

Build a traceability matrix from each acceptance criterion to test level, case and evidence. Select the cheapest level that can prove the behavior, then add higher-level tests for contracts and integration risk.

## Test levels

- **Unit:** decisions, transformations, boundaries, errors and state transitions.
- **Component/integration:** framework wiring, persistence, messaging, external adapters and serialization.
- **Contract:** public APIs, events, schemas and consumer compatibility.
- **End-to-end:** only critical user or system journeys that cannot be proven below.
- **Security negative:** unauthorized, malformed, replayed, oversized or malicious inputs.
- **Performance:** critical paths, resource limits and regression thresholds.
- **Migration/rollback:** forward, backward and mixed-version behavior when relevant.

## Case design

Cover equivalence classes, empty/null/missing input, minimum/maximum boundaries, invalid ordering, duplicates, retries, timeouts, partial failure, concurrency, authorization boundaries, locale/time-zone behavior and recovery when applicable.

Use property-based, mutation or fuzz testing when they provide material confidence and the repository supports them. Do not add a heavy framework for a single trivial test.

## Test quality

- Assert observable behavior, not internal call order unless interaction is the contract.
- Avoid sleeps, real external networks and shared mutable fixtures.
- Control time, randomness and concurrency.
- Use realistic fixtures without real secrets or personal data.
- Keep failure messages diagnostic.
- Never delete or weaken a valid test because production code fails it.

## Execution evidence

Record exact command, scope, result/exit status, duration when useful, skipped tests, flaky retries, coverage and environment limitations. A suite that could not run is FAIL or BLOCKED, never PASS.

## Exit criteria

All applicable acceptance criteria have passing evidence, no unexplained regression exists, new behavior has focused tests, and required broader suites pass. Coverage numbers support but do not replace behavioral adequacy.
