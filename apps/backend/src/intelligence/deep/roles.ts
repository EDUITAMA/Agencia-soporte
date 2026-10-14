import { ROLE_PROMPT_VERSIONS, type AITask } from "../config.js";
import { fold } from "../text.js";
import type { CanonicalUnit } from "../types.js";
import type { Segmentation } from "./segmentation.js";

export type RoleId = "FAILURE" | "FUNCTIONAL" | "TECHNICAL" | "INFRA";
export type RoleTask = Extract<AITask, "ROLE_FAILURE" | "ROLE_FUNCTIONAL" | "ROLE_TECHNICAL" | "ROLE_INFRA">;

export interface RoleDefinition {
  id: RoleId;
  task: RoleTask;
  name: string;
  mission: string;
}

export const ROLES: Record<RoleId, RoleDefinition> = {
  FAILURE: { id: "FAILURE", task: "ROLE_FAILURE", name: "Modos de falla", mission: "Describe cada modo de falla observado: qué ocurre, en cuántos casos y qué lo distingue de los demás. No propongas causas que los casos no muestren." },
  FUNCTIONAL: { id: "FUNCTIONAL", task: "ROLE_FUNCTIONAL", name: "Funcional", mission: "Evalúa reglas de negocio, datos maestros, parametrización y proceso. Indica si el comportamiento parece esperado, un defecto, un problema de configuración o de proceso, solo si los casos lo respaldan." },
  TECHNICAL: { id: "TECHNICAL", task: "ROLE_TECHNICAL", name: "Técnico", mission: "Analiza mensajes de error, códigos, excepciones, endpoints y componentes de integración citados en los casos. Plantea hipótesis técnicas solo con señales presentes." },
  INFRA: { id: "INFRA", task: "ROLE_INFRA", name: "Infraestructura", mission: "Analiza disponibilidad, red, latencia y capacidad únicamente con señales explícitas en los casos. Sin esas señales no atribuyas infraestructura." },
};

export const promptVersionOf = (role: RoleId): string => ROLE_PROMPT_VERSIONS[ROLES[role].task];

export interface RoleSelection {
  selected: { role: RoleId; reason: string }[];
  skipped: { role: RoleId; reason: string }[];
}

const FUNCTIONAL = /regla|parametr|configur|dato maestro|maestro|proceso|validacion|asociacion|permiso|perfil|usuario|solicitud de|ajuste|creacion|actualizacion|costo|precio|contrato|factura/;
const INFRA = /timeout|timed out|tiempo de espera|connection|conexion|latencia|disponibilidad|service unavailable|servicio no disponible|bad gateway|caida|red\b/;

/** Chooses roles from the evidence actually present; every decision (selected or skipped) is explained and persisted. */
export function selectRoles(units: CanonicalUnit[], segmentation: Segmentation): RoleSelection {
  const text = fold(units.map((unit) => [unit.root.summary, unit.errorMessage, unit.closeMessage, unit.root.description].join(" ")).join(" \n "));
  const withError = units.filter((unit) => unit.errorUseful || unit.errorMessage.trim()).length;
  const signatures = new Set(segmentation.groups.map((group) => group.signature));
  const infraSignature = ["TIMEOUT", "CONNECTIVITY"].some((id) => signatures.has(id));
  const technicalSignature = [...signatures].some((id) => !["OTHER", "DEPLOYMENT"].includes(id));
  const selected: RoleSelection["selected"] = [{ role: "FAILURE", reason: "Siempre se describe el patrón de falla antes de cualquier hipótesis." }];
  const skipped: RoleSelection["skipped"] = [];
  const decide = (role: RoleId, enabled: boolean, yes: string, no: string) => (enabled ? selected.push({ role, reason: yes }) : skipped.push({ role, reason: no }));

  const functional = FUNCTIONAL.test(text);
  const technical = withError > 0 || technicalSignature;
  decide("FUNCTIONAL", functional || !technical, functional ? "Los casos describen reglas, datos o procesos de negocio." : "Sin señales técnicas, el análisis funcional es el único disponible.", "Los casos no describen reglas, datos ni procesos de negocio.");
  decide("TECHNICAL", technical, `Hay mensajes de error o firmas técnicas (${withError} caso(s) con mensaje de error).`, "No hay mensajes de error ni firmas técnicas en los casos.");
  decide("INFRA", infraSignature || INFRA.test(text), "Hay señales explícitas de red, tiempo de espera o disponibilidad.", "No hay señales de disponibilidad, red o capacidad.");
  return { selected, skipped };
}

const CONTRACT = `{"summary": string, "claims": [{"id","claim","failureGroupId","level","confidence","evidence":[{"evidenceId","jiraKey","field","excerpt"}],"limitations":[]}], "recommendations": [{"action","rationale","owner","priority":"HIGH|MEDIUM|LOW","relatedClaimIds":["id"]}], "missingInformation": [string]}`;

export function rolePrompt(role: RoleDefinition): string {
  return [
    `Eres el especialista "${role.name}" de un equipo de análisis de casos de soporte de Jira. ${role.mission}`,
    `Responde solo JSON con esta forma: ${CONTRACT}. Pon el resumen del rol en "clusterSummary" (el campo "summary" es opcional).`,
    "Reglas estrictas:",
    "- level solo puede ser OBSERVED_PATTERN, HYPOTHESIS o LIKELY_CAUSE. Nunca declares una causa confirmada.",
    "- excerpt debe ser un fragmento LITERAL del campo citado, sin parafrasear. Una afirmación sin cita verificable se descarta.",
    "- Cada claim pertenece a un failureGroupId; no unas modos de falla distintos bajo una sola causa. Los grupos sin firma común solo admiten OBSERVED_PATTERN.",
    "- Usa solo la evidencia entregada y no inventes datos. Si no alcanza para una causa, reporta el patrón observado y la limitación.",
    "- Las recomendaciones son acciones de investigación o corrección, cada una ligada a relatedClaimIds; no recomiendes acciones genéricas.",
    "- missingInformation solo incluye datos concretos que cambiarían la conclusión.",
  ].join("\n");
}
