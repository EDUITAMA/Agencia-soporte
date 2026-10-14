import assert from "node:assert/strict"
import { createActivityEvent, formatActivity, reconcileModel } from "./activity.mjs"

const routing = createActivityEvent({ event: "ORCHESTRATOR_DECISION", deliveryMode: "PLAN_BUILD", executionProfile: "COMPLEX_CODING", agent: "IMPLEMENTER" })
assert.equal(formatActivity(routing), "[Routing] PLAN_BUILD · COMPLEX_CODING · IMPLEMENTER")
const switchEvent = createActivityEvent({ event: "MODEL_SWITCH", phase: "IMPLEMENTATION", previousModel: "axet/gpt-5.6-luna", configuredModel: "axet/gpt-5.3-codex", reason: "COMPLEX_CODING" })
assert.equal(formatActivity(switchEvent), "[Model switch] axet/gpt-5.6-luna → axet/gpt-5.3-codex · IMPLEMENTATION · COMPLEX_CODING")
assert.equal(formatActivity(createActivityEvent({ event: "MODEL_EXECUTION", phase: "IMPLEMENTATION", actualModel: "openai/gpt-5.3-codex" })), "[Model execution] IMPLEMENTATION → openai/gpt-5.3-codex")
assert.equal(formatActivity(createActivityEvent({ event: "RETRY", attempt: 2, reason: "provider timeout" })), "[Retry] Attempt 2 · provider timeout")
assert.equal(formatActivity(createActivityEvent({ event: "FALLBACK", previousModel: "axet/gpt-5.3-codex", configuredModel: "axet/gpt-5.6-terra", reason: "configured model fallback" })), "[Fallback] axet/gpt-5.3-codex → axet/gpt-5.6-terra · configured model fallback")
assert.equal(formatActivity(createActivityEvent({ event: "MODEL_ROUTING_WARNING", selectedModel: "axet/gpt-5.3-codex", actualModel: "axet/gpt-5.6-luna" })), "[Model routing warning] Selected axet/gpt-5.3-codex; actual axet/gpt-5.6-luna")
assert.equal(formatActivity(createActivityEvent({ event: "PHASE_STARTED", phase: "TESTING" })), "[Phase] TESTING")
assert.equal(formatActivity(createActivityEvent({ event: "COMMAND_COMPLETED", command: "backend npm test", result: "PASS" })), "[Result] backend npm test → PASS")
assert.deepEqual(reconcileModel({ selectedModel: "axet/gpt-5.3-codex", configuredModel: "axet/gpt-5.3-codex" }), { status: "UNCONFIRMED", selectedModel: "axet/gpt-5.3-codex", configuredModel: "axet/gpt-5.3-codex", actualModel: null })
assert.equal(reconcileModel({ selectedModel: "axet/gpt-5.3-codex", configuredModel: "axet/gpt-5.3-codex", actualModel: "axet/gpt-5.6-luna" }).status, "MISMATCH")
assert.equal(reconcileModel({ selectedModel: "axet/gpt-5.3-codex", configuredModel: "axet/gpt-5.3-codex", actualModel: "openai/gpt-5.3-codex" }).status, "MATCH")
console.log("activity regression: 10 passed")
