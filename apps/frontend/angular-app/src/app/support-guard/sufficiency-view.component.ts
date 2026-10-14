import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from "@angular/core";

import { type CaseFilters, distinct, EMPTY_FILTERS, filterCases } from "./filters";
import type { CaseRecord } from "./models";
import { SupportGuardService } from "./support-guard.service";
import { aiDisplay, StatusBadgeComponent, WorkflowBadgeComponent, workflowState } from "./ui";

const PAGE_SIZE = 5;

@Component({
  selector: "sg-sufficiency-view",
  standalone: true,
  imports: [StatusBadgeComponent, WorkflowBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="sg-pagehead">
      <div>
        <h1>Validación de suficiencia</h1>
        <p>Evalúa si la información de cada caso permite a un analista comenzar a trabajar. Este módulo solo analiza y recomienda; no modifica Jira.</p>
      </div>
    </header>

    <section class="sg-panel">
      <div class="sg-segments" role="tablist" aria-label="Filtro de suficiencia">
        @for (s of segments; track s.value) {
          <button type="button" role="tab" [attr.aria-selected]="filters().sufficiency === s.value" [class.is-active]="filters().sufficiency === s.value" (click)="set('sufficiency', s.value)">
            {{ s.label }} <span>{{ count(s.value) }}</span>
          </button>
        }
      </div>
      <div class="sg-filters" role="search">
        <input type="search" placeholder="Buscar por clave o resumen" aria-label="Buscar" (input)="set('search', $any($event.target).value)" />
        <select aria-label="Aplicación" (change)="set('application', $any($event.target).value)">
          <option value="">Aplicación: todas</option>
          @for (v of applications(); track v) { <option [value]="v">{{ v }}</option> }
        </select>
      </div>

      @if (svc.loading() && svc.cases().length === 0) {
        @for (row of [1, 2, 3, 4]; track row) { <div class="sg-skeleton sg-skeleton--row"></div> }
      } @else if (svc.cases().length === 0) {
        <div class="sg-state"><h3>No hay casos pendientes de evaluación</h3><p>Ejecute una validación de casos nuevos para generar evaluaciones.</p></div>
      } @else if (rows().length === 0) {
        <div class="sg-state"><h3>Sin coincidencias</h3><p>Ajuste los filtros para ver más casos.</p></div>
      } @else {
        <div class="sg-tablewrap">
          <table class="sg-table">
            <thead>
              <tr><th>Caso</th><th>Estado</th><th>Completitud</th><th>Suficiencia IA</th><th>Suficiencia por reglas</th><th>Información faltante</th><th>Mensaje al solicitante</th></tr>
            </thead>
            <tbody>
              @for (r of pageRows(); track r.caseId) {
                <tr tabindex="0" (click)="open.emit(r.caseId)" (keydown.enter)="open.emit(r.caseId)">
                  <td class="sg-key">{{ r.caseId }}<small class="sg-sub" [title]="r.supportCase.summary">{{ r.supportCase.summary }}</small></td>
                  <td><sg-workflow [state]="workflow(r)" /></td>
                  <td><sg-badge [value]="r.validation.valid ? 'COMPLETE' : 'MISSING_INFORMATION'" /></td>
                  <td>
                    <sg-badge [value]="ai(r).value" [text]="ai(r).label" />
                    @if (r.ai?.status === 'COMPLETED' && r.ai?.result?.status !== 'SUFFICIENT') {
                      <small class="sg-sub">Confianza {{ confidence(r) }}%</small>
                    }
                  </td>
                  <td><sg-badge [value]="r.sufficiency.status" /></td>
                  <td class="sg-missing">
                    {{ missing(r) }}
                  </td>
                  <td>
                    @if (r.request) {
                      <button type="button" class="sg-btn sg-btn--small" (click)="review(r, $event)">Ver detalle</button>
                    } @else { <span class="sg-muted">—</span> }
                  </td>
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
      }
    </section>
  `,
})
export class SufficiencyViewComponent {
  protected readonly svc = inject(SupportGuardService);
  readonly open = output<string>();
  protected readonly filters = signal<CaseFilters>({ ...EMPTY_FILTERS });
  protected readonly rows = computed(() => filterCases(this.svc.cases(), this.filters()));
  protected readonly page = signal(0);
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
  protected readonly applications = computed(() => distinct(this.svc.cases(), (r) => r.supportCase.application));
  protected readonly segments = [
    { value: "", label: "Todos" },
    { value: "SUFFICIENT", label: "Suficientes" },
    { value: "PARTIALLY_SUFFICIENT", label: "Parcialmente suficientes" },
    { value: "INSUFFICIENT", label: "Insuficientes" },
  ];

  protected count(value: string): number {
    return value ? this.svc.cases().filter((r) => r.sufficiency.status === value).length : this.svc.cases().length;
  }

  protected readonly workflow = workflowState;
  protected readonly ai = aiDisplay;

  protected confidence(r: CaseRecord): number {
    return Math.round((r.ai?.result?.confidence ?? 0) * 100);
  }

  protected missing(r: CaseRecord): string {
    const items = r.request?.items.map((item) => item.label) ?? r.sufficiency.missingInformation;
    return items.length ? items.slice(0, 3).join(" · ") + (items.length > 3 ? ` · +${items.length - 3}` : "") : "—";
  }

  protected review(r: CaseRecord, event: Event): void {
    event.stopPropagation();
    this.open.emit(r.caseId);
  }

  protected go(delta: number): void {
    this.page.update((p) => Math.min(Math.max(p + delta, 0), this.pages() - 1));
  }

  protected set(key: keyof CaseFilters, value: string): void {
    this.page.set(0);
    this.filters.update((current) => ({ ...current, [key]: value }));
  }
}
