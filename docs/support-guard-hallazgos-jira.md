# Support Guard · Hallazgos de la primera lectura real de Jira

Fecha: 2026-10-13 · Modo: `REAL_JIRA` + IA local + `DRY_RUN` (no se modificó nada en Jira).
Objetivo de este documento: que el equipo dueño de Jira nos indique qué casos debe devolver Support Guard y qué campos son obligatorios.

## 1. Qué hicimos

- Conectamos Support Guard a Jira con la configuración existente en `reference` (Jira Data Center, token personal, `/rest/api/2/search`).
- Consulta usada (JQL de referencia): proyecto `CABOK`, estado `Open`, sin la etiqueta `auto-respondido`, ordenado por fecha de creación.
- Resultado: **62 casos encontrados**, 0 errores de lectura. Todas las devoluciones quedaron simuladas (`DRY_RUN`).

## 2. Qué encontramos

### 2.1 Tipo de caso

| Tipo de incidencia | Cantidad |
| --- | --- |
| Sub-Support | 59 |
| Corrective | 2 |
| Epic | 1 |

La gran mayoría de los resultados son **sub-tareas `Sub-Support`**, no solicitudes directas de un usuario final.

### 2.2 Descripción

- **60 de 62** casos no tienen descripción (incluye las 59 sub-tareas).
- Solo 2 casos tienen descripción: `CABOK-13933` (Epic) y `CABOK-12621` (Corrective).
- Ejemplos de sub-tareas sin descripción: `CABOK-37157` "AJUSTES INTERES POR CONCEPTO DE CANCELADO", `CABOK-37124` "FALLA GRACIA A CAPITAL", `CABOK-37122` "DOCIT - VALIDACION DEBITOS AUTOMATICOS".

### 2.3 Campos aplicación y ambiente

- Support Guard no pudo leer "aplicación afectada" ni "ambiente" en ningún caso, porque **no sabemos qué campo personalizado de Jira los contiene** (el Jira tiene 1041 campos personalizados).
- Por eso hoy todos los casos salen con campos obligatorios faltantes (0 completos de 62).

Campos candidatos que vimos en el catálogo de Jira (por favor confirmar o corregir):

| Concepto | Campo candidato | Id |
| --- | --- | --- |
| Aplicación | Aplicación | `customfield_19705` |
| Aplicación | Associated aplication | `customfield_11911` |
| Servicio | Servicio | `customfield_15303` |
| Ambiente | QA environment | `customfield_28100` |
| Mensaje de error | Error Message | `customfield_26800` |
| Impacto | Impact | `customfield_10901` |
| Impacto | Problem Impact | `customfield_10201` |

No hallamos un campo claro de "ambiente" (producción / pruebas) distinto de `QA environment`.

### 2.4 Análisis de IA (modelo `gpt-5.6-terra`)

- Se analizaron 47 de los 62 casos cuando detuvimos la prueba: 43 `INSUFFICIENT` y 4 `PARTIALLY_SUFFICIENT`.
- Con sub-tareas sin descripción el resultado es siempre el mismo (insuficiente), porque solo existe el título. Esto no aporta información útil sobre calidad real.
- El mensaje generado para el solicitante es correcto, pero **estaría pidiendo descripción a una sub-tarea interna**, lo cual probablemente no tiene sentido.

## 3. Riesgo si se pasara a modo LIVE hoy

Support Guard comentaría y devolvería sub-tareas sin descripción a quien las creó (posiblemente un analista interno o un proceso automático). Por eso permanece en `DRY_RUN` hasta resolver las preguntas de abajo.

## 4. Preguntas para el equipo dueño de Jira

### Definición de caso nuevo
1. ¿Qué estados representan realmente un caso nuevo? Hoy usamos solo `Open`.
2. ¿Qué tipos de incidencia debe revisar Support Guard? (Corrective, Support, Incident, etc.)
3. ¿Las `Sub-Support` deben revisarse, excluirse, o validarse contra la incidencia padre?
4. ¿La etiqueta `auto-respondido` sigue siendo un criterio válido de exclusión?
5. ¿Hay otros proyectos además de `CABOK`?

### Campos obligatorios
6. ¿Cuáles son los campos obligatorios de un caso? (descripción, aplicación, ambiente, prioridad, otros)
7. ¿Cuál es el id del campo de aplicación afectada? ¿Y el de ambiente?
8. ¿Esos campos varían según el tipo de incidencia?
9. ¿Dónde se registra el mensaje de error, el impacto y la evidencia (campos o adjuntos)?

### Devolución
10. ¿Cuáles son las características de un caso que **sí debe devolverse**?
11. ¿Existe una transición de flujo para "devolver para información" (nombre o id)? Si no, ¿se acepta solo comentar y etiquetar (`support-guard-pending-info`)?
12. ¿A quién se devuelve (reporter, asignado, grupo)?
13. ¿Qué hacer con los casos sin descripción que son sub-tareas o tareas internas?
14. ¿Existe una plantilla corporativa de mensaje para solicitar información?

