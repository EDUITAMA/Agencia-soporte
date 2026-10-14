import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from "@angular/core";

import type { AnalysisMode, AnalysisRun, PeriodType, ReuseState, RoleActivityGroup } from "./intelligence.models";
import { IntelligenceService, type ObjectiveRequest, type PeriodSelection } from "./intelligence.service";
import { OpsDashboardComponent } from "./ops-dashboard.component";
import { OpsHistoryComponent } from "./ops-history.component";

const GROUP_PAGE_SIZE = 8;
const MANY_GROUPS = 5;

type Tab = "dashboard" | "analysis" | "summary" | "clusters" | "cases" | "quality" | "history";
type Audience = "executive" | "analyst";

const PERIOD_LABELS: Record<PeriodType, string> = { MONTHLY: "Mensual (recomendado)", BIWEEKLY: "15 días", WEEKLY: "Semanal", DAILY: "Diario", CUSTOM: "Personalizado" };
const REUSE_LABELS: Record<ReuseState, string> = { REUSABLE: "Análisis disponible", STALE_DATA: "Cambios en Jira", STALE_ANALYSIS: "Versión anterior", NOT_FOUND: "Sin análisis" };
const MODES: Record<AnalysisMode, { title: string; text: string }> = {
  SUMMARY: { title: "Resumen del período", text: "Métricas, tendencias y distribución. IA mínima o ninguna." },
  RECURRENCE: { title: "Problemas recurrentes", text: "Analizar recurrencia y principales grupos." },
  TOP_RCA: { title: "Causa raíz de los principales problemas", text: "Análisis profundo solo sobre los grupos prioritarios (por defecto, los 3 primeros)." },
  SELECTED_RCA: { title: "Seleccionar grupos", text: "Elige manualmente uno o varios grupos para el análisis profundo." },
  FULL_RCA: { title: "Análisis completo", text: "Analiza todos los grupos elegibles. Usa más tiempo y procesamiento de IA." },
};
const DEPTHS: Record<string, string> = { NONE: "Ninguna", LABEL: "Ligera", DEEP: "Profunda" };
const WORKLOADS: Record<string, string> = { NONE: "Ninguna", LOW: "Baja", MEDIUM: "Media", HIGH: "Alta" };
const TREND: Record<string, string> = { NEW: "Nuevo", GROWING: "Creciendo", DECLINING: "Decreciendo", PERSISTENT: "Persistente", NO_BASELINE: "Sin base" };
const LEVEL: Record<string, string> = { OBSERVED_PATTERN: "Patrón observado", HYPOTHESIS: "Hipótesis", LIKELY_CAUSE: "Causa probable", SUPPORTED_CAUSE: "Causa respaldada", CONFIRMED_CAUSE: "Causa confirmada" };
const ELIGIBILITY: Record<string, string> = { ELIGIBLE_FOR_RCA: "Elegible", INSUFFICIENT_CONTEXT: "Contexto insuficiente", FOREIGN_SERVICE: "Servicio ajeno", NOISE: "Ruido", DUPLICATE: "Duplicado", CHILD_ONLY: "Sub-Support", OTHER: "Otro" };
const STATUS: Record<string, string> = { PREPARED: "Datos listos", COMPLETED: "Completado", PARTIAL: "Parcial", FAILED: "Fallido", QUEUED: "En cola", SYNCING_JIRA: "Leyendo Jira", NORMALIZING: "Normalizando", CLUSTERING: "Agrupando", ANALYZING: "Analizando", VALIDATING: "Validando", GENERATING_REPORT: "Reportes", DISCARDED: "Descartado", INTERRUPTED: "Interrumpido" };

