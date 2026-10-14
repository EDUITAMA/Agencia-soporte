import crypto from "node:crypto"
import { EXECUTABLE_NODES, TERMINAL_NODES, validateNodeResult } from "./contracts.mjs"
import { resolveNextNode } from "./transitions.mjs"

const stamp = () => new Date().toISOString()
const event = (state, name, details = {}) => ({ event: name, at: stamp(), ...details })
const executionId = () => crypto.randomUUID()
const gateName = (node) => ({ PLAN: "plan", IMPLEMENT: "implementation", TEST: "test", REVIEW: "review" }[node])

export function createGraphState({ runId, deliveryMode, limits = {}, selections = {} }) {
  const createdAt = stamp()
  const state = {
    schemaVersion: 1,
    runId,
    deliveryMode,
    status: "RUNNING",
    currentNode: "PLAN",
    previousNode: "START",
    cycles: { implementation: 0, repair: 0, review: 0, technicalRetry: 0 },
    limits: { maxRepairCycles: limits.maxRepairCycles ?? 3, maxReviewCycles: limits.maxReviewCycles ?? 2 },
    gates: { plan: "PENDING", implementation: "PENDING", test: "PENDING", review: "PENDING" },
    selections,
    activeAgent: selections.PLAN?.agent || null,
    selectedModel: selections.PLAN?.selectedModel || null,
    nodeExecutions: [],
    history: [],
    lastFailure: null,
    createdAt,
    updatedAt: createdAt,
  }
  state.history.push(event(state, "GRAPH_STARTED", { from: "START", to: "PLAN" }), event(state, "NODE_ENTERED", { node: "PLAN" }))
  return state
}

export function startNode(state, node = state.currentNode, metadata = {}) {
  if (!EXECUTABLE_NODES.includes(node)) throw new Error(`Cannot start graph node: ${node}`)
  if (TERMINAL_NODES.includes(state.currentNode)) throw new Error("Cannot start a node in a terminal graph")
  if (node !== state.currentNode) throw new Error(`Cannot start ${node}; active node is ${state.currentNode}`)
  const selection = state.selections?.[node] || {}
  const active = state.nodeExecutions.find((item) => item.node === node && item.status === "RUNNING")
  if (active) return state
  state.activeAgent = selection.agent || null
  state.selectedModel = selection.selectedModel || null
  state.nodeExecutions.push({ nodeExecutionId: executionId(), node, status: "RUNNING", startedAt: stamp(), completedAt: null, agent: state.activeAgent, selectedModel: state.selectedModel, configuredModel: selection.configuredModel || state.selectedModel, actualModel: "NOT_EXTERNALLY_VERIFIED", sessionId: null, attempt: metadata.attempt || 1 })
  state.history.push(event(state, "NODE_ENTERED", { node, agent: state.activeAgent, selectedModel: state.selectedModel }))
  state.updatedAt = stamp()
  return state
}

export function recordNodeSession(state, nodeExecutionId, sessionId) {
  const active = state.nodeExecutions.find((item) => item.nodeExecutionId === nodeExecutionId)
  if (!active) throw new Error(`Unknown graph node execution: ${nodeExecutionId}`)
  active.sessionId = sessionId
  state.updatedAt = stamp()
  return state
}

export function recordNodeTechnicalFailure(state, { node = state.currentNode, nodeExecutionId, reason, failureClass = "TOOL_FAILURE" }) {
  const active = state.nodeExecutions.find((item) => item.nodeExecutionId === nodeExecutionId)
  if (active) Object.assign(active, { status: "TECHNICAL_FAILED", completedAt: stamp(), failureClass, summary: reason })
  state.lastFailure = { node, status: "FAILED", summary: reason, evidence: [], findings: [], failureClass }
  state.history.push(event(state, "TECHNICAL_RETRY_SCHEDULED", { node, nodeExecutionId, reason, failureClass }))
  state.updatedAt = stamp()
  return state
}

export function recordHostWorkspaceActions(state, { node = state.currentNode, nodeExecutionId, actions }) {
  state.history.push(event(state, "HOST_WORKSPACE_ACTIONS_APPLIED", { node, nodeExecutionId, actions }))
  state.updatedAt = stamp()
  return state
}

