# Support Guard

Capa inteligente de control de calidad previa al flujo de soporte de Jira (proyecto CABOK, Banco de Occidente), integrada como módulo de aXet. Stack: Node.js 22 / Express 5 / TypeScript (ESM) en el backend y Angular 20 (zoneless) en el frontend.

## Módulos

| Módulo | Función | Escribe en Jira |
|---|---|---|
| **Validación de casos nuevos** | Consulta los casos nuevos, valida campos obligatorios configurables y permite devolver casos (individual o masivo) con comentario profesional | Solo con `JIRA_ACTIONS_MODE=LIVE` (por defecto `DRY_RUN`) |
| **Suficiencia** | Análisis semántico con IA para decidir si un analista puede iniciar el caso y redactar la solicitud de información | No |
| **Analista inicial** | Vista previa (no habilitado) | No |
| **Support Intelligence** | Análisis histórico por período: reuse, pre-análisis, agrupación, tendencias, análisis profundo de causa raíz con evidencia, dashboard ejecutivo, reportes, historial y revisión humana | No (solo lectura) |

## Arquitectura

```
Jira (JiraAdapter: MOCK_JIRA | REAL_JIRA)
  ├─ Case intake → reglas de campos → devolución (DRY_RUN | LIVE)
  ├─ IA de suficiencia (AXET Bridge local | MOCK_AI)
  └─ Support Intelligence → almacén analítico local (DuckDB) → clustering → análisis por roles → reportes
```

- `apps/backend`: API (`/api/support-guard`, `/api/support-guard/intelligence`, `/api/health`).
- `apps/frontend/angular-app`: interfaz de Support Guard y Support Intelligence.
- `docs`: documentación funcional y de operación. `deploy`: plantillas de entrega.

## Requisitos

- Node.js 22.22.3 y npm 10.

## Instalación y ejecución

```bash
npm install
npm install --prefix apps/backend
npm install --prefix apps/frontend/angular-app
copy apps\backend\.env.example apps\backend\.env   # completar variables
npm run dev
```

Backend en `http://localhost:3000`; frontend en `http://localhost:4200` con proxy de `/api`. Por defecto se usa `MOCK_JIRA` y `DRY_RUN`.

## Configuración

Todo se resuelve por variables de entorno (ver `apps/backend/.env.example`); no hay IDs, URLs ni credenciales en el código.

- **Jira:** `SUPPORT_GUARD_SOURCE` (`MOCK_JIRA` | `REAL_JIRA`), `JIRA_URL`, `JIRA_AUTH_MODE`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, estados de caso nuevo, transición de devolución.
- **Acciones:** `JIRA_ACTIONS_MODE` = `DRY_RUN` (defecto, no modifica Jira) | `LIVE` (solo si la autenticación está configurada).
- **IA:** `SUPPORT_GUARD_AI_PROVIDER` (`AXET_BRIDGE_LOCAL` | `MOCK_AI`), `SUPPORT_GUARD_AI_BASE_URL`.
- **Autenticación (JWT aXet/Okta, RS256):** `SUPPORT_GUARD_AUTH_JWKS_URL` (https) + `SUPPORT_GUARD_AUTH_ISSUER` (+ `SUPPORT_GUARD_AUTH_AUDIENCE`). Deben definirse juntas; con `NODE_ENV=production` o `SUPPORT_GUARD_REQUIRE_AUTH=true` el backend no arranca sin ellas.
- **Support Intelligence:** `INTELLIGENCE_ENABLED`, `INTELLIGENCE_DB_PATH`.

Nunca versiones `.env` ni `reference/env`.

## Salud

- `GET /api/health/live`: proceso vivo.
- `GET /api/health/ready?fresh=true`: Jira, IA, almacén analítico (crítico) y scheduler. Estados UP / DEGRADED / DOWN; 503 solo si cae una dependencia crítica. Sin secretos; sin autenticación por diseño.

## Modos de análisis (Support Intelligence)

`SUMMARY` y `RECURRENCE` no ejecutan análisis profundo. `TOP_RCA` (Top 3 por puntaje determinístico), `SELECTED_RCA` y `FULL_RCA` requieren confirmación explícita y reutilizan resultados idénticos. Abrir dashboard, reportes, clústeres o comparar historial no llama a la IA.

## Verificación

```bash
npm run test:all
npm run build:all
npm run smoke:backend
```

## Documentación

- [Guía del piloto y checklist GO/NO-GO](docs/support-guard-pilot.md)
- [Support Guard (intake, IA, seguridad, REAL_JIRA)](docs/support-guard.md)
- [Support Intelligence](docs/support-intelligence.md)
- [Diccionario de datos Jira](docs/support-guard-jira-data-dictionary.md) · [Campos Jira](docs/support-guard-campos-jira.md) · [Hallazgos](docs/support-guard-hallazgos-jira.md)
- [Paquete de revisión humana](docs/support-guard-review-pack.md)
- [Estructura del repositorio](docs/architecture/repository-layout.md)

## Limitaciones conocidas

Clasificación Jira no disponible (el campo candidato es el Rank), banners estáticos descartados (calidad de datos baja), revisión humana de causas raíz pendiente y sin interfaz de revisión. Detalle en la guía del piloto.
