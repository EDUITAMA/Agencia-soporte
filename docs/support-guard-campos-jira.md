# Support Guard — Campos que recibimos de Jira (casos abiertos y cerrados)

Inventario de los campos del proyecto **CABOK** leído por API en modo solo lectura. No se modificó ningún caso.

## Muestra analizada

| Grupo | Criterio | Total en Jira | Muestra | Tipos en la muestra | Estados en la muestra |
|---|---|---|---|---|---|
| Abiertos | `statusCategory != Done` | 4275 | 100 más recientes | Sub-Support 48, Support 48, Sub-Management 2, Doubt 1, Sub-Unit Tests 1 | Open 89, Free status 1 9, In Progress 1, Free status 2 1 |
| Cerrados | `statusCategory = Done` | 30029 | 100 más recientes | Sub-Support 47, Support 47, Sub-Deployment 3, Sub-Documentation 3 | Closed 100 |

Jira expone 867 campos entre estándar y personalizados. En la muestra solo **100 traen algún valor**; los otros 767 llegan vacíos en todos los casos. Las columnas "Abiertos" y "Cerrados" indican en cuántos de los 100 casos el campo viene con valor.

## 1. Campos estándar

| ID | Nombre | Tipo | Abiertos | Cerrados | Nota |
|---|---|---|---|---|---|
| summary | Summary | texto | 100 | 100 | Siempre presente |
| issuetype | Issue Type | tipo | 100 | 100 | |
| status | Status | estado | 100 | 100 | |
| priority | Priority | prioridad | 100 | 100 | |
| project | Project | proyecto | 100 | 100 | |
| created | Created | fecha | 100 | 100 | |
| updated | Updated | fecha | 100 | 100 | |
| reporter | Reporter | usuario | 100 | 100 | |
| creator | Creator | usuario | 100 | 100 | |
| comment | Comment | comentarios | 100 | 100 | Incluye el historial de comentarios |
| description | Description | texto | 48 | 47 | **Vacía en los Sub-Support** (ver sección 3) |
| assignee | Assignee | usuario | 48 | 47 | |
| labels | Labels | lista | 48 | 47 | |
| subtasks | Sub-Tasks | lista | 48 | 47 | |
| parent | parent | referencia | 51 | 53 | Los Sub-* apuntan al caso padre |
| resolution | Resolution | resolución | 0 | 100 | Solo en cerrados |
| resolutiondate | Resolved | fecha | 0 | 100 | Solo en cerrados |
| issuelinks | Linked Issues | lista | 1 | 24 | |
| attachment | Attachment | lista | 0 | 6 | Rara vez hay adjuntos |
| timeestimate | Remaining Estimate | número | 3 | 53 | |
| aggregatetimeestimate | Σ Remaining Estimate | número | 3 | 100 | |
| timespent | Time Spent | número | 3 | 17 | |
| aggregatetimespent | Σ Time Spent | número | 3 | 34 | |
| votes, watches, worklog, progress, aggregateprogress, workratio, timetracking | Metadatos de Jira | varios | 100 | 100 | Sin valor para validar suficiencia |

## 2. Campos personalizados con valor

Campos con datos reales para el negocio:

