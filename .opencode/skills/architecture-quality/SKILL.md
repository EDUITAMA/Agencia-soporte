---
name: architecture-quality
description: Design or validate a proportionate architecture covering boundaries, contracts, data, failures, security, observability and rollback.
license: MIT
compatibility: opencode
metadata:
  category: architecture
  scope: universal
---

# Architecture Quality

## Proportional design

Prefer the existing architecture and the smallest coherent extension. A low-risk localized change may legitimately conclude “no structural architecture change”; still document affected boundaries and constraints.

## Decision checklist

- Responsibility and ownership of each component.
- Dependency direction and coupling.
- Public and internal contracts, including compatibility.
- Data model, lifecycle, consistency and migrations.
- Synchronous/asynchronous flow, idempotency and concurrency.
- Failure modes, retries, timeouts, circuit breaking and compensation.
- Authentication, authorization, validation and sensitive-data handling.
- Logging, metrics, traces, correlation and operational diagnostics.
- Deployment, configuration, feature flags and rollback.
- Performance and cost implications.

## Alternatives

Record at least one credible alternative for material decisions. Compare complexity, risk, operability and future change cost. Reject overengineering explicitly.

## ADR threshold

Create an ADR when the choice affects a public contract, data model, cross-module dependency, external integration, deployment topology or a long-lived constraint. Do not create an ADR for routine local implementation details.

## Architecture acceptance

The design is ready only when a planner can identify files and tasks without inventing missing behavior, and a test designer can derive observable verification points.
