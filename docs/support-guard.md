# Support Guard

Capa de control previa al flujo de soporte: sincroniza casos nuevos de Jira, valida campos obligatorios, evalúa la suficiencia de la información (reglas + IA local), redacta la solicitud de información y, en modo LIVE, devuelve los casos incompletos.

## Arquitectura

```
Adapter (REAL_JIRA | MOCK_JIRA) → Intake → Normalización (SupportCase)
  → Required Field Validator (determinístico) → Sufficiency Engine (reglas)
  → Actions (DRY_RUN | LIVE) → Audit/State
                          ↘ AI Analysis Service (cola, solo lectura sobre el estado local)
                               → AIAnalysisProvider (AXET_BRIDGE_LOCAL | MOCK_AI)
                               → Request Builder (determinístico + IA, sin duplicados)
```

- Backend: `apps/backend/src/{adapters,ai,auth,validation,sufficiency,actions,intake,store,api,config}`.
- API (`/api/support-guard`): `overview`, `cases`, `cases/:id`, `audit`, `validation/run`, `sync/startup`.
- Frontend: `apps/frontend/angular-app/src/app/support-guard` (consume solo la API; nunca habla con Jira ni con la IA).
- Dos capas separadas en dominio y UI:
  1. **Required Field Validation** (determinística): campo vacío ⇒ falta dato obligatorio.
  2. **AI Information Sufficiency** (semántica): el campo existe pero no basta (p. ej. "No funciona.").
- La IA complementa, no reemplaza, la validación determinística. El módulo "Analista inicial" sigue siendo una vista previa.

## Sincronización al entrar (startup sync)

1. El frontend carga el estado persistido y lo muestra de inmediato.
2. `SupportGuardService.initialize()` se ejecuta **una sola vez** por ciclo de vida y llama `POST /sync/startup` (nunca desde render ni change detection).
3. El backend comparte una ejecución en curso entre llamadas concurrentes y omite la sincronización si los datos tienen menos de `SUPPORT_GUARD_STARTUP_SYNC_MAX_AGE_SECONDS`.
4. Jira → casos → normalización → validación determinística → UI usable. El análisis de IA se encola **después**.
5. Si Jira falla, el panel sigue cargando con los últimos datos y muestra "Jira connection unavailable". Luego el scheduler existente continúa.

## Capa de IA

- Interfaz `AIAnalysisProvider` (`name`, `model`, `healthCheck()`, `analyze()`); implementaciones `AxetBridgeAIProvider` y `MockAIProvider`. Para sumar Azure OpenAI/OpenAI basta otra implementación y registrarla en `create-provider.ts`.
- `AIAnalysisService` mantiene una cola con concurrencia limitada (`SUPPORT_GUARD_AI_MAX_CONCURRENCY`) y estados por caso: `QUEUED`, `ANALYZING`, `COMPLETED`, `FAILED`, `SKIPPED`. No tiene referencia al adaptador de Jira: la IA **nunca** modifica Jira; solo analiza, recomienda y genera borradores.
- Contexto enviado al modelo: clave, resumen, descripción, aplicación, ambiente, prioridad, campos relevantes no sensibles, metadatos de adjuntos y resultado de validación. Nunca tokens, cabeceras, cookies, configuración interna ni datos de sesión.
- Resultado estructurado validado en backend; una respuesta inválida produce `FAILED` (`AI_ANALYSIS_ERROR`) sin afectar la validación determinística.

### Esquema del resultado

```json
{
  "status": "SUFFICIENT | PARTIALLY_SUFFICIENT | INSUFFICIENT",
  "confidence": 0.0,
  "summary": "...",
  "missingInformation": [{ "field": "reproductionSteps", "reason": "...", "question": "..." }],
  "ambiguities": [],
  "recommendedQuestions": [],
  "requesterMessage": "..."
}
```

### Versionado del prompt

El prompt vive en `apps/backend/src/ai/prompt.ts` con `PROMPT_VERSION` (actual: `case-info-quality/v1`). Cambiar el prompt exige subir la versión; eso invalida los análisis cacheados.

### Mensaje al solicitante

`request-builder.ts` combina los campos obligatorios faltantes (evidencia determinística) con la información semántica faltante de la IA, sin duplicados y sin pedir lo que el caso ya contiene. Es un borrador: la UI ofrece "Copiar mensaje"; no se envía a Jira desde la IA.

## IA local con AXET Bridge

1. Levantar el AXET Bridge existente (endpoint compatible con OpenAI, normalmente `http://127.0.0.1:4317/v1`). No se copia ni se depende de su implementación.
2. Configurar `apps/backend/.env`:

```
SUPPORT_GUARD_AI_ENABLED=true
SUPPORT_GUARD_AI_PROVIDER=AXET_BRIDGE_LOCAL
SUPPORT_GUARD_AI_BASE_URL=http://127.0.0.1:4317/v1
SUPPORT_GUARD_AI_MODEL=<modelo-configurado>
```

