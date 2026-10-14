import { HttpClient } from "@angular/common/http";
import { ChangeDetectionStrategy, Component, inject, output, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";

const BASE = "/api/support-guard/intelligence";

interface HistoryRow { runId: string; period: { type: string; from: string; to: string }; mode: string | null; cases: number; eligible: number; groups: number; rcaCandidates: number; priorityIssues: number | null; status: string; generatedAt: string; reportVersion: number | null }
interface Compare {
  a: { id: string; period: { from: string; to: string }; topGroups: { id: string; title: string; cases: number; open: number }[] };
  b: { id: string; period: { from: string; to: string }; topGroups: { id: string; title: string; cases: number; open: number }[] };
  kpis: { key: string; label: string; value: number; previous: number | null; change: number | null; changePct: number | null }[];
  notes: string[];
}

@Component({
  selector: "sg-ops-history",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sg-panel">
      <div class="sg-tablewrap"><table class="sg-table">
        <thead><tr><th></th><th>Período</th><th>Modo IA</th><th>Casos</th><th>Grupos</th><th>Candidatos</th><th>Prioritarios</th><th>Estado</th><th>Generado</th><th>Reporte</th><th></th></tr></thead>
        <tbody>
          @for (r of rows(); track r.runId) {
            <tr>
              <td><input type="checkbox" [checked]="picked().includes(r.runId)" [attr.aria-label]="'Comparar ' + r.period.from" (change)="pick(r.runId)" /></td>
              <td class="sg-key">{{ r.period.from }} → {{ r.period.to }}<small class="sg-sub">{{ r.period.type }}</small></td>
              <td>{{ r.mode ?? '—' }}</td><td>{{ r.cases }}<small class="sg-sub">{{ r.eligible }} elegibles</small></td><td>{{ r.groups }}</td><td>{{ r.rcaCandidates }}</td><td>{{ r.priorityIssues ?? '—' }}</td>
              <td>{{ r.status }}</td><td>{{ r.generatedAt.slice(0, 16).replace('T', ' ') }}</td><td>{{ r.reportVersion ? 'v' + r.reportVersion : '—' }}</td>
              <td><button type="button" class="sg-btn sg-btn--small" (click)="open.emit(r.runId)">Abrir</button></td>
            </tr>
          }
        </tbody></table></div>
      <div class="actions">
        <button type="button" class="sg-btn sg-btn--primary" [disabled]="picked().length !== 2" (click)="compare()">Comparar períodos (A vs B)</button>
        <span class="sg-muted">Seleccione dos análisis.</span>
      </div>
    </section>
    @if (result(); as c) {
      <section class="sg-panel">
        <h3>Comparación: {{ c.a.period.from }} → {{ c.a.period.to }} (A) vs {{ c.b.period.from }} → {{ c.b.period.to }} (B)</h3>
        <div class="sg-tablewrap"><table class="sg-table">
          <thead><tr><th>Métrica</th><th>A</th><th>B</th><th>Cambio</th></tr></thead>
          <tbody>@for (m of c.kpis; track m.key) { <tr><td>{{ m.label }}</td><td>{{ m.previous ?? '—' }}</td><td>{{ m.value }}</td><td>{{ m.change === null ? '—' : (m.change > 0 ? '+' : '') + m.change }}</td></tr> }</tbody></table></div>
        <div class="two">
          <div><h4>Principales grupos · A</h4><ul class="sg-list">@for (g of c.a.topGroups; track g.id) { <li>{{ g.title }} — {{ g.cases }} casos</li> }</ul></div>
          <div><h4>Principales grupos · B</h4><ul class="sg-list">@for (g of c.b.topGroups; track g.id) { <li>{{ g.title }} — {{ g.cases }} casos</li> }</ul></div>
        </div>
        @for (n of c.notes; track n) { <p class="sg-muted">{{ n }}</p> }
      </section>
    }
    @if (error(); as e) { <p class="sg-banner sg-banner--warn" role="alert">{{ e }}</p> }
  `,
  styles: `.actions { display: flex; gap: 12px; align-items: center; margin-top: 12px; } .two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }`,
})
export class OpsHistoryComponent {
  readonly open = output<string>();
  private readonly http = inject(HttpClient);
  protected readonly rows = signal<HistoryRow[]>([]);
  protected readonly picked = signal<string[]>([]);
  protected readonly result = signal<Compare | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void firstValueFrom(this.http.get<{ runs: HistoryRow[] }>(`${BASE}/history`)).then((value) => this.rows.set(value.runs), () => this.error.set("No fue posible cargar el historial."));
  }

  protected pick(id: string): void {
    this.picked.update((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(-2)));
  }

  protected async compare(): Promise<void> {
    const [a, b] = this.picked();
    try {
      this.result.set(await firstValueFrom(this.http.get<Compare>(`${BASE}/history/compare?a=${a}&b=${b}`)));
      this.error.set(null);
    } catch {
      this.error.set("No fue posible comparar los análisis seleccionados.");
    }
  }
}
