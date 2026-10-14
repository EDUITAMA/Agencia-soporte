import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import type { AuditEntry, CaseRecord, WorkflowState } from "./models";

const LABELS: Record<string, string> = {
  COMPLETE: "Completo",
  MISSING_INFORMATION: "Información faltante",
  RETURNED: "Devuelto",
  DRY_RUN: "Dry run",
  ERROR: "Error",
  SUFFICIENT: "Suficiente",
  PARTIALLY_SUFFICIENT: "Parcialmente suficiente",
  INSUFFICIENT: "Insuficiente",
  NOT_EVALUATED: "No evaluado",
  CONNECTED: "Conectado",
  DEGRADED: "Degradado",
  DISCONNECTED: "Desconectado",
  QUEUED: "En cola",
  ANALYZING: "Analizando",
  COMPLETED: "Completado",
  FAILED: "No disponible",
  SKIPPED: "No analizado",
  DISABLED: "Deshabilitado",
};

const TONES: Record<string, string> = {
  QUEUED: "neutral",
  ANALYZING: "info",
  COMPLETED: "ok",
  FAILED: "warn",
  SKIPPED: "neutral",
  DISABLED: "neutral",
  COMPLETE: "ok",
  SUFFICIENT: "ok",
  CONNECTED: "ok",
  MISSING_INFORMATION: "warn",
  PARTIALLY_SUFFICIENT: "warn",
  DEGRADED: "warn",
  DRY_RUN: "info",
  RETURNED: "info",
  ERROR: "danger",
  INSUFFICIENT: "danger",
  DISCONNECTED: "danger",
  NOT_EVALUATED: "neutral",
};

@Component({
  selector: "sg-badge",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="sg-badge" [attr.data-tone]="tone()"><i class="sg-badge__dot"></i>{{ label() }}</span>`,
})
export class StatusBadgeComponent {
  readonly value = input.required<string>();
  readonly text = input<string | undefined>(undefined);
  label = () => this.text() ?? LABELS[this.value()] ?? this.value();
  tone = () => TONES[this.value()] ?? "neutral";
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("es-CO", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const AUDIT_LABELS: Record<string, string> = {
  AI_ANALYSIS_STARTED: "Análisis IA iniciado",
  AI_ANALYSIS_COMPLETED: "Análisis IA completado",
  AI_ANALYSIS_FAILED: "Análisis IA no disponible",
  AI_ANALYSIS_REUSED: "Análisis IA reutilizado",
  CASE_DISCOVERED: "Caso descubierto",
  CASE_VALIDATED: "Caso validado",
  CASE_MISSING_FIELDS: "Campos faltantes detectados",
  CASE_RETURNED: "Caso devuelto",
  CASE_RETURN_DRY_RUN: "Devolución simulada (dry run)",
  SUFFICIENCY_EVALUATED: "Suficiencia evaluada",
  JIRA_ERROR: "Error de Jira",
};

export function workflowState(record: CaseRecord): WorkflowState {
  if (record.validationStatus === "ERROR") return "ERROR";
  if (record.validationStatus === "RETURNED") return "RETURNED";
  if (record.validationStatus === "MISSING_INFORMATION" || record.validationStatus === "DRY_RUN") return "NEEDS_INFO";
  if (record.ai?.status === "QUEUED" || record.ai?.status === "ANALYZING") return "AI_REVIEWING";
  if (record.ai?.status === "COMPLETED" && record.ai.result && record.ai.result.status !== "SUFFICIENT") return "NEEDS_INFO";
  return "READY";
}

const WORKFLOW: Record<WorkflowState, { label: string; icon: string; tone: string; hint: string }> = {
  READY: { label: "Listo para soporte", icon: "✓", tone: "ok", hint: "Información suficiente para iniciar la atención" },
  NEEDS_INFO: { label: "Requiere información", icon: "!", tone: "warn", hint: "Se debe solicitar información al solicitante" },
  AI_REVIEWING: { label: "IA en revisión", icon: "◌", tone: "info", hint: "Análisis de suficiencia en curso" },
  RETURNED: { label: "Devuelto", icon: "↩", tone: "info", hint: "Caso devuelto al solicitante" },
  ERROR: { label: "Error", icon: "✕", tone: "danger", hint: "Ocurrió un error al procesar el caso" },
};

@Component({
  selector: "sg-workflow",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="sg-badge sg-badge--workflow" [attr.data-tone]="meta().tone" [title]="meta().hint"><b aria-hidden="true">{{ meta().icon }}</b>{{ meta().label }}</span>`,
})
export class WorkflowBadgeComponent {
  readonly state = input.required<WorkflowState>();
  meta = () => WORKFLOW[this.state()];
}

/** Display status of the AI layer for one case, as a badge value understood by sg-badge. */
export function aiDisplay(record: CaseRecord): { value: string; label: string } {
  const ai = record.ai;
  if (!ai) return { value: "NOT_EVALUATED", label: "Sin analizar" };
  switch (ai.status) {
    case "QUEUED":
    case "ANALYZING":
      return { value: "ANALYZING", label: "Analizando" };
    case "FAILED":
      return { value: "FAILED", label: "IA no disponible" };
    case "SKIPPED":
      return { value: "NOT_EVALUATED", label: "Sin analizar" };
    default:
      return ai.result ? { value: ai.result.status, label: AI_RESULT_LABEL[ai.result.status] } : { value: "NOT_EVALUATED", label: "Sin analizar" };
  }
}

const AI_RESULT_LABEL: Record<string, string> = { SUFFICIENT: "Suficiente", PARTIALLY_SUFFICIENT: "Parcialmente suficiente", INSUFFICIENT: "Insuficiente" };

/** Human sentence for the activity feed. */
export function activityText(entry: AuditEntry): string {
  switch (entry.action) {
    case "CASE_MISSING_FIELDS":
      return "Información faltante detectada";
    case "CASE_RETURN_DRY_RUN":
      return "Would return case · DRY RUN";
    case "CASE_RETURNED":
      return "Caso devuelto al solicitante";
    case "CASE_VALIDATED":
      return "Caso validado · completo";
    case "CASE_DISCOVERED":
      return "Nuevo caso detectado";
    case "SUFFICIENCY_EVALUATED":
      return `Suficiencia evaluada · ${AI_RESULT_LABEL[entry.result] ?? entry.result}`;
    case "AI_ANALYSIS_COMPLETED":
      return `Análisis IA completado · ${AI_RESULT_LABEL[entry.result] ?? entry.result}`;
    case "AI_ANALYSIS_REUSED":
      return `Análisis IA reutilizado · ${AI_RESULT_LABEL[entry.result] ?? entry.result}`;
    case "AI_ANALYSIS_STARTED":
      return "Análisis IA iniciado";
    case "AI_ANALYSIS_FAILED":
      return "Análisis IA no disponible";
    case "JIRA_ERROR":
      return "Error de Jira";
    default:
      return AUDIT_LABELS[entry.action] ?? entry.action;
  }
}
