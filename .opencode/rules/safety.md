# Safety Rules

## Protected information

Never open real `.env` files, credential stores, private keys, cloud profiles, browser storage, secret-manager exports or production data dumps. Use examples, documented variable names and redacted fixtures.

## Prohibited automatic actions

Do not automatically:

- push, merge or rewrite shared Git history;
- publish packages or releases;
- deploy to any environment;
- apply or destroy infrastructure;
- execute irreversible migrations;
- delete real data or cloud resources;
- change access control, billing or organization settings;
- bypass TLS, signature, authentication or authorization checks;
- disable security controls or tests to obtain a passing result.

## Dependency policy

Prefer existing dependencies and platform capabilities. A new dependency requires a concrete benefit, compatibility check, maintenance and license consideration, and a note in the implementation report. Never install a package solely to simplify a trivial change.

## Command policy

Run commands from the repository root unless project documentation says otherwise. Prefer read-only inspection first. Use the narrowest command that proves the claim. Never use destructive flags as cleanup shortcuts.

## Data and migrations

For schema or data changes, require forward and rollback strategy, compatibility window, idempotency, backup assumptions and failure recovery. Critical or irreversible operations require human approval even if code generation is complete.

## Human escalation

Escalate with one concise question containing: decision needed, options, consequence of each option, recommended default and evidence already collected.
