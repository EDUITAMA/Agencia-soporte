import "@angular/compiler";
import { Injector, runInInjectionContext } from "@angular/core";
import { describe, expect, it } from "vitest";

import { ApiService } from "./api.service";
import { AppComponent } from "./app.component";
import { AxetSessionService, type AxetSession } from "./axet-session.service";

function createComponent(getSession: () => Promise<AxetSession | null>): AppComponent {
  const injector = Injector.create({
    providers: [
      { provide: ApiService, useValue: { getHealth: () => Promise.resolve() } },
      { provide: AxetSessionService, useValue: { getSession, requestSignIn: () => undefined, requestSignInOnce: () => true } },
    ],
  });
  return runInInjectionContext(injector, () => new AppComponent());
}

describe("AppComponent Okta gate", () => {
  it("keeps the menu hidden while the session is resolving", () => {
    const component = createComponent(() => new Promise(() => undefined));

    expect(component.sessionState()).toBe("resolving");
    expect(component.session()).toBeNull();
  });

  it("stays unauthenticated when the host returns no session", async () => {
    const component = createComponent(() => Promise.resolve(null));
    await new Promise((resolve) => setTimeout(resolve));

    expect(component.sessionState()).toBe("resolved");
    expect(component.session()).toBeNull();
    expect(component.redirecting()).toBe(true);
  });

  it("reveals the workspace only with a valid session", async () => {
    const component = createComponent(() => Promise.resolve({ token: "token", displayName: "Ada Lovelace" }));
    await new Promise((resolve) => setTimeout(resolve));

    expect(component.sessionState()).toBe("resolved");
    expect(component.session()?.displayName).toBe("Ada Lovelace");
  });
});
