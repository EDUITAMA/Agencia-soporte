---
name: implementation-quality
description: Implement maintainable production changes with minimal diffs, repository conventions, defensive behavior, observability and reversible decisions.
license: MIT
compatibility: opencode
metadata:
  category: engineering
  scope: universal
---

# Implementation Quality

## Before editing

Read the approved plan, architecture, test strategy, local conventions and nearby implementation/tests. Confirm the working tree so unrelated user changes are preserved.

## Coding principles

- Match existing naming, layering, error model and dependency injection style.
- Keep the diff minimal and cohesive.
- Prefer explicit types and contracts at boundaries.
- Validate untrusted input at the boundary.
- Preserve backward compatibility unless breaking behavior is approved.
- Handle errors intentionally; do not swallow exceptions or return ambiguous states.
- Add useful structured diagnostics without secrets or personal data.
- Make retries idempotent and concurrency safe when applicable.
- Avoid global mutable state and hidden temporal coupling.
- Do not add abstractions until they remove demonstrated duplication or enforce a boundary.

## Dependencies

Use existing libraries first. For a new dependency, verify necessity, supported version, license/maintenance implications and lockfile impact. Document the decision.

## Verification loop

After each coherent task, run the narrowest formatter/lint/typecheck/build/test needed. At the end, run the plan’s required suite. Record exact commands and outcomes in `07-implementation-report.md`.

## Prohibitions

Do not weaken tests, disable analyzers, add broad ignores, expose secrets, modify unrelated code or claim completion with failing verification.
