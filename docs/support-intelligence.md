# Support Intelligence

Módulo analítico **de solo lectura**: Jira → periodo → sincronización → almacén analítico → unidades canónicas → agrupación → modos de falla → evidencia → IA → candidatos a causa raíz → reportes → UI. No modifica Jira y está separado de Support Guard en vivo (`JIRA_ACTIONS_MODE=DRY_RUN` se mantiene).

## Reutilizado / adaptado / reemplazado (proyecto de referencia)

| Pieza | Decisión |
|---|---|
| Servicio de almacenamiento analítico | Reutilizado |
| Agrupación | Reemplazada por centroides TF-IDF con refinamiento y fusión |
| Segmentación de modos de falla | Adaptada (reglas por firma) |
| Selección de evidencia | Adaptada (muestreo estratificado) |
| Afirmaciones y consenso | Adaptadas a verificador de citas + guardrails |

## API (`/api/support-guard/intelligence`)

`GET overview`, `GET periods`, `GET analysis/lookup` (estado de reutilización, solo local), `POST analysis/check` (verificación incremental), `POST analysis` (prepara datos sin IA; 200 si reutiliza, 202 si crea; 409 si hay uno activo), `GET analysis`, `analysis/:id`, `:id/status`, `:id/pre-analysis`, `POST :id/estimate`, `POST :id/execute` (exige `confirm: true`; 409 `STALE_DATA` si Jira cambió), `:id/clusters`, `:id/clusters/:cid`, `:id/cases`, `:id/report?kind=`.

## Ciclo de vida (Fase 1)

`Preparar datos (sin IA)` → `Pre-análisis` → `Elegir objetivo` → `Confirmar` → `Pipeline IA`.

- **Fingerprints.** `scopeFingerprint = hash(proyecto, from, to, versiones de análisis/normalización/clustering, reglas deterministas)`. `dataFingerprint` = hash de `clave:versión` de los casos en caché del periodo (y del anterior). `aiFingerprint` y la clave por grupo = hash(snapshot del grupo, profundidad, versión del pipeline, evidencia, prompts, modelos).
- **Estados de reutilización.** `REUSABLE` (mismo scope y datos; se abre sin Jira ni IA), `STALE_DATA` (cambió Jira), `STALE_ANALYSIS` (otra configuración/versión), `NOT_FOUND`. Los runs nunca se sobrescriben; “Recalcular” crea una versión nueva.
- **Verificar cambios.** Consulta solo `updated >=` desde la última sincronización; no descarga todo.
- **Modos.** `SUMMARY` (sin IA por grupo; como máximo 1 llamada de resumen), `RECURRENCE` (1 llamada ligera por grupo, sin análisis profundo), `TOP_RCA` (top 3 por puntaje determinista: volumen, crecimiento, persistencia, abiertos, reabiertos, horas, prioridad, confianza), `SELECTED_RCA`, `FULL_RCA` (excluye baja confianza salvo que se incluya explícitamente).
- **Reutilización de IA por grupo.** Mismo snapshot de grupo + versión del pipeline + prompts + modelos ⇒ se reutiliza el resultado; el run registra `analysisMode`, grupos solicitados/procesados/reutilizados, llamadas y llamadas evitadas.

## Pipeline de análisis profundo (Fase 2, `cluster-analyst/2`)

Solo se ejecuta para los grupos seleccionados (`TOP_RCA`, `SELECTED_RCA`, `FULL_RCA`), tras la confirmación del usuario:

`grupo → segmentación de fallas → evidencia → filtro de servicio ajeno → selección dinámica de especialistas → afirmaciones con citas → verificación de citas → validación semántica → consolidación → candidatos → recomendaciones`

- **Segmentación** (`deep/segmentation.ts`): modos de falla por firma; significativo si ≥2 casos o ≥10 %; los casos raros quedan como atípicos (no se fuerzan) y los de otro servicio como `POSSIBLE_RECLASSIFICATION`.
- **Especialistas** (`deep/roles.ts`): FAILURE, FUNCTIONAL, TECHNICAL, INFRA; se eligen según la evidencia y cada omisión se explica.
- **Validación** (`SUPPORTED / PARTIALLY_SUPPORTED / UNSUPPORTED / CONTRADICTED`): las no soportadas se rechazan, las parciales se limitan a hipótesis y las contradichas generan `CONFLICTING_EVIDENCE`.
- **Candidatos**: `INSUFFICIENT_EVIDENCE_FOR_RCA` es un resultado válido; grupos sin firma técnica se limitan a `OBSERVED_PATTERN`.
- **Reuso por especialista**: clave = evidencia + grupos + versión/hash de prompt + modelo + versión del pipeline. Cambiar el modelo o prompt de un especialista solo recalcula ese especialista.
- **Auditoría** en DuckDB: `analysis_failure_groups`, `analysis_evidence_items`, `role_runs`, `role_claims`, `claim_validations`, `consolidated_findings`, `cluster_recommendations`.
- **UI**: el detalle del grupo tiene pestañas Resumen, Modos de falla, Evidencia, Hallazgos, Causa raíz, Recomendaciones, Casos y Especialistas.

