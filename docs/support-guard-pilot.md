# Support Guard — Guía del piloto

## Qué hace
Capa de control de calidad previa al flujo de soporte de Jira.

| Módulo | Función | Escribe en Jira |
|---|---|---|
| Validación de casos nuevos | Verifica campos obligatorios; devolución manual/masiva | Solo con `JIRA_ACTIONS_MODE=LIVE` (piloto: `DRY_RUN`) |
| Suficiencia | Evalúa con IA si un analista puede iniciar el caso | No |
| Analista inicial | Vista previa (no habilitado) | No |
| Support Intelligence | Análisis histórico por período: grupos, tendencias, causa raíz, reportes | No (lectura) |

## Cómo ejecutar
```
cd apps\backend ; npm run dev          # API en :3000
cd apps\frontend\angular-app ; npx ng serve --proxy-config proxy.conf.json
```
Las credenciales viven en variables de entorno / `reference\env` (nunca se imprimen ni se registran).

## Configuración clave
- `JIRA_SOURCE_MODE` (MOCK_JIRA / REAL_JIRA) y `JIRA_ACTIONS_MODE` (DRY_RUN por defecto).
- IA: puente AXET local (`http://127.0.0.1:4317/v1`); si no responde, la salud queda DEGRADED y el resto funciona.
- Auth: JWT aXet/Okta (RS256). Variables: `SUPPORT_GUARD_AUTH_JWKS_URL` (https) + `SUPPORT_GUARD_AUTH_ISSUER` (+ `SUPPORT_GUARD_AUTH_AUDIENCE` opcional). Ambas obligatorias juntas (configuración parcial aborta el arranque). Con `NODE_ENV=production` o `SUPPORT_GUARD_REQUIRE_AUTH=true` el backend **no arranca sin auth**. JWKS con timeout 5 s, caché 10 min y recarga limitada a 1 cada 30 s. `/api/health/*` queda sin auth por diseño y no expone secretos. Sin auth configurada la API queda abierta (solo local) y LIVE se fuerza a `DRY_RUN`.

## Salud
- `GET /api/health/live` — proceso vivo.
- `GET /api/health/ready?fresh=true` — Jira, IA, almacén analítico (crítico), scheduler. UP/DEGRADED/DOWN; 503 solo si una dependencia crítica cae. Sin secretos. No requiere autenticación por diseño (para sondas).

## Jira de solo lectura
La sincronización histórica solo consulta. La verificación incremental usa `updatedAt` y claves conocidas: un cambio dentro del período → `STALE_DATA`; fuera del período no invalida; sin cambios → `REUSABLE` sin descarga completa.

## Almacén analítico (archivo local)
- Un único proceso escritor. Esquema versionado (`schema_meta`, versión 2).
- Backup automático antes de migraciones relevantes en `apps\backend\data\backups\` (retención: 5).
- **Restore**: detener el backend, copiar el backup elegido sobre el archivo de datos, iniciar. Los runs que quedaron en curso se marcan `INTERRUPTED` al arrancar (nunca `COMPLETED`).
- El apagado (SIGINT/SIGTERM) cierra el almacén tras terminar las peticiones en curso.

## Scheduler
Mensual: mes anterior completo, solo `SUMMARY`/`RECURRENCE`, nunca `FULL_RCA`, sin tocar Jira, reutiliza si ya existe. Verificable con reloj simulado (tests en `ops.test.ts`).

## Modos de análisis
`SUMMARY` y `RECURRENCE` no ejecutan análisis profundo. `TOP_RCA` (Top 3 por puntaje determinístico), `SELECTED_RCA` y `FULL_RCA` requieren confirmación explícita. Abrir dashboard, reporte, clúster o comparar historial no llama IA. Resultados idénticos se reutilizan (huella de clúster, versión de pipeline, prompts, modelo).

## Confianza de causas raíz
Niveles: patrón observado → hipótesis → candidato; la confianza refleja cobertura de evidencia, no certeza. Con calidad de datos baja los candidatos son débiles.

## Validación humana
`POST /analysis/:id/reviews` (VALIDATED / PARTIALLY_VALIDATED / REJECTED / NEEDS_MORE_EVIDENCE + revisor + comentario), historial append-only, `GET /reviews/metrics`. Mide criterio de revisores, **no** precisión de la IA. No retroalimenta nada automáticamente. Paquete: `GET /analysis/:id/review-pack?format=md` → `docs\support-guard-review-pack.md`.

**Descartar recorrido y re-análisis.** `POST /analysis/:id/discard` marca el recorrido como `DISCARDED` (borrado lógico: no elimina filas; se rechaza si está en curso) y permite prepararlo de nuevo. `forceAi: true` en `/estimate` y `/execute` ignora los resultados guardados y vuelve a ejecutar a los especialistas (consume tokens). `GET /analysis/:id/roles` muestra por grupo qué especialista corrió, se reutilizó u omitió (sin señales), su resumen, el veredicto del validador, la causa raíz candidata y el conteo de hallazgos y recomendaciones.

## Limitaciones conocidas
1. **Clasificación**: `customfield_10705` es el Rank de Jira; no hay campo de categoría poblado → dimensión oculta (ver diccionario de datos).
2. `errorMessage`, `closeMessage`, `equipmentId` son banners estáticos → se descartan; calidad de datos POOR y causas raíz débiles.
3. Al cambiar la versión de normalización, los runs previos pasan a `STALE_ANALYSIS`.
4. No hay interfaz de revisión humana (solo API).
5. El host real de aXet (Okta) no es reproducible localmente; revisión visual hecha en host simulado.
6. Al abrir Inicio se ejecuta una sincronización y análisis de suficiencia automáticos (comportamiento previo).

## Checklist GO / NO-GO
| Ítem | Estado | Nota |
|---|---|---|
| Jira real sync | PASS | CABOK, 173 casos en ~22 s |
| Incremental sync | PASS | ~1–2 s, sin descarga completa |
| Persistencia del almacén | PASS | backup + recuperación de interrumpidos |
| Historia de tendencias | WARNING | 8 semanas previas a la normalización v2; re-preparar para tendencias vigentes |
| Clustering | PASS | 14 grupos en 4,3 s |
| RCA agéntico | WARNING | funciona; evidencia débil por datos pobres |
| Citas de evidencia | PASS | |
| Revisión humana RCA | BLOCKED | sin veredictos humanos aún; paquete listo |
| Dashboard ejecutivo | PASS | |
| Reportes | PASS | HTML escapado |
| Revisión UI en aXet real | WARNING | host real no disponible; responsive corregido |
| Auth | WARNING | código listo y probado (JWKS https, issuer, fail-closed en producción); falta cargar los valores reales de Okta en el despliegue |
| Scheduler | PASS | simulado |
| Backup/restore | PASS | documentado |
| Sin mutaciones en Jira | PASS | `DRY_RUN`, Intelligence solo lectura |
| Tests | PASS | backend 80/80 tras corregir empate en revisiones |
| Build de producción | PASS | `ng build` OK |
| IA (puente AXET) | WARNING | health DEGRADED por timeout una vez |
| Clasificación Jira | BLOCKED (dimensión oculta) | requiere confirmar campo en CABOK |

**Veredicto**: NO declarar PILOT READY hasta completar la revisión humana de causas raíz y configurar auth.
