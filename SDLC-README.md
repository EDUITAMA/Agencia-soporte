# OpenCode Autonomous SDLC - Plug & Play

> **AXET-only build:** all agents use exact `axet/...` IDs. Native OpenCode V2 `subagent` delegation resolves model overrides from `opencode.jsonc`; no fallback provider or model is allowed.


## Uso

1. Extrae **el contenido** de este ZIP en la raiz de tu repositorio.
2. Abre una terminal en esa raiz.
3. Ejecuta:

```powershell
opencode
```

4. Escribe tu solicitud normal, por ejemplo:

```text
Implementa la HU de autenticacion con Microsoft.
```

No necesitas ejecutar `install.ps1`, `/sdlc-start` ni configurar los modelos manualmente.

## Que ocurre automaticamente

El agente principal `sdlc-orchestrator` clasifica con Luna y delega cada fase con el `task` nativo de OpenCode al subagente seleccionado. El override autoritativo `opencode.jsonc.agent.<nombre>.model` hace que la fase de implementación no herede el modelo del orquestador. En el primer flujo llama a `sdlc_apply_models`, que valida los IDs AXET configurados en `.sdlc/config/models.json` contra `opencode models`.

La politica `_strictNoFallback: true` bloquea el flujo si un modelo preferido no esta disponible o es ambiguo. Esto evita caer silenciosamente en modelos de Copilot u otros modelos no listados.

## Routing incluido

| Rol | Modelo preferido |
|---|---|
| Orquestador / routing | `axet/gpt-5.6-luna` |
| Cambio directo | `axet/gpt-5.6-luna` |
| Repo scout | `gpt-5.6-luna` |
| Requisitos | `gpt-5.6-terra` |
| Arquitectura | `eu.anthropic.claude-sonnet-5` |
| Diseno de pruebas | `gpt-5.4-2026-03-05` |
| Planificacion | `gpt-5.6-terra` |
| Desarrollo | `gpt-5.3-codex` |
| Ejecucion de pruebas | `gpt-5.4-2026-03-05` |
| Code review | `eu.anthropic.claude-sonnet-5` |
| Seguridad | `eu.anthropic.claude-sonnet-4-6` |
| Performance | `gpt-5.4-2026-03-05` |
| DevOps | `gpt-5.3-codex` |
| Documentacion | `gpt-5.4-mini` |
| Debugger | `gpt-5.3-codex` |
| Juez final | `gpt-5.6-terra` |

## Ahorro de contexto

Los agentes intercambian rutas de artefactos en vez de copiar el repositorio completo entre prompts. Discovery y documentacion usan modelos ligeros, y los modelos mas fuertes quedan reservados para gates de mayor riesgo. La compactacion y poda de contexto de OpenCode estan habilitadas.

## Validacion local

Si quieres verificar que la estructura esta integra:

```powershell
node .sdlc/bin/validate-installation.mjs
```

Debe reportar 15 agentes, 8 comandos y 15 skills.


## v1.4 - execution model routing

`routing.mjs` emite una decisión con `deliveryMode`, `executionProfile`, modelo de routing, modelo de ejecución y agentes. Cada run conserva `15-model-routing.jsonl` con `ORCHESTRATOR_DECISION` y `MODEL_EXECUTION_START`. El último debe contrastarse con `bridge.log`; una decisión de routing no prueba por sí sola que el proveedor ejecutó dicho modelo.

Para la regresión real de PLAN_BUILD, después de ejecutar “crear proyecto Angular + Node”, usa:

```powershell
node .opencode/tools/verify-model-routing-log.mjs <ruta-a-bridge.log>
```

El comando solo pasa al observar `openai/gpt-5.6-luna` en routing y después `openai/gpt-5.3-codex` para la implementación.

## Activity feed operacional

OpenCode muestra las transiciones reales del orquestador como resultados de tools: routing, cambio/selección de modelo, delegación, fase, comandos de validación, retry/fallback y cierre. Los eventos se guardan por run en `16-orchestrator-activity.jsonl`; no contienen prompts, razonamiento privado, secretos ni stdout completo.

El estado activo de un subagente es el `task` nativo de OpenCode. La versión 2.0.23 no tiene una API pública soportada para actualizaciones progresivas desde una tool que sigue ejecutándose, así que el sistema no genera heartbeats artificiales.

`ORCHESTRATOR_LOG_LEVEL=normal` es el valor por defecto. `debug` agrega IDs de correlación y metadatos de modelos a esos mismos eventos. `selectedModel`, `configuredModel` y `actualModel` son distintos: el último solo se confirma mediante bridge.log; una diferencia de modelo genera `MODEL_ROUTING_WARNING`.

## Graph SDLC v1

For `PLAN_BUILD`, `graphEngine.enabled` activates a deterministic flow persisted in `.sdlc/runs/<runId>/graph-state.json` and `.sdlc/runs/<runId>/graph-events.jsonl`:

```text
PLAN -> IMPLEMENT -> TEST -> REVIEW -> COMPLETE
                    | fail     | changes
                    v          v
                  REPAIR ------+
```

The engine validates node results and owns transitions, gates, functional repair cycles (3 by default), review cycles (2 by default), separate technical retries, and resume of interrupted nodes. Specialists only execute their assigned phase: planner, developer, test engineer, or reviewer. `DIRECT` does not enter the graph.

Use `/sdlc-graph` to start or resume and `/sdlc-status` to see node, gates, cycles, selected agent and model. `/sdlc-graph-smoke` is a bounded real smoke; `actualModel` remains unverified until bridge evidence exists.

## v1.3 - timeout/root hardening

This version adds:
- authoritative project-root discovery from OpenCode context;
- explicit protection against accidentally treating the AXET bridge folder as the repository;
- persisted begin/complete checkpoints per stage;
- timeout recovery that inspects artifacts and Git changes before any re-execution;
- idempotency requirements for mutating agents;
- `gpt-5.6-luna` for the top-level orchestrator to keep coordination turns short, while stronger models remain assigned to specialist roles.

If the UI shows an AXET timeout after files changed, do **not** manually restart the whole task. Ask the orchestrator to continue/resume; it will recover the stage from `.sdlc/runs/.../state.json`.