@Component({
  selector: "sg-intelligence-view",
  standalone: true,
  imports: [OpsDashboardComponent, OpsHistoryComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!svc.detail()) {
    <header class="sg-pagehead">
      <div>
        <h1>Support Intelligence</h1>
        <p>Analiza periodos históricos de casos para detectar patrones recurrentes y candidatos a causa raíz con evidencia verificable. Solo lectura: no modifica Jira ni los casos de Support Guard.</p>
      </div>
      <div class="sg-segments" role="group" aria-label="Vista">
        <button type="button" [class.is-active]="audience() === 'executive'" [attr.aria-pressed]="audience() === 'executive'" (click)="setAudience('executive')">Ejecutiva</button>
        <button type="button" [class.is-active]="audience() === 'analyst'" [attr.aria-pressed]="audience() === 'analyst'" (click)="setAudience('analyst')">Analista</button>
      </div>
    </header>

    <section class="sg-panel sg-intel-launch">
      <div class="sg-intel-periods" role="radiogroup" aria-label="Periodo de análisis">
        @for (t of types; track t) {
          <button type="button" role="radio" [attr.aria-checked]="type() === t" [class.is-active]="type() === t" (click)="setType(t)">{{ labels[t] }}</button>
        }
      </div>
      <div class="sg-intel-dates">
        @if (type() === 'MONTHLY') {
          <label>Mes <input type="month" [value]="month()" (change)="month.set($any($event.target).value); refreshPreview()" /></label>
        }
        @if (type() === 'CUSTOM') {
          <label>Desde <input type="date" [value]="from()" (change)="from.set($any($event.target).value); refreshPreview()" /></label>
          <label>Hasta <input type="date" [value]="to()" (change)="to.set($any($event.target).value); refreshPreview()" /></label>
        }
        @if (svc.preview(); as p) { <span class="sg-chip">{{ p.label }} · {{ p.days }} día(s)</span> }
      </div>
      @if (svc.preview(); as p) {
        <div class="sg-intel-period" aria-live="polite">
          <div class="sg-intel-period__head">
            <div>
              <strong>{{ p.label }}</strong>
              <span class="sg-muted">{{ p.days }} día(s)</span>
            </div>
            @if (svc.lookup(); as l) { <span class="sg-chip" [class.sg-chip--ok]="l.state === 'REUSABLE'" [class.sg-chip--warn]="l.state === 'STALE_DATA' || l.state === 'STALE_ANALYSIS'">{{ reuseLabels[l.state] }}</span> }
          </div>
          @if (svc.lookup(); as l) {
            @if (l.run) {
              <p class="sg-muted">Último análisis: <strong>{{ when(l.run.preparedAt ?? l.run.startedAt) }}</strong> · {{ l.run.casesFetched }} casos · {{ l.run.clusters }} grupos@if (l.run.analysis) { · IA: {{ modeTitle(l.run.analysis.mode) }} }</p>
              @if (l.state === 'STALE_DATA') { <p class="sg-note">Se detectaron cambios en Jira desde ese análisis. Actualice los datos para analizar con IA sobre información vigente.</p> }
              @if (l.state === 'STALE_ANALYSIS') { <p class="sg-note">Ese análisis se generó con otra versión o configuración. Puede consultarlo; se recomienda recalcular.</p> }
            } @else {
              <p class="sg-muted">Aún no hay un análisis para este periodo. Preparar datos no usa IA.</p>
            }
            @if (svc.checkNote(); as note) { <p class="sg-note">{{ note }}</p> }
            <div class="sg-intel-actions">
              @if (l.run) {
                <button type="button" class="sg-btn" [class.sg-btn--primary]="l.state === 'REUSABLE'" [disabled]="svc.running" (click)="svc.openExisting()">Ver análisis existente</button>
                <button type="button" class="sg-btn sg-btn--ghost" [disabled]="svc.running || svc.checking()" (click)="check()" title="Consulta en Jira solo los casos modificados; no descarga todo ni usa IA">{{ svc.checking() ? 'Verificando…' : 'Verificar cambios' }}</button>
              }
              @if (!l.run || l.state === 'STALE_DATA') {
                <button type="button" class="sg-btn sg-btn--primary" [disabled]="svc.running || svc.starting()" (click)="start(false)">{{ svc.running ? 'Preparando…' : l.run ? 'Actualizar datos' : 'Preparar datos' }}</button>
              }
              @if (l.run) { <button type="button" class="sg-btn sg-btn--ghost" [disabled]="svc.running || svc.starting()" (click)="start(true)" title="Vuelve a leer Jira y crea una nueva versión; el análisis anterior se conserva">Recalcular</button> }
              @if (l.run) { <button type="button" class="sg-btn sg-btn--danger" [disabled]="svc.running || svc.starting()" (click)="discard()" title="Descarta este recorrido para volver a hacerlo. No borra datos del almacén.">Descartar recorrido</button> }
            </div>
          }
        </div>
      }
      @for (w of svc.preview()?.warnings ?? []; track w) { <p class="sg-banner sg-banner--warn">{{ w }}</p> }
      @if (svc.error(); as e) { <p class="sg-banner sg-banner--warn" role="alert">{{ e }}</p> }
    </section>

    @if (svc.run(); as run) {
      @if (svc.running) {
        <section class="sg-panel" aria-live="polite">
          <h3>{{ statuses[run.status] ?? run.status }}</h3>
          <div class="sg-progress" role="progressbar" [attr.aria-valuenow]="run.progress?.percent ?? 0" aria-valuemin="0" aria-valuemax="100"><span [style.width.%]="run.progress?.percent ?? 0"></span></div>
          <p class="sg-muted">{{ run.progress?.message }}@if (run.progress?.clustersTotal) { · {{ run.progress?.clustersDone ?? 0 }}/{{ run.progress?.clustersTotal }} grupos }</p>
          @if (board().length) {
            <div class="sg-roles sg-roles--live">
              @for (g of board(); track g.id) {
                <article class="sg-role-card" [class.is-running]="g.state === 'RUNNING'">
                  <header><strong [title]="g.title">{{ g.title }}</strong><span class="sg-chip" [class.sg-chip--ok]="g.state === 'DONE' || g.state === 'REUSED'" [class.sg-chip--warn]="g.state === 'FAILED'">{{ boardState(g.state) }}</span></header>
                  @if (g.segmentation) { <small class="sg-muted">{{ g.segmentation }}</small> }
                  @if (g.roles.length) {
                    <ul>
                      @for (r of g.roles; track r.role) {
                        <li><span class="sg-role-name" [title]="roleHint(r.role)">{{ roleName(r.role) }}</span><span class="sg-chip" [class.sg-chip--ok]="r.state === 'DONE' || r.state === 'REUSED'" [class.sg-chip--warn]="r.state === 'FAILED'">@if (r.state === 'RUNNING') { <span class="sg-spin" aria-hidden="true"></span> }{{ boardState(r.state) }}</span><small>{{ r.detail }}@if (r.startedAt) { · {{ time(r.startedAt) }} }</small></li>
                      }
                    </ul>
                  } @else if (g.state === 'RUNNING') { <small class="sg-muted">Seleccionando especialistas…</small> }
                </article>
              }
            </div>
          }
          @if (activity().length) {
            <details class="sg-activity-box"><summary>Bitácora detallada ({{ activity().length }})</summary>
              <ul class="sg-activity" aria-label="Actividad del análisis">
                @for (e of activity(); track $index) {
                  <li [class.is-warn]="e.level !== 'INFO'"><time>{{ time(e.ts) }}</time><span class="sg-chip">{{ eventLabel(e.phase) }}</span><span class="sg-activity__msg">{{ e.message }}</span></li>
                }
              </ul>
            </details>
          } @else if (!board().length) { <p class="sg-muted">Esperando la primera actividad…</p> }
        </section>
      } @else if (run.status === 'FAILED') {
        <div class="sg-state sg-state--error"><h3>El análisis no pudo completarse</h3><p>{{ run.error }}</p></div>
      } @else {
        <div class="sg-intel-title">
          <h2>{{ svc.executive()?.period?.label ?? (run.from + ' → ' + run.to) }}</h2>
          <span class="sg-muted">{{ labels[run.periodType] }} · {{ statuses[run.status] ?? run.status }}</span>
          <button type="button" class="sg-btn sg-btn--small sg-btn--danger sg-intel-title__action"           (click)="discard()" title="Descarta este recorrido para volver a hacerlo. No borra datos del almacén.">Descartar recorrido</button>
        </div>
        <nav class="sg-segments" role="tablist" aria-label="Secciones">
          @for (t of visibleTabs(); track t.id) {
            <button type="button" role="tab" [attr.aria-selected]="tab() === t.id" [class.is-active]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }}</button>
          }
        </nav>
        @if (run.status === 'PARTIAL') { <p class="sg-banner sg-banner--warn">Análisis parcial: algunos grupos no pudieron analizarse con IA. La agrupación determinista se conserva.</p> }
        @if (run.reusedFrom) { <p class="sg-note">Sin cambios en Jira desde el último análisis equivalente: se reutilizó el resultado existente.</p> }

        @switch (tab()) {
          @case ('dashboard') { <sg-ops-dashboard [runId]="run.id" /> }
          @case ('analysis') {
            @if (svc.pre(); as pre) {
              <div class="sg-kpis">
                <div class="sg-kpi"><span class="sg-label">Casos totales</span><strong>{{ pre.totals.units }}</strong></div>
                <div class="sg-kpi"><span class="sg-label">Elegibles</span><strong>{{ pre.totals.eligible }}</strong></div>
                <div class="sg-kpi"><span class="sg-label">Excluidos</span><strong>{{ pre.totals.excluded }}</strong></div>
                <div class="sg-kpi"><span class="sg-label">Grupos</span><strong>{{ pre.totals.clusters }}</strong></div>
                <div class="sg-kpi"><span class="sg-label">Agrupados</span><strong>{{ pre.totals.clusteredPercentage }}%</strong></div>
                <div class="sg-kpi"><span class="sg-label">Cerrados / reabiertos</span><strong>{{ pre.totals.closed }} / {{ pre.totals.reopened }}</strong></div>
              </div>

              <section class="sg-panel">
                <h3>Estado del proceso</h3>
                <dl class="sg-kv">
                  <div><dt>Preparación de datos</dt><dd>Completada · {{ pre.totals.units }} casos · {{ pre.totals.clusters }} grupos</dd></div>
                  <div><dt>Análisis con IA</dt>
                    <dd>
                      @if (run.analysis; as a) { {{ modeTitle(a.mode) }} · {{ a.requestedClusters.length }} grupos seleccionados · {{ a.reusedClusters }} reutilizados · {{ a.analyzedClusters }} analizados@if (a.aiSkippedByReuse) { · {{ a.aiSkippedByReuse }} llamada(s) evitadas } }
                      @else { Sin ejecutar }
                    </dd>
                  </div>
                </dl>
                @if (run.analysis; as a) {
                  @if (a.requestedClusters.length > 0 && a.analyzedClusters === 0 && a.reusedClusters > 0) { <p class="sg-note">Se reutilizaron {{ a.reusedClusters }} resultado(s) existentes; no se llamó a la IA.</p> }
                  @else if (a.analyzedClusters > 0) { <p class="sg-note">Se analizaron {{ a.analyzedClusters }} grupo(s) con IA ({{ a.aiCalls }} llamadas).</p> }
                  @if (svc.roles().length) { <button type="button" class="sg-btn sg-btn--small sg-btn--primary" (click)="goResults()">Ver resultado del análisis ↓</button> }
                }
                @if (activity().length) {
                  <details class="sg-activity-box"><summary>Última actividad del análisis ({{ activity().length }})</summary>
                    <ul class="sg-activity">@for (e of activity(); track $index) { <li [class.is-warn]="e.level !== 'INFO'"><time>{{ time(e.ts) }}</time><span class="sg-chip">{{ eventLabel(e.phase) }}</span><span class="sg-activity__msg">{{ e.message }}</span></li> }</ul>
                                     </details>
                                   }
                                 </section>

              <section class="sg-panel">
                <h3>Grupos detectados</h3>
                @if (pre.groups.length === 0) { <div class="sg-state"><p>No se detectaron grupos con casos suficientes.</p></div> }
                @else {
                  <p class="sg-muted">Marca los grupos que quieres analizar con IA. Si no marcas ninguno se usa el objetivo elegido abajo.</p>
                  <div class="sg-groups-toolbar">
                    <input type="search" class="sg-groups-search" placeholder="Buscar grupo" aria-label="Buscar grupo" [value]="groupQuery()" (input)="setGroupQuery($any($event.target).value)" />
                    <span class="sg-groups-count" aria-live="polite"><strong>{{ selectedCount() }}</strong> seleccionado(s) de {{ pre.groups.length }}</span>
                    <button type="button" class="sg-btn sg-btn--small sg-btn--ghost" (click)="selectRecommended()">Top recomendados</button>
                    <button type="button" class="sg-btn sg-btn--small sg-btn--ghost" [disabled]="selectedCount() === 0" (click)="clearSelection()">Limpiar</button>
                  </div>
                  <div class="sg-groups-wrap">
                    <table class="sg-groups">
                      <thead><tr>
                        <th class="sg-groups__check"><input type="checkbox" aria-label="Seleccionar los grupos de esta página" [checked]="pageSelected()" (change)="togglePage($any($event.target).checked)" /></th>
                        <th>Grupo</th>
                        @if (serviceVaries()) { <th class="sg-groups__service">Servicio</th> }
                        <th class="sg-groups__num">Casos</th>
                        <th class="sg-groups__trend">Tendencia</th>
                        <th class="sg-groups__num">Prioridad</th>
                        <th class="sg-groups__ai">IA</th>
                      </tr></thead>
                      <tbody>
                        @for (g of pageGroups(); track g.id) {
                          <tr [class.is-selected]="isChecked(g.id)" (click)="toggle(g.id)">
                            <td class="sg-groups__check" (click)="$event.stopPropagation()"><input type="checkbox" [attr.aria-label]="'Seleccionar ' + g.title" [checked]="isChecked(g.id)" (change)="toggle(g.id)" /></td>
                            <td class="sg-groups__title">
                              <a href="javascript:void(0)" (click)="$event.stopPropagation(); svc.openCluster(g.id)" [title]="g.title">{{ g.title }}</a>
                              <small>{{ g.open }} abiertos · {{ g.closed }} cerrados@if (g.reopened) { · {{ g.reopened }} reabiertos }@if (g.lowConfidence) { · <em>Baja confianza</em> }</small>
                            </td>
                            @if (serviceVaries()) { <td class="sg-groups__service" [title]="g.service">{{ g.service || '—' }}</td> }
                            <td class="sg-groups__num"><strong>{{ g.cases }}</strong><small>{{ g.percentage }}%</small></td>
                            <td class="sg-groups__trend">{{ trend(g.trend) }}@if (g.previousCount !== null) { <small>antes: {{ g.previousCount }}</small> }</td>
                            <td class="sg-groups__num" [title]="g.priorityReasons.join(' · ')">{{ g.priorityScore }}</td>
                            <td class="sg-groups__ai">{{ aiStatus(g.analysisStatus) }}@if (g.aiReused) { <small>Reutilizado</small> }</td>
                          </tr>
                        } @empty {
                          <tr><td colspan="7" class="sg-groups__empty">Ningún grupo coincide con la búsqueda.</td></tr>
                        }
                      </tbody>
                    </table>
                  </div>
                  <nav class="sg-pager" aria-label="Paginación de grupos">
                    <span>{{ groupRange() }}</span>
                    <div>
                      <button type="button" class="sg-btn sg-btn--small sg-btn--ghost" [disabled]="groupPage() === 0" (click)="groupPage.set(groupPage() - 1)">← Anterior</button>
                      <span aria-live="polite">Página {{ groupPage() + 1 }} de {{ groupPages() }}</span>
                      <button type="button" class="sg-btn sg-btn--small sg-btn--ghost" [disabled]="groupPage() >= groupPages() - 1" (click)="groupPage.set(groupPage() + 1)">Siguiente →</button>
                    </div>
                  </nav>
                }
              </section>

              <section class="sg-panel">
                <h3>¿Qué deseas analizar?</h3>
                <p class="sg-muted">No se usa IA hasta que confirmes.</p>
                <div class="sg-objectives" role="radiogroup" aria-label="Objetivo del análisis">
                  @for (m of modeKeys; track m) {
                    <button type="button" role="radio" class="sg-objective" [attr.aria-checked]="objective() === m" [class.is-active]="objective() === m" (click)="choose(m)">
                      <strong>{{ modes[m].title }}@if (m === 'TOP_RCA') { <span class="sg-chip">Recomendado</span> }</strong>
                      <span>{{ modes[m].text }}</span>
                    </button>
                  }
                </div>
                @if (objective() === 'FULL_RCA' && pre.lowConfidenceGroups.length) {
                  <label class="sg-inline"><input type="checkbox" [checked]="includeLow()" (change)="includeLow.set($any($event.target).checked); estimate()" /> Incluir {{ pre.lowConfidenceGroups.length }} grupo(s) de baja confianza</label>
                }
                @if (objective() === 'SELECTED_RCA') { <p class="sg-muted">Analizarás exactamente los grupos marcados en la tabla ({{ selectedCount() }}).</p> }
                @if (forceAi() || svc.estimate()?.estimate?.reusableGroups) {
                  <label class="sg-inline"><input type="checkbox" [checked]="forceAi()" (change)="forceAi.set($any($event.target).checked); estimate()" /> Volver a ejecutar a los especialistas con IA (ignora los resultados guardados; consume más IA)</label>
                }
                @if (manyGroups()) { <p class="sg-banner sg-banner--warn" role="status">Seleccionaste {{ selectedCount() }} grupos (más de {{ manyThreshold }}): el análisis con IA tomará más tiempo y procesamiento.</p> }

                @if (svc.estimate(); as e) {
                  <div class="sg-estimate">
                    <dl class="sg-kv">
                      <div><dt>Grupos seleccionados</dt><dd>{{ e.estimate.groupsSelected }}</dd></div>
                      <div><dt>Casos representados</dt><dd>{{ e.estimate.casesRepresented }}/{{ e.estimate.casesTotal }}</dd></div>
                      <div><dt>Profundidad IA</dt><dd>{{ depthLabels[e.depth] }}</dd></div>
                      <div><dt>Carga estimada</dt><dd><span class="sg-chip" [class.sg-chip--warn]="e.estimate.workload === 'HIGH'">{{ workloadLabels[e.estimate.workload] }}</span></dd></div>
                      <div><dt>Reutilizables</dt><dd>{{ e.estimate.reusableGroups }} de {{ e.estimate.groupsSelected }}</dd></div>
                    </dl>
                    @if (e.selected.length) {
                      <ul class="sg-list">@for (s of e.selected; track s.id) { <li><strong>{{ s.title }}</strong> — {{ s.reason }}@if (s.willReuse) { <span class="sg-chip">Se reutiliza</span> }</li> }</ul>
                    }
                    @for (w of e.warnings; track w) { <p class="sg-banner sg-banner--warn">{{ w }}</p> }
                  </div>
                }
                @if (svc.staleBlocked()) { <p class="sg-banner sg-banner--warn">Los datos de Jira cambiaron. Use “Actualizar datos” en el selector de periodo antes de analizar.</p> }
                <div class="sg-intel-actions">
                  <button type="button" class="sg-btn sg-btn--primary" [disabled]="svc.executing() || svc.running || !canConfirm()" (click)="confirm()">{{ svc.executing() ? 'Ejecutando…' : confirmLabel() }}</button>
                </div>
              </section>

              @if (svc.roles().length) {
                <section class="sg-panel" id="sg-results">
                  <h3>Resultado del análisis con IA</h3>
                  <p class="sg-muted">Cada grupo lo revisan especialistas por separado y un validador independiente comprueba sus afirmaciones contra la evidencia. Los especialistas sin señales en los casos se omiten.</p>
                  <div class="sg-roles">
                    @for (g of svc.roles(); track g.clusterId) {
                      <article class="sg-role-card">
                        <header><a href="javascript:void(0)" (click)="openDetail(g.clusterId, 'overview')" [title]="g.title">{{ g.title }}</a></header>
                                                @if (g.topCandidate; as c) {
                                                  <div class="sg-role-card__cause"><span class="sg-label">Causa raíz candidata · {{ pct(c.confidence) }}% de confianza</span><strong>{{ c.title }}</strong>@if (c.status === 'INSUFFICIENT_EVIDENCE_FOR_RCA') { <small>Evidencia insuficiente para confirmarla.</small> }</div>
                        } @else { <p class="sg-muted">Sin causa raíz candidata: la evidencia no alcanzó.</p> }
                        <p class="sg-role-card__counts"><span>{{ g.findings }} hallazgo(s)</span><span>{{ g.recommendations }} recomendación(es)</span></p>
                        <dl class="sg-role-stats">
                          <div><dt>Especialistas</dt><dd>{{ roleDone(g) }} de {{ g.roles.length }} ejecutados</dd></div>
                          <div><dt>Afirmaciones verificadas</dt><dd>{{ claimsText(g) }}</dd></div>
                          <div><dt>Validador</dt><dd>{{ validationText(g.validation) || '—' }}</dd></div>
                        </dl>
                        <div class="sg-role-chips" aria-label="Especialistas">
                          @for (r of g.roles; track r.role) {
                            <span class="sg-chip" [class.sg-chip--ok]="r.status === 'COMPLETED' || r.status === 'REUSED'" [class.sg-chip--warn]="r.status === 'FAILED'" [title]="r.reason ?? roleHint(r.role)">{{ roleName(r.role) }} · {{ roleStatus(r.status) }}</span>
                          }
                        </div>
                        <button type="button" class="sg-btn sg-btn--small sg-btn--primary" (click)="openDetail(g.clusterId, 'rca')">Ver análisis completo →</button>
                      </article>
                    }
                  </div>
                </section>
              }
            }
          }
          @case ('summary') {
            @if (svc.executive(); as e) {
              <div class="sg-kpis">
                <div class="sg-kpi"><span class="sg-label">Casos analizados</span><strong>{{ e.totals.units }}</strong></div>
                <div class="sg-kpi"><span class="sg-label">Elegibles</span><strong>{{ e.totals.eligible }}</strong></div>
                <div class="sg-kpi"><span class="sg-label">Grupos</span><strong>{{ e.totals.clusters }}</strong></div>
                <div class="sg-kpi"><span class="sg-label">Agrupados</span><strong>{{ e.totals.clusteredPercentage }}%</strong></div>
                <div class="sg-kpi"><span class="sg-label">Resolución prom. (h)</span><strong>{{ e.totals.avgResolutionHours ?? '—' }}</strong></div>
                <div class="sg-kpi"><span class="sg-label">Reabiertos</span><strong>{{ e.totals.reopened }}</strong></div>
              </div>
              <section class="sg-panel">
                <h3>Resumen ejecutivo <span class="sg-chip">{{ e.narrativeSource === 'AI' ? 'IA' : 'Determinista' }}</span></h3>
                <p>{{ e.narrative }}</p>
                @if (svc.comparison(); as c) {
                  @if (c.previous) {
                    <p class="sg-muted">Frente al periodo anterior ({{ c.previous.from }} → {{ c.previous.to }}): {{ c.previous.units }} → {{ c.current.units }} casos · {{ c.newClusters }} grupo(s) nuevos · {{ c.growingClusters }} en crecimiento · {{ c.decliningClusters }} en descenso{{ c.resolvedClusters !== null ? ' · ' + c.resolvedClusters + ' ya no aparecen' : '' }}.</p>
                  }
                }
              </section>
              <section class="sg-panel">
                <h3>Principales problemas</h3>
                @if (e.topClusters.length === 0) { <div class="sg-state"><p>No se detectaron grupos con casos suficientes en este periodo.</p></div> }
                @else {
                  <div class="sg-tablewrap"><table class="sg-table">
                    <thead><tr><th>Grupo</th><th>Casos</th><th>%</th><th>Tendencia</th><th>Nivel de hallazgo</th></tr></thead>
                    <tbody>
                      @for (c of e.topClusters; track c.id) {
                        <tr tabindex="0" (click)="svc.openCluster(c.id)" (keydown.enter)="svc.openCluster(c.id)">
                          <td class="sg-key">{{ c.title }}@if (c.lowConfidence) { <small class="sg-sub">Baja confianza</small> }</td>
                          <td>{{ c.cases }}</td><td>{{ c.percentage }}%</td><td>{{ trend(c.trend) }}</td><td>{{ c.topLevel ? level(c.topLevel) : '—' }}</td>
                        </tr>
                      }
                    </tbody></table></div>
                }
              </section>
              <section class="sg-panel">
                <h3>Limitaciones</h3>
                <ul class="sg-list">@for (l of e.limitations; track l) { <li>{{ l }}</li> }</ul>
              </section>
            }
          }
          @case ('clusters') {
            <section class="sg-panel">
              @if (svc.clusters().length === 0) { <div class="sg-state"><h3>Sin grupos</h3><p>No hay casos suficientes para formar grupos en este periodo.</p></div> }
              @else {
                <div class="sg-tablewrap"><table class="sg-table">
                  <thead><tr><th>Grupo</th><th>Servicio</th><th>Casos</th><th>Abiertos</th><th>Tendencia</th><th>Modos de falla</th><th>IA</th></tr></thead>
                  <tbody>
                    @for (c of svc.clusters(); track c.id) {
                      <tr tabindex="0" (click)="svc.openCluster(c.id)" (keydown.enter)="svc.openCluster(c.id)">
                        <td class="sg-key">{{ c.title }}<small class="sg-sub">{{ c.description }}</small></td>
                        <td>{{ c.service || '—' }}</td><td>{{ c.cases }}</td><td>{{ c.open }}</td>
                        <td>{{ trend(c.trend) }}@if (c.previousCount !== null) { <small class="sg-sub">antes: {{ c.previousCount }}</small> }</td>
                        <td>{{ c.failureGroups }}@if (c.mixedFailureModes) { <small class="sg-sub">Mixto</small> }</td>
                        <td>{{ aiStatus(c.analysisStatus) }}</td>
                      </tr>
                    }
                  </tbody></table></div>
              }
            </section>
          }
          @case ('cases') {
            <section class="sg-panel">
              <div class="sg-filters" role="search">
                <input type="search" placeholder="Buscar por clave o resumen" aria-label="Buscar" (input)="search.set($any($event.target).value)" (keydown.enter)="applyFilters()" />
                <select aria-label="Elegibilidad" (change)="eligibility.set($any($event.target).value); applyFilters()">
                  <option value="">Elegibilidad: todas</option>
                  @for (k of eligibilityKeys; track k) { <option [value]="k">{{ eligibilityLabels[k] }}</option> }
                </select>
                <select aria-label="Grupo" (change)="clusterFilter.set($any($event.target).value); applyFilters()">
                  <option value="">Grupo: todos</option>
                  @for (c of svc.clusters(); track c.id) { <option [value]="c.id">{{ c.title }}</option> }
                </select>
                <button type="button" class="sg-btn sg-btn--small" (click)="applyFilters()">Buscar</button>
              </div>
              @if (svc.casePage(); as p) {
                <div class="sg-tablewrap"><table class="sg-table">
                  <thead><tr><th>Caso</th><th>Estado</th><th>Servicio</th><th>Fecha</th><th>Elegibilidad</th></tr></thead>
                  <tbody>
                    @for (i of p.items; track i.key) {
                      <tr>
                        <td class="sg-key">{{ i.key }}<small class="sg-sub" [title]="i.summary">{{ i.summary }}</small></td>
                        <td>{{ i.status }}</td><td>{{ i.service || '—' }}</td><td>{{ i.date }}</td>
                        <td [title]="i.eligibilityReason">{{ eligibilityLabels[i.eligibility] ?? i.eligibility }}</td>
                      </tr>
                    }
                  </tbody></table></div>
                <nav class="sg-pager" aria-label="Paginación">
                  <span>{{ p.total }} caso(s)</span>
                  <div>
                    <button type="button" class="sg-btn sg-btn--small sg-btn--ghost" [disabled]="p.page <= 1" (click)="goto(p.page - 1)">← Anterior</button>
                    <span aria-live="polite">Página {{ p.page }} de {{ pageCount(p.total, p.pageSize) }}</span>
                    <button type="button" class="sg-btn sg-btn--small sg-btn--ghost" [disabled]="p.page >= pageCount(p.total, p.pageSize)" (click)="goto(p.page + 1)">Siguiente →</button>
                  </div>
                </nav>
              }
            </section>
          }
          @case ('quality') {
            @if (svc.quality(); as q) {
              <section class="sg-panel">
                <h3>Calidad de datos del periodo</h3>
                <dl class="sg-kv">
                  @for (entry of qualityEntries(); track entry[0]) { <div><dt>{{ entry[0] }}</dt><dd>{{ entry[1] }}%</dd></div> }
                  <div><dt>Sub-Support sin padre</dt><dd>{{ q.orphanSubSupport }}</dd></div>
                  <div><dt>Unidades con campos heredados</dt><dd>{{ q.inheritedFieldUnits }}</dd></div>
                </dl>
              </section>
            }
          }
          @case ('history') { <sg-ops-history (open)="openId($event)" /> }
        }
      }
    } @else if (!svc.error()) {
      <div class="sg-state"><h3>Aún no hay análisis</h3><p>Seleccione un periodo: si ya existe un análisis se mostrará para reutilizarlo; de lo contrario, prepare los datos (sin IA). Se recomienda el análisis mensual.</p></div>
    }

    }

    @if (svc.detail(); as d) {
      <div class="sg-detailpage" [attr.aria-label]="'Grupo ' + d.cluster.title" (keydown.escape)="svc.closeCluster()">
        <nav class="sg-crumbs" aria-label="Ruta">
          <button type="button" class="sg-btn sg-btn--ghost" (click)="svc.closeCluster()">← Volver al análisis</button>
          <span class="sg-muted">Support Intelligence / Grupos / {{ d.cluster.title }}</span>
        </nav>
        <header class="sg-drawer__head">
          <div><span class="sg-key">{{ d.cluster.cases }} caso(s) · {{ trend(d.cluster.trend) }}</span><h1>{{ d.cluster.title }}</h1></div>
        </header>
        <nav class="sg-tabs" role="tablist" aria-label="Detalle del grupo">
          @for (t of dtabs; track t.id) {
            <button type="button" role="tab" [class.is-active]="dtab() === t.id" [attr.aria-selected]="dtab() === t.id" (click)="dtab.set(t.id)">{{ t.label }}</button>
          }
        </nav>
        <div class="sg-drawer__body">
          @if (dtab() === 'overview') {
          @if (d.cluster.description) { <p>{{ d.cluster.description }}</p> }
          @if (d.cluster.lowConfidence) { <p class="sg-banner sg-banner--warn">Grupo de baja confianza: solo se reporta como patrón observado.</p> }
          @if (d.deep?.partial) { <p class="sg-banner sg-banner--warn">Análisis parcial: algún rol o la validación no se completó. Lo completado se conserva.</p> }
          <section>
            <h3>Resumen</h3>
            <dl class="sg-kv">
              <div><dt>Servicio</dt><dd>{{ d.cluster.service || '—' }}</dd></div>
              <div><dt>Equipo</dt><dd>{{ d.cluster.team || '—' }}</dd></div>
              <div><dt>Abiertos / cerrados</dt><dd>{{ d.cluster.open }} / {{ d.cluster.closed }}</dd></div>
              <div><dt>Reabiertos</dt><dd>{{ d.cluster.reopened }}</dd></div>
              <div><dt>Horas registradas</dt><dd>{{ d.cluster.totalHours }}</dd></div>
              <div><dt>Periodo previo</dt><dd>{{ d.cluster.previousCount ?? '—' }}</dd></div>
            </dl>
          </section>
          <section>
            <h3>Evolución</h3>
            <div class="sg-spark" aria-hidden="true">
              @for (t of d.timeline; track t.bucket) { <span [style.height.%]="barHeight(t.count, d.timeline)" [title]="t.bucket + ': ' + t.count"></span> }
            </div>
          </section>
          @if (d.deep; as deep) {
            <section>
              <h3>Alcance del análisis</h3>
              <p class="sg-muted">{{ deep.evidence.casesRepresented }} de {{ deep.evidence.totalCases }} caso(s) representados en la evidencia@if (deep.evidence.sampled) { (muestra estratificada) }.</p>
              @if (deep.limitations.length) { <ul class="sg-list sg-list--warn">@for (l of deep.limitations; track l) { <li>{{ l }}</li> }</ul> }
              @if (deep.dataQuality.length) { <h4>Calidad de datos</h4><ul class="sg-list">@for (q of deep.dataQuality; track q.code) { <li>{{ q.message }} ({{ q.cases }})</li> }</ul> }
            </section>
          }
          }
          @if (dtab() === 'modes') {
          <section>
            <h3>Modos de falla</h3>
            <ul class="sg-list">
              @for (g of d.failureGroups; track g.id) { <li><strong>{{ g.label }}</strong> · {{ g.cases }} caso(s) ({{ g.percentage }}%)@if (g.signals.length) { — {{ g.signals.join(', ') }} }</li> }
            </ul>
            @if (d.deep; as deep) {
              @if (deep.segmentation.outliers.length) { <h4>Casos atípicos (no forzados a un grupo)</h4><p class="sg-muted">{{ deep.segmentation.outliers.join(', ') }}</p> }
              @if (deep.segmentation.reclassifications.length) { <h4>Posible reclasificación</h4><p class="sg-muted">{{ deep.segmentation.reclassifications.length }} caso(s) de otro servicio quedaron fuera del análisis de este grupo.</p> }
            }
          </section>
          }
          @if (dtab() === 'evidence') {
          <section>
            <h3>Evidencia</h3>
            @if (d.evidence.length === 0) { <p class="sg-muted">Sin evidencia: el grupo no fue analizado en profundidad.</p> }
            <ul class="sg-list">@for (e of d.evidence; track e.id) { <li><span class="sg-key">{{ e.jiraKey }}</span> · {{ e.field }}: “{{ e.snippet }}”</li> }</ul>
          </section>
          }
          @if (dtab() === 'findings') {
          <section>
            <h3>Hallazgos validados</h3>
            @if (!d.deep || d.deep.findings.length === 0) { <p class="sg-muted">Sin hallazgos validados con evidencia verificada.</p> }
            @if (d.deep; as deep) {
              <p class="sg-muted">Afirmaciones: {{ deep.counts.raw }} propuestas · {{ deep.counts.verified }} con cita verificada · {{ deep.counts.rejected }} rechazadas.</p>
              @for (f of deep.findings; track f.id) {
                <article class="sg-candidate">
                  <header><span class="sg-chip">{{ level(f.level) }}</span><span class="sg-muted">Confianza {{ pct(f.confidence) }}% · {{ f.roles.join(', ') }}</span></header>
                  <p>{{ f.statement }}</p>
                  @if (f.status === 'CONFLICTING_EVIDENCE') { <p class="sg-banner sg-banner--warn">Evidencia contradictoria entre roles.</p> }
                  <ul class="sg-list">@for (e of f.evidence; track $index) { <li><span class="sg-key">{{ e.jiraKey }}</span> · {{ e.field }}: “{{ e.excerpt }}”</li> }</ul>
                  @if (f.limitations.length) { <ul class="sg-list sg-list--warn">@for (l of f.limitations; track l) { <li>{{ l }}</li> }</ul> }
                </article>
              }
            }
          </section>
          }
          @if (dtab() === 'rca') {
          <section>
            <h3>Candidatos a causa raíz</h3>
            @if (d.candidates.length === 0) { <p class="sg-muted">Sin candidatos: la evidencia no alcanzó para proponer una causa.</p> }
            @for (c of d.candidates; track c.id) {
              <article class="sg-candidate">
                <header><span class="sg-chip">{{ level(c.level) }}</span><span class="sg-muted">Confianza {{ pct(c.confidence) }}%</span></header>
                @if (c.status === 'INSUFFICIENT_EVIDENCE_FOR_RCA') { <p class="sg-banner sg-banner--warn">Evidencia insuficiente para proponer una causa raíz.</p> }
                @if (c.status === 'CONFLICTING_EVIDENCE') { <p class="sg-banner sg-banner--warn">Evidencia contradictoria: requiere revisión humana.</p> }
                <p>{{ c.description }}</p>
                <p class="sg-muted">{{ c.businessImpact }}</p>
                @if (c.evidence.length) {
                  <h4>Evidencia citada</h4>
                  <ul class="sg-list">@for (e of c.evidence; track $index) { <li><span class="sg-key">{{ e.jiraKey }}</span> · {{ e.field }}: “{{ e.excerpt }}”</li> }</ul>
                }
                @if (c.limitations.length) { <h4>Limitaciones</h4><ul class="sg-list sg-list--warn">@for (l of c.limitations; track l) { <li>{{ l }}</li> }</ul> }
              </article>
            }
          </section>
          }
          @if (dtab() === 'recommendations') {
          <section>
            <h3>Recomendaciones</h3>
            @if (!d.deep || d.deep.recommendations.length === 0) { <p class="sg-muted">Sin recomendaciones respaldadas por hallazgos.</p> }
            @if (d.deep; as deep) {
              <ul class="sg-list">@for (r of deep.recommendations; track r.action) { <li><strong>{{ r.action }}</strong>@if (r.priority) { · {{ r.priority }} }@if (r.owner) { · {{ r.owner }} }<br /><span class="sg-muted">{{ r.rationale }}</span></li> }</ul>
            }
          </section>
          }
          @if (dtab() === 'cases') {
          <section>
            <h3>Casos del grupo</h3>
            <ul class="sg-list">@for (c of d.cases; track c.key) { <li><span class="sg-key">{{ c.key }}</span> {{ c.summary }}</li> }</ul>
          </section>
          }
          @if (dtab() === 'roles') {
          <section>
            <h3>Actividad de especialistas</h3>
            @if (!d.deep) { <p class="sg-muted">Este grupo no se analizó en profundidad.</p> }
            @if (d.deep; as deep) {
              <ul class="sg-list">
                @for (r of deep.roleRuns; track r.role) {
                  <li><strong>{{ r.role }}</strong> <span class="sg-chip" [class.sg-chip--ok]="r.status === 'COMPLETED' || r.status === 'REUSED'" [class.sg-chip--warn]="r.status === 'FAILED'">{{ roleStatus(r.status) }}</span>@if (r.status !== 'REUSED' && r.status !== 'SKIPPED') { <span class="sg-muted"> · {{ (r.durationMs / 1000).toFixed(1) }} s</span> }<br /><span class="sg-muted">{{ r.verifiedClaims }}/{{ r.rawClaims }} afirmaciones verificadas@if (r.reason) { · {{ r.reason }} }</span></li>
                }
              </ul>
              <p class="sg-muted">Validación: {{ roleStatus(deep.validation.status) }} · {{ deep.validation.model }}</p>
            }
          </section>
          }
        </div>
      </div>
    }
  `,
  styles: `
    .sg-intel-period { border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; background: var(--surface); }
    .sg-intel-period__head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .sg-intel-period__head > div { display: flex; gap: 10px; align-items: baseline; }
    .sg-intel-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
    .sg-intel-title { display: flex; align-items: baseline; gap: 12px; margin: 4px 0 12px; flex-wrap: wrap; }
    .sg-intel-title h2 { margin: 0; }
    .sg-objectives { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin: 12px 0; }
    .sg-objective { text-align: left; border: 1px solid var(--line); background: var(--surface); border-radius: 12px; padding: 12px 14px; cursor: pointer; display: flex; flex-direction: column; gap: 6px; font: inherit; color: inherit; }
    .sg-objective span { color: var(--ink-muted); font-size: .85rem; }
    .sg-objective.is-active { border-color: var(--brand); box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 25%, transparent); }
    .sg-estimate { border: 1px dashed var(--line); border-radius: 12px; padding: 12px 14px; margin: 12px 0; }
    .sg-inline { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
    .sg-groups-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 10px 0; }
    .sg-groups-search { flex: 1 1 220px; min-width: 0; padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; font: inherit; background: var(--surface); }
    .sg-groups-count { color: var(--ink-muted); font-size: .9rem; margin-left: auto; }
    .sg-groups-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; }
    .sg-groups { width: 100%; border-collapse: collapse; table-layout: fixed; min-width: 640px; }
    .sg-groups th { text-align: left; font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-muted); padding: 10px 12px; background: var(--surface-alt, #f6f7f9); white-space: nowrap; }
    .sg-groups td { padding: 10px 12px; border-top: 1px solid var(--line); vertical-align: middle; }
    .sg-groups tbody tr { cursor: pointer; }
    .sg-groups tbody tr:hover, .sg-groups tbody tr.is-selected { background: color-mix(in srgb, var(--brand) 7%, transparent); }
    .sg-groups small { display: block; color: var(--ink-muted); font-size: .78rem; margin-top: 2px; }
    .sg-groups .sg-groups__check { width: 48px; text-align: center; }
    .sg-groups input[type="checkbox"] { width: 20px; height: 20px; margin: 0; cursor: pointer; accent-color: var(--brand); }
    .sg-groups__title a { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .sg-groups__service { width: 18%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sg-groups .sg-groups__num { width: 84px; }
    .sg-groups .sg-groups__trend { width: 120px; }
    .sg-groups .sg-groups__ai { width: 110px; }
    .sg-groups__empty { text-align: center; color: var(--ink-muted); padding: 24px; }
    .sg-activity-title { margin: 14px 0 6px; }
    .sg-activity { list-style: none; margin: 8px 0 0; padding: 0; max-height: 280px; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
    .sg-activity li { display: flex; gap: 10px; align-items: baseline; font-size: .85rem; }
    .sg-activity li.is-warn .sg-activity__msg { color: #8a5a00; }
    .sg-activity time { color: var(--ink-muted); font-variant-numeric: tabular-nums; flex: none; }
    .sg-activity .sg-chip { flex: none; }
    .sg-activity__msg { overflow-wrap: anywhere; }
    .sg-activity-box { margin-top: 12px; }
    .sg-activity-box summary { cursor: pointer; font-weight: 600; }
    .sg-chip--ok { background: #e6f4ea; color: #1e6b34; }
    .sg-chip--warn { background: #fff4e0; color: #8a5a00; }
    .sg-intel-launch { display: flex; flex-direction: column; gap: 14px; margin-bottom: 20px; }
    .sg-intel-periods { display: flex; gap: 6px; flex-wrap: wrap; }
    .sg-intel-periods button { border: 1px solid var(--line); background: var(--surface); padding: 8px 14px; border-radius: 999px; cursor: pointer; font-weight: 600; color: var(--ink-muted); }
    .sg-intel-periods button.is-active { background: var(--brand); color: #fff; border-color: var(--brand); }
    .sg-intel-dates { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .sg-intel-dates label { display: flex; gap: 6px; align-items: center; font-size: .85rem; color: var(--ink-muted); }
    .sg-progress { height: 8px; border-radius: 999px; background: var(--line); overflow: hidden; margin: 10px 0; }
    .sg-progress span { display: block; height: 100%; background: var(--brand); border-radius: 999px; transition: width .4s; }
    .sg-spark { display: flex; align-items: flex-end; gap: 3px; height: 56px; }
    .sg-spark span { flex: 1; min-height: 3px; background: var(--brand); border-radius: 3px 3px 0 0; opacity: .85; }
    .sg-candidate { border: 1px solid var(--line); border-radius: 12px; padding: 14px; margin-bottom: 12px; }
    .sg-candidate header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .sg-tabs { display: flex; flex: none; gap: 2px; padding: 0 16px; border-bottom: 1px solid var(--line); overflow-x: auto; scrollbar-width: none; }
    .sg-tabs::-webkit-scrollbar { display: none; }
    .sg-tabs button { flex: none; border: 0; background: none; padding: 12px 12px; line-height: 1.2; cursor: pointer; font: inherit; font-size: .9rem; color: var(--ink-muted); border-bottom: 2px solid transparent; white-space: nowrap; }
    .sg-detailpage { display: flex; flex-direction: column; gap: 16px; max-width: 1100px; margin: 0 auto; }
    .sg-crumbs { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: .85rem; }
    .sg-detailpage .sg-drawer__head { padding: 4px 0 12px; border-bottom: 1px solid var(--line); }
    .sg-detailpage .sg-drawer__head h1 { margin: 4px 0 0; font-size: 1.5rem; overflow-wrap: anywhere; }
    .sg-detailpage .sg-tabs { padding: 0; }
    .sg-detailpage .sg-drawer__body { overflow: visible; padding: 4px 0 24px; }
    .sg-drawer__body > * { flex: none; }
    .sg-btn--danger { color: #9b1c1c; border-color: #efc2c2; background: #fff; }
    .sg-btn--danger:hover:not(:disabled) { background: #fdecec; }
    .sg-intel-title__action { margin-left: auto; }
    .sg-roles { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 12px; margin-top: 12px; }
    .sg-role-card { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .sg-role-card header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .sg-role-card__cause { display: flex; flex-direction: column; gap: 2px; background: var(--surface-muted, #f4f7fb); border-radius: 8px; padding: 8px 10px; }
    .sg-role-card__counts { display: flex; gap: 12px; margin: 0; font-size: .82rem; color: var(--ink-muted); }
    .sg-role-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; margin: 0; }
    .sg-role-stats > div { padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-alt, #f8f9fb); }
    .sg-role-stats dt { font-size: .68rem; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-muted); }
    .sg-role-stats dd { margin: 2px 0 0; font-weight: 600; font-size: .85rem; overflow-wrap: anywhere; }
    .sg-role-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .sg-role-summary { font-style: italic; }
    .sg-roles--live .sg-role-card.is-running { border-color: var(--brand, #0a64c8); box-shadow: 0 0 0 2px rgba(10,100,200,.12); }
    .sg-spin { display: inline-block; width: 9px; height: 9px; margin-right: 5px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: sg-spin .8s linear infinite; }
    @keyframes sg-spin { to { transform: rotate(360deg); } }
    .sg-role-card header a { font-weight: 600; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sg-role-card ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .sg-role-card li { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: center; font-size: .86rem; }
    .sg-role-card li small { grid-column: 1 / -1; color: var(--ink-muted); }
    .sg-role-card footer { font-size: .8rem; color: var(--ink-muted); border-top: 1px dashed var(--line); padding-top: 8px; }
    .sg-drawer__head { flex: none; }
    .sg-drawer__body { flex: 1 1 auto; min-height: 0; overscroll-behavior: contain; }
    .sg-drawer__body .sg-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .sg-drawer__body .sg-list li { padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-alt, #f8f9fb); font-size: .88rem; line-height: 1.45; overflow-wrap: anywhere; }
    .sg-drawer__body .sg-list--warn li { border-color: #f0d9a8; background: #fff9ec; color: #6f4a00; }
    .sg-drawer__body .sg-candidate { background: var(--surface); }
    .sg-drawer__body .sg-candidate > p { margin: 0 0 10px; line-height: 1.5; }
    .sg-drawer__body .sg-candidate header { flex-wrap: wrap; gap: 8px; }
    .sg-drawer__body .sg-kv { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0; }
    .sg-drawer__body .sg-kv > div { padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; }
    .sg-drawer__body .sg-kv dt { font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-muted); }
    .sg-drawer__body .sg-kv dd { margin: 2px 0 0; font-weight: 600; overflow-wrap: anywhere; }
    @media (max-width: 640px) {
      .sg-drawer { width: 100%; border-radius: 0; }
      .sg-drawer__head { padding: 14px 16px; }
      .sg-drawer__body { padding: 16px; gap: 18px; }
      .sg-drawer__body .sg-kv { grid-template-columns: 1fr; }
    }
    .sg-tabs button.is-active { color: var(--brand); border-bottom-color: var(--brand); font-weight: 600; }
  `,
})
export class IntelligenceViewComponent {
  protected readonly svc = inject(IntelligenceService);
  protected readonly types: PeriodType[] = ["MONTHLY", "BIWEEKLY", "WEEKLY", "DAILY", "CUSTOM"];
  protected readonly labels = PERIOD_LABELS;
  protected readonly statuses = STATUS;
  protected readonly eligibilityLabels = ELIGIBILITY;
  protected readonly eligibilityKeys = Object.keys(ELIGIBILITY);
  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: "dashboard", label: "Panel operativo" },
    { id: "analysis", label: "Pre-análisis" },
    { id: "summary", label: "Resumen" },
    { id: "clusters", label: "Grupos" },
    { id: "cases", label: "Casos" },
    { id: "quality", label: "Calidad de datos" },
    { id: "history", label: "Historial" },
  ];

  protected readonly type = signal<PeriodType>("MONTHLY");
  protected readonly month = signal<string>("");
  protected readonly from = signal<string>("");
  protected readonly to = signal<string>("");
  protected readonly tab = signal<Tab>("analysis");
  protected readonly audience = signal<Audience>("analyst");
  protected readonly visibleTabs = computed(() => (this.audience() === "executive" ? this.tabs.filter((t) => t.id === "dashboard" || t.id === "summary" || t.id === "history") : this.tabs));
  protected readonly reuseLabels = REUSE_LABELS;
  protected readonly modes = MODES;
  protected readonly modeKeys = (Object.keys(MODES) as AnalysisMode[]).filter((mode) => mode !== "SELECTED_RCA" && mode !== "FULL_RCA");
  protected readonly forceAi = signal(false);
  protected roleName = (role: string) => ({ FAILURE: "Modos de falla", FUNCTIONAL: "Funcional", TECHNICAL: "Técnico", INFRA: "Infraestructura", VALIDATOR: "Validador independiente" })[role] ?? role;
  protected modeTitle = (mode: string) => mode === "SELECTED_RCA" ? "Grupos marcados en la tabla" : this.modes[mode as keyof typeof this.modes]?.title ?? mode;
  protected roleHint = (role: string) => ({ FAILURE: "Describe el patrón de falla de los casos.", FUNCTIONAL: "Analiza reglas, datos y procesos de negocio.", TECHNICAL: "Analiza mensajes de error y firmas técnicas.", INFRA: "Analiza disponibilidad, red y capacidad.", VALIDATOR: "Comprueba cada afirmación contra la evidencia citada." })[role] ?? "";
  protected boardState = (value: string) => ({ QUEUED: "En cola", RUNNING: "En curso", DONE: "Listo", REUSED: "Reutilizado", FAILED: "Falló", PARTIAL: "Parcial" })[value] ?? value;
  protected goResults(): void {
    document.getElementById("sg-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  protected async openDetail(clusterId: string, tab: string): Promise<void> {
    await this.svc.openCluster(clusterId);
    this.dtab.set(tab);
  }

  private clusterTitle(id: string): string {
    return this.svc.pre()?.groups.find((g) => g.id === id)?.title ?? this.svc.roles().find((g) => g.clusterId === id)?.title ?? id;
  }

  private humanize(message: string): string {
    return message
      .replace(/cl_[0-9a-f]+/g, (id) => this.clusterTitle(id))
      .replace(/\b(FAILURE|FUNCTIONAL|TECHNICAL|INFRA|VALIDATOR)\b/g, (role) => this.roleName(role));
  }

  protected readonly board = computed(() => {
    type RoleState = { role: string; state: string; detail: string; startedAt?: string };
    type GroupState = { id: string; title: string; state: string; segmentation: string; roles: RoleState[] };
    const groups = new Map<string, GroupState>();
    const ensure = (id: string): GroupState => {
      let group = groups.get(id);
      if (!group) { group = { id, title: this.clusterTitle(id), state: "QUEUED", segmentation: "", roles: [] }; groups.set(id, group); }
      return group;
    };
    for (const id of this.svc.run()?.analysis?.requestedClusters ?? this.svc.estimate()?.selected.map((s) => s.id) ?? []) ensure(id);
    const events = this.svc.events();
    const startAt = events.map((e) => e.phase).lastIndexOf("ANALYZING");
    for (const e of startAt >= 0 ? events.slice(startAt) : events) {
      const match = /^(cl_[0-9a-f]+)(.*)$/.exec(e.message);
      if (!match) continue;
      const group = ensure(match[1]);
      const rest = match[2];
      if (e.phase === "AI_ANALYSIS_STARTED") group.state = "RUNNING";
      else if (e.phase === "AI_ANALYSIS_REUSED") group.state = "REUSED";
      else if (e.phase === "AI_ANALYSIS_COMPLETED") group.state = "DONE";
      else if (e.phase === "AI_ANALYSIS_PARTIAL") group.state = "PARTIAL";
      else if (e.phase === "AI_ANALYSIS_FAILED") group.state = "FAILED";
      else if (e.phase === "SEGMENTATION") group.segmentation = rest.replace(/^:\s*/, "");
      else if (e.phase.startsWith("AI_ROLE_")) {
        const parsed = /^:\s*([A-Z_]+)(?:\s*\(([^)]+)\)|:\s*(.*))?$/.exec(rest);
        if (!parsed) continue;
        let role = group.roles.find((r) => r.role === parsed[1]);
        if (!role) { role = { role: parsed[1], state: "RUNNING", detail: "" }; group.roles.push(role); }
        if (e.phase === "AI_ROLE_STARTED") { role.state = "RUNNING"; role.startedAt = e.ts; role.detail = `Modelo ${parsed[2] ?? ""}`.trim(); }
        else if (e.phase === "AI_ROLE_REUSED") { role.state = "REUSED"; role.detail = "Resultado existente reutilizado"; }
        else if (e.phase === "AI_ROLE_COMPLETED") { role.state = "DONE"; role.detail = parsed[3] ?? ""; }
        else if (e.phase === "AI_ROLE_FAILED") { role.state = "FAILED"; role.detail = parsed[3] ?? "No se completó"; }
      }
    }
    return [...groups.values()];
  });
  protected roleDone = (g: RoleActivityGroup) => g.roles.filter((r) => r.role !== "VALIDATOR" && (r.status === "COMPLETED" || r.status === "REUSED")).length;
  protected claimsText = (g: RoleActivityGroup) => {
    const rs = g.roles.filter((r) => r.role !== "VALIDATOR");
    return `${rs.reduce((a, r) => a + r.verifiedClaims, 0)} de ${rs.reduce((a, r) => a + r.rawClaims, 0)}`;
  };
  protected validationText = (v: Record<string, number>) => Object.entries(v).map(([verdict, n]) => `${n} ${({ SUPPORTED: "respaldadas", PARTIALLY_SUPPORTED: "parciales", UNSUPPORTED: "sin respaldo", CONTRADICTED: "contradichas" })[verdict] ?? verdict.toLowerCase()}`).join(" · ");

  protected async discard(): Promise<boolean> {
    if (!window.confirm("¿Descartar este recorrido? Los datos se conservan en el almacén; podrás prepararlo de nuevo desde cero.")) return false;
    if (!(await this.svc.discard())) return false;
    this.preparedFor = "";
    this.syncedKey = "";
    await this.refreshPreview();
    return true;
  }
  protected readonly depthLabels = DEPTHS;
  protected readonly workloadLabels = WORKLOADS;
  protected readonly objective = signal<AnalysisMode>("TOP_RCA");
  protected readonly selectedIds = signal<string[]>([]);
  protected readonly includeLow = signal(false);
  protected readonly allSelected = computed(() => {
    const groups = this.svc.pre()?.groups ?? [];
    return groups.length > 0 && groups.every((group) => this.selectedIds().includes(group.id));
  });
  private syncedKey = "";
  private preparedFor = "";
  protected readonly search = signal("");
  protected readonly eligibility = signal("");
  protected readonly clusterFilter = signal("");
  protected readonly qualityEntries = computed(() => Object.entries(this.svc.quality()?.completeness ?? {}));

  constructor() {
    void this.svc.initialize().then(() => this.refreshPreview());

    // The selector always mirrors the loaded run, so the title can never show a different period than the one analyzed.
    effect(() => {
      const run = this.svc.run();
      if (!run) return;
      untracked(() => {
        const key = `${run.id}|${run.periodType}|${run.from}|${run.to}`;
        if (key === this.syncedKey) return;
        this.syncedKey = key;
        this.type.set(run.periodType);
        if (run.periodType === "MONTHLY") this.month.set(run.from.slice(0, 7));
        if (run.periodType === "CUSTOM") {
          this.from.set(run.from);
          this.to.set(run.to);
        }
        this.tab.set("analysis");
        void this.refreshPreview();
      });
    });

    effect(() => {
      const pre = this.svc.pre();
      if (!pre) return;
      untracked(() => {
        if (pre.run.id === this.preparedFor) return;
        this.preparedFor = pre.run.id;
        this.objective.set(pre.recommended.mode);
        this.selectedIds.set(pre.recommended.clusterIds);
        this.includeLow.set(false);
        this.forceAi.set(false);
        void this.estimate();
      });
    });
  }

  protected when(value: string | null | undefined): string {
    return value ? new Date(value).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "—";
  }

  protected check(): void {
    void this.svc.check(this.selection());
  }

  protected request(): ObjectiveRequest {
    const mode = this.objective();
    return { mode, clusterIds: mode === "SELECTED_RCA" ? this.selectedIds() : undefined, includeLowConfidence: mode === "FULL_RCA" ? this.includeLow() : undefined, forceAi: this.forceAi() || undefined };
  }

  protected estimate(): Promise<void> {
    if (this.objective() === "SELECTED_RCA" && this.selectedIds().length === 0) {
      this.svc.estimate.set(null);
      return Promise.resolve();
    }
    return this.svc.estimateObjective(this.request());
  }

  protected choose(mode: AnalysisMode): void {
    this.objective.set(mode);
    if (mode === "SELECTED_RCA" && this.selectedIds().length === 0) this.selectedIds.set(this.svc.pre()?.recommended.clusterIds ?? []);
    void this.estimate();
  }

  protected readonly groupQuery = signal("");
  protected readonly groupPage = signal(0);
  protected readonly selectedCount = computed(() => (this.objective() === "SELECTED_RCA" ? this.selectedIds().length : (this.svc.estimate()?.selected.length ?? 0)));
  private readonly filteredGroups = computed(() => {
    const query = this.groupQuery().trim().toLowerCase();
    const groups = this.svc.pre()?.groups ?? [];
    return query ? groups.filter((group) => `${group.title} ${group.service} ${group.team}`.toLowerCase().includes(query)) : groups;
  });
  protected readonly groupPages = computed(() => Math.max(1, Math.ceil(this.filteredGroups().length / GROUP_PAGE_SIZE)));
  protected readonly pageGroups = computed(() => {
    const page = Math.min(this.groupPage(), this.groupPages() - 1);
    return this.filteredGroups().slice(page * GROUP_PAGE_SIZE, (page + 1) * GROUP_PAGE_SIZE);
  });
  protected readonly pageSelected = computed(() => this.pageGroups().length > 0 && this.pageGroups().every((group) => this.selectedIds().includes(group.id)));
  protected readonly serviceVaries = computed(() => new Set((this.svc.pre()?.groups ?? []).map((group) => group.service)).size > 1);
  protected readonly groupRange = computed(() => {
    const total = this.filteredGroups().length;
    const start = Math.min(this.groupPage(), this.groupPages() - 1) * GROUP_PAGE_SIZE;
    return total ? `${start + 1}–${Math.min(total, start + GROUP_PAGE_SIZE)} de ${total} grupos` : "0 grupos";
  });
  protected readonly manyGroups = computed(() => this.selectedCount() > MANY_GROUPS && this.objective() !== "SUMMARY" && this.objective() !== "RECURRENCE");
  protected readonly manyThreshold = MANY_GROUPS;

  protected setGroupQuery(value: string): void {
    this.groupQuery.set(value);
    this.groupPage.set(0);
  }

  protected isChecked(id: string): boolean {
    return this.currentSelection().includes(id);
  }

  protected toggle(id: string): void {
    const current = this.currentSelection();
    this.pickGroups(current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  protected togglePage(checked: boolean): void {
    const page = this.pageGroups().map((group) => group.id);
    const rest = this.currentSelection().filter((id) => !page.includes(id));
    this.pickGroups(checked ? [...rest, ...page] : rest);
  }

  protected selectRecommended(): void {
    this.pickGroups(this.svc.pre()?.recommended.clusterIds ?? []);
  }

  protected clearSelection(): void {
    this.pickGroups([]);
  }

  private currentSelection(): string[] {
    return this.objective() === "SELECTED_RCA" ? this.selectedIds() : (this.svc.estimate()?.selected.map((item) => item.id) ?? []);
  }

  // Marking groups always means "analyze exactly these", so the objective follows the selection.
  private pickGroups(ids: string[]): void {
    this.selectedIds.set(ids);
    this.objective.set("SELECTED_RCA");
    void this.estimate();
  }

  protected canConfirm(): boolean {
    return this.objective() !== "SELECTED_RCA" || this.selectedIds().length > 0;
  }

  protected confirmLabel(): string {
    return this.objective() === "SUMMARY" ? "Confirmar y generar resumen" : "Confirmar y ejecutar análisis";
  }

  protected async confirm(): Promise<void> {
    await this.svc.execute(this.request());
    await this.estimate();
  }

  private selection(): PeriodSelection {
    return { type: this.type(), month: this.type() === "MONTHLY" ? this.month() || undefined : undefined, from: this.type() === "CUSTOM" ? this.from() : undefined, to: this.type() === "CUSTOM" ? this.to() : undefined };
  }

  protected setType(type: PeriodType): void {
    this.type.set(type);
    void this.refreshPreview();
  }

  protected refreshPreview(): Promise<void> {
    if (this.type() === "CUSTOM" && (!this.from() || !this.to())) return Promise.resolve();
    return this.svc.previewPeriod(this.selection());
  }

  protected start(refresh: boolean): void {
    void this.svc.start(this.selection(), refresh);
  }

  protected open(run: AnalysisRun): void {
    this.openId(run.id);
  }

  protected openId(id: string): void {
    this.tab.set("dashboard");
    void this.svc.select(id);
  }

  protected setAudience(value: Audience): void {
    this.audience.set(value);
    if (!this.visibleTabs().some((t) => t.id === this.tab())) this.tab.set("dashboard");
  }

  protected applyFilters(): void {
    void this.svc.loadCases({ page: 1, search: this.search(), eligibility: this.eligibility(), clusterId: this.clusterFilter() });
  }

  protected goto(page: number): void {
    void this.svc.loadCases({ page, search: this.search(), eligibility: this.eligibility(), clusterId: this.clusterFilter() });
  }

  protected pageCount(total: number, size: number): number {
    return Math.max(1, Math.ceil(total / size));
  }

  protected readonly activity = computed(() => this.svc.events().filter((e) => e.phase.startsWith("AI_") || e.phase === "SEGMENTATION").slice(-40).reverse().map((e) => ({ ...e, message: this.humanize(e.message) })));
  protected time = (ts: string) => new Date(ts).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  protected eventLabel = (phase: string) => ({ AI_ANALYSIS_STARTED: "Grupo iniciado", AI_ANALYSIS_REUSED: "Reutilizado", AI_ANALYSIS_COMPLETED: "Grupo listo", AI_ANALYSIS_PARTIAL: "Parcial", AI_ANALYSIS_FAILED: "Falló", AI_ROLE_STARTED: "Especialista", AI_ROLE_REUSED: "Especialista (reuso)", AI_ROLE_COMPLETED: "Especialista listo", AI_ROLE_FAILED: "Especialista falló", SEGMENTATION: "Segmentación" })[phase] ?? phase;
  protected trend = (value: string) => TREND[value] ?? value;
  protected level = (value: string) => LEVEL[value] ?? value;
  protected readonly dtab = signal("overview");
  protected readonly dtabs = [
    { id: "overview", label: "Resumen" }, { id: "modes", label: "Modos de falla" }, { id: "evidence", label: "Evidencia" },
    { id: "findings", label: "Hallazgos" }, { id: "rca", label: "Causa raíz" }, { id: "recommendations", label: "Recomendaciones" },
    { id: "cases", label: "Casos" }, { id: "roles", label: "Especialistas" },
  ];
  protected roleStatus = (value: string) => ({ COMPLETED: "Completado", REUSED: "Reutilizado", FAILED: "Falló", SKIPPED: "Omitido", RUNNING: "En curso", QUEUED: "En cola" })[value] ?? value;
  protected pct = (value: number) => Math.round(value * 100);
  protected aiStatus = (value: string) => ({ COMPLETED: "Analizado", FAILED: "Falló", AI_DISABLED: "Deshabilitada", NOT_ANALYZED: "No analizado", PENDING: "Pendiente" })[value] ?? value;
  protected barHeight(count: number, series: { count: number }[]): number {
    return Math.max(8, Math.round((count / Math.max(...series.map((item) => item.count), 1)) * 100));
  }
}
