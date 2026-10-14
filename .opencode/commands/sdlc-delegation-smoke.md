---
description: Verify one real V2 AXET subagent delegation without a full SDLC run.
agent: sdlc-orchestrator
---

Run this exact minimal delegation check. Do not use a full SDLC lifecycle.

1. Call the native V2 `subagent` tool exactly once with `agent: "sdlc-developer"`, a short description, and a bounded prompt that instructs the child to create `model-routing-test.txt` in the authoritative project root containing exactly `MODEL_ROUTING_OK`.
2. The orchestrator must not create, edit, or test that file itself.
3. Record selected/configured model metadata before the call. Do not state an actual model until bridge evidence exists.
4. If the `subagent` call fails or the child fails to create the exact file, return `BLOCKED_DELEGATION` and do not implement a fallback.
5. Report the child session result and that bridge.log must show the downstream model before declaring real model switching PASS.
