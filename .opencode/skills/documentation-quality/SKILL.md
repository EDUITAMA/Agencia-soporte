---
name: documentation-quality
description: Update concise user, developer and operational documentation so behavior, setup, decisions and troubleshooting match the implemented system.
license: MIT
compatibility: opencode
metadata:
  category: documentation
  scope: universal
---

# Documentation Quality

## Determine impact

Update only documentation affected by the change: public API, configuration, setup, behavior, architecture decision, migration, operational response, troubleshooting or examples.

## Quality criteria

- Commands are copyable and match repository tooling.
- Examples use safe placeholders, not secrets.
- New configuration includes purpose, type, default, valid values and operational consequence.
- Breaking or migration behavior is explicit.
- Architecture docs explain why, not line-by-line implementation.
- Runbooks include detection, diagnosis, mitigation and rollback.
- Terminology matches the product and codebase.
- Remove stale statements made incorrect by the change.

## Economy

Do not duplicate source code or produce a large new document when a focused update is sufficient. Link existing canonical docs rather than restating them.

## Verdict

PASS when all material documentation impact is covered or explicitly NOT_REQUIRED with evidence. FAIL when users/operators would misconfigure, misuse or be unable to support the changed behavior.