| ID | Nombre | Tipo | Abiertos | Cerrados |
|---|---|---|---|---|
| customfield_20800 | Team | opción | 100 | 100 |
| customfield_15303 | Servicio | texto | 100 | 100 |
| customfield_15304 | IssueType Linea Servicio | texto | 100 | 100 |
| customfield_15302 | Grupo Comercial | texto | 100 | 100 |
| customfield_15305 | Parent Issue Type | texto | 51 | 53 |
| customfield_10705 | Clasificación | cualquiera | 100 | 100 |
| customfield_13321 | Identificación del equipo | texto | 100 | 100 |
| customfield_17900 | Priorizada | opción | 100 | 100 |
| customfield_12071 | Reopened | opción | 100 | 100 |
| customfield_15307 | Total horas incurridas | número | 100 | 100 |
| customfield_26800 | Error Message | texto | 100 | 100 |
| customfield_27000 | Close Message | texto | 100 | 100 |
| customfield_36000 | AI Usage | opción | 99 | 100 |
| customfield_12202 | Time to SLA | cualquiera | 48 | 47 |
| customfield_12800 | Number of client requests | número | 48 | 47 |
| customfield_24800 | Billable to customer | opción | 48 | 47 |
| customfield_11943 | Resolved by associated client | opción | 48 | 47 |
| customfield_12045 | Excluded from ANS | opción | 48 | 47 |
| customfield_12073 / 12074 | Versions / Versions Edit | texto | 48 | 47 |
| customfield_23211 / 23212 | Estimation / Estimation Edit | texto | 48 | 47 |
| customfield_23412 | Support Phase | opción | 8 | 11 |
| customfield_10701 | Epic Link | cualquiera | 8 | 46 |
| customfield_21900 | Real delivery date | fecha | 0 | 100 |
| customfield_23216 | Real start date | fecha | 0 | 53 |
| customfield_22631 / 22634 | Sale estimate (h) / Internal estimate (h) | número | 0 | 47 |
| customfield_36001 / 36009 | AI Tools 1 / Total AI Usage % | opción / número | 0 | 11 |
| customfield_23600 | Related issue | enlace | 1 | 0 |

Campos libres (`Free Text Field 1-4`, `Free Date Field 1-3`, `Free Combo Field 1-8`): vienen con valor en 43-48 casos de cada grupo, pero sin un significado definido. Hay que confirmar con el dueño de Jira para qué se usan.

Campos que siempre llegan con valor (100 de 100), pero parecen etiquetas de formulario o de flujo de trabajo y no datos del solicitante: `Form line` (1-4), `*Change Label`, `Approval ... Label`, `Remember ... Label`, `Estimated Analyze Label`, `Deadline Approval Label`, `Phase Change Label`, `Hitos`, `Milestones`, `Architecture` / `Architecture Edit`, `Global Parameter Edit`, `Note`, `Note Informative`, `More info COM Change`, `How I Unit/Integration Tested`, `QA Testing` y `Development`.

## 3. Hallazgos para Support Guard

1. **Descripción:** solo la traen los casos tipo `Support` (alrededor de la mitad de la muestra). Los `Sub-Support` llegan con la descripción vacía en abiertos y cerrados, por lo que hoy casi todos se marcarían como incompletos o insuficientes.
2. **Aplicación y ambiente:** no hay un campo claro en la muestra reciente.
   - Los candidatos detectados antes (`customfield_19705` Aplicación, `customfield_11911` Associated aplication, `customfield_28100` QA environment, `customfield_10901` Impact) vienen vacíos en esta muestra.
   - `Servicio` (15303) y `Team` (20800) sí tienen valor y podrían servir como "aplicación".
3. **Mensaje de error:** `Error Message` (26800) siempre llega con algún valor. Hay que verificar si es un dato real o un valor por defecto antes de usarlo como obligatorio.
4. **Cerrados vs. abiertos:** los cerrados añaden `resolution`, `resolutiondate`, `Real delivery date`, `Close Message` y estimaciones. Sirven solo como referencia histórica, porque Support Guard evalúa casos abiertos.
5. **Adjuntos:** casi no hay (6 de 100 en cerrados, ninguno en abiertos). No conviene exigirlos.

## 4. Preguntas para el dueño de Jira

1. ¿Qué tipos de caso debe validar Support Guard: `Support`, `Sub-Support` o ambos?
2. ¿Qué campo identifica la aplicación afectada y cuál el ambiente? ¿Son `Servicio` y `Team`, o hay otros?
3. ¿Los `Sub-Support` deben tener descripción? Si no, ¿qué campo reemplaza esa información?
4. ¿Qué significa `Error Message` y cuándo es obligatorio?
5. ¿Para qué sirven los campos libres (`Free Text/Date/Combo Field`)?
6. ¿Cuál es la transición de devolución y a qué estado pasa el caso?
7. ¿Quién recibe el mensaje al devolver: el reporter, el creator u otra persona?

Con estas respuestas se ajustan `JIRA_JQL`, `JIRA_FIELD_MAP` y `JIRA_NEW_CASE_STATUSES` en la configuración de Support Guard.
