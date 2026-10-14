---
name: requirements-engineering
description: Convert a request and repository evidence into testable requirements, explicit scope, assumptions, NFRs and a risk-driven check profile.
license: MIT
compatibility: opencode
metadata:
  category: analysis
  scope: universal
---

# Requirements Engineering

## Requirement quality

Each acceptance criterion must be independently verifiable and describe observable behavior. Use stable IDs `AC-01`, `AC-02`, and so on.

Cover when relevant:

- actors and permissions;
- preconditions and triggers;
- normal outcome;
- invalid input and boundary behavior;
- failures, retries, timeouts and partial completion;
- compatibility and migration behavior;
- observability and supportability;
- accessibility, localization or data-retention obligations.

## Scope control

State explicitly:

- in scope;
- out of scope;
- assumptions supported by evidence;
- decisions still requiring a human;
- existing behavior that must remain unchanged.

Do not convert a possible improvement into a requirement unless the request or repository policy demands it.

## NFRs

Derive measurable NFRs only when applicable: latency, throughput, reliability, consistency, security, privacy, auditability, maintainability, portability and cost. When no numeric target exists, define a comparative constraint such as “no regression against the existing benchmark/test threshold”.

## Risk classification

Use the highest applicable level from policy. Risk drivers include blast radius, reversibility, sensitive data, authorization, financial impact, persistence, concurrency, public contracts, infrastructure and observability gaps.

Produce required checks from risk, not from preference. Mark a check NOT_REQUIRED only with a reason.
