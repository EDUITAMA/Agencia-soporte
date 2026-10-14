const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

interface Kpi {
  label: string;
  value: number;
  unit: string;
  previous: number | null;
  changePct: number | null;
  tone: string | null;
  note?: string;
}

interface ExecutiveContent {
  period?: { label?: string; from?: string; to?: string };
  operationalStatus?: string;
  narrative?: { headline?: string; periodSummary?: string; keyChanges?: string[]; topRisks?: string[]; importantFindings?: string[]; recommendedFocus?: string[]; limitations?: string[] };
  narrativeSource?: string;
  kpis?: Kpi[];
  topProblems?: { title: string; cases: number; open: number; trend: string; priority: string; why: string[]; rcaLevel: string | null }[];
  rootCause?: { counts?: Record<string, number>; coverage?: { percentage?: number } };
  recommendations?: { type: string; action: string; cluster: string; basis: string | null }[];
  dataQuality?: { level?: string; score?: number };
  limitations?: string[];
}

const list = (items?: string[]) => (items?.length ? `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : "<p class=\"muted\">Sin elementos.</p>");

/** Print-friendly executive report. Plain HTML/CSS: the browser's "Save as PDF" is the export path. */
export function renderExecutiveHtml(report: { version: number; generatedAt: string; dataFingerprint: string; content: unknown }): string {
  const content = (report.content ?? {}) as ExecutiveContent;
  const narrative = content.narrative ?? {};
  const kpis = (content.kpis ?? []).map((item) => `<div class="kpi"><div class="label">${esc(item.label)}</div><div class="value">${esc(item.value)}</div><div class="delta">${item.previous === null ? "Sin período anterior" : `${esc(item.previous)} antes${item.changePct === null ? "" : ` · ${item.changePct >= 0 ? "+" : ""}${Math.round(item.changePct * 100)}%`}`}</div></div>`).join("");
  const problems = (content.topProblems ?? []).map((problem) => `<tr><td>${esc(problem.title)}</td><td>${esc(problem.cases)}</td><td>${esc(problem.open)}</td><td>${esc(problem.trend)}</td><td>${esc(problem.priority)}</td><td>${esc(problem.why.join("; "))}</td></tr>`).join("");
  const counts = content.rootCause?.counts ?? {};
  const recs = (content.recommendations ?? []).map((rec) => `<tr><td>${esc(rec.type)}</td><td>${esc(rec.action)}</td><td>${esc(rec.cluster)}</td><td>${esc(rec.basis ?? "—")}</td></tr>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte ejecutivo — ${esc(content.period?.label)}</title><style>
body{font:14px/1.5 "Segoe UI",Arial,sans-serif;color:#1b2430;margin:32px auto;max-width:900px;padding:0 24px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px;border-bottom:1px solid #d9dee5;padding-bottom:4px}
.muted{color:#66707d}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.kpi{border:1px solid #d9dee5;border-radius:8px;padding:10px}
.label{font-size:12px;color:#66707d}.value{font-size:22px;font-weight:600}.delta{font-size:12px;color:#66707d}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #d9dee5;padding:6px 8px;text-align:left;vertical-align:top;font-size:13px}th{background:#f3f5f8}
@media print{body{margin:12mm}.kpi,tr{break-inside:avoid}}</style></head><body>
<h1>${esc(narrative.headline ?? "Reporte ejecutivo")}</h1>
<div class="muted">${esc(content.period?.label)} · Estado: ${esc(content.operationalStatus)} · Versión ${esc(report.version)} · Generado ${esc(report.generatedAt)}</div>
<p>${esc(narrative.periodSummary)}</p>
<h2>Indicadores</h2><div class="kpis">${kpis}</div>
<h2>Cambios clave</h2>${list(narrative.keyChanges)}
<h2>Principales problemas</h2><table><tr><th>Problema</th><th>Casos</th><th>Abiertos</th><th>Tendencia</th><th>Prioridad</th><th>Por qué</th></tr>${problems}</table>
<h2>Causas validadas</h2><p>Respaldadas: ${esc(counts.supported ?? 0)} · Probables: ${esc(counts.likely ?? 0)} · Hipótesis: ${esc(counts.hypotheses ?? 0)} · Evidencia insuficiente: ${esc(counts.insufficient ?? 0)}</p>${list(narrative.importantFindings)}
<h2>Acciones recomendadas</h2><table><tr><th>Tipo</th><th>Acción</th><th>Problema</th><th>Base</th></tr>${recs}</table>
<h2>Calidad de datos</h2><p>${esc(content.dataQuality?.level)} (${esc(content.dataQuality?.score)} puntos)</p>
<h2>Limitaciones</h2>${list(narrative.limitations?.length ? narrative.limitations : content.limitations)}
<p class="muted">Huella de datos ${esc(report.dataFingerprint.slice(0, 12))}. Narrativa: ${esc(content.narrativeSource ?? "")}. Las causas probables no son causas confirmadas.</p>
</body></html>`;
}
