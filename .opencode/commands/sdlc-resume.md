---
description: Resume the current or specified SDLC run from its persisted state and continue only incomplete or failed stages.
agent: sdlc-orchestrator
---

Resume the SDLC run identified by `$ARGUMENTS`.

When no ID is supplied or the argument is `current`, use `sdlc_status` with `current`. Read persisted state and artifacts, continue from the earliest incomplete/failed stage, preserve successful evidence, use bounded repairs, and close when possible. Do not restart the workflow without impact evidence.

Before delegating anything, call `sdlc_project_context` and use its absolute `projectRoot`. Use stage checkpoints and recovery; never blindly retry a timed-out mutating stage.
