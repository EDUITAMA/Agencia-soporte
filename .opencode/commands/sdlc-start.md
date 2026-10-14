---
description: Start and autonomously execute a complete risk-adaptive SDLC run for the supplied request.
agent: sdlc-orchestrator
---

Start a NEW autonomous SDLC run for this exact request:

$ARGUMENTS

Follow the full protocol in your agent instructions. Create the run with `sdlc_create_run`, preserve the request verbatim, execute all applicable stages and risk checks, use bounded repairs, and close APPROVED or BLOCKED.

Do not stop for routine progress confirmation. Ask the user only when a policy stop condition requires a real human decision. Do not deploy, publish, push, commit, read secrets or perform destructive actions.

Before delegating anything, call `sdlc_project_context` and use its absolute `projectRoot`. Use stage checkpoints and recovery; never blindly retry a timed-out mutating stage.
