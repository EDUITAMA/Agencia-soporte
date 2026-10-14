---
description: Show concise state, risk, gates, artifacts, repair budget and next action for the current or specified run.
agent: sdlc-orchestrator
---

Call `sdlc_status` for `$ARGUMENTS` or `current` when blank. If it contains a graph object, also call `sdlc_graph_status` and report graph state, current node, repair/review cycles, gates, agents/models and exactly one next command. Do not run or modify the workflow.
