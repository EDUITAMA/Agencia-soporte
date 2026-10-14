import { HttpClient } from "@angular/common/http";
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from "@angular/core";
import { firstValueFrom } from "rxjs";

import { IntelligenceService } from "./intelligence.service";

const BASE = "/api/support-guard/intelligence";

interface Kpi { key: string; label: string; unit: string; value: number; previous: number | null; change: number | null; changePct: number | null; direction: string | null; tone: string | null; note?: string }
interface Insight { id: string; type: string; statement: string; severity: string; clusterId?: string; evidence: string[] }
interface Problem {
  rank: number; clusterId: string; title: string; cases: number; previousCount: number | null; open: number; reopened: number; service: string; lowConfidence: boolean; analysisStatus: string; rcaLevel: string | null;
  trend: { trend: string; limitedHistory: boolean; changePct: number | null; historyAvailable: number };
  priority: { score: number; badge: string; reasons: string[]; criticalRule?: string; components: { key: string; label: string; weight: number; points: number }[] };
  series: { from: string; to: string; count: number }[];
}
interface Finding { id: string; clusterId: string; cluster: string; statement: string; level: string; confidence: number; limitations: string[]; affectedCases: number; evidence: { jiraKey: string; field: string; excerpt: string }[] }
interface Recommendation { id: string; clusterId: string; cluster: string; type: string; action: string; rationale: string; owner: string; basis: string | null; state: string; priority: string; affectedCases: number }
interface Dash {
  run: { id: string; period: { label: string; from: string; to: string }; operationalStatus: string; mode: string | null; computedAt: string };
  kpis: Kpi[]; health: Record<string, string>; changes: Insight[];
  problems: Problem[];
  rootCause: { counts: Record<string, number>; analyzedGroups: number; findings: Finding[]; coverage: { recurringCases: number; coveredCases: number; percentage: number } };
  recommendations: Recommendation[];
  dataQuality: { level: string; score: number; previousScore: number | null; current: Record<string, number>; previous: Record<string, number> | null };
  breakdowns: { dimension: string; coverage: number; rows: Record<string, unknown>[] }[];
  aging: { buckets: { label: string; cases: number }[]; open: number; oldestHours: number | null; medianHours: number | null };
  trend: { historyAvailable: number; periods: { from: string; to: string; current: boolean; total: number; open: number; closed: number }[] };
  limitations: string[];
  ai: { calls: number; skippedByReuse: number; mode: string | null };
}
interface Report { kind: string; version: number; status: string; generatedAt: string; model: string | null; aiCalls: number; content: { narrative?: Record<string, unknown> & { headline: string; periodSummary: string; keyChanges: string[]; topRisks: string[]; recommendedFocus: string[] }; narrativeSource?: string } }

