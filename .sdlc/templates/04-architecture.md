# Architecture

- Run ID: {{RUN_ID}}
- Status: DESIGN_READY/DESIGN_BLOCKED/NO_STRUCTURAL_CHANGE

## Decision

{{DECISION_AND_RATIONALE}}

### Alternatives

| Alternative | Benefits | Costs/risks | Decision |
|---|---|---|---|
| {{OPTION}} | {{VALUE}} | {{VALUE}} | selected/rejected |

## Components

| Component | Responsibility | Changed? | Dependencies |
|---|---|---|---|
| {{NAME}} | {{RESPONSIBILITY}} | yes/no | {{DEPENDENCIES}} |

## Data and Contracts

- API/event/schema/file contracts: {{VALUE}}
- Compatibility: {{VALUE}}
- Data lifecycle/migration: {{VALUE}}
- Idempotency/concurrency: {{VALUE}}

## Failure Modes

| Failure | Detection | Behavior | Recovery |
|---|---|---|---|
| {{FAILURE}} | {{DETECTION}} | {{BEHAVIOR}} | {{RECOVERY}} |

## Security

- Trust boundaries: {{VALUE}}
- Authentication/authorization: {{VALUE}}
- Validation/sensitive data: {{VALUE}}

## Observability

- Logs: {{VALUE}}
- Metrics/traces/correlation: {{VALUE}}
- Alerts/support diagnostics: {{VALUE}}

## Rollback

- Reversal mechanism: {{VALUE}}
- Compatibility window: {{VALUE}}
- Feature flag or migration rollback: {{VALUE}}
