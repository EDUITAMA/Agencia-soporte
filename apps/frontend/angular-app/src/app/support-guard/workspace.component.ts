import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";

import { AnalystPreviewComponent } from "./analyst-preview.component";
import { CaseDrawerComponent } from "./case-drawer.component";
import { DashboardComponent } from "./dashboard.component";
import { IntelligenceViewComponent } from "./intelligence-view.component";
import type { ViewName } from "./models";
import { SufficiencyViewComponent } from "./sufficiency-view.component";
import { SupportGuardService } from "./support-guard.service";
import { ValidationViewComponent } from "./validation-view.component";

@Component({
  selector: "sg-workspace",
  standalone: true,
  imports: [DashboardComponent, ValidationViewComponent, SufficiencyViewComponent, AnalystPreviewComponent, CaseDrawerComponent, IntelligenceViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sg-shell">
      <nav class="sg-nav" aria-label="Support Guard">
        @for (item of items; track item.view) {
          <button type="button" [class.is-active]="view() === item.view" [attr.aria-current]="view() === item.view ? 'page' : null" (click)="view.set(item.view)">{{ item.label }}</button>
        }
      </nav>
      <main class="sg-main">
        @switch (view()) {
          @case ('home') { <sg-dashboard (navigate)="view.set($event)" /> }
          @case ('validation') { <sg-validation-view (open)="selected.set($event)" /> }
          @case ('sufficiency') { <sg-sufficiency-view (open)="selected.set($event)" /> }
          @case ('analyst') { <sg-analyst-preview /> }
          @case ('intelligence') { <sg-intelligence-view /> }
        }
      </main>
      <sg-case-drawer [caseId]="selected()" (closed)="selected.set(null)" />
    </div>
  `,
})
export class WorkspaceComponent {
  private readonly svc = inject(SupportGuardService);
  protected readonly view = signal<ViewName>("home");
  protected readonly selected = signal<string | null>(null);
  protected readonly items: { view: ViewName; label: string }[] = [
    { view: "home", label: "Inicio" },
    { view: "validation", label: "Validación de casos" },
    { view: "sufficiency", label: "Suficiencia" },
    { view: "analyst", label: "Analista inicial" },
    { view: "intelligence", label: "Support Intelligence" },
  ];

  constructor() {
    void this.svc.initialize();
  }
}
