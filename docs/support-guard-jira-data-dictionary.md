# Support Guard · Diccionario de datos Jira

Proyecto Jira: `CABOK` (REAL_JIRA, solo lectura). Los IDs, nombres y tipos provienen de `GET /rest/api/2/field`
(metadatos de Jira). La cobertura se midió el 2026-10-14 sobre una muestra de 100 casos de `created` 2026-09-01 → 2026-10-13
(1 177 casos en el rango) con una búsqueda de solo lectura. Los IDs se configuran en `apps/backend/src/intelligence/config.ts`
y se pueden sobrescribir por variables de entorno.

**Confianza en la interpretación**
- `CONFIRMED`: nombre y tipo verificados en Jira y el contenido real coincide con el significado.
- `UNCONFIRMED`: el significado de negocio no está validado; no se infiere. Requiere confirmación del equipo de soporte.
- `NOT_USABLE`: el campo no contiene datos del caso; se ignora a propósito.

## Campos estándar

| Jira ID | Nombre | Campo normalizado | Significado | Cobertura | Uso | Confianza |
|---|---|---|---|---|---|---|
| `summary` | Summary | `summary` | Título del caso | 100 % | clustering, evidencia | CONFIRMED |
| `description` | Description | `description` | Descripción del caso | ~98 % | clustering, evidencia, calidad de datos | CONFIRMED |
| `status` | Status | `status`, `closed` | Estado del flujo (cerrado según `closedStatuses`) | 100 % | métricas abiertos/cerrados | CONFIRMED |
| `priority` | Priority | `priority` | Prioridad Jira | 100 % | score de priorización | CONFIRMED |
| `created` / `updated` | Created / Updated | `createdAt`, `updatedAt` | Fechas del caso | 100 % | periodos, sync incremental | CONFIRMED |
| `reporter`, `creator`, `assignee` | — | `reporter`, `creator`, `assignee` | Personas | variable | solo almacenado | CONFIRMED |
| `parent`, `issuetype` | — | `parentKey`, `issueType` | Jerarquía Support → Sub-Support | 100 % | unidades canónicas | CONFIRMED |
| `issuelinks`, `comment`, `attachment`, `labels` | — | `links`, `comments`, `attachmentCount`, `labels` | Relaciones, comentarios y adjuntos | variable | evidencia (comentarios), contexto | CONFIRMED |
| `resolution`, `resolutiondate` | — | `resolution`, `resolvedAt` | Resolución | solo cerrados | métricas | CONFIRMED |

## Campos personalizados

| Jira ID | Nombre en Jira | Tipo Jira | Campo normalizado | Significado | Cobertura | Uso | Confianza |
|---|---|---|---|---|---|---|---|
| `customfield_15303` | Servicio | scripted (texto) | `service` | Servicio de negocio/soporte (ej. `KOSIN Standard\|CO-AVAL-…`) | 100 % | dimensiones, clustering | CONFIRMED |
| `customfield_20800` | Team | select | `team` | Equipo (en la muestra solo `Operaciones`) | 100 % | dimensiones | CONFIRMED |
| `customfield_15304` | IssueType Linea Servicio | scripted (texto) | `serviceLine` | Tipo de caso + línea de servicio (`Support\|Vacio`, `Sub-Support\|Vacio`, `Doubt\|Vacio`…) | 100 % | almacenado | UNCONFIRMED |
| `customfield_15302` | Grupo Comercial | scripted (texto) | `commercialGroup` | Grupo comercial (en la muestra un solo valor) | 100 % | almacenado | UNCONFIRMED |
| `customfield_15305` | Parent Issue Type | scripted (texto) | `parentIssueType` | Tipo del caso padre (`Support`, `Corrective`) | 53 % (solo subcasos) | jerarquía | UNCONFIRMED |
| `customfield_15307` | Total horas incurridas | scripted (número) | `totalHours` | Horas incurridas (valores 0–2 en la muestra) | 100 % | prioridad, métricas | UNCONFIRMED |
| `customfield_12071` | Reopened | select | `reopened` | Indicador de reapertura (`No` en toda la muestra) | 100 % | métrica de reabiertos, prioridad | UNCONFIRMED |
| `customfield_17900` | Priorizada | select | `prioritized` | Marca de caso priorizado (`No` en toda la muestra) | 100 % | almacenado | UNCONFIRMED |
| `customfield_36000` | AI Usage | select | `aiUsage` | Indica si se usó IA (`Yes`/`No`) | 99 % | almacenado | UNCONFIRMED |
| `customfield_12202` | Time to SLA | plugin TTS | `sla` | Tiempo de SLA (`CABOK - resolution time:…`) | 46 % | almacenado | UNCONFIRMED |
| `customfield_10705` | **Clasificación** | **gh-lexo-rank** | `classification` | **No es una clasificación**: es el token de orden (Rank) de Jira, p. ej. `1\|ikb8e0:` (100 valores distintos en 100 casos) | 100 % (sin significado) | **ignorado** | NOT_USABLE |
| `customfield_26800` | Error Message | message (toolkit) | `errorMessage` | Banner HTML/JS estático idéntico en todos los casos; no contiene el error real | 0 % útil | **ignorado** | NOT_USABLE |
| `customfield_27000` | Close Message | message (toolkit) | `closeMessage` | Banner HTML/JS estático idéntico en casos abiertos y cerrados | 0 % útil | **ignorado** | NOT_USABLE |
| `customfield_13321` | Identificación del equipo | message (toolkit) | `equipmentId` | Bloque HTML estático | 0 % útil | **ignorado** | NOT_USABLE |

## Hallazgos importantes (Fase 4)

1. **Clasificación (ítem 8 del plan): bloqueada, dimensión permanece oculta.** El campo configurado como "Clasificación" es el
   *Rank* de Jira. No existe metadata para convertir esos valores a nombres, porque no son categorías. Se buscaron campos
   candidatos por nombre (`Clasificación` texto `customfield_19508`, `Classification` select `customfield_10200`,
   `Incident classification` `customfield_14304`, `Operational/Product categorization`, etc.) y **ninguno tiene datos en
   CABOK** en la muestra (0/100). El sistema ahora ignora esos valores (`readableClassification`); la dimensión no se muestra.
   Acción humana: confirmar si CABOK tiene otro campo de clasificación real.
2. **`Error Message` y `Close Message` no contienen datos reales** en CABOK (banner estático). Antes, `Close Message` se contaba
   con 100 % de cobertura y podía aparecer como evidencia; ahora se descarta (`readableMessage`). Consecuencia: el análisis
   de causa raíz se apoya en `summary`, `description` y comentarios; no hay firma técnica de error ni resolución documentada
   en campos estructurados. Esto limita la confianza de las causas raíz (ver `docs/support-guard-pilot.md`).
3. `Reopened`, `Priorizada` y `Team` casi no varían en la muestra; su poder discriminante es bajo.
4. Los cambios de normalización incrementaron `NORMALIZATION_VERSION` a `canonical-units/2`: los análisis previos dejan de
   considerarse reutilizables y deben recalcularse.
