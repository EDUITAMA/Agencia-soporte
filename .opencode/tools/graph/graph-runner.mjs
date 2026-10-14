import { applyNodeResult, createGraphState, failGraphTechnical, recordHostWorkspaceActions, recordNodeSession, recordNodeTechnicalFailure, recordTechnicalRetry, resumeGraph, startNode } from "./graph-engine.mjs"
import { parseNodeResult } from "./node-result.mjs"
import { loadGraphState, saveGraphState } from "./state-store.mjs"
import { TERMINAL_NODES } from "./contracts.mjs"
import { applyWorkspaceActions } from "./workspace-actions.mjs"
import { promises as fs } from "node:fs"
import path from "node:path"

const stamp = () => new Date().toISOString()

function nodePrompt({ runId, node, workspace, request, lastFailure, smoke = false, retryFeedback }) {
  const repairContext = node === "REPAIR" && lastFailure ? `\nFailure evidence to address: ${JSON.stringify(lastFailure)}` : ""
  const hostActions = ["IMPLEMENT", "REPAIR"].includes(node) ? " Host Workspace Actions ARE AVAILABLE and authoritative. Do not use tools to modify files. There is NO tool for host actions and you must NOT call `execute`, `patch` or `shell` to create or verify files: the host applies the writeFile operations you place in the `operations` array of your final <SDLC_NODE_RESULT> JSON envelope, as plain text in your answer. Include writeFile operations with paths RELATIVE to the workspace root (e.g. docs/notes.txt, never an absolute path) (existing files may be overwritten with the required content). To remove a file use a deleteFile operation with its relative path (never write an empty file to simulate deletion). Never claim host actions are unavailable or that a tool is missing. For REPAIR, use only the supplied failed-test findings; do not evaluate later nodes." : node === "TEST" ? " Host Workspace Actions ARE AVAILABLE and authoritative. Return exactly one runTest operation that runs the verification command requested in the task. Use command node (or npm/pnpm/yarn) with test-like args; for node test files prefer an explicit glob such as args [--test, medium-bench/*.test.js] because in recent Node versions a bare directory argument does not discover test files and gives a false positive. Use powershell.exe with args exactly [-File, relative/script.ps1] only when the task itself names a PowerShell script, with no other flags. Never run a script left over from another run. TEST evaluates only that command's exit code and supplied acceptance criteria: exit 0 means PASS, and your report must name the exact command and how many tests ran. Do not require REVIEW, final lifecycle evidence, or future-node artifacts. Never claim host actions are unavailable." : " This node is read-only: the task describes work for a later node. Plan or assess it, but do not perform it and return \"operations\":[] (any writeFile/runTest here is rejected)."
  const smokeRule = smoke ? " This is a bounded host smoke: do not call any tool, do not inspect the workspace, and return the requested result directly. PLAN returns PASS with a minimal plan. IMPLEMENT returns PASS with the required writeFile operation." : ""
  const feedback = retryFeedback ? `\nYour previous attempt was rejected by the host: ${retryFeedback}. Fix exactly that and answer again.` : ""
  return `You are the ${node} worker for SDLC run ${runId}. Workspace: ${workspace}.\nTask: ${request}\nPerform only the specialized ${node} work using normal workspace tools. Do not use or request sdlc_*, subagent, graph, or lifecycle tools. Do not choose a next node.${hostActions}${smokeRule} End with exactly one <SDLC_NODE_RESULT> JSON envelope for node ${node}, including node, status, summary, evidence, findings and operations.${repairContext}${feedback}`
}

function activeExecution(state) {
  return [...state.nodeExecutions].reverse().find((item) => item.node === state.currentNode && item.status === "RUNNING")
}