3. Levantar Support Guard (`npm run dev`). Para desarrollo sin bridge: `SUPPORT_GUARD_AI_PROVIDER=MOCK_AI`.

`AXET_BRIDGE_LOCAL` solo acepta URL de loopback (ejecución local); no hay integración cloud todavía.

| Variable | Default |
| --- | --- |
| `SUPPORT_GUARD_AI_ENABLED` | `false` |
| `SUPPORT_GUARD_AI_PROVIDER` | `AXET_BRIDGE_LOCAL` (o `MOCK_AI`) |
| `SUPPORT_GUARD_AI_BASE_URL` | `http://127.0.0.1:4317/v1` |
| `SUPPORT_GUARD_AI_MODEL` | `gpt-5.6-terra` (cambiable sin código; Luna es la alternativa más ligera) |
| `SUPPORT_GUARD_AI_TIMEOUT_MS` | `60000` |
| `SUPPORT_GUARD_AI_MAX_CONCURRENCY` | `2` |
| `SUPPORT_GUARD_AI_RETRY_SECONDS` | `120` (reintento de análisis fallidos) |

## Smoke real contra AXET Bridge

Prueba manual (no forma parte de `npm test`), con MOCK_JIRA + IA real:

```
cd apps/backend
$env:SUPPORT_GUARD_AI_ENABLED="true"; $env:SUPPORT_GUARD_AI_PROVIDER="AXET_BRIDGE_LOCAL"
$env:SUPPORT_GUARD_AI_BASE_URL="http://127.0.0.1:4317/v1"; $env:SUPPORT_GUARD_AI_MODEL="gpt-5.6-luna"
npm run smoke:ai
```

`smoke/ai-smoke.ts` ejecuta 5 casos propios (suficiente, vago, técnico con error y pasos, campo requerido faltante, ambiguo), imprime el resultado por caso, duración, auditoría, health con bridge caído y un chequeo de timeout.

Hallazgos del bridge: respuesta no-stream (`chat.completion`), acepta el nombre de modelo sin prefijo y `GET /v1/models` lista los modelos (el health exige JSON válido y que el modelo configurado exista). La primera llamada puede tardar (arranque en frío); un análisis real toma ~10–20 s. Cada registro guarda `aiStartedAt`, `aiCompletedAt` y `durationMs` (la UI solo muestra "Analizando…").

Resultado con `case-info-quality/v1`: la IA marcó como faltantes datos ya presentes y generó mensajes largos. Se endureció el prompt (`case-info-quality/v2`): solo es faltante lo ausente, sin mensaje si es suficiente, máximo 4 preguntas, mensaje breve. Con v2 los casos suficientes no generan solicitud y los vagos piden solo lo necesario.

## Fallback

Si el bridge no responde o excede el timeout: el caso queda `FAILED` ("AI unavailable"), el estado de salud de "AI Analysis" pasa a `DISCONNECTED` (o `DISABLED` si está apagada) y siguen funcionando la sincronización, la validación de campos, la suficiencia por reglas y el dashboard. Los fallos se reintentan tras `SUPPORT_GUARD_AI_RETRY_SECONDS`.

## Idempotencia

- **Casos**: huella del contenido + versión de reglas; sin cambios no se reprocesa ni repite acciones.
- **IA**: huella = contenido + `PROMPT_VERSION` + versión de reglas + proveedor + modelo. Se persisten `fingerprint`, `promptVersion`, `model`, `analyzedAt`. Si coincide se reutiliza (`AI_ANALYSIS_REUSED`); si cambia el caso, el prompt, las reglas o el modelo, se reevalúa.
- **Comentario en Jira**: se persiste una clave (caso + campos faltantes + texto). Si el comentario se publicó pero la transición falló, el reintento solo repite la transición; no duplica el comentario.
- **Auditoría IA**: `AI_ANALYSIS_STARTED`, `AI_ANALYSIS_COMPLETED`, `AI_ANALYSIS_FAILED`, `AI_ANALYSIS_REUSED` con caso, fecha, modelo, versión de prompt y estado (sin secretos).

## Seguridad y DRY_RUN / LIVE

- `JIRA_ACTIONS_MODE=DRY_RUN` (default): no modifica Jira y registra "Would return case".
- `LIVE`: comenta y ejecuta la transición configurada. Sin transición solo comenta y etiqueta; nunca se declara éxito sin respuesta de Jira.
- **LIVE falla cerrado**: solo se activa si hay autenticación configurada (`SUPPORT_GUARD_AUTH_JWKS_URL` y `SUPPORT_GUARD_AUTH_ISSUER`, opcional `SUPPORT_GUARD_AUTH_AUDIENCE`). Si no, se fuerza `DRY_RUN` y el panel muestra el motivo.
- Con autenticación configurada, todas las rutas de `/api/support-guard` exigen el JWT Bearer de aXet/Okta (RS256, JWKS cacheado, validación de `exp`, `nbf`, `iss`, `aud`); se responde `401` en caso contrario. No existe un login nuevo.
- Sin autenticación configurada la API queda abierta solo para desarrollo local, con LIVE bloqueado.
- Secretos solo por variables de entorno; no se registran ni se envían a la IA.

