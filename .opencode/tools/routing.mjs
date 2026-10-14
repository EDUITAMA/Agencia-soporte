const MODES = ["DIRECT", "PLAN_BUILD", "SDD", "SDLC", "ANALYSIS_ONLY", "REVIEW_ONLY"]

export const DEFAULT_EXECUTION_PROFILES = Object.freeze({
  FAST_ROUTING: { model: "axet/gpt-5.6-luna", agents: ["sdlc-orchestrator", "sdlc-repo-scout"] },
  SIMPLE_DIRECT: { model: "axet/gpt-5.6-luna", agents: ["sdlc-direct"] },
  COMPLEX_CODING: { model: "axet/gpt-5.3-codex", agents: ["sdlc-developer", "sdlc-devops", "sdlc-debugger"] },
  ARCHITECTURE_REASONING: { model: "axet/gpt-5.6-terra", agents: ["sdlc-requirements", "sdlc-planner"] },
  REVIEW_VALIDATION: { model: "axet/eu.anthropic.claude-sonnet-5", agents: ["sdlc-reviewer"] },
})

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term))
}

const ERROR_REPORT_TERMS = ["error", "exception", "runtimeerror", "typeerror", "ng0", "falla", "fallo", "no funciona", "arregla", "soluciona", "resuelve", "fix ", "pantalla en blanco", "se rompi", "se jodi"]
const READ_ONLY_TERMS = ["sin modificar", "solo analiza", "solo revisa", "no cambies", "no modifiques", "pull request", "audita", "auditoría", "auditoria"]

function classifyIntent(text) {
  if (hasAny(text, ["analiza", "investiga", "explica", "por qué falla", "por que falla", "analizar", "alternativas"])) return "ANALYZE"
  // A bug report or error trace means the user wants it fixed, not just reviewed.
  if (hasAny(text, ERROR_REPORT_TERMS) && !hasAny(text, READ_ONLY_TERMS)) return "CHANGE"
  if (hasAny(text, ["revisa", "review", "audita", "pull request", "validar resultado"])) return "REVIEW"
  if (hasAny(text, ["crea", "crear", "construye", "implementa", "agrega", "añade", "nuevo módulo", "nuevo modulo"])) return "BUILD"
  if (hasAny(text, ["corrige", "cambia", "modifica", "ejecuta", "actualiza", "ajusta"])) return "CHANGE"
  return "OTHER"
}

export function classifyRequest(request) {
  const original = String(request || "").trim()
  if (!original) throw new Error("Request cannot be empty")
  const text = original.toLowerCase()
  const explicitMethodologyRequest = hasAny(text, ["ejecuta el sdlc", "usa sdlc", "usar sdlc", "sdlc completo", "metodología sdlc", "metodologia sdlc"])
    ? "SDLC"
    : hasAny(text, ["usa sdd", "usar sdd", "usando sdd", "spec-driven", "spec driven", "especificación formal", "especificacion formal"])
      ? "SDD"
      : hasAny(text, ["primero planifica", "primero plan", "plan only", "solo plan", "solo planifica"])
        ? "PLAN"
        : "NONE"
  const intent = classifyIntent(text)
  const greenfield = hasAny(text, ["proyecto nuevo", "proyecto nueva", "greenfield", "base nueva", "desde cero"])
  const crossModuleImpact = hasAny(text, ["frontend", "backend", "pipeline", "ci/cd", "persistencia", "contratos", "módulo", "modulo"])
  const architectureImpact = hasAny(text, ["arquitectura", "arquitectónico", "arquitectonico", "persistencia", "contratos", "plataforma", "migración", "migracion"])
  const highRisk = hasAny(text, ["pagos", "autenticación", "autenticacion", "autorización", "autorizacion", "datos sensibles", "producción", "produccion"])
  const ambiguity = text.length < 20 || hasAny(text, ["algo", "lo necesario", "etc.", "etc"]) ? "MEDIUM" : "LOW"
  const scope = architectureImpact || text.length > 240 ? "LARGE" : greenfield || crossModuleImpact || intent === "BUILD" || text.length > 80 ? "MEDIUM" : "SMALL"
  const complexity = architectureImpact || highRisk ? "HIGH" : scope === "MEDIUM" ? "MEDIUM" : "LOW"
  const risk = highRisk || architectureImpact ? "HIGH" : crossModuleImpact ? "MEDIUM" : "LOW"
  const formalLifecycle = hasAny(text, ["ciclo de vida formal", "lifecycle", "gobernanza formal", "varios equipos", "multiple teams"])
  const deliveryMode = explicitMethodologyRequest === "SDLC"
    ? "SDLC"
    : explicitMethodologyRequest === "SDD"
      ? "SDD"
      : intent === "ANALYZE"
        ? "ANALYSIS_ONLY"
        : intent === "REVIEW"
          ? "REVIEW_ONLY"
          : explicitMethodologyRequest === "PLAN" || hasAny(text, ["hazlo directamente", "directamente"])
            ? (hasAny(text, ["hazlo directamente", "directamente"]) ? "DIRECT" : "PLAN_BUILD")
            : scope === "LARGE" && risk === "HIGH" && formalLifecycle
              ? "SDLC"
              : complexity === "HIGH" || architectureImpact
                ? "SDD"
                : ((scope === "SMALL" && complexity === "LOW") || (intent === "CHANGE" && complexity !== "HIGH" && !crossModuleImpact)) && risk === "LOW" && !greenfield
                  ? "DIRECT"
                  : "PLAN_BUILD"
  return { intent, scope, complexity, risk, ambiguity, crossModuleImpact, architectureImpact, explicitMethodologyRequest, greenfield, existingProject: !greenfield, deliveryMode }
}