const HEALTH_LABELS: Record<string, string> = { volume: "Volumen", recurrence: "Recurrencia", resolution: "Resolución", reopened: "Reaperturas", dataQuality: "Calidad de datos", rcaConfidence: "Confianza de causas" };
const HEALTH_VALUES: Record<string, string> = { STABLE: "Estable", INCREASING: "En aumento", DECREASING: "En descenso", NO_BASELINE: "Sin base", LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", IMPROVING: "Mejorando", WORSENING: "Empeorando", NO_DATA: "Sin datos", GOOD: "Buena", DEGRADED: "Degradada", POOR: "Deficiente", NOT_ANALYZED: "Sin analizar" };
const TREND_LABELS: Record<string, string> = { NEW: "Nuevo", GROWING: "Creciendo", STABLE: "Estable", DECLINING: "En descenso", NOT_SEEN: "Sin casos", PERSISTENT: "Persistente", RECURRING: "Recurrente", INSUFFICIENT_HISTORY: "Historial insuficiente" };
const LEVEL_LABELS: Record<string, string> = { OBSERVED_PATTERN: "Patrón observado", HYPOTHESIS: "Hipótesis", LIKELY_CAUSE: "Causa probable", SUPPORTED_CAUSE: "Causa respaldada", CONFIRMED_CAUSE: "Causa confirmada" };
const TYPE_LABELS: Record<string, string> = { INVESTIGATE: "Investigar", FIX: "Corregir", MONITOR: "Monitorear", PROCESS_CHANGE: "Cambio de proceso", DATA_QUALITY: "Calidad de datos", RECLASSIFY: "Reclasificar" };
const STATE_LABELS: Record<string, string> = { PROPOSED: "Propuesta", REVIEWED: "Revisada", ACCEPTED: "Aceptada", DISMISSED: "Descartada", DONE: "Hecha" };
const OP_STATUS: Record<string, string> = { PREPARED: "Datos listos", COMPLETED: "Completado", COMPLETED_WITH_LIMITATIONS: "Completado con limitaciones", PARTIAL: "Parcial", FAILED: "Fallido" };
const BADGES: Record<string, string> = { CRITICAL: "Crítica", HIGH: "Alta", MEDIUM: "Media", LOW: "Baja" };

@Component({
  selector: "sg-ops-dashboard",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading() && !data()) { <div class="sg-state"><h3>Cargando panel operativo…</h3></div> }
    @if (error(); as e) { <p class="sg-banner sg-banner--warn" role="alert">{{ e }}</p> }
    @if (data(); as d) {
      <section class="sg-panel ops-head">
        <div>
          <span class="sg-label">Período</span>
          <h2>{{ d.run.period.label }}</h2>
          <span class="sg-muted">{{ opStatus[d.run.operationalStatus] ?? d.run.operationalStatus }} · calculado {{ d.run.computedAt.slice(0, 16).replace('T', ' ') }}</span>
        </div>
        <div class="ops-health" aria-label="Salud operativa">
          @for (h of healthEntries(); track h[0]) {
            <span class="ops-pill" [class.is-bad]="isBad(h[1])" [class.is-good]="isGood(h[1])" [title]="healthLabels[h[0]]"><small>{{ healthLabels[h[0]] }}</small>{{ healthValues[h[1]] ?? h[1] }}</span>
          }
        </div>
      </section>

      <div class="sg-kpis">
        @for (k of d.kpis; track k.key) {
          <div class="sg-kpi" [title]="k.note ?? ''">
            <span class="sg-label">{{ k.label }}</span>
            <strong>{{ k.value }}@if (k.unit === 'percent') { % }</strong>
            @if (k.previous === null) { <small class="sg-muted">Sin período anterior</small> }
            @else {
              <small class="ops-delta" [class.is-bad]="k.tone === 'BAD'" [class.is-good]="k.tone === 'GOOD'">{{ arrow(k.direction) }} {{ k.change! > 0 ? '+' : '' }}{{ k.change }}@if (k.changePct !== null) { ({{ pct(k.changePct) }}) } · antes {{ k.previous }}</small>
            }
          </div>
        }
      </div>

      @if (report(); as r) {
        <section class="sg-panel">
          <h3>Resumen ejecutivo <span class="sg-chip">{{ r.content.narrativeSource === 'AI' ? 'Redactado con IA' : 'Generado de métricas' }}</span> <small class="sg-muted">v{{ r.version }}</small></h3>
          <p><strong>{{ r.content.narrative?.headline }}</strong></p>
          <p>{{ r.content.narrative?.periodSummary }}</p>
          @if (r.content.narrative?.recommendedFocus?.length) { <h4>Dónde enfocar</h4><ul class="sg-list">@for (f of r.content.narrative!.recommendedFocus; track f) { <li>{{ f }}</li> }</ul> }
        </section>
      }
      <div class="ops-actions">
        <button type="button" class="sg-btn" [disabled]="generating()" (click)="generate(false)">{{ generating() ? 'Generando…' : report() ? 'Actualizar reportes' : 'Generar reportes' }}</button>
        @if (report()) {
          <button type="button" class="sg-btn sg-btn--ghost" [disabled]="generating()" (click)="generate(true)" title="Crea una nueva versión aunque nada haya cambiado">Nueva versión</button>
          <a class="sg-btn sg-btn--ghost" [href]="exportUrl()" target="_blank" rel="noopener">Exportar reporte (HTML / PDF)</a>
        }
      </div>

      <section class="sg-panel">
        <h3>Qué cambió</h3>
        @if (d.changes.length) {
          <ul class="ops-changes">@for (c of d.changes; track c.id) {
            <li [class]="'sev-' + c.severity.toLowerCase()">
              <span>{{ c.statement }}</span>
              @if (c.clusterId) { <button type="button" class="sg-btn sg-btn--small sg-btn--ghost" (click)="svc.openCluster(c.clusterId)">Ver grupo</button> }
            </li>
          }</ul>
        } @else { <p class="sg-muted">No se detectaron cambios relevantes frente al período anterior.</p> }
      </section>

      <section class="sg-panel">
        <h3>Principales problemas</h3>
        <div class="sg-tablewrap"><table class="sg-table">
          <thead><tr><th>#</th><th>Problema</th><th>Casos</th><th>Abiertos</th><th>Tendencia</th><th>Prioridad</th><th>Causa</th></tr></thead>
          <tbody>
            @for (p of d.problems; track p.clusterId) {
              <tr tabindex="0" (click)="toggle(p.clusterId)" (keydown.enter)="toggle(p.clusterId)">
                <td>{{ p.rank }}</td>
                <td class="sg-key">{{ p.title }}<small class="sg-sub">{{ p.service }}@if (p.lowConfidence) { · baja confianza }</small></td>
                <td>{{ p.cases }}@if (p.previousCount !== null) { <small class="sg-sub">antes {{ p.previousCount }}</small> }</td>
                <td>{{ p.open }}</td>
                <td>{{ trendLabels[p.trend.trend] ?? p.trend.trend }}@if (p.trend.limitedHistory) { <small class="sg-sub">historial limitado</small> }</td>
                <td><span class="ops-badge" [class]="'ops-badge b-' + p.priority.badge.toLowerCase()">{{ badges[p.priority.badge] }} · {{ p.priority.score }}</span></td>
                <td>{{ p.rcaLevel ? levels[p.rcaLevel] : p.analysisStatus === 'COMPLETED' ? 'Sin causa validada' : 'No analizado' }}</td>
              </tr>
              @if (expanded() === p.clusterId) {
                <tr class="ops-why"><td></td><td colspan="6">
                  <strong>Por qué esta prioridad</strong>
                  <ul class="sg-list">@for (r of p.priority.reasons; track r) { <li>{{ r }}</li> }</ul>
                  <div class="ops-components">@for (c of p.priority.components; track c.key) { <span title="peso {{ c.weight }}">{{ c.label }}: {{ c.points }}/{{ c.weight }}</span> }</div>
                  @if (p.priority.criticalRule) { <p class="sg-note">Regla crítica: {{ p.priority.criticalRule }}</p> }
                  @if (p.series.length > 1) { <div class="ops-spark" aria-label="Casos por período">@for (s of p.series; track s.from) { <span [style.height.px]="bar(s.count, p)" [title]="s.from + ': ' + s.count"></span> }</div> }
                  <button type="button" class="sg-btn sg-btn--small" (click)="svc.openCluster(p.clusterId)">Ver detalle y casos</button>
                </td></tr>
              }
            }
          </tbody></table></div>
      </section>

      <section class="sg-panel">
        <h3>Causas validadas</h3>
        <div class="ops-counts">
          <span><strong>{{ d.rootCause.counts['supported'] }}</strong> respaldadas</span>
          <span><strong>{{ d.rootCause.counts['likely'] }}</strong> probables</span>
          <span><strong>{{ d.rootCause.counts['hypotheses'] }}</strong> hipótesis</span>
          <span><strong>{{ d.rootCause.counts['insufficient'] }}</strong> evidencia insuficiente</span>
          <span><strong>{{ d.rootCause.counts['conflicting'] }}</strong> en conflicto</span>
        </div>
        <p class="sg-muted">{{ d.rootCause.analyzedGroups }} grupo(s) con análisis profundo · cubren {{ d.rootCause.coverage.coveredCases }} de {{ d.rootCause.coverage.recurringCases }} casos recurrentes ({{ d.rootCause.coverage.percentage }}%). Las causas probables no son causas confirmadas.</p>
        @if (d.rootCause.findings.length) {
          <div class="sg-tablewrap"><table class="sg-table">
            <thead><tr><th>Hallazgo</th><th>Nivel</th><th>Casos</th><th>Confianza</th><th></th></tr></thead>
            <tbody>@for (f of d.rootCause.findings.slice(0, 8); track f.id) {
              <tr>
                <td>{{ f.statement }}<small class="sg-sub">{{ f.cluster }}@if (f.evidence.length) { · evidencia: {{ evidenceKeys(f) }} }</small></td>
                <td>{{ levels[f.level] ?? f.level }}</td><td>{{ f.affectedCases }}</td><td>{{ pct(f.confidence) }}</td>
                <td><button type="button" class="sg-btn sg-btn--small sg-btn--ghost" (click)="svc.openCluster(f.clusterId)">Evidencia</button></td>
              </tr>
            }</tbody></table></div>
        }
      </section>

      <section class="sg-panel">
        <h3>Centro de recomendaciones</h3>
        @if (d.recommendations.length) {
          <div class="ops-recs">@for (r of d.recommendations; track r.clusterId + r.id) {
            <article>
              <header><span class="sg-chip">{{ typeLabels[r.type] ?? r.type }}</span> <span class="sg-muted">{{ r.cluster }} · {{ r.affectedCases }} casos</span></header>
              <p><strong>{{ r.action }}</strong></p>
              <p class="sg-muted">{{ r.rationale }}</p>
              <footer>
                <small class="sg-muted">Responsable sugerido: {{ r.owner }}@if (r.basis) { · base: {{ levels[r.basis] ?? r.basis }} }</small>
                <select [value]="r.state" [attr.aria-label]="'Estado de la recomendación'" (change)="setState(r, $any($event.target).value)">
                  @for (s of stateKeys; track s) { <option [value]="s" [selected]="s === r.state">{{ stateLabels[s] }}</option> }
                </select>
              </footer>
            </article>
          }</div>
        } @else { <p class="sg-muted">No hay recomendaciones: ejecute un análisis profundo para generarlas.</p> }
      </section>

      <div class="ops-grid">
        <section class="sg-panel">
          <h3>Calidad de datos <span class="sg-chip" [class.sg-chip--ok]="d.dataQuality.level === 'GOOD'" [class.sg-chip--warn]="d.dataQuality.level !== 'GOOD'">{{ healthValues[d.dataQuality.level] }} · {{ d.dataQuality.score }}</span></h3>
          <dl class="sg-kv">
            @for (c of coverageEntries(); track c[0]) { <div><dt>{{ c[0] }}</dt><dd>{{ c[1] }}%@if (c[2] !== null) { <small class="sg-muted"> antes {{ c[2] }}%</small> }</dd></div> }
          </dl>
        </section>
        <section class="sg-panel">
          <h3>Antigüedad de casos abiertos</h3>
          @for (b of d.aging.buckets; track b.label) {
            <div class="ops-bar"><span>{{ b.label }}</span><div><i [style.width.%]="d.aging.open ? (b.cases / d.aging.open) * 100 : 0"></i></div><strong>{{ b.cases }}</strong></div>
          }
          <p class="sg-muted">{{ d.aging.open }} abiertos@if (d.aging.medianHours !== null) { · mediana {{ d.aging.medianHours }} h }</p>
        </section>
      </div>

      @for (b of d.breakdowns; track b.dimension) {
        <section class="sg-panel">
          <h3>Por {{ b.dimension.toLowerCase() }} <small class="sg-muted">cobertura {{ b.coverage }}%</small></h3>
          <div class="sg-tablewrap"><table class="sg-table">
            <thead><tr><th>{{ b.dimension }}</th><th>Casos</th><th>Abiertos</th><th>Cerrados</th><th>% recurrente</th><th>Mediana resolución (h)</th></tr></thead>
            <tbody>@for (row of b.rows; track row['value']) {
              <tr><td>{{ row['value'] }}</td><td>{{ row['cases'] }}</td><td>{{ row['open'] }}</td><td>{{ row['closed'] }}</td><td>{{ row['recurringPercentage'] ?? '—' }}</td><td>{{ row['medianResolutionHours'] ?? '—' }}</td></tr>
            }</tbody></table></div>
        </section>
      }

      @if (d.trend.periods.length > 1) {
        <section class="sg-panel">
          <h3>Casos por período <small class="sg-muted">{{ d.trend.historyAvailable }} período(s) previo(s) con datos</small></h3>
          <div class="ops-columns">@for (p of d.trend.periods; track p.from) {
            <div [class.is-current]="p.current"><i [style.height.px]="colHeight(p.total)"></i><strong>{{ p.total }}</strong><small>{{ p.from.slice(5) }}</small></div>
          }</div>
        </section>
      }

      <section class="sg-panel">
        <h3>Limitaciones</h3>
        <ul class="sg-list sg-list--warn">@for (l of d.limitations; track l) { <li>{{ l }}</li> }</ul>
        <p class="sg-muted">IA en este análisis: {{ d.ai.calls }} llamada(s) · {{ d.ai.skippedByReuse }} evitadas por reutilización.</p>
      </section>
    }
  `,
  styles: `
    :host { display: block; }
    .ops-head { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: flex-start; }
    .ops-head h2 { margin: 2px 0; }
    .ops-health { display: flex; flex-wrap: wrap; gap: 8px; }
    .ops-pill { display: flex; flex-direction: column; padding: 6px 12px; border-radius: 10px; background: #eef1f5; font-weight: 600; font-size: 13px; }
    .ops-pill small { font-weight: 400; font-size: 11px; color: var(--ink-muted); }
    .ops-pill.is-bad { background: #fdecea; color: #8c1d18; } .ops-pill.is-good { background: #e6f4ea; color: #1e6b34; }
    .ops-delta.is-bad { color: #b3261e; } .ops-delta.is-good { color: #1e6b34; }
    .ops-actions { display: flex; gap: 8px; margin: 12px 0; flex-wrap: wrap; }
    .ops-changes { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
    .ops-changes li { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 8px 12px; border-left: 3px solid #c3cad4; background: #f7f9fb; border-radius: 6px; }
    .ops-changes li.sev-high { border-left-color: #b3261e; } .ops-changes li.sev-medium { border-left-color: #e09b00; }
    .ops-badge { padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #eef1f5; white-space: nowrap; }
    .b-critical { background: #b3261e; color: #fff; } .b-high { background: #fdecea; color: #8c1d18; } .b-medium { background: #fff4e0; color: #8a5a00; } .b-low { background: #e6f4ea; color: #1e6b34; }
    .ops-why td { background: #f7f9fb; } .ops-components { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--ink-muted); margin: 6px 0; }
    .ops-spark { display: flex; align-items: flex-end; gap: 4px; height: 44px; margin: 8px 0; } .ops-spark span { width: 18px; background: #5b7fb8; border-radius: 3px 3px 0 0; }
    .ops-counts { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 8px; }
    .ops-recs { display: grid; gap: 10px; } .ops-recs article { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; } .ops-recs p { margin: 6px 0; }
    .ops-recs footer { display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; }
    .ops-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
    .ops-bar { display: grid; grid-template-columns: 56px 1fr 32px; gap: 8px; align-items: center; margin: 4px 0; } .ops-bar div { background: #eef1f5; border-radius: 999px; height: 10px; overflow: hidden; } .ops-bar i { display: block; height: 100%; background: #5b7fb8; }
    .ops-columns { display: flex; gap: 16px; align-items: flex-end; } .ops-columns div { display: flex; flex-direction: column; align-items: center; gap: 2px; } .ops-columns i { width: 36px; background: #b8c4d6; border-radius: 4px 4px 0 0; } .ops-columns .is-current i { background: #3d62a3; }
  `,
})
export class OpsDashboardComponent {
  readonly runId = input.required<string>();
  protected readonly svc = inject(IntelligenceService);
  private readonly http = inject(HttpClient);

  protected readonly data = signal<Dash | null>(null);
  protected readonly report = signal<Report | null>(null);
  protected readonly loading = signal(false);
  protected readonly generating = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly expanded = signal<string | null>(null);

  protected readonly healthLabels = HEALTH_LABELS;
  protected readonly healthValues = HEALTH_VALUES;
  protected readonly trendLabels = TREND_LABELS;
  protected readonly levels = LEVEL_LABELS;
  protected readonly typeLabels = TYPE_LABELS;
  protected readonly stateLabels = STATE_LABELS;
  protected readonly stateKeys = Object.keys(STATE_LABELS);
  protected readonly opStatus = OP_STATUS;
  protected readonly badges = BADGES;
  protected readonly healthEntries = computed(() => Object.entries(this.data()?.health ?? {}));
  protected readonly coverageEntries = computed(() => {
    const quality = this.data()?.dataQuality;
    if (!quality) return [];
    return Object.entries(quality.current).map(([key, value]) => [key === "description" ? "Descripción" : key === "errorMessage" ? "Mensaje de error útil" : key === "closeMessage" ? "Mensaje de cierre" : key, value, quality.previous?.[key] ?? null] as [string, number, number | null]);
  });
  protected readonly exportUrl = computed(() => `${BASE}/analysis/${this.runId()}/reports/EXECUTIVE/export`);

  constructor() {
    effect(() => {
      const id = this.runId();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.data.set(await firstValueFrom(this.http.get<Dash>(`${BASE}/analysis/${id}/dashboard`)));
      try {
        this.report.set(await firstValueFrom(this.http.get<Report>(`${BASE}/analysis/${id}/reports/EXECUTIVE`)));
      } catch {
        this.report.set(null);
      }
    } catch {
      this.error.set("No fue posible cargar el panel operativo de este análisis.");
    } finally {
      this.loading.set(false);
    }
  }

  protected async generate(force: boolean): Promise<void> {
    this.generating.set(true);
    try {
      await firstValueFrom(this.http.post(`${BASE}/analysis/${this.runId()}/reports`, { force }));
      await this.load(this.runId());
    } catch {
      this.error.set("No fue posible generar los reportes.");
    } finally {
      this.generating.set(false);
    }
  }

  protected async setState(rec: Recommendation, state: string): Promise<void> {
    try {
      await firstValueFrom(this.http.patch(`${BASE}/analysis/${this.runId()}/recommendations/${rec.clusterId}/${rec.id}`, { state }));
      this.data.update((d) => (d ? { ...d, recommendations: d.recommendations.map((item) => (item === rec ? { ...item, state } : item)) } : d));
    } catch {
      this.error.set("No fue posible actualizar el estado de la recomendación.");
    }
  }

  protected toggle(id: string): void {
    this.expanded.update((current) => (current === id ? null : id));
  }

  protected isBad(value: string): boolean {
    return ["HIGH", "INCREASING", "WORSENING", "POOR", "DEGRADED"].includes(value);
  }

  protected isGood(value: string): boolean {
    return ["IMPROVING", "GOOD", "DECREASING"].includes(value);
  }

  protected arrow(direction: string | null): string {
    return direction === "UP" ? "▲" : direction === "DOWN" ? "▼" : "■";
  }

  protected pct(value: number): string {
    return `${Math.round(value * 100)}%`;
  }

  protected bar(count: number, problem: Problem): number {
    const max = Math.max(...problem.series.map((point) => point.count), 1);
    return Math.max(4, Math.round((count / max) * 40));
  }

  protected colHeight(total: number): number {
    const max = Math.max(...(this.data()?.trend.periods.map((period) => period.total) ?? [1]), 1);
    return Math.max(4, Math.round((total / max) * 80));
  }

  protected evidenceKeys(finding: Finding): string {
    return finding.evidence.slice(0, 3).map((item) => item.jiraKey).join(", ");
  }
}
