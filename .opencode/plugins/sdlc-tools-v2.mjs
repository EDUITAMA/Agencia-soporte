// V2 registration adapter only. Graph behavior remains implemented in
// ../tools/graph/*.mjs; V2 handlers are dependency-free wrappers in sdlc-v2-runtime.
import { executeSdlcV2 } from "../tools/sdlc-v2-runtime.mjs"
import { prepareHostGraphRun } from "../tools/sdlc-v2-runtime.mjs"
import { runGraph } from "../tools/graph/graph-runner.mjs"
import { chooseEngine } from "../tools/routing.mjs"
import { createOpenCodeNodeExecutor } from "../tools/graph/node-executor.mjs"
import { promises as fs } from "node:fs"
import path from "node:path"
const TOOL_SPECS = {
  sdlc_project_context: { legacy: "project_context", required: [], properties: {} },
  sdlc_create_run: { legacy: "create_run", required: ["title", "request", "riskHint"], properties: { title: string(), request: string(), riskHint: string() } },
  sdlc_begin_stage: { legacy: "begin_stage", required: ["runId", "stageName"], properties: { runId: string(), stageName: string() } },
  sdlc_recover_stage: { legacy: "recover_stage", required: ["runId", "stageName"], properties: { runId: string(), stageName: string() } },
  sdlc_complete_stage: { legacy: "complete_stage", required: ["runId", "stageName", "summary"], properties: { runId: string(), stageName: string(), summary: string() } },
  sdlc_configure_run: { legacy: "configure_run", required: ["runId", "riskLevel", "requiredChecks", "maxRepairLoops"], properties: { runId: string(), riskLevel: string(), requiredChecks: string(), maxRepairLoops: number() } },
  sdlc_advance_stage: { legacy: "advance_stage", required: ["runId", "stage", "summary", "artifacts"], properties: { runId: string(), stage: string(), summary: string(), artifacts: string() } },
  sdlc_validate_gate: { legacy: "validate_gate", required: ["runId", "gate"], properties: { runId: string(), gate: string() } },
  sdlc_record_gate: { legacy: "record_gate", required: ["runId", "gate", "result", "summary"], properties: { runId: string(), gate: string(), result: string(), summary: string() } },
  sdlc_begin_repair: { legacy: "begin_repair", required: ["runId", "failedGate", "owner", "reason"], properties: { runId: string(), failedGate: string(), owner: string(), reason: string() } },
  sdlc_status: { legacy: "status", required: ["runId"], properties: { runId: string() } },
  sdlc_list_runs: { legacy: "list_runs", required: [], properties: {} },
  sdlc_record_human_approval: { legacy: "record_human_approval", required: ["runId", "decision", "evidence"], properties: { runId: string(), decision: string(), evidence: string() } },
  sdlc_close_run: { legacy: "close_run", required: ["runId", "outcome", "summary"], properties: { runId: string(), outcome: string(), summary: string() } },
  sdlc_apply_models: { legacy: "apply_models", required: [], properties: {} },
  sdlc_resolve_model_routing: { legacy: "resolve_model_routing", required: ["request"], properties: { request: string(), runId: string() } },
  sdlc_record_model_execution: { legacy: "record_model_execution", required: ["runId", "requestedModel", "configuredModel", "agent", "phase"], properties: { runId: string(), requestedModel: string(), configuredModel: string(), actualModel: string(), agent: string(), phase: string() } },
  sdlc_activity_event: { legacy: "activity_event", required: ["runId", "event"], properties: { runId: string(), event: string(), deliveryMode: string(), executionProfile: string(), phase: string(), agent: string(), selectedModel: string(), configuredModel: string(), actualModel: string(), previousModel: string(), reason: string(), task: string(), command: string(), result: string(), attempt: number(), bridgeSessionId: string(), requestId: string() } },
  sdlc_graph_start: { legacy: "graph_start", required: ["runId", "deliveryMode"], properties: { runId: string(), deliveryMode: string() } },
  sdlc_graph_node_started: { legacy: "graph_node_started", required: ["runId"], properties: { runId: string() } },
  sdlc_graph_parse_node_result: { legacy: "graph_parse_node_result", required: ["expectedNode", "childResponse"], properties: { expectedNode: string(), childResponse: string() } },
  sdlc_graph_node_result: { legacy: "graph_node_result", required: ["runId", "node", "status", "summary"], properties: { runId: string(), node: string(), status: string(), summary: string(), evidenceJson: string(), findingsJson: string(), failureClass: string(), actualModel: string() } },
  sdlc_graph_resume: { legacy: "graph_resume", required: ["runId"], properties: { runId: string() } },
  sdlc_graph_technical_retry: { legacy: "graph_technical_retry", required: ["runId", "reason"], properties: { runId: string(), reason: string(), attempt: number() } },
  sdlc_graph_status: { legacy: "graph_status", required: ["runId"], properties: { runId: string() } },
  sdlc_plugin_status: { legacy: null, required: [], properties: {} },
}

function string() { return { type: "string" } }
function number() { return { type: "number" } }

function workspaceContext(location) {
  const directory = location?.project?.directory || location?.directory
  if (!directory) throw new Error("SDLC plugin has no authoritative OpenCode project directory")
  return { directory, worktree: directory }
}

