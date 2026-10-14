import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { ApplicationRef, provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";

import { AppComponent } from "./app/app.component";
import { oktaSessionInterceptor } from "./app/okta-session.interceptor";

let appRef: ApplicationRef | null = null;

// The aXet host page owns #page-top; the app replaces its content, as the Terpel app does.
async function mount(): Promise<void> {
  const root = document.getElementById("page-top");
  if (!root) {
    console.error("Mount target #page-top not found");
    return;
  }

  appRef?.destroy();
  root.replaceChildren(document.createElement("app-root"));
  appRef = await bootstrapApplication(AppComponent, {
    providers: [provideZonelessChangeDetection(), provideHttpClient(withInterceptors([oktaSessionInterceptor]))],
  });
}

function unmount(): void {
  appRef?.destroy();
  appRef = null;
  document.getElementById("page-top")?.replaceChildren();
}

void mount().catch((error: unknown) => console.error("Angular bootstrap failed", error));
(globalThis as Record<string, unknown>)["__appUnmount"] = unmount;
