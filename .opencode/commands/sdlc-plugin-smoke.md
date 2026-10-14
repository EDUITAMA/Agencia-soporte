---
description: Verify that OpenCode V2 has loaded the SDLC controller-tool plugin before starting a Graph run.
agent: sdlc-orchestrator
---

Call `sdlc_plugin_status` only. Confirm that the returned `registeredTools` includes `sdlc_project_context`, `sdlc_create_run`, `sdlc_graph_start`, `sdlc_graph_node_started`, `sdlc_graph_parse_node_result`, `sdlc_graph_node_result`, `sdlc_graph_resume`, `sdlc_graph_technical_retry`, and `sdlc_graph_status`. Also report `nativeDelegationToolIds` and whether `nativeSubagentAvailable` is true. Do not search MCP resources or marketplace. Do not start, modify, or resume a run. If the tool is unavailable, report `SDLC_PLUGIN_NOT_LOADED` and stop.
