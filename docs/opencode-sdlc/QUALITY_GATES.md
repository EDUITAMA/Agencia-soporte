# Quality Gates

## Evidence hierarchy

From strongest to weakest:

1. reproducible passing test or static analyzer tied to a requirement;
2. measured benchmark/security check with controlled conditions;
3. traced source invariant and independent review;
4. implementation-agent claim;
5. confidence statement.

Lower evidence cannot override contradictory higher evidence.

## Test quality

Coverage is a signal, not the decision. A high percentage with weak assertions is insufficient. The test report must show acceptance-criterion traceability, negative/failure behavior, skipped tests and environment limits.

## Finding severity

- CRITICAL: exploitable or catastrophic impact.
- HIGH: likely serious production defect/contract/security issue.
- MEDIUM: bounded defect or material maintainability/operability risk.
- LOW: limited robustness or clarity issue.

Unresolved CRITICAL/HIGH findings block approval. Medium findings block only when they violate an acceptance criterion, NFR or policy.

## Existing failures

A pre-existing failure must be demonstrated as pre-existing and assessed for relevance. The run cannot claim a clean regression suite when the suite fails, but the judge may distinguish a clearly unrelated baseline defect and require follow-up.

## NOT_REQUIRED

A conditional audit can be NOT_REQUIRED only with evidence about the changed surface. Silence is not NOT_REQUIRED.

## Human gates

Critical/destructive/release operations remain outside autonomous approval. The generated code may be complete, but the run closes BLOCKED until the named human decision exists.
