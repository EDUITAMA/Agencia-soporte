import type { ConnectionStatus, SupportCase } from "../domain/types.js";
import { type CaseSourceAdapter, type ReturnEvidence, type ReturnOptions, SourceError } from "./case-source.js";

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

function demoCase(partial: Partial<SupportCase> & Pick<SupportCase, "id" | "summary">, hours: number): SupportCase {
  return {
    externalId: partial.id,
    source: "JIRA",
    description: "",
    status: "Open",
    priority: "Medium",
    application: "",
    environment: "",
    reporter: "Demo Reporter",
    createdAt: hoursAgo(hours),
    updatedAt: hoursAgo(hours),
    attachments: [],
    fields: {},
    ...partial,
  };
}

/** Development-only source. It is selected explicitly with SUPPORT_GUARD_SOURCE=MOCK_JIRA and is flagged in the UI. */
export function demoCases(): SupportCase[] {
  return [
    demoCase(
      {
        id: "DEMO-101",
        summary: "Error al facturar en el módulo de ventas",
        description:
          "Al intentar facturar una venta a crédito en producción, el sistema muestra el mensaje \"Error 500: no se pudo generar el documento\". Pasos: 1. Abrir el módulo de ventas. 2. Seleccionar cliente. 3. Pulsar Facturar. Se esperaba que se generara la factura. Afecta a todos los usuarios de la sucursal norte y bloquea la operación.",
        priority: "High",
        application: "Ventas",
        environment: "Producción",
        attachments: [{ id: "1", filename: "captura-error.png", mimeType: "image/png", size: 48211 }],
      },
      2,
    ),
    demoCase(
      {
        id: "DEMO-102",
        summary: "El sistema no funciona",
        description: "El sistema no funciona.",
        priority: "High",
        application: "Portal",
        environment: "Producción",
      },
      5,
    ),
    demoCase(
      {
        id: "DEMO-103",
        summary: "Solicitud de acceso a reportes",
        description: "Solicito acceso de lectura a los reportes financieros para el usuario maria.gomez en el ambiente de producción por cambio de cargo.",
        priority: "Low",
        application: "Reportes",
        environment: "Producción",
      },
      9,
    ),
    demoCase(
      {
        id: "DEMO-104",
        summary: "Falla en integración de inventario",
        description: "La integración de inventario falla desde ayer y no sincroniza las existencias con el almacén central.",
        priority: "Medium",
      },
      12,
    ),
    demoCase(
      {
        id: "DEMO-105",
        summary: "Lentitud en consulta de pedidos",
        description:
          "Desde la mañana la consulta de pedidos tarda más de un minuto en QA. Actualmente la pantalla se queda cargando; se esperaba una respuesta en pocos segundos. Impacta a los usuarios del equipo de bodega.",
        priority: "Medium",
        application: "Pedidos",
        environment: "QA",
        reporter: "N/A",
      },
      20,
    ),
    demoCase(
      {
        id: "DEMO-106",
        summary: "Caída intermitente del servicio de autenticación",
        description: "El servicio de login presenta caídas intermitentes. Código HTTP 503 en los intentos fallidos. Afecta a los usuarios de la aplicación móvil en producción.",
        priority: "Highest",
        application: "Autenticación",
        environment: "Producción",
      },
      30,
    ),
    demoCase(
      {
        id: "DEMO-107",
        summary: "NullPointerException al exportar conciliación bancaria",
        description:
          "Al exportar la conciliación bancaria del cierre mensual en producción aparece: \"java.lang.NullPointerException at ConciliacionExporter.build(ConciliacionExporter.java:212)\". Ocurre cada vez desde el 3 de este mes con cuentas en USD. Se esperaba el archivo XLSX. Hora del último intento 09:42; el equipo de tesorería no puede cerrar el mes. Adjunto el log completo.",
        priority: "High",
        application: "Tesorería",
        environment: "Producción",
        attachments: [{ id: "2", filename: "export-error.log", mimeType: "text/plain", size: 9120 }],
      },
      3,
    ),
    demoCase(
      {
        id: "DEMO-108",
        summary: "No puedo ingresar",
        description: "No funciona.",
        priority: "Medium",
        application: "Portal",
        environment: "QA",
      },
      1,
    ),
  ];
}

/** Dev hook: what the requester of DEMO-108 would add after being asked for information (used to demo re-evaluation). */
export const DEMO_108_UPDATE: Partial<SupportCase> = {
  description:
    "Al iniciar sesión en el portal de QA con mi usuario corporativo aparece el mensaje \"Credenciales inválidas\" desde esta mañana; ayer funcionaba. Esperaba entrar al tablero principal. Probé en dos navegadores con el mismo resultado y afecta solo a mi usuario.",
};

export class MockJiraAdapter implements CaseSourceAdapter {
  readonly sourceName = "Jira (mock)";
  readonly mode = "MOCK_JIRA" as const;
  private cases: Map<string, SupportCase>;
  /** Test hook: when set, every call fails with this error. */
  failWith: SourceError | null = null;
  /** Test hook: the comment is accepted but the transition fails (partial failure). */
  failTransition: SourceError | null = null;
  readonly returned: { id: string; comment: string }[] = [];

  constructor(initial: SupportCase[] = demoCases()) {
    this.cases = new Map(initial.map((item) => [item.id, { ...item }]));
  }

  private guard(): void {
    if (this.failWith) throw this.failWith;
  }

  /** Test/dev hook to simulate a reporter editing a case. */
  updateCase(id: string, patch: Partial<SupportCase>): void {
    const current = this.cases.get(id);
    if (current) this.cases.set(id, { ...current, ...patch, updatedAt: new Date().toISOString() });
  }

  async healthCheck(): Promise<ConnectionStatus> {
    const base = { source: this.sourceName, mode: this.mode, checkedAt: new Date().toISOString() };
    if (this.failWith) return { ...base, state: "DISCONNECTED", message: this.failWith.userMessage };
    return { ...base, state: "CONNECTED", latencyMs: 1, message: "Fuente simulada (MOCK_JIRA) — no es Jira real" };
  }

  async fetchNewCases(): Promise<SupportCase[]> {
    this.guard();
    return [...this.cases.values()].filter((item) => item.status === "Open").map((item) => ({ ...item }));
  }

  async getCase(id: string): Promise<SupportCase> {
    this.guard();
    const found = this.cases.get(id);
    if (!found) throw new SourceError("NOT_FOUND", `mock case ${id} not found`, 404);
    return { ...found };
  }

  async addComment(id: string, body: string): Promise<void> {
    this.guard();
    this.returned.push({ id, comment: body });
  }

  async returnForInformation(id: string, comment: string, options: ReturnOptions = {}): Promise<ReturnEvidence> {
    this.guard();
    const found = this.cases.get(id);
    if (!found) throw new SourceError("NOT_FOUND", `mock case ${id} not found`, 404);
    if (!options.skipComment) {
      this.returned.push({ id, comment });
      options.onCommentPosted?.();
    }
    if (this.failTransition) throw this.failTransition;
    this.cases.set(id, { ...found, status: "Pending Information" });
    return { type: "RETURNED", detail: "Mock transition applied", evidence: { transitionName: "Pending Information (mock)" } };
  }
}
