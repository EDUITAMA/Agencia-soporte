---
description: Run a deliberately small Graph SDLC smoke path using real subagents when the environment permits.
agent: sdlc-orchestrator
---

This is a fresh Graph command turn. First call `sdlc_plugin_status` exactly once, then immediately call `sdlc_project_context`, then `sdlc_apply_models`. Do not produce a text response between those successful calls. Their success proves controller availability for this turn. Next call `sdlc_create_run`, `sdlc_resolve_model_routing`, and `sdlc_graph_start`; do not stop after the preflight. A tool is unavailable only when its concrete call returns `Unknown tool`, `permission denied`, or a rejected native `subagent` call. Do not search MCP resources or marketplace.

Create or resume a PLAN_BUILD run for this bounded task: create `graph-sdlc-smoke.txt` containing `GRAPH_SDLC_OK`, add a focused verification, and review it. The parent owns the complete sequence: `sdlc_graph_start` → `sdlc_graph_node_started` → native child delegation → `sdlc_graph_parse_node_result` → `sdlc_graph_node_result`, repeated for PLAN, IMPLEMENT, TEST and REVIEW. Each child uses only normal workspace tools and returns its final `<SDLC_NODE_RESULT>`; it must not call or require any `sdlc_*` or subagent capability. Persist graph evidence and report selected/configured models. Set actualModel to NOT_EXTERNALLY_VERIFIED unless bridge evidence is accessible; do not claim a real model switch without it.
