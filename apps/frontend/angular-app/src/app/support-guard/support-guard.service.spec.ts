import "@angular/compiler";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { Injector } from "@angular/core";
import { of, throwError } from "rxjs";
import { describe, expect, it } from "vitest";

import type { CaseRecord } from "./models";
import { SupportGuardService } from "./support-guard.service";
import { activityText, aiDisplay, workflowState } from "./ui";

function setup(startup: () => unknown) {
  const calls: string[] = [];
  const http = {
    get: (url: string) => {
      calls.push(`GET ${url}`);
      return of(url.endsWith("/cases") ? { cases: [] } : { ai: { pending: 0 } });
    },
    post: (url: string) => {
      calls.push(`POST ${url}`);
      return url.endsWith("/sync/startup") ? (startup() as ReturnType<typeof of>) : of({});
    },
  };
  const injector = Injector.create({ providers: [{ provide: HttpClient, useValue: http }, { provide: SupportGuardService, useClass: SupportGuardService, deps: [] }] });
  return { svc: injector.get(SupportGuardService), calls };
}

describe("SupportGuardService startup sync", () => {
  it("syncs once even when initialize() is called repeatedly", async () => {
    const { svc, calls } = setup(() => of({ performed: true, summary: { found: 0 } }));
    await Promise.all([svc.initialize(), svc.initialize(), svc.initialize()]);
    expect(calls.filter((call) => call === "POST /api/support-guard/sync/startup")).toHaveLength(1);
    expect(svc.syncing()).toBe(false);
  });

  it("keeps the dashboard usable and flags Jira as unavailable when the sync fails", async () => {
    const { svc } = setup(() => throwError(() => new HttpErrorResponse({ status: 502 })));
    await svc.initialize();
    expect(svc.jiraUnavailable()).toBe(true);
    expect(svc.syncing()).toBe(false);
    expect(svc.overview()).not.toBeNull();
  });
});

describe("workflow and AI display helpers", () => {
  const base = { validationStatus: "COMPLETE" } as CaseRecord;

  it("derives workflow states from validation and AI status", () => {
    expect(workflowState({ ...base, validationStatus: "MISSING_INFORMATION" })).toBe("NEEDS_INFO");
    expect(workflowState({ ...base, ai: { status: "ANALYZING" } as CaseRecord["ai"] })).toBe("AI_REVIEWING");
    expect(workflowState({ ...base, ai: { status: "COMPLETED", result: { status: "INSUFFICIENT" } } as CaseRecord["ai"] })).toBe("NEEDS_INFO");
    expect(workflowState(base)).toBe("READY");
    expect(workflowState({ ...base, validationStatus: "ERROR" })).toBe("ERROR");
  });

  it("describes AI states and activity in plain language", () => {
    expect(aiDisplay({ ...base, ai: { status: "FAILED" } as CaseRecord["ai"] }).label).toBe("IA no disponible");
    expect(aiDisplay(base).label).toBe("Sin analizar");
    expect(activityText({ timestamp: "", caseId: "S-1", action: "AI_ANALYSIS_COMPLETED", result: "SUFFICIENT" })).toBe("Análisis IA completado · Suficiente");
    expect(activityText({ timestamp: "", caseId: "S-1", action: "CASE_RETURN_DRY_RUN", result: "" })).toBe("Would return case · DRY RUN");
  });
});