function assertController(execution) {
  if (execution?.agent && execution.agent !== "sdlc-orchestrator") {
    throw new Error("SDLC controller tools are available only to sdlc-orchestrator; child agents must use workspace tools and return SDLC_NODE_RESULT.")
  }
}

export const SDLC_V2_TOOL_NAMES = Object.freeze(Object.keys(TOOL_SPECS))

// OpenCode 2.0.23 requires an object with id and setup/effect. It exposes the
// V2 context directly, but does not ship either documented SDK import as a
// resolvable package for local plugins.
export default {
  id: "sdlc.tools.v2",
  async setup(ctx) {
    await ctx.command.transform((editor) => {
      const executeHostGraph = async ({ sessionID, prompt }, smoke = false) => {
        const request = smoke
          ? "Create graph-host-smoke.txt with the exact content GRAPH_HOST_OK. PLAN must analyze the task and return PASS. IMPLEMENT must create the file and return PASS."
          : String(prompt?.text || "").trim()
        if (!request) throw new Error("/sdlc-graph requires a task description")
        const host = await prepareHostGraphRun({ title: smoke ? "graph-host-smoke" : "graph", request, resume: !smoke }, workspaceContext(ctx.location))
        const executor = createOpenCodeNodeExecutor(ctx, { timeoutMs: smoke ? 90_000 : 300_000 })
        const validateResult = smoke ? async ({ node, result, workspace }) => {
          if (node !== "IMPLEMENT" || result.status !== "PASS") return
          const marker = path.join(workspace, "graph-host-smoke.txt")
          const content = await fs.readFile(marker, "utf8").catch(() => null)
          if (content !== "GRAPH_HOST_OK") throw Object.assign(new Error("Smoke IMPLEMENT PASS lacks graph-host-smoke.txt with exact content GRAPH_HOST_OK"), { failureClass: "VALIDATION_FAILURE" })
        } : undefined
        const onProgress = async ({ phase, node, agent, model, status, nextNode }) => {
          const details = [phase, node, status, nextNode, agent, model].filter(Boolean).join(" · ")
          await ctx.session.update({ sessionID, title: `Graph host · ${details}` })
        }
        // Detached: awaiting minutes inside the command RPC hits the transport timeout and resets the TUI.
        // Progress and failure are persisted in graph-state.json / graph-events.jsonl by the runner.
        void runGraph({ ...host, deliveryMode: "PLAN_BUILD", executor, maxTechnicalRetriesPerNode: 2, stopAfterNode: smoke ? "IMPLEMENT" : undefined, resume: host.resume, validateResult, smoke, onProgress }).catch(() => {})
      }
      editor.add({ name: "sdlc-graph", description: "Run the host-driven deterministic SDLC graph.", execute: (input) => executeHostGraph(input, false) })
      editor.add({
        name: "sdlc",
        description: "Route the task: small bounded changes run the host Graph, broad or risky work goes to the orchestrator.",
        execute: async (input) => {
          const request = String(input.prompt?.text || "").trim()
          if (!request) throw new Error("/sdlc requires a task description")
          const route = chooseEngine(request)
          await ctx.session.update({ sessionID: input.sessionID, title: `SDLC route · ${route.engine} · ${route.reasons.join(", ")}` })
          if (route.engine === "GRAPH") return executeHostGraph(input, false)
          // Detached for the same reason as the Graph: never hold the command RPC open.
          void ctx.session.prompt({ sessionID: input.sessionID, text: `Sigue el protocolo SDLC del orquestador (routing, delegacion por paquetes y verificacion independiente) para esta solicitud:\n\n${request}` }).catch(() => {})
        },
      })
      editor.add({ name: "sdlc-graph-host-smoke", description: "Run host-driven PLAN to IMPLEMENT smoke only.", execute: (input) => executeHostGraph(input, true) })
    })
    await ctx.tool.transform((editor) => {
      for (const [name, spec] of Object.entries(TOOL_SPECS)) {
        editor.add({
          name,
          description: `SDLC controller tool: ${name}. Available only to an authorized parent agent.`,
          input: { type: "object", properties: spec.properties, required: spec.required, additionalProperties: false },
          options: { codemode: false },
          execute: async (input, execution) => {
            assertController(execution)
            if (name === "sdlc_plugin_status") {
              const availableToolIds = (await ctx.tool.list()).map((tool) => tool.id || tool.name).filter(Boolean)
              const nativeDelegationToolIds = availableToolIds.filter((id) => /^(subagent|task)$/i.test(id) || /subagent/i.test(id))
              return { content: JSON.stringify({ plugin: "sdlc.tools.v2", location: ctx.location.project?.directory || ctx.location.directory, registeredTools: SDLC_V2_TOOL_NAMES, nativeSubagentAvailable: availableToolIds.includes("subagent"), nativeDelegationToolIds, availableToolIds }, null, 2) }
            }
            const result = await executeSdlcV2(spec.legacy, input, workspaceContext(ctx.location))
            return { content: typeof result === "string" ? result : JSON.stringify(result, null, 2) }
          },
        })
      }
    })
    const registered = await ctx.tool.list()
    if (!registered.some((tool) => tool.id === "sdlc_graph_start")) {
      throw new Error("SDLC V2 tool registration did not produce sdlc_graph_start")
    }
  },
}
