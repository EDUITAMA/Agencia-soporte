import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { createGraphState, startNode, applyNodeResult, resumeGraph } from "./graph-engine.mjs"
import { resolveNextNode } from "./transitions.mjs"
import { loadGraphState, saveGraphState } from "./state-store.mjs"
import { parseNodeResult } from "./node-result.mjs"

const make = () => createGraphState({ runId: "graph-test", deliveryMode: "PLAN_BUILD", limits: { maxRepairCycles: 3, maxReviewCycles: 2 } })
const result = (node, status, extra = {}) => ({ node, status, summary: `${node} ${status}`, evidence: [], findings: [], ...extra })
const complete = (state, node, status, extra) => { startNode(state, node); return applyNodeResult(state, result(node, status, extra)).state }

{
  const state = make()
  assert.equal(state.currentNode, "PLAN")
  assert.equal(state.previousNode, "START")
  assert.equal(resolveNextNode(state, result("PLAN", "PASS")).nextNode, "IMPLEMENT")
  complete(state, "PLAN", "PASS")
  assert.equal(state.currentNode, "IMPLEMENT")
  complete(state, "IMPLEMENT", "PASS")
  assert.equal(state.currentNode, "TEST")
  complete(state, "TEST", "PASS")
  assert.equal(state.currentNode, "REVIEW")
  complete(state, "REVIEW", "PASS")
  assert.equal(state.currentNode, "COMPLETE")
  assert.equal(state.status, "COMPLETE")
}

{
  const child = `planner notes\n<SDLC_NODE_RESULT>\n{"node":"PLAN","status":"PASS","summary":"plan is ready","evidence":["06-implementation-plan.md"],"findings":[]}\n</SDLC_NODE_RESULT>`
  const parsed = parseNodeResult(child, "PLAN")
  const state = make()
  startNode(state, "PLAN")
  applyNodeResult(state, parsed)
  assert.equal(state.currentNode, "IMPLEMENT")
  assert.throws(() => parseNodeResult("PLAN_READY", "PLAN"), /missing <SDLC_NODE_RESULT>/)
}

{
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sdlc-graph-test-"))
  try {
    const state = make()
    await saveGraphState(directory, state, state.history)
    assert.equal((await loadGraphState(directory)).currentNode, "PLAN")
    const events = await fs.readFile(path.join(directory, "graph-events.jsonl"), "utf8")
    assert.match(events, /GRAPH_STARTED/)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

{
  const state = make()
  assert.equal(resolveNextNode(state, result("PLAN", "BLOCKED")).nextNode, "BLOCKED")
  assert.equal(resolveNextNode(state, result("PLAN", "FAILED")).nextNode, "FAILED")
  state.currentNode = "IMPLEMENT"
  assert.equal(resolveNextNode(state, result("IMPLEMENT", "FAILED")).nextNode, "REPAIR")
  assert.equal(resolveNextNode(state, result("IMPLEMENT", "BLOCKED")).nextNode, "BLOCKED")
  state.currentNode = "TEST"
  assert.equal(resolveNextNode(state, result("TEST", "BLOCKED")).nextNode, "BLOCKED")
  state.currentNode = "REPAIR"
  assert.equal(resolveNextNode(state, result("REPAIR", "FAILED")).nextNode, "FAILED")
  assert.equal(resolveNextNode(state, result("REPAIR", "BLOCKED")).nextNode, "BLOCKED")
  state.currentNode = "REVIEW"
  assert.equal(resolveNextNode(state, result("REVIEW", "BLOCKED")).nextNode, "BLOCKED")
  assert.equal(resolveNextNode(state, result("REVIEW", "FAILED")).nextNode, "FAILED")
}

{
  const state = make()
  complete(state, "PLAN", "PASS")
  complete(state, "IMPLEMENT", "PASS")
  complete(state, "TEST", "FAILED", { findings: [{ id: "T1" }] })
  assert.equal(state.currentNode, "REPAIR")
  assert.equal(state.cycles.repair, 1)
  assert.equal(state.lastFailure.findings[0].id, "T1")
  complete(state, "REPAIR", "PASS")
  assert.equal(state.currentNode, "TEST")
}

{
  const state = make()
  complete(state, "PLAN", "PASS")
  complete(state, "IMPLEMENT", "PASS")
  complete(state, "TEST", "PASS")
  complete(state, "REVIEW", "CHANGES_REQUESTED")
  assert.equal(state.currentNode, "REPAIR")
  assert.equal(state.cycles.review, 1)
  complete(state, "REPAIR", "PASS")
  assert.equal(state.currentNode, "TEST")
}

{
  const state = make()
  state.cycles.repair = 3
  assert.equal(resolveNextNode({ ...state, currentNode: "TEST" }, result("TEST", "FAILED")).nextNode, "FAILED")
  state.cycles.review = 2
  assert.equal(resolveNextNode({ ...state, currentNode: "REVIEW" }, result("REVIEW", "CHANGES_REQUESTED")).nextNode, "FAILED")
}

{
  const state = make()
  startNode(state, "PLAN")
  const id = state.nodeExecutions[0].nodeExecutionId
  resumeGraph(state)
  assert.equal(state.nodeExecutions[0].status, "INTERRUPTED")
  assert.equal(state.currentNode, "PLAN")
  assert.equal(state.history.at(-1).event, "GRAPH_RESUMED")
  assert.ok(id)
}

assert.throws(() => resolveNextNode(make(), result("PLAN", "CHANGES_REQUESTED")))
{
  const state = make()
  state.gates = { plan: "PASS", implementation: "PASS", test: "PENDING", review: "PENDING" }
  state.currentNode = "REVIEW"
  assert.equal(resolveNextNode(state, result("REVIEW", "PASS")).nextNode, "FAILED")
}

// Deterministic E2E: PLAN → IMPLEMENT → TEST fail → REPAIR → TEST → REVIEW changes → REPAIR → TEST → REVIEW.
{
  const state = make()
  complete(state, "PLAN", "PASS")
  complete(state, "IMPLEMENT", "PASS")
  complete(state, "TEST", "FAILED")
  complete(state, "REPAIR", "PASS")
  complete(state, "TEST", "PASS")
  complete(state, "REVIEW", "CHANGES_REQUESTED")
  complete(state, "REPAIR", "PASS")
  complete(state, "TEST", "PASS")
  complete(state, "REVIEW", "PASS")
  assert.equal(state.status, "COMPLETE")
  assert.equal(state.cycles.repair, 2)
  assert.deepEqual(state.history.filter((item) => item.event === "TRANSITION").map((item) => `${item.from}->${item.to}`), [
    "PLAN->IMPLEMENT", "IMPLEMENT->TEST", "TEST->REPAIR", "REPAIR->TEST", "TEST->REVIEW", "REVIEW->REPAIR", "REPAIR->TEST", "TEST->REVIEW", "REVIEW->COMPLETE",
  ])
}

console.log("graph SDLC regression: 11 passed")
