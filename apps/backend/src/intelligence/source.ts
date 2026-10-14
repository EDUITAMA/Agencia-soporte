import type { JiraIssue } from "../adapters/jira-normalizer.js";
import type { IntelligenceConfig } from "./config.js";

export interface SearchOptions {
  fields: string[];
  pageSize: number;
  /** Hard ceiling; exceeding it throws instead of silently truncating. */
  maxCases: number;
  onPage?: (fetched: number, total: number) => void;
}

/** Read-only port used by the analytical pipeline. It deliberately exposes no write operation. */
export interface HistoricalIssueSource {
  readonly mode: "REAL_JIRA" | "MOCK_JIRA";
  readonly baseUrl?: string;
  searchIssues(jql: string, options: SearchOptions): Promise<JiraIssue[]>;
}

export class SearchLimitError extends Error {
  constructor(readonly total: number, readonly limit: number) {
    super(`La consulta devuelve ${total} casos y el máximo permitido es ${limit}. Reduzca el periodo.`);
  }
}

const DAY = 86_400_000;
const THEMES = [
  { key: "db", summary: "Timeout al consultar facturas en el portal", description: "Al consultar facturas del cliente el portal tarda más de un minuto y finalmente muestra un error.", error: "ORA-01013: user requested cancel of current operation", close: "Se ajustó el índice de la tabla de facturas y se reinició el pool de conexiones.", service: "Facturación", classification: "Incidente", team: "Operaciones" },
  { key: "auth", summary: "Usuario no puede iniciar sesión en la aplicación", description: "El usuario ingresa credenciales correctas pero recibe acceso denegado al abrir la aplicación.", error: "HTTP 403 Forbidden: acceso denegado", close: "Se reasignó el perfil de acceso del usuario en el directorio.", service: "Accesos", classification: "Solicitud", team: "Seguridad" },
  { key: "report", summary: "Reporte de ventas no exporta a Excel", description: "Al presionar exportar el reporte de ventas diarias el archivo no se genera.", error: "NullPointerException en ExportService.generate", close: "Se corrigió la validación de fechas nulas en el servicio de exportación.", service: "Reportes", classification: "Incidente", team: "Desarrollo" },
  { key: "conn", summary: "Servicio de pagos no disponible intermitentemente", description: "Los pagos fallan de forma intermitente durante la mañana con mensaje de servicio no disponible.", error: "503 Service Unavailable: connection refused", close: "", service: "Pagos", classification: "Incidente", team: "Infraestructura" },
  { key: "data", summary: "Datos de cliente duplicados en el maestro", description: "Se observan clientes duplicados en el maestro con el mismo documento.", error: "", close: "Se depuraron los duplicados y se agregó restricción de unicidad.", service: "Clientes", classification: "Incidente", team: "Datos" },
] as const;

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Deterministic demo history so the analytical module can run without Jira. Not real data. */
export class MockHistoricalSource implements HistoricalIssueSource {
  readonly mode = "MOCK_JIRA" as const;
  readonly baseUrl = "https://demo.invalid";

  constructor(private readonly fieldIds: IntelligenceConfig["fieldIds"]) {}

  private issue(day: string, theme: (typeof THEMES)[number], themeIndex: number, n: number, withChild: boolean): JiraIssue[] {
    const stamp = day.replaceAll("-", "").slice(2);
    const key = `DEMO-${stamp}${themeIndex}${n}`;
    const created = `${day}T0${8 + themeIndex}:15:00.000+0000`;
    const closed = Boolean(theme.close);
    const ids = this.fieldIds;
    const fields = (extra: Record<string, unknown>) => ({
      priority: { name: n === 0 ? "Alta" : "Media" },
      reporter: { displayName: "Usuario Demo" },
      created,
      updated: created,
      labels: [],
      status: { name: closed ? "Cerrado" : "En progreso", statusCategory: { key: closed ? "done" : "indeterminate" } },
      resolution: closed ? { name: "Resuelto" } : null,
      resolutiondate: closed ? `${day}T18:00:00.000+0000` : null,
      comment: { comments: [{ id: `${key}-1`, author: { displayName: "Analista Demo" }, created, body: `Revisando el caso ${theme.summary.toLowerCase()}.` }] },
      ...extra,
    });
    const parent: JiraIssue = {
      id: key,
      key,
      fields: fields({
        summary: `${theme.summary}`,
        description: theme.description,
        issuetype: { name: "Support" },
        [ids.service]: { value: theme.service },
        [ids.team]: { value: theme.team },
        [ids.classification]: { value: theme.classification },
        [ids.errorMessage]: theme.error,
        [ids.closeMessage]: theme.close,
        [ids.totalHours]: String(2 + themeIndex),
      }),
    } as JiraIssue;
    if (!withChild) return [parent];
    const childKey = `${key}-S`;
    return [
      parent,
      { id: childKey, key: childKey, fields: fields({ summary: `Validar ${theme.service.toLowerCase()} con el equipo`, description: "", issuetype: { name: "Sub-Support" }, parent: { key }, [ids.totalHours]: "1" }) } as JiraIssue,
    ];
  }

  async searchIssues(jql: string, options: SearchOptions): Promise<JiraIssue[]> {
    const keys = /key in \(([^)]*)\)/i.exec(jql);
    if (keys) return []; // demo parents are always returned together with their children
    const from = /created >= "(\d{4}-\d{2}-\d{2})/i.exec(jql)?.[1];
    const until = /created < "(\d{4}-\d{2}-\d{2})/i.exec(jql)?.[1];
    if (!from || !until) return [];
    const issues: JiraIssue[] = [];
    for (let ms = Date.parse(from); ms < Date.parse(until); ms += DAY) {
      const day = ymd(ms);
      const dayNumber = Math.floor(ms / DAY);
      THEMES.forEach((theme, index) => {
        if ((dayNumber + index) % 3 !== 0) return;
        const count = (dayNumber + index) % 2 === 0 ? 2 : 1;
        for (let n = 0; n < count; n++) issues.push(...this.issue(day, theme, index, n, (dayNumber + n) % 2 === 0));
      });
    }
    if (issues.length > options.maxCases) throw new SearchLimitError(issues.length, options.maxCases);
    options.onPage?.(issues.length, issues.length);
    return issues;
  }
}
