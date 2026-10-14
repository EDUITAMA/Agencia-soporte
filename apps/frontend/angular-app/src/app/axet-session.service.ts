import { Injectable } from "@angular/core";

interface AxetHostUserInfo {
  jwt?: unknown;
  displayName?: unknown;
  email?: unknown;
  userName?: unknown;
}

interface AxetHostService {
  getUserInfo?: () => AxetHostUserInfo | Promise<AxetHostUserInfo | undefined> | undefined;
}

export interface AxetSession {
  token: string;
  displayName?: string;
  email?: string;
}

@Injectable({ providedIn: "root" })
export class AxetSessionService {
  async getSession(): Promise<AxetSession | null> {
    try {
      const hostService = (globalThis as typeof globalThis & { DeptAppService?: AxetHostService }).DeptAppService;
      const userInfo = await hostService?.getUserInfo?.();
      const token = this.toText(userInfo?.jwt);

      if (!token) return null;

      return {
        token,
        displayName: this.firstText(userInfo?.displayName, userInfo?.userName),
        email: this.toText(userInfo?.email),
      };
    } catch {
      return null;
    }
  }

  requestSignIn(): void {
    if (typeof globalThis.location === "undefined") return;

    const authUrl = new URL("/flows/backend/okta/auth", globalThis.location.origin);
    authUrl.searchParams.set("redirectUri", `${globalThis.location.origin}${globalThis.location.pathname}`);
    globalThis.location.assign(authUrl.toString());
  }

  /**
   * Starts the Okta handoff automatically, at most once per 30 seconds, so a host
   * that cannot issue a session never causes a redirect loop. Returns whether it redirected.
   */
  requestSignInOnce(): boolean {
    const storage = globalThis.sessionStorage;
    const key = "okta-handoff-at";
    const last = Number(storage?.getItem(key) ?? 0);
    if (Date.now() - last < 30_000) return false;

    storage?.setItem(key, String(Date.now()));
    this.requestSignIn();
    return true;
  }

  async getAuthorizationToken(): Promise<string | null> {
    const session = await this.getSession();
    return session?.token ?? null;
  }

  private firstText(...values: unknown[]): string | undefined {
    return values.map((value) => this.toText(value)).find((value): value is string => Boolean(value));
  }

  private toText(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }
}
