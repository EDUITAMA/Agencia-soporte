import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from "@angular/core";

import { SupportGuardService } from "./support-guard.service";
import { AUDIT_LABELS, aiDisplay, formatDate, StatusBadgeComponent, WorkflowBadgeComponent, workflowState } from "./ui";

@Component({
  selector: "sg-case-drawer",
  standalone: true,
  imports: [StatusBadgeComponent, WorkflowBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (record(); as r) {
      <div class="sg-scrim" (click)="closed.emit()"></div>
      <aside class="sg-drawer" role="dialog" aria-modal="true" [attr.aria-label]="'Detalle del caso ' + r.caseId" (keydown.escape)="closed.emit()">
        <header class="sg-drawer__head">
          <div>
            <span class="sg-key">{{ r.caseId }}</span>
            <h2>{{ r.supportCase.summary }}</h2>
          </div>
          <button type="button" class="sg-btn sg-btn--ghost" aria-label="Cerrar" (click)="closed.emit()">✕</button>
        </header>

        <div class="sg-drawer__body">
          <div class="sg-drawer__badges">
            <sg-workflow [state]="workflow()" />
            <sg-badge [value]="r.validationStatus" />
            <sg-badge [value]="ai().value" [text]="'IA: ' + ai().label" />
          </div>

          <section>
            <h3>Case Information</h3>
            <dl class="sg-kv">
              <div><dt>Estado</dt><dd>{{ r.supportCase.status || '—' }}</dd></div>
              <div><dt>Prioridad</dt><dd>{{ r.supportCase.priority || '—' }}</dd></div>
              <div><dt>Reporter</dt><dd>{{ r.supportCase.reporter || '—' }}</dd></div>
              <div><dt>Creado</dt><dd>{{ date(r.supportCase.createdAt) }}</dd></div>
              <div><dt>Actualizado</dt><dd>{{ date(r.supportCase.updatedAt) }}</dd></div>
              <div><dt>Aplicación</dt><dd>{{ r.supportCase.application || '—' }}</dd></div>
              <div><dt>Ambiente</dt><dd>{{ r.supportCase.environment || '—' }}</dd></div>
            </dl>
            <h4>Descripción</h4>
            <p class="sg-desc">{{ r.supportCase.description || 'Sin descripción.' }}</p>
            @if (extraFields().length) {
              <h4>Otros campos</h4>
              <dl class="sg-kv">@for (f of extraFields(); track f[0]) { <div><dt>{{ f[0] }}</dt><dd>{{ f[1] }}</dd></div> }</dl>
            }
            <h4>Adjuntos</h4>
            @if (r.supportCase.attachments.length) {
              <ul class="sg-list">@for (a of r.supportCase.attachments; track a.id) { <li>{{ a.filename }}</li> }</ul>
            } @else { <p class="sg-muted">Sin adjuntos.</p> }
          </section>

          <section>
            <h3>Validation</h3>
            <p class="sg-label">Campos obligatorios</p>
            @if (r.validation.missingLabels.length) {
              <ul class="sg-list sg-list--warn">@for (m of r.validation.missingLabels; track m) { <li>{{ m }}</li> }</ul>
            } @else { <p class="sg-muted">Todos los campos obligatorios están completos.</p> }
            <p class="sg-label">Suficiencia por reglas</p>
            <p>{{ r.sufficiency.explanation }}</p>
            <ul class="sg-checks">
              @for (c of r.sufficiency.checks; track c.ruleId) {
                <li [class.is-fail]="!c.passed"><b aria-hidden="true">{{ c.passed ? '✓' : '✕' }}</b> {{ c.label }}<small>{{ c.detail }}</small></li>
              }
            </ul>
          </section>

          <section>
            <h3>AI Assessment</h3>
            @switch (r.ai?.status) {
              @case ('COMPLETED') {
                @if (r.ai?.result; as res) {
                  <p>{{ res.summary }}</p>
                  <p class="sg-muted">Confianza {{ confidence() }}% · {{ r.ai?.model }} · {{ r.ai?.promptVersion }}</p>
                  @if (res.missingInformation.length) {
                    <p class="sg-label">Información faltante</p>
                    <ul class="sg-list sg-list--warn">@for (m of res.missingInformation; track m.field) { <li>{{ m.reason }}</li> }</ul>
                  }
                  @if (res.ambiguities.length) {
                    <p class="sg-label">Información ambigua</p>
                    <ul class="sg-list">@for (a of res.ambiguities; track a) { <li>{{ a }}</li> }</ul>
                  }
                  @if (res.recommendedQuestions.length) {
                    <p class="sg-label">Preguntas sugeridas</p>
                    <ul class="sg-list">@for (q of res.recommendedQuestions; track q) { <li>{{ q }}</li> }</ul>
                  }
                }
              }
              @case ('QUEUED') { <p class="sg-muted">Análisis en cola…</p> }
              @case ('ANALYZING') { <p class="sg-muted">Analizando el caso…</p> }
              @case ('FAILED') { <p class="sg-muted">El análisis con IA no está disponible. La validación determinística sigue vigente.</p> }
              @default { <p class="sg-muted">Sin análisis con IA para este caso.</p> }
            }
          </section>

          <section>
            <h3>Suggested Request</h3>
            @if (r.request; as req) {
              <pre class="sg-message">{{ req.message }}</pre>
              <div class="sg-card__actions">
                <button type="button" class="sg-btn" (click)="svc.copyMessage(r.caseId, req.message)">{{ svc.copiedCase() === r.caseId ? 'Copiado ✓' : 'Copiar mensaje' }}</button>
                @if (r.validationStatus === 'RETURNED') {
                  <span class="sg-muted">Caso ya devuelto en Jira.</span>
                } @else if (!confirming()) {
                  <button type="button" class="sg-btn sg-btn--primary" [disabled]="aiPending()" (click)="confirming.set(true)">
                    {{ isDryRun() ? 'Simular devolución' : 'Devolver caso en Jira' }}
                  </button>
                } @else {
                  <button type="button" class="sg-btn sg-btn--primary" [disabled]="!!svc.returningCase()" (click)="confirmReturn(r.caseId)">
                    {{ svc.returningCase() === r.caseId ? 'Procesando…' : (isDryRun() ? 'Confirmar simulación' : 'Confirmar devolución') }}
                  </button>
                  <button type="button" class="sg-btn sg-btn--ghost" [disabled]="!!svc.returningCase()" (click)="confirming.set(false)">Cancelar</button>
                }
              </div>
              @if (confirming() && !isDryRun()) {
                <p class="sg-muted">Se publicará este mensaje como comentario en {{ r.caseId }} y el caso se devolverá en Jira.</p>
              }
              @if (aiPending()) { <p class="sg-muted">Disponible cuando termine el análisis con IA.</p> }
              @if (svc.returnFeedback(); as fb) {
                @if (fb.caseId === r.caseId) {
                  <div class="sg-banner" [class.sg-banner--warn]="!fb.ok" [attr.role]="fb.ok ? 'status' : 'alert'">{{ fb.text }}</div>
                }
              }
              <p class="sg-muted">La IA solo redacta el borrador. La devolución la ejecuta una persona, con confirmación{{ isDryRun() ? ' y en modo simulación (DRY_RUN)' : '' }}.</p>
            } @else { <p class="sg-muted">No se requiere solicitar información adicional.</p> }
          </section>

          <section>
            <h3>Activity</h3>
            @if (r.lastAction; as a) {
              <p>{{ a.detail }} <span class="sg-muted">({{ a.mode }} · {{ date(a.at) }})</span></p>
            } @else { <p class="sg-muted">Sin acciones externas.</p> }
            @if (r.errorMessage) { <div class="sg-banner sg-banner--warn">{{ r.errorMessage }}</div> }
            <ol class="sg-timeline">
              @for (e of svc.selectedAudit(); track $index) {
                <li><span>{{ date(e.timestamp) }}</span> {{ label(e.action) }} <small>{{ e.result }}</small></li>
              }
            </ol>
          </section>
        </div>
      </aside>
    }
  `,
})
export class CaseDrawerComponent {
  protected readonly svc = inject(SupportGuardService);
  readonly caseId = input<string | null>(null);
  readonly closed = output<void>();
  protected readonly date = formatDate;
  protected readonly record = computed(() => this.svc.cases().find((r) => r.caseId === this.caseId()) ?? null);
  protected readonly extraFields = computed(() => Object.entries(this.record()?.supportCase.fields ?? {}).filter(([, v]) => !!v));
  protected readonly workflow = computed(() => workflowState(this.record()!));
  protected readonly ai = computed(() => aiDisplay(this.record()!));
  protected readonly confidence = computed(() => Math.round((this.record()?.ai?.result?.confidence ?? 0) * 100));
  protected readonly confirming = signal(false);
  protected readonly isDryRun = computed(() => this.svc.overview()?.actionsMode !== "LIVE");
  protected readonly aiPending = computed(() => ["QUEUED", "ANALYZING"].includes(this.record()?.ai?.status ?? ""));

  constructor() {
    effect(() => {
      const id = this.caseId();
      this.confirming.set(false);
      if (id) void this.svc.loadAudit(id);
    });
  }

  protected async confirmReturn(caseId: string): Promise<void> {
    await this.svc.returnCase(caseId);
    this.confirming.set(false);
  }

  protected label(action: string): string {
    return (AUDIT_LABELS as Record<string, string>)[action] ?? action;
  }
}
