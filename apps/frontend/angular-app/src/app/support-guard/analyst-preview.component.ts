import { ChangeDetectionStrategy, Component } from "@angular/core";

/** Static preview only. No analysis logic runs behind this screen; every value below is illustrative. */
@Component({
  selector: "sg-analyst-preview",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="sg-pagehead">
      <div>
        <h1>Analista inicial <span class="sg-chip sg-chip--warn">Demo / Preview</span></h1>
        <p>Analiza el contexto del caso y prepara una primera evaluación técnica para el equipo de soporte.</p>
      </div>
    </header>

    <div class="sg-banner sg-banner--warn" role="status">
      <strong>Initial Case Analyst is not enabled in this version.</strong> La información mostrada es un ejemplo ilustrativo (Demo / Preview) y no proviene de ningún caso real.
    </div>

    <section class="sg-preview" aria-label="Vista previa del analista inicial (datos de ejemplo)" inert>
      <article class="sg-panel">
        <div class="sg-panel__head"><h2>Case</h2><span class="sg-chip">Demo / Preview</span></div>
        <dl class="sg-kv">
          <div><dt>Case</dt><dd>DEMO-000</dd></div>
          <div><dt>Issue summary</dt><dd>Intermitencia al generar facturas desde el módulo de ventas.</dd></div>
          <div><dt>Possible category</dt><dd>Incidente · Integración</dd></div>
          <div><dt>Affected system</dt><dd>Módulo de ventas / servicio de facturación</dd></div>
          <div><dt>Confidence</dt><dd><span class="sg-meter"><i style="width: 70%"></i></span> Media</dd></div>
        </dl>
      </article>

      <article class="sg-panel">
        <div class="sg-panel__head"><h2>Initial assessment</h2><span class="sg-chip">Demo / Preview</span></div>
        <p>Ejemplo: el síntoma sugiere un posible fallo de comunicación entre el módulo de ventas y el servicio de facturación, con mayor probabilidad en horas de alta carga.</p>
      </article>

      <article class="sg-panel">
        <div class="sg-panel__head"><h2>Relevant evidence</h2><span class="sg-chip">Demo / Preview</span></div>
        <ul class="sg-list"><li>Mensaje de error reportado por el usuario (ejemplo)</li><li>Captura de pantalla adjunta (ejemplo)</li><li>Casos previos similares (ejemplo)</li></ul>
      </article>

      <article class="sg-panel">
        <div class="sg-panel__head"><h2>Suggested checks</h2><span class="sg-chip">Demo / Preview</span></div>
        <ul class="sg-list"><li>Revisar el estado del servicio de facturación</li><li>Validar la configuración de la integración</li><li>Revisar registros del momento del incidente</li></ul>
      </article>

      <article class="sg-panel">
        <div class="sg-panel__head"><h2>Possible next steps</h2><span class="sg-chip">Demo / Preview</span></div>
        <ul class="sg-list"><li>Asignar al equipo de integraciones</li><li>Solicitar al usuario la hora exacta del error</li></ul>
      </article>
    </section>
  `,
})
export class AnalystPreviewComponent {}
