import type { CaseSourceAdapter } from "./case-source.js";
import type { SupportGuardConfig } from "../config/config.js";
import { JiraRestAdapter } from "./jira-rest-adapter.js";
import { MockJiraAdapter } from "./mock-jira-adapter.js";

export function createSourceAdapter(config: SupportGuardConfig): CaseSourceAdapter {
  return config.sourceMode === "REAL_JIRA" ? new JiraRestAdapter({ config }) : new MockJiraAdapter();
}
