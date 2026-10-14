---
name: implementation-planning
description: Produce a dependency-ordered implementation plan with small tasks, affected files, verification, rollback and explicit non-goals.
license: MIT
compatibility: opencode
metadata:
  category: planning
  scope: universal
---

# Implementation Planning

## Task format

Use IDs `T-01`, `T-02`, and include for every task:

- objective and linked acceptance criteria;
- files or symbols expected to change;
- dependencies and execution order;
- implementation constraints;
- focused verification command or observation;
- rollback or reversal note;
- completion evidence.

## Slicing

Prefer vertical or behaviorally complete slices that can be verified independently. Keep refactoring separate from behavior change unless separation would be unsafe or duplicate work. Identify generated files but modify their source rather than hand-editing output.

## Plan validity

- Every acceptance criterion maps to one or more tasks and tests.
- Every architecture decision maps to implementation work or an explicit “no code impact”.
- Tests are planned before the implementation report.
- Migration and compatibility steps have ordering and rollback.
- No task relies on a vague instruction such as “update as needed”.

## Change budget

Name the expected modules and a rough size class: small, medium or large. A substantial deviation during implementation must return to planning rather than silently expanding scope.