## Inteligencia operativa y reportes ejecutivos (Fase 3, `operational-intelligence/1`)

Capa `apps/backend/src/intelligence/ops/` que **solo lee** lo ya almacenado (clusters, hallazgos, candidatos, recomendaciones). No consulta Jira ni re-ejecuta especialistas; la única IA es **una llamada de narrativa por reporte ejecutivo** (`EXEC_NARRATIVE`, modelo `INTELLIGENCE_AI_MODEL_EXECUTIVE`, por defecto el de razonamiento).

- **Métricas** (`metrics.ts`): KPIs con delta frente al período anterior; sin período anterior no hay delta (`null`, nunca se inventa). Resolución mediana/P75/P95 solo con ≥ 5 muestras. Antigüedad de abiertos con cortes configurables. Desgloses solo con cobertura suficiente.
- **Tendencia por grupo** (`trends.ts`): `NEW`, `GROWING`, `STABLE`, `DECLINING`, `NOT_SEEN` (nunca "resuelto"), `PERSISTENT`, `RECURRING`, `INSUFFICIENT_HISTORY`. Los grupos no tienen id estable entre períodos: la serie se reconstruye emparejando casos previos con los centroides actuales y se persiste en `cluster_period_series`.
- **Prioridad operativa** (`priority.ts`): puntaje explicable 0–100 (volumen, crecimiento, persistencia, abiertos, reabiertos, prioridad Jira, horas, confianza, causa validada) con componentes y motivos persistidos. `CRITICAL` solo si se cumple la regla documentada (puntaje ≥ 70, ≥ 50 % abiertos, tendencia creciente/nueva o ≥ 3 períodos, confianza suficiente). No se infiere impacto de negocio, dinero ni SLA.
- **Insights** (`insights.ts`): cambios de volumen, problemas persistentes/nuevos, degradación de resolución, reaperturas, calidad de datos, concentración por servicio, causas disponibles y evidencia insuficiente.
- **Reportes** (`ops_reports`, versionados): `EXECUTIVE`, `OPERATIONAL`, `RCA`, `DATA_QUALITY`, `PERIOD_COMPARISON`. Clave de caché = huella de datos + hallazgos + versiones + modelo + prompt; misma clave ⇒ `REUSED` (0 llamadas de IA). `force` crea una nueva versión. La narrativa se valida (esquema, sin cifras ajenas al payload, sin dinero/SLA, sin presentar causas probables como confirmadas) y, si falla, se usa texto determinista.
- **Centro de recomendaciones**: tipos `INVESTIGATE/FIX/MONITOR/PROCESS_CHANGE/DATA_QUALITY/RECLASSIFY` (un `FIX` con base débil pasa a `INVESTIGATE`) y estados `PROPOSED/REVIEWED/ACCEPTED/DISMISSED/DONE` (`recommendation_state`).
- **Automatización mensual**: el planificador usa `INTELLIGENCE_AUTO_ANALYSIS_MODE` (`SUMMARY`/`RECURRENCE`), prepara la propuesta `TOP_RCA` sin ejecutarla, genera los reportes y registra `MONTHLY_ANALYSIS_STARTED/COMPLETED`. Nunca ejecuta `TOP_RCA` ni `FULL_RCA` por sí solo.
- **API**: `GET /analysis/:id/dashboard|insights|recommendations|reports`, `POST /analysis/:id/reports`, `GET /analysis/:id/reports/:kind[/export]` (HTML imprimible; use "Guardar como PDF"), `PATCH /analysis/:id/recommendations/:clusterId/:recommendationId`, `GET /history`, `GET /history/compare?a=&b=`.
- **UI**: interruptor Ejecutiva/Analista; pestaña "Panel operativo" (salud, KPIs con deltas, cambios, problemas con prioridad explicada, causas validadas, recomendaciones, calidad de datos, antigüedad, desgloses, limitaciones) con drill-down a grupo, evidencia y casos; Historial con comparación A vs B.

## Garantías

- Las citas deben ser subcadenas normalizadas del campo real; las inválidas se descartan.
- Nunca se produce `CONFIRMED_CAUSE`; el máximo automático es `SUPPORTED_CAUSE`.
- Grupos de baja confianza o de un solo caso: solo `OBSERVED_PATTERN`.
- Sin IA o con fallo de IA, se conservan los clusters deterministas (estado `PARTIAL`).

## Límites

- Hijos Sub-Support creados fuera del periodo no se consultan.
- Sin embeddings.
- En datos mock, los mensajes de error repetidos pueden marcarse como boilerplate.

## Configuración

Ver las variables `INTELLIGENCE_*` en `apps/backend/.env.example`.
