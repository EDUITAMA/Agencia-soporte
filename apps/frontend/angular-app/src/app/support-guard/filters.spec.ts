import { describe, expect, it } from "vitest";

import { EMPTY_FILTERS, filterCases } from "./filters";
import type { CaseRecord } from "./models";

function record(id: string, summary: string, validationStatus: CaseRecord["validationStatus"], priority = "High"): CaseRecord {
  return {
    caseId: id,
    supportCase: { id, source: "JIRA", summary, description: "", status: "Open", priority, application: "ERP", environment: "", reporter: "", createdAt: "", updatedAt: "", attachments: [], fields: {} },
    validationStatus,
    validation: { valid: validationStatus === "COMPLETE", missingFields: [], missingLabels: [] },
    sufficiency: { status: "SUFFICIENT", score: 80, missingInformation: [], checks: [], explanation: "", recommendation: "" },
    lastAction: null,
    lastCheckedAt: "",
  };
}

describe("filterCases", () => {
  const data = [record("SUP-1", "Login falla", "COMPLETE"), record("SUP-2", "Reporte lento", "DRY_RUN", "Low")];

  it("searches by key or summary", () => {
    expect(filterCases(data, { ...EMPTY_FILTERS, search: "sup-2" })).toHaveLength(1);
    expect(filterCases(data, { ...EMPTY_FILTERS, search: "login" })[0].caseId).toBe("SUP-1");
  });

  it("combines validation and priority filters", () => {
    expect(filterCases(data, { ...EMPTY_FILTERS, validation: "DRY_RUN", priority: "Low" })).toHaveLength(1);
    expect(filterCases(data, { ...EMPTY_FILTERS, validation: "COMPLETE", priority: "Low" })).toHaveLength(0);
  });
});