## Devolución manual desde el detalle

En "Suficiencia" las tablas muestran 5 casos por página y el botón "Revisar mensaje" abre el detalle del caso. Allí se ve el mensaje sugerido, se puede copiar y devolver el caso con confirmación (`POST /api/support-guard/cases/:id/return`).

- Solo la dispara una persona; la IA nunca modifica Jira.
- Se envía el mensaje guardado en el servidor, no texto del cliente.
- En DRY_RUN solo simula ("Would return case"); en LIVE publica el comentario y es idempotente por caso + mensaje.
- Errores: 404 no existe, 409 IA pendiente o ya devuelto, 502 error de Jira.

## Configuración general (ver `apps/backend/.env.example`)

| Variable | Descripción |
| --- | --- |
| `SUPPORT_GUARD_SOURCE` | `MOCK_JIRA` (default) o `REAL_JIRA` |
| `JIRA_URL`, `JIRA_AUTH_MODE`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | Conexión (`basic` o `bearer`) |
| `JIRA_PROJECT_KEY`, `JIRA_JQL`, `JIRA_NEW_CASE_STATUSES` | Qué es un caso nuevo |
| `JIRA_FIELD_MAP` | Mapeo de campos (aplicación, ambiente, etc.) |
| `JIRA_RETURN_TRANSITION_ID` / `JIRA_RETURN_TRANSITION_NAME` | Transición de devolución |
| `SUPPORT_GUARD_REQUIRED_FIELDS` | Campos obligatorios |
| `SUPPORT_GUARD_RULES_FILE` | JSON con reglas de suficiencia/plantillas |
| `SUPPORT_GUARD_AUTO_ENABLED`, `SUPPORT_GUARD_POLL_INTERVAL_SECONDS` | Validación automática |
| `SUPPORT_GUARD_STARTUP_SYNC`, `SUPPORT_GUARD_STARTUP_SYNC_MAX_AGE_SECONDS` | Sincronización al entrar |
| `SUPPORT_GUARD_STATE_FILE` | Estado persistente (idempotencia y auditoría) |

## MOCK_JIRA

Incluye casos para demostrar la IA: completo y suficiente (DEMO-101), descripción vaga con todos los campos (DEMO-102), campos obligatorios faltantes (DEMO-104), parcialmente suficiente (DEMO-105), error técnico con evidencia (DEMO-107) y un caso vago que puede actualizarse para reevaluación (DEMO-108, ver `DEMO_108_UPDATE`).

La UI deriva la fuente del backend: con `MOCK_JIRA` muestra solo el indicador discreto "Demo mode"; con `REAL_JIRA` no muestra ninguna referencia a datos de demostración.

## Paso a REAL_JIRA (+ IA real, DRY_RUN)

`SUPPORT_GUARD_SOURCE=REAL_JIRA` arranca sin credenciales, pero Jira queda `DISCONNECTED` ("integración no configurada") hasta definir en `apps/backend/.env`:

| Variable | Requerida | Nota |
| --- | --- | --- |
| `JIRA_URL` | Sí | URL base de Jira |
| `JIRA_API_TOKEN` | Sí | Solo en `.env` local |
| `JIRA_EMAIL` | Sí con `JIRA_AUTH_MODE=basic` | No necesario con `bearer` |
| `JIRA_AUTH_MODE` | Sí | `basic` o `bearer` |
| `JIRA_PROJECT_KEY` | Sí (o `JIRA_JQL`) | Proyecto a leer |
| `JIRA_NEW_CASE_STATUSES` | Sí | Estados reales que significan "nuevo" (default `Open`) |
| `JIRA_FIELD_MAP` | Recomendada | Ids reales de campos personalizados (aplicación, ambiente, etc.); sin ella esos campos aparecerán vacíos |
| `JIRA_JQL` | Opcional | Reemplaza la consulta derivada |
| `JIRA_RETURN_TRANSITION_ID`/`_NAME` | Solo para LIVE | No se necesita en DRY_RUN |

Mantener `JIRA_ACTIONS_MODE=DRY_RUN`: no se escribe nada en Jira.

## Ejecución

```
npm run dev     # backend :3000, frontend :4200
npm test --prefix apps/backend
npm run test --prefix apps/frontend/angular-app
npm run build --prefix apps/frontend/angular-app
```