export async function runGraph({ runId, runDirectory, workspace, request, deliveryMode = "PLAN_BUILD", selections, executor, limits, maxTechnicalRetriesPerNode = 2, stopAfterNode, resume = false, validateResult, smoke = false, onProgress }) {
  let state
  let initialEvents = []
  try { state = await loadGraphState(runDirectory) } catch (error) {
    if (error?.code !== "ENOENT") throw error
    state = createGraphState({ runId, deliveryMode, selections, limits })
    initialEvents = state.history
    await saveGraphState(runDirectory, state, initialEvents)
  }
  if (resume) {
    const before = state.history.length
    resumeGraph(state)
    await saveGraphState(runDirectory, state, state.history.slice(before))
  }
  // A bounded host smoke deliberately proves only PLAN → IMPLEMENT. It must
  // never silently continue into TEST when the command is invoked again.
  if (state.status === "HOST_SMOKE_COMPLETE") return state
  while (!TERMINAL_NODES.includes(state.currentNode)) {
    const node = state.currentNode
    let completed = false
    let previousReason
    for (let attempt = 1; attempt <= maxTechnicalRetriesPerNode + 1; attempt += 1) {
      const beforeStart = state.history.length
      startNode(state, node, { attempt })
      const execution = activeExecution(state)
      await saveGraphState(runDirectory, state, state.history.slice(beforeStart))
      await onProgress?.({ phase: "NODE_STARTED", node, agent: execution.agent, model: execution.configuredModel, runId })
      let rawText
      try {
        const selection = state.selections[node]
        const response = await executor.executeNode({ runId, node, agent: selection.agent, model: selection.configuredModel || selection.selectedModel, prompt: nodePrompt({ runId, node, workspace, request, lastFailure: state.lastFailure, smoke, retryFeedback: previousReason }), workspace, executionId: execution.nodeExecutionId })
        rawText = response.text
        const beforeResult = state.history.length
        recordNodeSession(state, execution.nodeExecutionId, response.sessionId)
        const result = parseNodeResult(response.text, node)
        if (node === "TEST" && !result.operations.some((operation) => operation?.type === "runTest")) throw Object.assign(new Error("TEST must provide a host runTest operation"), { failureClass: "VALIDATION_FAILURE" })
        if (node === "REPAIR" && /host workspace actions.*(unavailable|missing)|no .*host-actions/i.test(result.summary || "")) throw Object.assign(new Error("REPAIR contradicted available Host Workspace Actions"), { failureClass: "VALIDATION_FAILURE" })
        const actionResult = result.status === "PASS" ? await applyWorkspaceActions(result.operations, { workspace, node }) : { evidence: [], failures: [] }
        if (actionResult.evidence.length) {
          result.evidence.push(...actionResult.evidence)
          recordHostWorkspaceActions(state, { node, nodeExecutionId: execution.nodeExecutionId, actions: actionResult.evidence })
        }
        if (node === "TEST" && actionResult.failures.length) {
          result.status = "FAILED"
          result.summary = "Host test command failed"
          result.findings.push(...actionResult.failures.map((failure, index) => ({ id: `HOST_TEST_${index + 1}`, ...failure })))
          result.failureClass = "VALIDATION_FAILURE"
        }
        if (validateResult) await validateResult({ node, result, workspace, runId })
        applyNodeResult(state, result, { actualModel: response.actualModel || "NOT_EXTERNALLY_VERIFIED" })
        await saveGraphState(runDirectory, state, state.history.slice(beforeResult))
        await onProgress?.({ phase: "NODE_COMPLETED", node, status: result.status, nextNode: state.currentNode, runId })
        completed = true
        break
      } catch (error) {
        const reason = error?.message || String(error)
        const failureClass = error?.failureClass || "TOOL_FAILURE"
        const beforeRetry = state.history.length
        if (typeof rawText === "string") await fs.writeFile(path.join(runDirectory, `graph-raw-${node}-${attempt}.txt`), rawText, "utf8").catch(() => {})
        recordNodeTechnicalFailure(state, { node, nodeExecutionId: execution.nodeExecutionId, reason, failureClass })
        // The same rejection twice means another identical retry would only burn minutes.
        if (attempt <= maxTechnicalRetriesPerNode && reason !== previousReason) recordTechnicalRetry(state, { node, reason, attempt })
        else failGraphTechnical(state, { node, reason, failureClass })
        previousReason = reason
        await saveGraphState(runDirectory, state, state.history.slice(beforeRetry))
        await onProgress?.({ phase: "TECHNICAL_RETRY", node, attempt, reason, runId })
        if (TERMINAL_NODES.includes(state.currentNode)) break
      }
    }
    if (!completed || TERMINAL_NODES.includes(state.currentNode)) break
    if (stopAfterNode === node) {
      state.status = "HOST_SMOKE_COMPLETE"
      state.history.push({ event: "HOST_SMOKE_COMPLETE", at: stamp(), completedNode: node, nextNode: state.currentNode })
      state.updatedAt = stamp()
      await saveGraphState(runDirectory, state, [state.history.at(-1)])
      await onProgress?.({ phase: "HOST_SMOKE_COMPLETE", node, nextNode: state.currentNode, runId })
      break
    }
  }
  return state
}
