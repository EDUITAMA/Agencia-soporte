/**
 * Support Guard AI Smoke — MANUAL check against the real local AXET Bridge (not part of `npm test`).
 * Run: npm run smoke:ai --prefix apps/backend   (needs the bridge running; reads SUPPORT_GUARD_AI_* from the environment/.env)
 * Jira stays simulated: cases below are inline and are not the MOCK_JIRA fixtures.
 */
import dotenv from "dotenv";

import { MockJiraAdapter } from "../src/adapters/mock-jira-adapter.js";
import { AIAnalysisService } from "../src/ai/ai-analysis-service.js";
import { AxetBridgeAIProvider } from "../src/ai/axet-bridge-provider.js";
import { createAIProvider } from "../src/ai/create-provider.js";
import { loadConfig } from "../src/config/config.js";
import type { SupportCase } from "../src/domain/types.js";
import { CaseIntakeService } from "../src/intake/case-intake-service.js";
import { StateStore } from "../src/store/state-store.js";

dotenv.config();
const quiet = { error: () => undefined, info: () => undefined, warn: () => undefined };

const base: SupportCase = {
  id: "", externalId: "", source: "JIRA", summary: "", description: "", status: "Open", priority: "Medium",
  application: "Ventas", environment: "Producción", reporter: "Ana Pérez",
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), attachments: [], fields: {},
};
const make = (id: string, patch: Partial<SupportCase>): SupportCase => ({ ...base, id, externalId: id, ...patch });

const CASES: { label: string; case: SupportCase }[] = [
  { label: "A completo y suficiente", case: make("SMOKE-A", {
    summary: "Error 500 al facturar venta a crédito",
    description: "Desde las 8:00 a.m. de hoy, en producción, al facturar una venta a crédito en el módulo de ventas aparece el mensaje \"Error 500: no se pudo generar el documento\". Pasos: 1. Abrir ventas. 2. Seleccionar cliente. 3. Pulsar Facturar. Se esperaba que se generara la factura. Afecta a toda la sucursal norte y bloquea la operación. Adjunto captura del error.",
    priority: "High", attachments: [{ id: "1", filename: "error.png", mimeType: "image/png", size: 1000 }] }) },
  { label: "B vago", case: make("SMOKE-B", { summary: "No sirve", description: "El sistema no funciona." }) },
  { label: "C contexto técnico", case: make("SMOKE-C", {
    summary: "NullPointerException al exportar conciliación",
    description: "Al exportar la conciliación bancaria en producción: java.lang.NullPointerException at ConciliacionExporter.build(ConciliacionExporter.java:212). Ocurre siempre con cuentas en USD desde el día 3. Pasos: 1. Reportes > Conciliación. 2. Filtrar moneda USD. 3. Exportar. Esperado: archivo XLSX. Tesorería no puede cerrar el mes. Log adjunto.",
    priority: "High", application: "Tesorería", attachments: [{ id: "2", filename: "export.log", mimeType: "text/plain", size: 9000 }] }) },
  { label: "D required faltante", case: make("SMOKE-D", {
    summary: "Falla al cargar el tablero de pedidos",
    description: "El tablero de pedidos se queda cargando indefinidamente y nunca muestra datos desde hoy. Antes cargaba en pocos segundos.",
    environment: "" }) },
  { label: "E ambiguo parcial", case: make("SMOKE-E", {
    summary: "Lentitud en el portal",
    description: "A veces el portal está lento y toca recargar varias veces. Pasa más en las tardes.",
    application: "Portal", environment: "Producción" }) },
];

const config = loadConfig({ ...process.env, SUPPORT_GUARD_SOURCE: "MOCK_JIRA" });
if (!config.ai.enabled || config.ai.provider !== "AXET_BRIDGE_LOCAL") {
  console.error("Set SUPPORT_GUARD_AI_ENABLED=true and SUPPORT_GUARD_AI_PROVIDER=AXET_BRIDGE_LOCAL to run the real smoke.");
  process.exit(2);
}

const provider = createAIProvider(config.ai)!;
console.info(`== Support Guard AI Smoke · provider=${provider.name} model=${provider.model} ==`);
console.info("health:", (await provider.healthCheck()).state);
const down = await new AxetBridgeAIProvider({ baseUrl: "http://127.0.0.1:1/v1", model: provider.model, timeoutMs: 2000 }).healthCheck();
console.info("health with bridge unreachable:", down.state);

const store = new StateStore();
const ai = new AIAnalysisService(provider, config.ai, store, quiet);
const intake = new CaseIntakeService(new MockJiraAdapter(CASES.map((item) => item.case)), config, store, quiet, ai);
const started = Date.now();
await intake.run("MANUAL");
console.info(`deterministic validation ready in ${Date.now() - started}ms (AI pending: ${ai.pending})`);
await ai.idle();

for (const { label, case: item } of CASES) {
  const record = store.getCase(item.id)!;
  const result = record.ai?.result;
  console.info(`\n--- ${label} [${item.id}] · deterministic=${record.validationStatus} · ai=${record.ai?.status} · ${record.ai?.durationMs}ms`);
  if (!result) {
    console.info(`  FAILED: ${record.ai?.errorKind} ${record.ai?.errorMessage ?? ""}`);
    continue;
  }
  console.info(`  status=${result.status} confidence=${result.confidence}`);
  console.info(`  summary: ${result.summary}`);
  console.info(`  missing: ${result.missingInformation.map((m) => m.field).join(", ") || "-"}`);
  console.info(`  ambiguities: ${result.ambiguities.join(" | ") || "-"}`);
  console.info(`  questions: ${result.recommendedQuestions.join(" | ") || "-"}`);
  console.info(`  requesterMessage (${result.requesterMessage.length} chars):\n${result.requesterMessage.replace(/^/gm, "    ")}`);
  console.info(`  composed request: ${record.request ? record.request.items.map((i) => i.key).join(", ") : "none"}`);
}

const audits = store.recentAudit(200).filter((entry) => entry.action.startsWith("AI_"));
console.info("\naudit:", audits.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.action]: (acc[e.action] ?? 0) + 1 }), {}));

const slow = createAIProvider({ ...config.ai, timeoutMs: 50 })!;
const slowStore = new StateStore();
const slowAi = new AIAnalysisService(slow, { ...config.ai, timeoutMs: 50 }, slowStore, quiet);
const slowIntake = new CaseIntakeService(new MockJiraAdapter([CASES[0].case]), config, slowStore, quiet, slowAi);
await slowIntake.run("MANUAL");
await slowAi.idle();
const failed = slowStore.getCase("SMOKE-A")!;
console.info(`\ntimeout check (50ms): ai=${failed.ai?.status}/${failed.ai?.errorKind} deterministic=${failed.validationStatus}`);
