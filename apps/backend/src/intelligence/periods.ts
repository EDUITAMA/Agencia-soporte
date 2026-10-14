import type { PeriodType, ResolvedPeriod } from "./types.js";

export class PeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeriodError";
  }
}

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const toMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day: string, delta: number) => toDay(toMs(day) + delta * DAY_MS);
export const daysBetween = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / DAY_MS) + 1;

function assertDay(value: string | undefined, name: string): string {
  if (!value || !ISO_DAY.test(value) || Number.isNaN(toMs(value)) || toDay(toMs(value)) !== value) throw new PeriodError(`${name} must be a valid date (YYYY-MM-DD)`);
  return value;
}

function formatDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return `${date} ${MONTHS[month - 1]} ${year}`;
}

const label = (from: string, to: string) => (from === to ? formatDay(from) : `${formatDay(from)} → ${formatDay(to)}`);

function monthRange(month: string): { from: string; to: string } {
  if (!ISO_MONTH.test(month)) throw new PeriodError("month must use the format YYYY-MM");
  const [year, monthIndex] = month.split("-").map(Number);
  if (monthIndex < 1 || monthIndex > 12) throw new PeriodError("month must be between 01 and 12");
  const from = `${month}-01`;
  const next = monthIndex === 12 ? `${year + 1}-01-01` : `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
  return { from, to: addDays(next, -1) };
}

export interface PeriodRequest {
  type: PeriodType;
  month?: string;
  day?: string;
  from?: string;
  to?: string;
}

export interface PeriodLimits {
  maxCustomDays: number;
  warnCustomDays: number;
}

/** Resolves a period request to explicit calendar days. "now" is injectable so results are deterministic in tests. */
export function resolvePeriod(request: PeriodRequest, limits: PeriodLimits, now: Date = new Date()): ResolvedPeriod {
  const today = toDay(now.getTime());
  const yesterday = addDays(today, -1);
  const warnings: string[] = [];
  let from: string;
  let to: string;

  switch (request.type) {
    case "MONTHLY": {
      const month = request.month ?? monthOf(addDays(`${today.slice(0, 7)}-01`, -1));
      ({ from, to } = monthRange(month));
      if (from > today) throw new PeriodError("No se puede analizar un mes futuro");
      if (to >= today) warnings.push("El mes seleccionado aún no termina; el análisis será parcial");
      break;
    }
    case "BIWEEKLY":
      to = yesterday;
      from = addDays(to, -14);
      break;
    case "WEEKLY":
      to = yesterday;
      from = addDays(to, -6);
      break;
    case "DAILY": {
      const day = request.day ? assertDay(request.day, "day") : yesterday;
      if (day > today) throw new PeriodError("No se puede analizar un día futuro");
      if (day === today) warnings.push("El día actual está incompleto; el análisis será parcial");
      from = to = day;
      break;
    }
    case "CUSTOM": {
      from = assertDay(request.from, "from");
      to = assertDay(request.to, "to");
      if (from > to) throw new PeriodError("La fecha inicial no puede ser posterior a la final");
      if (from > today) throw new PeriodError("El rango no puede comenzar en el futuro");
      const span = daysBetween(from, to);
      if (span > limits.maxCustomDays) throw new PeriodError(`El rango máximo permitido es de ${limits.maxCustomDays} días`);
      if (span > limits.warnCustomDays) warnings.push(`El rango abarca ${span} días; el análisis puede tardar más`);
      if (to > today) warnings.push("El rango incluye días futuros; solo se analizarán casos existentes");
      break;
    }
    default:
      throw new PeriodError("Unknown period type");
  }
  return { type: request.type, from, to, label: label(from, to), days: daysBetween(from, to), warnings };
}

function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** Builds a ResolvedPeriod from stored dates, so every layer reads the exact same period the run was created with. */
export function periodFromRange(type: PeriodType, from: string, to: string): ResolvedPeriod {
  return { type, from, to, label: label(from, to), days: daysBetween(from, to), warnings: [] };
}

/** The period of equal scope immediately before the given one (previous calendar month for MONTHLY). */
export function previousPeriod(period: ResolvedPeriod): { from: string; to: string } {
  if (period.type === "MONTHLY") return monthRange(monthOf(addDays(period.from, -1)));
  return { from: addDays(period.from, -period.days), to: addDays(period.from, -1) };
}

/** Upper-exclusive bound used in JQL (`created < "to+1"`). */
export const exclusiveEnd = (period: { to: string }) => addDays(period.to, 1);
