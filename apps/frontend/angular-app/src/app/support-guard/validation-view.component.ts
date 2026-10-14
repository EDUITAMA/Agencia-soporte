import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from "@angular/core";

import { type CaseFilters, distinct, EMPTY_FILTERS, filterCases } from "./filters";
import type { CaseRecord } from "./models";
import { SupportGuardService } from "./support-guard.service";
import { formatDate, StatusBadgeComponent, WorkflowBadgeComponent, workflowState } from "./ui";

const PAGE_SIZE = 5;

@Component({
  selector: "sg-validation-view",
  standalone: true,
  imports: [StatusBadgeComponent, WorkflowBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="sg-pagehead">
      <div>
        <h1>Validación de casos nuevos</h1>
        <p>Resultados de la verificación de campos obligatorios sobre los casos nuevos de Jira.</p>
      </div>
      <button type="button" class="sg-btn sg-btn--primary" [disabled]="svc.running()" (click)="svc.runValidation()">
        {{ svc.running() ? 'Validando…' : 'Validar casos nuevos' }}
      </button>
    </header>

    @if (svc.lastRunMessage(); as message) { <p class="sg-note" role="status">{{ message }}</p> }
    @if (svc.error()) { <div class="sg-banner sg-banner--warn" role="alert">{{ svc.error() }}</div> }
    @if (svc.overview()?.lastRun?.sourceError; as sourceError) {
      <div class="sg-banner sg-banner--warn" role="alert">La última sincronización con Jira falló: {{ sourceError }}</div>
    }

    <section class="sg-panel">
      <div class="sg-filters" role="search">
        <input type="search" placeholder="Buscar por clave o resumen" aria-label="Buscar" [value]="filters().search" (input)="set('search', $any($event.target).value)" />
        <select aria-label="Estado" (change)="set('status', $any($event.target).value)">
          <option value="">Estado: todos</option>
          @for (v of statuses(); track v) { <option [value]="v">{{ v }}</option> }
        </select>
        <select aria-label="Prioridad" (change)="set('priority', $any($event.target).value)">
          <option value="">Prioridad: todas</option>
          @for (v of priorities(); track v) { <option [value]="v">{{ v }}</option> }
        </select>
        <select aria-label="Aplicación" (change)="set('application', $any($event.target).value)">
          <option value="">Aplicación: todas</option>
          @for (v of applications(); track v) { <option [value]="v">{{ v }}</option> }
        </select>
        <select aria-label="Validación" (change)="set('validation', $any($event.target).value)">
          <option value="">Validación: todas</option>
          @for (v of validations; track v.value) { <option [value]="v.value">{{ v.label }}</option> }
        </select>
      </div>

      @if (svc.loading() && svc.cases().length === 0) {
        @for (row of [1, 2, 3, 4]; track row) { <div class="sg-skeleton sg-skeleton--row"></div> }
      } @else if (svc.cases().length === 0) {
        <div class="sg-state">
          <h3>No se encontraron casos nuevos</h3>
          <p>Cuando Support Guard detecte casos nuevos en Jira aparecerán aquí. Puede ejecutar una validación manual.</p>
        </div>
      } @else if (rows().length === 0) {
        <div class="sg-state"><h3>Sin coincidencias</h3><p>Ajuste los filtros para ver más casos.</p></div>
      } @else {
        <div class="sg-bulkbar">
          <label class="sg-check">
            <input type="checkbox" [checked]="allSelected()" [disabled]="eligible().length === 0 || svc.bulkReturning()" (change)="toggleAll()" />
            Seleccionar todos los elegibles ({{ eligible().length }})
          </label>
          <span class="sg-muted">{{ selectedCount() }} seleccionados</span>
          @if (selectedCount() > 0) { <button type="button" class="sg-btn sg-btn--small sg-btn--ghost" (click)="clear()">Limpiar selección</button> }
          <span class="sg-bulkbar__spacer"></span>
          @if (confirming()) {
            <span>¿{{ isDryRun() ? 'Simular la devolución de' : 'Devolver en Jira' }} {{ selectedCount() }} casos?</span>
            <button type="button" class="sg-btn sg-btn--small sg-btn--primary" [disabled]="svc.bulkReturning()" (click)="confirmReturn()">
              {{ svc.bulkReturning() ? 'Procesando…' : 'Confirmar' }}
            </button>
            <button type="button" class="sg-btn sg-btn--small sg-btn--ghost" [disabled]="svc.bulkReturning()" (click)="confirming.set(false)">Cancelar</button>
          } @else {
            <button type="button" class="sg-btn sg-btn--primary" [disabled]="selectedCount() === 0 || svc.bulkReturning()" (click)="confirming.set(true)">
              Devolver casos ({{ selectedCount() }})
            </button>
          }
        </div>
        @if (svc.bulkFeedback(); as fb) { <p class="sg-note" role="status" [attr.data-ok]="fb.ok">{{ fb.text }}</p> }
        <div class="sg-tablewrap">
          <table class="sg-table">
            <thead>
              <tr><th class="sg-check-col"></th><th>Caso</th><th>Resumen</th><th>Estado</th><th>Creado</th><th>Prioridad</th><th>Aplicación</th><th>Validación</th><th>Campos faltantes</th><th>Acción</th><th>Última revisión</th></tr>
            </thead>
            <tbody>
              @for (r of pageRows(); track r.caseId) {
                <tr tabindex="0" (click)="open.emit(r.caseId)" (keydown.enter)="open.emit(r.caseId)">
                  <td class="sg-check-col" (click)="$event.stopPropagation()">
                    <input type="checkbox" [attr.aria-label]="'Seleccionar ' + r.caseId" [checked]="selected().has(r.caseId)" [disabled]="!isEligible(r) || svc.bulkReturning()" (change)="toggle(r.caseId)" />
                  </td>
                  <td class="sg-key">{{ r.caseId }}</td>
                  <td class="sg-summary" [title]="r.supportCase.summary">{{ r.supportCase.summary }}</td>
                  <td><sg-workflow [state]="workflow(r)" /></td>
                  <td>{{ date(r.supportCase.createdAt) }}</td>
                  <td>{{ r.supportCase.priority || '—' }}</td>
                  <td>{{ r.supportCase.application || '—' }}</td>
                  <td><sg-badge [value]="r.validationStatus" /></td>
                  <td class="sg-missing">{{ r.validation.missingLabels.join(', ') || '—' }}</td>
                  <td [title]="r.lastAction?.detail ?? ''">{{ actionLabel(r.lastAction?.type) }}</td>
                  <td>{{ date(r.lastCheckedAt) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <nav class="sg-pager" aria-label="Paginación">
          <span>{{ rangeLabel() }}</span>
          <div>
            <button type="button" class="sg-btn sg-btn--small sg-btn--ghost" [disabled]="page() === 0" (click)="go(-1)">← Anterior</button>
            <span aria-live="polite">Página {{ page() + 1 }} de {{ pages() }}</span>
            <button type="button" class="sg-btn sg-btn--small sg-btn--ghost" [disabled]="page() >= pages() - 1" (click)="go(1)">Siguiente →</button>
          </div>
        </nav>
        @if (allComplete()) {
          <div class="sg-state sg-state--ok"><h3>Todos los casos nuevos contienen la información requerida</h3></div>
        }
      }
    </section>
  `,
})
export class ValidationViewComponent {
  protected readonly svc = inject(SupportGuardService);
  readonly open = output<string>();
  protected readonly date = formatDate;
  protected readonly workflow = workflowState;
  protected readonly filters = signal<CaseFilters>({ ...EMPTY_FILTERS });
  protected readonly rows = computed(() => filterCases(this.svc.cases(), this.filters()));
  protected readonly page = signal(0);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly confirming = signal(false);
  protected readonly isDryRun = computed(() => this.svc.overview()?.actionsMode !== "LIVE");
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.rows().length / PAGE_SIZE)));
  protected readonly pageRows = computed(() => {
    const start = Math.min(this.page(), this.pages() - 1) * PAGE_SIZE;
    return this.rows().slice(start, start + PAGE_SIZE);
  });
  protected readonly rangeLabel = computed(() => {
    const total = this.rows().length;
    const start = Math.min(this.page(), this.pages() - 1) * PAGE_SIZE;
    return `${start + 1}–${Math.min(start + PAGE_SIZE, total)} de ${total} casos`;
  });
  protected readonly eligible = computed(() => this.rows().filter((r) => this.isEligible(r)));
  protected readonly selectedCount = computed(() => this.eligible().filter((r) => this.selected().has(r.caseId)).length);
  protected readonly allSelected = computed(() => this.eligible().length > 0 && this.selectedCount() === this.eligible().length);
  protected readonly statuses = computed(() => distinct(this.svc.cases(), (r) => r.supportCase.status));
  protected readonly priorities = computed(() => distinct(this.svc.cases(), (r) => r.supportCase.priority));
  protected readonly applications = computed(() => distinct(this.svc.cases(), (r) => r.supportCase.application));
  protected readonly allComplete = computed(() => this.svc.cases().length > 0 && this.svc.cases().every((r) => r.validationStatus === "COMPLETE"));
  protected readonly validations = [
    { value: "COMPLETE", label: "Completo" },
    { value: "MISSING_INFORMATION", label: "Información faltante" },
    { value: "RETURNED", label: "Devuelto" },
    { value: "DRY_RUN", label: "Dry run" },
    { value: "ERROR", label: "Error" },
  ];

  protected set(key: keyof CaseFilters, value: string): void {
    this.page.set(0);
    this.confirming.set(false);
    this.filters.update((current) => ({ ...current, [key]: value }));
  }

  protected isEligible(r: CaseRecord): boolean {
    return !r.validation.valid && !!r.request && r.validationStatus !== "RETURNED";
  }

  protected go(delta: number): void {
    this.page.update((p) => Math.min(Math.max(p + delta, 0), this.pages() - 1));
  }

  protected toggle(caseId: string): void {
    this.confirming.set(false);
    this.selected.update((current) => {
      const next = new Set(current);
      if (!next.delete(caseId)) next.add(caseId);
      return next;
    });
  }

  protected toggleAll(): void {
    this.confirming.set(false);
    this.selected.set(this.allSelected() ? new Set() : new Set(this.eligible().map((r) => r.caseId)));
  }

  protected clear(): void {
    this.confirming.set(false);
    this.selected.set(new Set());
  }

  protected async confirmReturn(): Promise<void> {
    const ids = this.eligible().filter((r) => this.selected().has(r.caseId)).map((r) => r.caseId);
    await this.svc.returnMany(ids);
    this.confirming.set(false);
    this.selected.set(new Set());
  }

  protected actionLabel(type: string | undefined): string {
    switch (type) {
      case "DRY_RUN": return "Would return case";
      case "RETURNED": return "Returned";
      case "MARKED_PENDING": return "Marked pending";
      case "ERROR": return "Failed";
      default: return "—";
    }
  }
}