export function resolveProjectRoot(context = {}, fallbackCwd = process.cwd()) {
  const candidate = context.projectRoot || context.workspaceRoot || context.workspace?.root || context.worktree || context.directory || fallbackCwd
  return candidate
}

function profileFor(classification) {
  if (classification.deliveryMode === "DIRECT") return "SIMPLE_DIRECT"
  if (classification.deliveryMode === "REVIEW_ONLY") return "REVIEW_VALIDATION"
  if (classification.deliveryMode === "SDD" || classification.deliveryMode === "SDLC") return "ARCHITECTURE_REASONING"
  if (classification.deliveryMode === "PLAN_BUILD") return "COMPLEX_CODING"
  return "FAST_ROUTING"
}

export function buildRoutingDecision(classification, profileConfig = DEFAULT_EXECUTION_PROFILES) {
  const executionProfile = profileFor(classification)
  const selected = profileConfig[executionProfile]
  const routing = profileConfig.FAST_ROUTING
  if (!selected || !routing) throw new Error(`Missing execution profile configuration: ${executionProfile}`)
  const phaseModels = classification.deliveryMode === "SDD" || classification.deliveryMode === "SDLC"
    ? { architecture: profileConfig.ARCHITECTURE_REASONING.model, implementation: profileConfig.COMPLEX_CODING.model, review: profileConfig.REVIEW_VALIDATION.model }
    : { execution: selected.model }
  return { intent: classification.intent, deliveryMode: classification.deliveryMode, executionProfile, routingModel: routing.model, selectedExecutionModel: selected.model, selectedAgents: selected.agents, phaseModels, reason: `deliveryMode=${classification.deliveryMode}; complexity=${classification.complexity}; risk=${classification.risk}` }
}

export function decisionLog(classification, projectRoot, profileConfig = DEFAULT_EXECUTION_PROFILES) {
  return JSON.stringify({ event: "ORCHESTRATOR_DECISION", projectRoot, ...buildRoutingDecision(classification, profileConfig) })
}

export function executionStartLog({ selectedModel, configuredModel, actualModel, agent, phase }) {
  if (!selectedModel || !configuredModel || !agent || !phase) throw new Error("MODEL_EXECUTION_START requires selectedModel, configuredModel, agent and phase")
  return JSON.stringify({ event: "MODEL_EXECUTION_START", selectedModel, configuredModel, actualModel: actualModel || null, agent, phase })
}

export function selectSpecialists(classification, profileConfig = DEFAULT_EXECUTION_PROFILES) {
  return buildRoutingDecision(classification, profileConfig).selectedAgents
}

export { MODES }

// Picks the execution engine for a request: the host-driven Graph for small bounded
// changes, the staged orchestrator for anything broad, risky, exploratory or ambiguous.
export function chooseEngine(request) {
  const c = classifyRequest(request)
  const text = String(request).toLowerCase()
  const reasons = []
  if (!["BUILD", "CHANGE"].includes(c.intent)) reasons.push(`intent=${c.intent}`)
  if (c.greenfield) reasons.push("proyecto nuevo")
  if (c.crossModuleImpact) reasons.push("varios componentes")
  if (c.architectureImpact) reasons.push("impacto de arquitectura")
  if (c.risk !== "LOW") reasons.push(`riesgo ${c.risk}`)
  if (c.ambiguity !== "LOW") reasons.push("ambigua")
  if (c.explicitMethodologyRequest !== "NONE") reasons.push(`metodologia ${c.explicitMethodologyRequest}`)
  if (text.length > 400) reasons.push("descripcion extensa")
  if (/npm install|pnpm install|angular|docker|migraci|instal(a|ar) /.test(text)) reasons.push("requiere instalar/compilar")
  return reasons.length ? { engine: "ORCHESTRATOR", reasons } : { engine: "GRAPH", reasons: ["cambio pequeno y acotado"] }
}
