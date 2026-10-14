import { ChangeDetectionStrategy, Component, computed, inject, output } from "@angular/core";

import type { AuditEntry, ViewName } from "./models";
import { SupportGuardService } from "./support-guard.service";
import { activityText, digestActivity, formatDate, type CaseDigest } from "./ui";

@Component({
  selector: "sg-dashboard",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="sg-pagehead">
      <div>
        <h1>Support Guard</h1>
        <p>Control inteligente de calidad para casos de soporte</p>
      </div>
      <div class="sg-pagehead__meta">
        @if (overview(); as o) {
          <span class="sg-conn" [attr.data-state]="o.connection.state" [title]="o.connection.message">
            <i></i> Jira · {{ connectionLabel() }}
          </span>
          <span class="sg-conn" [attr.data-state]="aiState()" [title]="o.ai?.health?.message ?? ''">
            <i></i> AI Analysis · {{ aiLabel() }}
          </span>
          <span class="sg-chip" [title]="o.liveBlockedReason || (o.actionsMode === 'LIVE' ? 'Las devoluciones modifican Jira' : 'Las devoluciones solo se simulan')">
            Acciones: {{ o.actionsMode }}
          </span>
          @if (o.sourceMode === 'MOCK_JIRA') {
            <span class="sg-chip" title="Los casos provienen de un conjunto de ejemplo">Modo demo</span>
          }
        }
      </div>
    </header>

    <section class="sg-statusbar" aria-label="Estado de sincronización">
      <dl>
        <div><dt>Última sincronización</dt><dd>{{ date(overview()?.lastSyncAt) }}</dd></div>
        <div><dt>Casos encontrados</dt><dd>{{ overview()?.lastRun?.found ?? '—' }}</dd></div>
        <div><dt>Casos analizados</dt><dd>{{ overview()?.ai?.stats?.analyzed ?? 0 }}{{ (overview()?.ai?.pending ?? 0) > 0 ? ' · ' + overview()!.ai!.pending + ' en proceso' : '' }}</dd></div>
      </dl>
      <button type="button" class="sg-btn sg-btn--ghost" [disabled]="svc.running() || svc.syncing()" (click)="svc.runValidation()" aria-label="Sincronizar ahora">
        <span aria-hidden="true">↻</span> {{ svc.running() ? 'Sincronizando…' : 'Sincronizar ahora' }}
      </button>
    </section>

    @if (svc.syncing() || svc.running()) {
      <div class="sg-banner sg-banner--sync" role="status" aria-live="polite">
        <span class="sg-spinner" aria-hidden="true"></span> Sincronizando casos nuevos desde Jira...
      </div>
    }
    @if (svc.jiraUnavailable() || (overview() && overview()!.connection.state === 'DISCONNECTED')) {
      <div class="sg-banner sg-banner--warn" role="alert">
        <strong>Conexión con Jira no disponible.</strong> Se muestran los últimos datos conocidos; se reintentará automáticamente.
      </div>
    }
    @if (overview() && overview()!.connection.state === 'DEGRADED') {
      <div class="sg-banner sg-banner--warn" role="alert">{{ overview()!.connection.message }}</div>
    }

    @if (svc.error() && !overview()) {
      <div class="sg-state sg-state--error">
        <h3>No se pudo cargar el panel</h3>
        <p>{{ svc.error() }}</p>
        <button type="button" class="sg-btn" (click)="svc.refresh()">Reintentar</button>
      </div>
    } @else {
      <section class="sg-kpis" aria-label="Indicadores operativos">
        @for (kpi of kpis(); track kpi.label) {
          <article class="sg-kpi" [attr.data-tone]="kpi.tone">
            <span class="sg-kpi__label">{{ kpi.label }}</span>
            @if (svc.loading() && !overview()) {
              <span class="sg-skeleton sg-skeleton--kpi"></span>
            } @else {
              <strong class="sg-kpi__value">{{ kpi.value }}</strong>
            }
          </article>
        }
      </section>

      <section class="sg-cards">
        <article class="sg-card sg-card--featured">
          <div class="sg-card__head">
            <span class="sg-card__icon" aria-hidden="true">✓</span>
            <span class="sg-chip sg-chip--solid">Principal</span>
          </div>
          <h2>Validación de casos nuevos</h2>
          <p>Verifica automáticamente que los nuevos casos de Jira contengan la información obligatoria antes de ingresar al flujo de soporte.</p>

          <dl class="sg-stats">
            <div><dt>Encontrados</dt><dd>{{ overview()?.lastRun?.found ?? '—' }}</dd></div>
            <div><dt>Completos</dt><dd>{{ overview()?.kpis?.completeCases ?? '—' }}</dd></div>
            <div><dt>Incompletos</dt><dd>{{ overview()?.kpis?.missingInformation ?? '—' }}</dd></div>
            <div><dt>Devueltos</dt><dd>{{ overview()?.kpis?.returnedCases ?? '—' }}</dd></div>
            <div><dt>Errores</dt><dd>{{ overview()?.kpis?.errorCases ?? '—' }}</dd></div>
          </dl>

          <ul class="sg-meta">
            <li>
              <span>Validación automática</span>
              <strong [class.sg-on]="overview()?.autoValidation?.enabled">{{ overview()?.autoValidation?.enabled ? 'ACTIVA' : 'INACTIVA' }}</strong>
            </li>
            <li><span>Última ejecución</span><strong>{{ date(overview()?.autoValidation?.lastRunAt) }}</strong></li>
            <li><span>Próxima ejecución</span><strong>{{ overview()?.autoValidation?.enabled ? date(overview()?.autoValidation?.nextRunAt) : 'No programada' }}</strong></li>
            <li><span>Última sincronización</span><strong>{{ date(overview()?.lastSyncAt) }}</strong></li>
          </ul>

          <div class="sg-card__actions">
            <button type="button" class="sg-btn sg-btn--primary" [disabled]="svc.running()" (click)="svc.runValidation()">
              {{ svc.running() ? 'Validando…' : 'Validar casos nuevos' }}
            </button>
            <button type="button" class="sg-btn sg-btn--ghost" (click)="navigate.emit('validation')">Ver resultados</button>
          </div>
          @if (svc.lastRunMessage(); as message) {
            <p class="sg-note" role="status">{{ message }}</p>
          }
        </article>

        <article class="sg-card">
          <div class="sg-card__head"><span class="sg-card__icon sg-card__icon--alt" aria-hidden="true">◧</span></div>
          <h2>Validación inteligente de suficiencia</h2>
          <p>Combina la validación determinística con un análisis semántico con IA para decidir si un analista puede comenzar a trabajar el caso y redactar la solicitud de información. Solo analiza y recomienda; no modifica Jira.</p>
          <dl class="sg-stats sg-stats--compact">
            <div><dt>Suficientes</dt><dd>{{ overview()?.kpis?.sufficientCases ?? '—' }}</dd></div>
            <div><dt>Insuficientes</dt><dd>{{ overview()?.kpis?.insufficientCases ?? '—' }}</dd></div>
            <div><dt>Analizados con IA</dt><dd>{{ overview()?.ai?.stats?.analyzed ?? 0 }}</dd></div>
          </dl>
          <div class="sg-card__actions">
            <button type="button" class="sg-btn" (click)="navigate.emit('sufficiency')">Abrir suficiencia</button>
          </div>
        </article>

        <article class="sg-card sg-card--preview">
          <div class="sg-card__head">
            <span class="sg-card__icon sg-card__icon--muted" aria-hidden="true">◇</span>
            <span class="sg-chip">Preview</span>
          </div>
          <h2>Analista inicial</h2>
          <p>Analiza el contexto del caso y prepara una primera evaluación técnica para el equipo de soporte.</p>
          <p class="sg-note">No habilitado en esta versión.</p>
          <div class="sg-card__actions">
            <button type="button" class="sg-btn" (click)="navigate.emit('analyst')">Ver vista previa</button>
          </div>
        </article>
      </section>

      <section class="sg-panel" aria-labelledby="recent-title">
        <div class="sg-panel__head">
          <div>
            <h2 id="recent-title">Casos que requieren atención</h2>
            <p class="sg-muted">Estado más reciente de cada caso revisado. Los que necesitan acción aparecen primero.</p>
          </div>
          <button type="button" class="sg-link" (click)="svc.refresh()">Actualizar</button>
        </div>
        @if (!overview() && svc.loading()) {
          @for (row of [1, 2, 3]; track row) { <div class="sg-skeleton sg-skeleton--row"></div> }
        } @else if (digest().length === 0) {
          <div class="sg-state">
            <h3>Sin casos revisados todavía</h3>
            <p>Ejecute “Validar casos nuevos” para registrar la primera revisión.</p>
          </div>
        } @else {
          <div class="sg-digest__summary">
            <span class="sg-chip">{{ digest().length }} caso(s) revisado(s)</span>
            <span class="sg-chip sg-chip--warn">{{ attentionCount() }} requieren atención</span>
            <span class="sg-chip sg-chip--ok">{{ digest().length - attentionCount() }} sin pendientes</span>
          </div>
          <ul class="sg-digest">
            @for (d of shown(); track d.caseId) {
              <li>
                <button type="button" class="sg-digest__row" (click)="open.emit(d.caseId)" [attr.aria-label]="'Abrir caso ' + d.caseId">
                  <span class="sg-activity__case">{{ d.caseId }}</span>
                  <span class="sg-digest__tags">
                    @if (d.validation; as v) { <span class="sg-chip" [class.sg-chip--ok]="v.tone === 'ok'" [class.sg-chip--warn]="v.tone !== 'ok'">Información: {{ v.label }}</span> }
                    @if (d.sufficiency; as s) { <span class="sg-chip" [class.sg-chip--ok]="s.tone === 'ok'" [class.sg-chip--warn]="s.tone !== 'ok'">Suficiencia: {{ s.label }}</span> }
                    @if (d.action) { <span class="sg-chip">{{ d.action }}</span> }
                    @if (d.hasError) { <span class="sg-chip sg-chip--warn">Error al procesar</span> }
                  </span>
                  <span class="sg-digest__detail">@if (d.missing.length) { Falta: {{ d.missing.slice(0, 3).join(', ') }}@if (d.missing.length > 3) { y {{ d.missing.length - 3 }} más } }</span>
                  <span class="sg-activity__time">{{ date(d.lastAt) }}</span>
                </button>
              </li>
            }
          </ul>
          @if (digest().length > shown().length) { <p class="sg-muted">Mostrando {{ shown().length }} de {{ digest().length }}. Consulta el resto en “Validación de casos”.</p> }
        }
      </section>
    }
  `,
})
export class DashboardComponent {
  protected readonly svc = inject(SupportGuardService);
  readonly navigate = output<ViewName>();
  readonly open = output<string>();
  protected readonly overview = this.svc.overview;
  protected readonly date = formatDate;
  protected readonly digest = computed(() => {
    const needs = (d: CaseDigest) => (d.hasError ? 0 : d.validation?.tone === "warn" ? 1 : d.sufficiency && d.sufficiency.tone !== "ok" ? 2 : 3);
    return digestActivity(this.overview()?.recentActivity ?? []).sort((a, b) => needs(a) - needs(b));
  });
  protected readonly needsAttention = (d: CaseDigest) => d.hasError || d.validation?.tone === "warn" || (!!d.sufficiency && d.sufficiency.tone !== "ok");
  protected readonly attentionCount = computed(() => this.digest().filter(this.needsAttention).length);
  protected readonly shown = computed(() => this.digest().slice(0, 8));

  protected readonly connectionLabel = computed(() => {
    const state = this.overview()?.connection.state;
    return state === "CONNECTED" ? "Conectado" : state === "DEGRADED" ? "Degradado" : "Problema de conexión";
  });

  protected readonly aiState = computed(() => this.overview()?.ai?.health.state ?? "DISABLED");
  protected readonly aiLabel = computed(() => {
    const s = this.aiState();
    const name = this.overview()?.ai?.health.provider === "MOCK_AI" ? "Simulada" : "AXET Bridge local";
    return s === "CONNECTED" ? `${name} · Conectada` : s === "DISCONNECTED" ? `${name} · Desconectada` : "Deshabilitada";
  });

  protected readonly kpis = computed(() => {
    const k = this.overview()?.kpis;
    const value = (n: number | undefined) => (k ? n : "—");
    return [
      { label: "Casos nuevos", value: value(k?.newCases), tone: "neutral" },
      { label: "Casos completos", value: value(k?.completeCases), tone: "ok" },
      { label: "Información faltante", value: value(k?.missingInformation), tone: "warn" },
      { label: "Casos suficientes", value: value(k?.sufficientCases), tone: "ok" },
      { label: "Casos insuficientes", value: value(k?.insufficientCases), tone: "danger" },
      { label: "Casos devueltos", value: value(k?.returnedCases), tone: "info" },
    ];
  });

  protected auditLabel(entry: AuditEntry): string {
    return activityText(entry);
  }
}
