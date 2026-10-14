const EVENTS = new Set([
  "ORCHESTRATOR_DECISION", "MODEL_SELECTED", "MODEL_EXECUTION", "MODEL_SWITCH", "AGENT_DELEGATED",
  "PHASE_STARTED", "PHASE_COMPLETED", "COMMAND_STARTED", "COMMAND_COMPLETED",
  "RETRY", "FALLBACK", "MODEL_ROUTING_WARNING", "RUN_COMPLETED", "RUN_FAILED",
])

const PHASES = new Set(["ROUTING", "PLANNING", "INSPECTION", "IMPLEMENTATION", "TESTING", "BUILD", "VALIDATION", "REVIEW", "COMPLETED", "FAILED"])

function clean(value, max = 160) {
  if (value === undefined || value === null) return undefined
  return String(value).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
}

export function createActivityEvent(input) {
  if (!EVENTS.has(input.event)) throw new Error(`Unsupported activity event: ${input.event}`)
  const phase = input.phase && clean(input.phase).toUpperCase()
  if (phase && !PHASES.has(phase)) throw new Error(`Unsupported phase: ${phase}`)
  return {
    timestamp: new Date().toISOString(),
    event: input.event,
    runId: clean(input.runId, 96),
    deliveryMode: clean(input.deliveryMode, 48),
    executionProfile: clean(input.executionProfile, 64),
    phase,
    agent: clean(input.agent, 96),
    selectedModel: clean(input.selectedModel, 160),
    configuredModel: clean(input.configuredModel, 160),
    actualModel: clean(input.actualModel, 160),
    previousModel: clean(input.previousModel, 160),
    reason: clean(input.reason),
    task: clean(input.task),
    command: clean(input.command),
    result: clean(input.result, 48),
    attempt: input.attempt === undefined ? undefined : Number(input.attempt),
    correlation: input.correlation && typeof input.correlation === "object"
      ? Object.fromEntries(Object.entries(input.correlation).filter(([key]) => ["bridgeSessionId", "requestId", "orchestratorRunId"].includes(key)).map(([key, value]) => [key, clean(value, 128)]))
      : undefined,
  }
}

function model(event) {
  return event.actualModel || event.configuredModel || event.selectedModel || "unresolved"
}

export function formatActivity(event, level = "normal") {
  const detail = level === "debug" ? ` · ${JSON.stringify({ runId: event.runId, agent: event.agent, selectedModel: event.selectedModel, configuredModel: event.configuredModel, actualModel: event.actualModel, correlation: event.correlation })}` : ""
  switch (event.event) {
    case "ORCHESTRATOR_DECISION": return `[Routing] ${event.deliveryMode} · ${event.executionProfile}${event.agent ? ` · ${event.agent}` : ""}${detail}`
    case "MODEL_SELECTED": return `[Model selected] ${event.phase || "Routing"} → ${model(event)}${detail}`
    case "MODEL_EXECUTION": return `[Model execution] ${event.phase || "Execution"} → ${event.actualModel || "unconfirmed"}${detail}`
    case "MODEL_SWITCH": return `[Model switch] ${event.previousModel || "unknown"} → ${model(event)} · ${event.phase || "EXECUTION"}${event.reason ? ` · ${event.reason}` : ""}${detail}`
    case "AGENT_DELEGATED": return `[Delegate] ${event.agent || "SPECIALIST"} → ${model(event)}${event.task ? ` · ${event.task}` : ""}${detail}`
    case "PHASE_STARTED": return `[Phase] ${event.phase}${event.task ? ` · ${event.task}` : ""}${detail}`
    case "PHASE_COMPLETED": return `[Phase] ${event.phase} completed${event.result ? ` · ${event.result}` : ""}${detail}`
    case "COMMAND_STARTED": return `[Command] ${event.command || "command"}${detail}`
    case "COMMAND_COMPLETED": return `[Result] ${event.command || "command"} → ${event.result || "COMPLETED"}${detail}`
    case "RETRY": return `[Retry] Attempt ${event.attempt || "?"}${event.reason ? ` · ${event.reason}` : ""}${detail}`
    case "FALLBACK": return `[Fallback] ${event.previousModel || "unknown"} → ${model(event)}${event.reason ? ` · ${event.reason}` : ""}${detail}`
    case "MODEL_ROUTING_WARNING": return `[Model routing warning] Selected ${event.selectedModel || "unknown"}; actual ${event.actualModel || "unknown"}${detail}`
    case "RUN_COMPLETED": return `[Done] ${event.deliveryMode || "Run"} completed${detail}`
    case "RUN_FAILED": return `[Failed] ${event.phase || "Run"}${event.reason ? ` · ${event.reason}` : ""}${detail}`
    default: throw new Error(`Cannot format activity event: ${event.event}`)
  }
}

export function reconcileModel({ selectedModel, configuredModel, actualModel }) {
  if (!actualModel) return { status: "UNCONFIRMED", selectedModel, configuredModel, actualModel: null }
  // AXET is the configured provider while bridge telemetry may report the
  // downstream provider. Capability routing compares the resolved model ID;
  // keep both provider-qualified values for debug correlation.
  const modelId = (value) => String(value || "").split("/").slice(1).join("/")
  return { status: modelId(selectedModel) === modelId(actualModel) ? "MATCH" : "MISMATCH", selectedModel, configuredModel, actualModel }
}

export { EVENTS, PHASES }