export function failGraphTechnical(state, { node = state.currentNode, reason, failureClass = "TOOL_FAILURE" }) {
  state.lastFailure = { node, status: "FAILED", summary: reason, evidence: [], findings: [], failureClass }
  state.previousNode = node
  state.currentNode = "FAILED"
  state.status = "FAILED"
  state.history.push(event(state, "TECHNICAL_RETRY_EXHAUSTED", { node, reason, failureClass }))
  state.history.push(event(state, "GRAPH_FAILED", { reason: "TECHNICAL_RETRY_EXHAUSTED" }))
  state.updatedAt = stamp()
  return state
}

export function applyNodeResult(state, rawResult, metadata = {}) {
  const result = validateNodeResult(rawResult)
  const transition = resolveNextNode(state, result)
  const active = state.nodeExecutions.findLast?.((item) => item.node === result.node && item.status === "RUNNING")
    || [...state.nodeExecutions].reverse().find((item) => item.node === result.node && item.status === "RUNNING")
  if (active) Object.assign(active, { status: result.status, completedAt: stamp(), actualModel: metadata.actualModel || null, summary: result.summary })
  const gate = gateName(result.node)
  if (gate) state.gates[gate] = result.status === "PASS" ? "PASS" : "FAILED"
  if (result.node === "IMPLEMENT" && result.status === "PASS") state.cycles.implementation += 1
  if (result.status !== "PASS") state.lastFailure = { node: result.node, status: result.status, summary: result.summary, evidence: result.evidence, findings: result.findings, failureClass: result.failureClass || "VALIDATION_FAILURE" }
  state.history.push(event(state, "NODE_COMPLETED", { node: result.node, status: result.status, summary: result.summary }))
  state.history.push(event(state, result.status === "PASS" ? "GATE_PASSED" : "GATE_FAILED", { node: result.node, status: result.status }))
  if (transition.increment?.repair) {
    state.cycles.repair += transition.increment.repair
    if (result.node === "REVIEW") state.cycles.review += 1
    state.history.push(event(state, "REPAIR_SCHEDULED", { from: result.node, repairCycle: state.cycles.repair, reason: transition.reason }))
  }
  if (transition.cycleLimitReached) state.history.push(event(state, "CYCLE_LIMIT_REACHED", { node: result.node, reason: transition.reason }))
  state.history.push(event(state, "TRANSITION", { from: result.node, to: transition.nextNode, reason: transition.reason }))
  state.previousNode = result.node
  state.currentNode = transition.nextNode
  state.status = TERMINAL_NODES.includes(transition.nextNode) ? transition.nextNode : "RUNNING"
  const selection = state.selections?.[transition.nextNode] || {}
  state.activeAgent = selection.agent || null
  state.selectedModel = selection.selectedModel || null
  if (transition.nextNode === "COMPLETE") state.history.push(event(state, "GRAPH_COMPLETED"))
  if (transition.nextNode === "BLOCKED") state.history.push(event(state, "GRAPH_BLOCKED", { reason: transition.reason }))
  if (transition.nextNode === "FAILED") state.history.push(event(state, "GRAPH_FAILED", { reason: transition.reason }))
  if (EXECUTABLE_NODES.includes(transition.nextNode)) state.history.push(event(state, "NODE_ENTERED", { node: transition.nextNode, agent: state.activeAgent, selectedModel: state.selectedModel }))
  state.updatedAt = stamp()
  return { state, transition, result }
}

export function resumeGraph(state) {
  if (TERMINAL_NODES.includes(state.currentNode)) return state
  const active = [...state.nodeExecutions].reverse().find((item) => item.node === state.currentNode && item.status === "RUNNING")
  if (active) {
    active.status = "INTERRUPTED"
    active.completedAt = stamp()
    state.lastFailure = { node: state.currentNode, status: "INTERRUPTED", summary: "Process interrupted before node result was persisted", evidence: [], findings: [], failureClass: "INTERRUPTED" }
  }
  state.status = "RUNNING"
  state.history.push(event(state, "GRAPH_RESUMED", { node: state.currentNode, interruptedExecutionId: active?.nodeExecutionId || null }))
  state.updatedAt = stamp()
  return state
}

export function recordTechnicalRetry(state, { node = state.currentNode, reason, attempt }) {
  if (TERMINAL_NODES.includes(state.currentNode)) throw new Error("Cannot retry a terminal graph")
  state.cycles.technicalRetry = (state.cycles.technicalRetry || 0) + 1
  state.history.push(event(state, "RETRY", { node, reason, attempt: attempt || state.cycles.technicalRetry }))
  state.updatedAt = stamp()
  return state
}
