---
description: Perform independent tests, review and risk-selected audits of the current working-tree changes without creating new product behavior.
agent: sdlc-orchestrator
---

Review the current working-tree changes. Use `$ARGUMENTS` as additional scope or acceptance criteria.

Create a new SDLC run whose request is "Independent review of current changes" plus the supplied scope. Discover only changed/relevant areas, derive requirements from the stated scope and diff, classify risk, create a proportionate test strategy, then run `sdlc-test-engineer`, `sdlc-reviewer` and applicable security/performance/DevOps audits. Do not ask the developer agent to implement new behavior. Use the judge for a final APPROVED/REJECTED review decision.
