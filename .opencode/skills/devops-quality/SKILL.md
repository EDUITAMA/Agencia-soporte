---
name: devops-quality
description: Review build, CI/CD, configuration, migrations, deployment safety, observability, rollback and runtime operability without deploying.
license: MIT
compatibility: opencode
metadata:
  category: delivery
  scope: universal
---

# DevOps Quality

## Delivery review

Inspect only when the change affects build artifacts, dependencies, configuration, runtime topology, infrastructure, migrations, pipelines or operational procedures.

Check:

- reproducible build and lockfile consistency;
- CI command parity with local verification;
- least-privilege workflow permissions and secret references;
- environment-specific configuration and safe defaults;
- artifact versioning and compatibility;
- health/readiness checks and graceful shutdown;
- migration ordering, mixed-version compatibility and rollback;
- feature-flag lifecycle;
- deployment strategy, failure detection and rollback trigger;
- logs, metrics, alerts and runbook impact;
- resource requests/limits and scaling implications.

## Safety

Do not run deployment, apply infrastructure, publish images/packages or execute real migrations. Validate definitions statically or through existing dry-run/test commands.

## Verdict

FAIL for unreproducible delivery, missing required config, unsafe secret handling, irreversible rollout without approval, absent rollback for high-risk changes or pipeline behavior that bypasses required gates.
