---
name: security-engineering
description: Assess threat surface, authentication, authorization, input handling, data exposure, dependencies, secrets and abuse paths using repository evidence.
license: MIT
compatibility: opencode
metadata:
  category: security
  scope: universal
---

# Security Engineering

## Threat-led review

Identify assets, trust boundaries, actors, entry points, privileges and attacker-controlled data. Review changed paths first, then adjacent controls required to judge them.

## Mandatory dimensions when applicable

- authentication and session lifecycle;
- object/function-level authorization and tenant isolation;
- input validation, canonicalization and output encoding;
- injection into SQL, shell, templates, paths, logs and queries;
- SSRF, unsafe redirects, deserialization and file handling;
- secrets, tokens, encryption, key use and sensitive logging;
- CSRF, CORS, cookies and browser security;
- replay, idempotency, rate limiting and resource exhaustion;
- dependency vulnerabilities and supply-chain changes;
- privacy, retention and least privilege;
- error responses that leak internal details.

## Evidence

Use local source, tests, lockfiles and existing scanners. Record scanner versions/commands and distinguish new findings from pre-existing ones. Never read real secret files or send code/data to an unapproved external service.

## Finding standard

Include severity, attack precondition, exploit path, impacted asset, evidence, mitigation and residual risk. Do not call theoretical reachability exploitable without tracing the path.

## Verdict

FAIL for unresolved CRITICAL/HIGH issues, missing required authorization tests, exposed secrets or unbounded high-impact abuse paths. PASS_WITH_WARNINGS may include accepted, documented lower risks.
