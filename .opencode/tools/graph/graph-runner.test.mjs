import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { runGraph } from "./graph-runner.mjs"

const selections = {
  PLAN: { agent: "sdlc-planner", selectedModel: "axet/gpt-5.6-terra", configuredModel: "axet/gpt-5.6-terra" },
  IMPLEMENT: { agent: "sdlc-developer", selectedModel: "axet/gpt-5.3-codex", configuredModel: "axet/gpt-5.3-codex" },
  TEST: { agent: "sdlc-test-engineer", selectedModel: "axet/gpt-5.4-2026-03-05", configuredModel: "axet/gpt-5.4-2026-03-05" },
  REPAIR: { agent: "sdlc-developer", selectedModel: "axet/gpt-5.3-codex", configuredModel: "axet/gpt-5.3-codex" },
  REVIEW: { agent: "sdlc-reviewer", selectedModel: "axet/eu.anthropic.claude-sonnet-5", configuredModel: "axet/eu.anthropic.claude-sonnet-5" },
}
const envelope = (node, status = "PASS") => `<SDLC_NODE_RESULT>{"node":"${node}","status":"${status}","summary":"${node} ${status}","evidence":[],"findings":[]}</SDLC_NODE_RESULT>`
const envelopeWithWrite = (node, file, content) => `<SDLC_NODE_RESULT>{"node":"${node}","status":"PASS","summary":"${node} PASS","evidence":[],"findings":[],"operations":[{"type":"writeFile","path":"${file}","content":"${content}"}]}</SDLC_NODE_RESULT>`
const setup = async () => fs.mkdtemp(path.join(os.tmpdir(), "sdlc-host-runner-"))
const run = (runDirectory, executor, extra = {}) => runGraph({ runId: "host-test", runDirectory, workspace: runDirectory, request: "host test", selections, limits: {}, executor, maxTechnicalRetriesPerNode: 2, stopAfterNode: "IMPLEMENT", ...extra })

{
  const directory = await setup()
  try {
    const calls = []
    const state = await run(directory, { executeNode: async ({ node, agent, model }) => { calls.push({ node, agent, model }); return { sessionId: `session-${node}`, text: envelope(node), actualModel: "NOT_EXTERNALLY_VERIFIED" } } })
    assert.equal(state.status, "HOST_SMOKE_COMPLETE")
    assert.equal(state.currentNode, "TEST")
    assert.deepEqual(calls.map((call) => call.node), ["PLAN", "IMPLEMENT"])
    assert.equal(calls[0].agent, "sdlc-planner")
    assert.equal(calls[1].model, "axet/gpt-5.3-codex")
    assert.equal(state.nodeExecutions[0].sessionId, "session-PLAN")
    assert.equal(state.nodeExecutions[1].sessionId, "session-IMPLEMENT")
    const repeated = await run(directory, { executeNode: async () => { throw new Error("bounded smoke must not execute TEST") } })
    assert.equal(repeated.status, "HOST_SMOKE_COMPLETE")
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
}

{
  const directory = await setup()
  try {
    const state = await run(directory, { executeNode: async ({ node }) => ({ sessionId: `action-${node}`, text: node === "IMPLEMENT" ? envelopeWithWrite(node, "graph-host-smoke.txt", "GRAPH_HOST_OK") : envelope(node) }) })
    assert.equal(await fs.readFile(path.join(directory, "graph-host-smoke.txt"), "utf8"), "GRAPH_HOST_OK")
    assert.equal(state.history.some((event) => event.event === "HOST_WORKSPACE_ACTIONS_APPLIED"), true)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
}

{
  const directory = await setup()
  try {
    let calls = 0
    const state = await run(directory, { executeNode: async ({ node }) => ({ sessionId: `retry-${++calls}`, text: calls === 1 ? "invalid" : envelope(node) }) })
    assert.equal(calls, 3)
    assert.equal(state.nodeExecutions[0].status, "TECHNICAL_FAILED")
    assert.equal(state.cycles.technicalRetry, 1)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
}

{
  const directory = await setup()
  try {
    const state = await run(directory, { executeNode: async () => { throw Object.assign(new Error("timeout"), { failureClass: "TIMEOUT" }) } })
    assert.equal(state.status, "FAILED")
    assert.equal(state.lastFailure.failureClass, "TIMEOUT")
    assert.equal(state.history.some((event) => event.event === "TECHNICAL_RETRY_EXHAUSTED"), true)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
}

{
  const directory = await setup()
  try {
    const state = await run(directory, { executeNode: async ({ node }) => ({ sessionId: `validation-${node}`, text: envelope(node) }) }, {
      validateResult: async ({ node }) => {
        if (node === "IMPLEMENT") throw Object.assign(new Error("required smoke artifact missing"), { failureClass: "VALIDATION_FAILURE" })
      },
    })
    assert.equal(state.status, "FAILED")
    assert.equal(state.lastFailure.failureClass, "VALIDATION_FAILURE")
    assert.equal(state.gates.implementation, "PENDING")
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
}

console.log("host-driven graph runner: PASS")
