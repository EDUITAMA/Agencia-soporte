import { createHash } from "node:crypto";

import { fold, round, truncate } from "./text.js";
import type { CanonicalUnit, FailureGroup } from "./types.js";

interface SignatureRule {
  id: string;
  label: string;
  pattern: RegExp;
}

/** Ordered by specificity: the first match defines the failure mode of a case. */
const RULES: SignatureRule[] = [
  { id: "DB_ERROR", label: "Error de base de datos", pattern: /\b(ora-\d+|sqlstate\s?\w+|sql\s?error|deadlock|constraint violation|unique constraint)\b/ },
  { id: "TIMEOUT", label: "Tiempo de espera agotado", pattern: /time-?out|timed out|tiempo de espera|tiempo agotado|exceeded/ },
  { id: "CONNECTIVITY", label: "Conectividad / servicio no disponible", pattern: /connection (refused|reset|closed)|conexion (rechazada|fallida|perdida)|no hay conexion|service unavailable|servicio no disponible|bad gateway/ },
  { id: "HTTP_5XX", label: "Error de servidor (HTTP 5xx)", pattern: /\b(?:http|status|codigo|code|error)\s*:?\s*5\d\d\b|\b5\d\d\s+(?:internal|error)|internal server error/ },
  { id: "HTTP_4XX", label: "Error de solicitud (HTTP 4xx)", pattern: /\b(?:http|status|codigo|code|error)\s*:?\s*4\d\d\b|\b404 not found|bad request/ },
  { id: "PERMISSION", label: "Permisos / autenticación", pattern: /permiso|acceso denegado|access denied|forbidden|unauthori[sz]ed|no autorizado|credencial|token (invalido|expirado)|sesion expirada/ },
  { id: "DATA_NOT_FOUND", label: "Dato inexistente o inconsistente", pattern: /no existe|not found|no se encuentra|no encontrad|inconsistente|duplicad|dato incorrecto|datos incorrectos/ },
  { id: "EXCEPTION", label: "Excepción de aplicación", pattern: /\b[a-z]+(?:exception|error)\b|nullpointer|null pointer|stack ?trace|traceback/ },
  { id: "DEPLOYMENT", label: "Despliegue / configuración", pattern: /despliegue|deploy|configuracion|parametriz|parametro|release|pase a produccion/ },
];

export function detectSignature(unit: CanonicalUnit): { id: string; label: string; signals: string[] } {
  const haystack = fold([unit.root.summary, unit.errorMessage, unit.root.description, unit.closeMessage, ...unit.children.map((child) => child.summary)].join(" \n "));
  for (const rule of RULES) {
    const match = rule.pattern.exec(haystack);
    if (match) return { id: rule.id, label: rule.label, signals: [truncate(match[0].trim(), 60)] };
  }
  return { id: "OTHER", label: "Sin firma técnica común", signals: [] };
}

export const SIGNIFICANT_GROUP_MIN_CASES = 2;
export const SIGNIFICANT_GROUP_MIN_PERCENT = 10;

/**
 * A cluster can contain several failure modes. Cases are split by detected technical signature so one cause is not
 * proposed for cases that only share an application or a topic. Insignificant signatures fall into OTHER.
 */
export function segmentFailures(members: CanonicalUnit[]): FailureGroup[] {
  const bySignature = new Map<string, { label: string; units: CanonicalUnit[]; signals: Set<string> }>();
  for (const unit of members) {
    const signature = detectSignature(unit);
    const entry = bySignature.get(signature.id) ?? { label: signature.label, units: [], signals: new Set<string>() };
    entry.units.push(unit);
    signature.signals.forEach((signal) => entry.signals.add(signal));
    bySignature.set(signature.id, entry);
  }
  const total = members.length;
  const significant = (units: number) => units >= SIGNIFICANT_GROUP_MIN_CASES || (units / total) * 100 >= SIGNIFICANT_GROUP_MIN_PERCENT;

  const merged = new Map<string, { label: string; units: CanonicalUnit[]; signals: Set<string> }>();
  for (const [id, entry] of bySignature) {
    const target = id !== "OTHER" && significant(entry.units.length) ? id : "OTHER";
    const existing = merged.get(target) ?? { label: target === "OTHER" ? "Sin firma técnica común" : entry.label, units: [], signals: new Set<string>() };
    existing.units.push(...entry.units);
    entry.signals.forEach((signal) => existing.signals.add(signal));
    merged.set(target, existing);
  }

  return [...merged]
    .map(([signature, entry]) => ({
      id: `fg_${createHash("sha1").update(`${entry.units.map((unit) => unit.canonicalKey).sort().join("|")}:${signature}`).digest("hex").slice(0, 12)}`,
      signature,
      label: entry.label,
      members: entry.units.map((unit) => unit.canonicalKey).sort(),
      percentage: round((entry.units.length / total) * 100, 1),
      signals: [...entry.signals].slice(0, 5),
      representative: entry.units.slice(0, 3).map((unit) => unit.canonicalKey),
    }))
    .sort((a, b) => b.members.length - a.members.length || a.signature.localeCompare(b.signature));
}
