<!-- opencode-autonomous-sdlc:start -->
# Autonomous SDLC instructions

Este repositorio usa el ecosistema multiagente de `.opencode/` y los artefactos persistentes de `.sdlc/`.

## Reglas obligatorias

- Para comandos `/sdlc-*`, `sdlc-orchestrator` es el unico propietario del estado del flujo.
- `.sdlc/runs/<run-id>/state.json` y los reportes de la misma carpeta son la fuente de verdad de una ejecucion.
- Los agentes deben cargar skills solo cuando sean relevantes. No cargues todas las skills de forma preventiva.
- Busca antes de leer, lee rangos pequenos y trabaja con el diff actual. No vuelques el repositorio completo al contexto.
- Ningun gate pasa por una afirmacion verbal. Debe existir evidencia reproducible: archivos, comandos, resultados, hallazgos y veredicto.
- El desarrollador no puede emitir la decision final. El juez debe ser independiente y usar los reportes de pruebas y revision.
- Mantener cambios pequenos, reversibles, compatibles con las convenciones existentes y limitados al alcance aprobado.
- No leer ni modificar secretos. No publicar paquetes, hacer `git push`, desplegar, destruir infraestructura, borrar datos ni ejecutar migraciones irreversibles.
- Las decisiones de negocio ambiguas, el uso de secretos, los cambios destructivos, los despliegues productivos y los riesgos criticos requieren intervencion humana.
- Si un gate falla, corrige solo la causa demostrada y vuelve a ejecutar las verificaciones impactadas. No repitas todo el flujo sin necesidad.
- Si se agotan los bucles de reparacion, termina en estado `BLOCKED` con evidencia y una accion humana concreta.

## Carga modular

El contrato operativo base esta en `.opencode/rules/sdlc-core.md`. Las reglas de seguridad estan en `.opencode/rules/safety.md` y la politica de tokens en `.opencode/rules/token-policy.md`. Los agentes especializados ya indican que skills deben cargar.

Las instrucciones propias del repositorio prevalecen cuando son mas especificas y no contradicen las barreras de seguridad anteriores.
<!-- opencode-autonomous-sdlc:end -->
