import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";

import { ApiService } from "./api.service";
import { AxetSessionService, type AxetSession } from "./axet-session.service";
import { WorkspaceComponent } from "./support-guard/workspace.component";

type ConnectionState = "Checking" | "Connected" | "Unavailable";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [WorkspaceComponent],
  template: `
    @if (sessionState() === "resolving") {
      <main class="login-shell" aria-busy="true">
        <p class="login-card__note">Verificando tu sesión…</p>
      </main>
    } @else if (!session()) {
      <main class="login-shell">
        <section class="login-card" aria-labelledby="login-title">
          <span class="brand__mark" aria-hidden="true">SG</span>
          <h1 id="login-title">Support Guard</h1>
          <p>
            @if (redirecting()) { Redirigiendo a Okta… } @else { Para ingresar debes autenticarte con tu cuenta corporativa. }
          </p>
          <button type="button" class="button button--primary" (click)="signIn()">Ingresar con Okta / aXet</button>
          <p class="login-card__note">La autenticación se gestiona con tu sesión Okta y aXet.</p>
        </section>
      </main>
    } @else {
    <main class="application-shell">
      <header class="topbar">
        <a class="brand" href="/" aria-label="Support Guard home">
          <span class="brand__mark" aria-hidden="true">SG</span>
          <span>Support Guard</span>
        </a>
        <div class="topbar__status">
          <span class="status-dot" [class.status-dot--online]="connectionState() === 'Connected'"></span>
          <span>Plataforma {{ connectionText() }}</span>
          @if (session(); as currentSession) {
            <span class="identity-card__avatar" [title]="currentSession.email ?? ''">{{ initials(currentSession) }}</span>
          }
        </div>
      </header>

      <sg-workspace />
    </main>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  readonly connectionState = signal<ConnectionState>("Checking");
  readonly connectionText = () => ({ Checking: "verificando", Connected: "conectada", Unavailable: "no disponible" })[this.connectionState()];
  readonly session = signal<AxetSession | null>(null);
  readonly sessionState = signal<"resolving" | "resolved">("resolving");
  readonly redirecting = signal(false);
  private readonly api = inject(ApiService);
  private readonly axetSession = inject(AxetSessionService);

  constructor() {
    void this.initialize();
  }

  initials(session: AxetSession): string {
    const label = session.displayName ?? session.email ?? "AX";
    return label
      .split(/\s+|@/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");
  }

  signIn(): void {
    this.axetSession.requestSignIn();
  }

  private async initialize(): Promise<void> {
    void this.checkHealth();
    const session = await this.axetSession.getSession();
    this.session.set(session);
    this.sessionState.set("resolved");
    if (!session) this.redirecting.set(this.axetSession.requestSignInOnce());
  }

  private async checkHealth(): Promise<void> {
    try {
      await this.api.getHealth();
      this.connectionState.set("Connected");
    } catch {
      this.connectionState.set("Unavailable");
    }
  }
}
