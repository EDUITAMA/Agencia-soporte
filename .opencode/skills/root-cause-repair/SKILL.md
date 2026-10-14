---
name: root-cause-repair
description: Diagnose a failed gate from reproducible evidence, isolate the root cause, apply the smallest repair and verify only impacted behavior.
license: MIT
compatibility: opencode
metadata:
  category: debugging
  scope: universal
---

# Root Cause Repair

## Diagnose before editing

1. Reproduce the failure with the narrowest command or code path.
2. Separate symptom, trigger, root cause and contributing conditions.
3. Identify the first invalid state or violated invariant.
4. Compare with expected behavior from requirements and tests.
5. Check whether the test, environment or production code is wrong.

## Repair

- Change the smallest layer that owns the violated invariant.
- Preserve valid behavior and compatibility.
- Add or strengthen a regression test that fails before the fix and passes after it.
- Avoid broad refactors while repairing unless the root cause is structural and approved.
- Do not catch-and-ignore failures, add retries blindly, increase timeouts without evidence or weaken assertions.

## Verification

Run the reproducer, focused regression tests and every downstream check affected by the modified behavior. Record before/after evidence and remaining uncertainty.

## Escalation

Return to requirements or architecture when the expected behavior itself is ambiguous or the repair would violate the approved design. Do not guess through a business decision.
