import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { classifyRequest, resolveProjectRoot, decisionLog, buildRoutingDecision, executionStartLog } from "./routing.mjs"

const cases = [
  ["Cambia el texto del botón Guardar a Continuar.", "DIRECT"],
  ["Corrige este error TypeScript y ejecuta los tests.", "DIRECT"],
  ["Crea una base nueva Angular + Node con health, tests y pipeline GitLab.", "PLAN_BUILD"],
  ["Implementa un nuevo módulo complejo de pagos, con contratos backend/frontend y persistencia.", "SDD"],
  ["Quiero desarrollar esta iniciativa usando SDD.", "SDD"],
  ["Ejecuta el SDLC completo de esta plataforma.", "SDLC"],
  ["Analiza por qué falla el pipeline, no modifiques nada.", "ANALYSIS_ONLY"],
]

for (const [request, expected] of cases) {
  assert.equal(classifyRequest(request).deliveryMode, expected, request)
}
assert.equal(classifyRequest("Crea un proyecto nuevo").deliveryMode, "PLAN_BUILD")
assert.equal(classifyRequest("Hazlo directamente").deliveryMode, "DIRECT")
assert.equal(classifyRequest("Usa SDLC para esta iniciativa").deliveryMode, "SDLC")
assert.equal(classifyRequest("Revisa el resultado del agente").deliveryMode, "REVIEW_ONLY")
assert.equal(resolveProjectRoot({ projectRoot: "C:/workspace", directory: "C:/bridge" }), "C:/workspace")
assert.match(decisionLog(classifyRequest("Cambia el texto del botón Guardar a Continuar."), "C:/workspace"), /deliveryMode=DIRECT/)
const direct = buildRoutingDecision(classifyRequest("Cambia el texto del boton Guardar a Continuar."))
assert.deepEqual({ deliveryMode: direct.deliveryMode, executionProfile: direct.executionProfile, model: direct.selectedExecutionModel }, { deliveryMode: "DIRECT", executionProfile: "SIMPLE_DIRECT", model: "axet/gpt-5.6-luna" })
assert.deepEqual(direct.selectedAgents, ["sdlc-direct"])
const planBuild = buildRoutingDecision(classifyRequest("Crea una base nueva Angular + Node con health, tests y pipeline GitLab."))
assert.deepEqual({ deliveryMode: planBuild.deliveryMode, executionProfile: planBuild.executionProfile, routingModel: planBuild.routingModel, executionModel: planBuild.selectedExecutionModel }, { deliveryMode: "PLAN_BUILD", executionProfile: "COMPLEX_CODING", routingModel: "axet/gpt-5.6-luna", executionModel: "axet/gpt-5.3-codex" })
const sdd = buildRoutingDecision(classifyRequest("Implementa un nuevo modulo complejo de pagos, con contratos backend/frontend y persistencia."))
assert.deepEqual(sdd.phaseModels, { architecture: "axet/gpt-5.6-terra", implementation: "axet/gpt-5.3-codex", review: "axet/eu.anthropic.claude-sonnet-5" })
const review = buildRoutingDecision(classifyRequest("Revisa el resultado del agente"))
assert.deepEqual({ deliveryMode: review.deliveryMode, executionProfile: review.executionProfile, model: review.selectedExecutionModel }, { deliveryMode: "REVIEW_ONLY", executionProfile: "REVIEW_VALIDATION", model: "axet/eu.anthropic.claude-sonnet-5" })
assert.match(decisionLog(classifyRequest("Cambia el texto del boton Guardar a Continuar."), "C:/workspace"), /ORCHESTRATOR_DECISION/)
assert.deepEqual(JSON.parse(executionStartLog({ selectedModel: "axet/gpt-5.3-codex", configuredModel: "axet/gpt-5.3-codex", agent: "sdlc-developer", phase: "implementation" })), { event: "MODEL_EXECUTION_START", selectedModel: "axet/gpt-5.3-codex", configuredModel: "axet/gpt-5.3-codex", actualModel: null, agent: "sdlc-developer", phase: "implementation" })
const modelConfig = JSON.parse(await readFile(new URL("../../.sdlc/config/models.json", import.meta.url), "utf8"))
const openCodeConfig = await readFile(new URL("../../opencode.jsonc", import.meta.url), "utf8")
for (const [agent, model] of Object.entries(modelConfig)) {
  if (agent.startsWith("_")) continue
  assert.match(openCodeConfig, new RegExp(`"${agent}":\\s*\\{\\s*"model":\\s*"${model}"`), `authoritative model override missing for ${agent}`)
}
console.log(`routing regression: ${cases.length + 10} passed`)

import { chooseEngine } from "./routing.mjs"
assert.equal(chooseEngine("Corrige el texto del boton Guardar en el archivo header.txt para que diga Continuar").engine, "GRAPH")
assert.equal(chooseEngine("Crea un proyecto nuevo con frontend y backend y pipeline GitLab").engine, "ORCHESTRATOR")
assert.equal(chooseEngine("Explica por que falla el login").engine, "ORCHESTRATOR")
assert.equal(chooseEngine("Cambia la autenticacion para usar tokens").engine, "ORCHESTRATOR")
console.log("engine routing: PASS")