# Security and Autonomy Boundaries

## Guarded autonomy

The kit is autonomous inside the current worktree for analysis, code/test edits and verification. It is not authorized to release, deploy, publish, push, destroy or access credentials.

## Defense in depth

1. Global permission rules deny protected reads, external directories and dangerous commands.
2. Each agent has narrower role permissions.
3. The orchestrator cannot edit product code.
4. Auditors and judge can write only run reports.
5. `--auto` cannot override explicit deny rules.
6. Prompts independently prohibit unsafe actions.

## Limitations

Command matching is pattern-based and cannot understand every shell composition. Run in an isolated development environment, use least-privilege credentials and avoid exposing production access to autonomous sessions. Repository scripts themselves may contain side effects; inspect unknown scripts before allowing execution.

## Secrets

Use `.env.example`, fake fixtures and documented variable names. Do not paste tokens into requests, reports or model configuration. Provider authentication remains in OpenCode’s own credential mechanism.

## External research

Agents may access external documentation only when permissions allow and local evidence is insufficient. Do not send proprietary source, logs, customer data or secrets to external services.
