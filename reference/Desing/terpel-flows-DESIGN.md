# Terpel Flows Design System

## Propósito

Esta guía documenta el lenguaje visual actual de la aplicación Angular de Terpel Flows. Centraliza los tokens, la jerarquía visual y los patrones de interfaz para que nuevas pantallas y componentes mantengan coherencia con el producto.

## Referencia de implementación

- Tokens globales: `frontend/angular-app/src/styles/_tokens.scss`
- Botones reutilizables: `frontend/angular-app/src/styles/_buttons.scss`
- Tarjetas reutilizables: `frontend/angular-app/src/styles/_cards.scss`
- Carga de estilos globales: `frontend/angular-app/src/styles/styles.scss`
- Estilos específicos por módulo: `frontend/angular-app/src/app/**/**/*.scss`

---

## Fundamentos visuales

### Personalidad

La interfaz utiliza una estética corporativa, clara y analítica:

- Azul NTT como color de marca y acción principal.
- Fondos fríos muy claros para separar capas sin recargar la pantalla.
- Superficies blancas, bordes sutiles y sombras discretas para tarjetas y paneles.
- Tipografía del sistema, legible y sobria para datos operativos.
- Estados semánticos consistentes para éxito, alerta, error e información.

### Paleta de color

| Token | Valor | Uso principal |
| --- | --- | --- |
| `--ntt-primary` | `#0072BC` | Acción principal, enlaces y métricas destacadas. |
| `--ntt-primary-dark` | `#004B85` | Hover, énfasis y superficies de marca intensas. |
| `--ntt-primary-light` | `#E6F2FA` | Fondos suaves, hover y elementos secundarios. |
| `--ntt-secondary` | `#13192C` | Contraste institucional y texto oscuro auxiliar. |
| `--ntt-accent` | `#00A3E0` | Información, indicadores y acentos complementarios. |
| `--color-background` | `#F8FAFC` | Fondo general de la aplicación. |
| `--color-surface` | `#FFFFFF` | Tarjetas, formularios y contenedores elevados. |
| `--color-surface-muted` | `#F1F5F9` | Áreas secundarias, pies de tarjeta y fondos sutiles. |
| `--color-text-primary` | `#111827` | Títulos, datos y texto de mayor jerarquía. |
| `--color-text-secondary` | `#4B5563` | Descripciones y etiquetas de apoyo. |
| `--color-text-muted` | `#6B7280` | Metadatos y contenido de baja jerarquía. |
| `--color-border` | `#E5E7EB` | Separadores y bordes estándar. |
| `--color-border-strong` | `#CBD5E1` | Controles y bordes con mayor presencia. |
| `--color-success` | `#16A34A` | Estados exitosos. |
| `--color-warning` | `#F59E0B` | Alertas y estados de atención. |
| `--color-error` | `#DC2626` | Errores y acciones destructivas. |
| `--color-info` | `#0284C7` | Mensajes informativos y contexto adicional. |

### Tipografía

```css
font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
```

| Token | Tamaño | Uso |
| --- | --- | --- |
| `--font-size-xs` | `0.75rem` | Metadatos, tendencias y acciones compactas. |
| `--font-size-sm` | `0.875rem` | Etiquetas, botones y texto secundario. |
| `--font-size-base` | `1rem` | Texto y títulos de tarjeta. |
| `--font-size-lg` | `1.125rem` | Encabezados secundarios. |
| `--font-size-xl` | `1.25rem` | Subtítulos y datos relevantes. |
| `--font-size-2xl` | `1.5rem` | Métricas destacadas. |
| `--font-size-3xl` | `1.875rem` | Títulos de página y datos clave. |

Pesos recomendados:

- `500`: botones y valores que requieren énfasis moderado.
- `600`: títulos de tarjeta y encabezados de sección.
- `700`: métricas y títulos de alto impacto.

---

## Espaciado y dimensiones

### Escala de espaciado

| Token | Valor |
| --- | --- |
| `--spacing-xs` | `0.25rem` |
| `--spacing-sm` | `0.5rem` |
| `--spacing-md` | `1rem` |
| `--spacing-lg` | `1.5rem` |
| `--spacing-xl` | `2rem` |
| `--spacing-2xl` | `3rem` |

También se mantienen los alias `--space-xs`, `--space-sm`, `--space-md` y `--space-lg` para los componentes que ya los consumen.

### Dimensiones de estructura

| Token | Valor | Uso |
| --- | --- | --- |
| `--sidebar-width` | `260px` | Navegación lateral. |
| `--header-height` | `64px` | Barra superior. |
| `--content-max-width` | `1280px` | Ancho máximo para el contenido principal. |

### Bordes y elevación

| Token | Valor | Uso |
| --- | --- | --- |
| `--radius-sm` | `8px` | Controles y botones compactos. |
| `--radius-md` | `12px` | Tarjetas y contenedores estándar. |
| `--radius-lg` | `18px` | Contenedores de mayor énfasis. |
| `--shadow-sm` | `0 1px 3px rgba(15, 23, 42, 0.06)` | Elevación ligera. |
| `--shadow-card` | `0 8px 24px rgba(15, 23, 42, 0.08)` | Tarjetas y pasos destacados. |

La transición base es `--transition-base: 0.2s ease`.

---

## Patrones de interfaz

### Botones

La clase base es `.btn`. Alinea el contenido al centro, usa `inline-flex`, separación interna `--spacing-sm`, borde transparente y transición base.

| Variante | Clase | Tratamiento |
| --- | --- | --- |
| Principal | `.btn--primary` | Fondo y borde `--ntt-primary`; texto blanco; hover en `--ntt-primary-dark`. |
| Secundaria | `.btn--secondary` | Fondo blanco, texto principal y borde reforzado; hover con fondo atenuado. |
| Fantasma | `.btn--ghost` | Fondo transparente, texto azul de marca; hover en azul claro. |
| Peligro | `.btn--danger` | Fondo rojo claro, texto rojo oscuro y borde rojo translúcido. |

Tamaños disponibles:

- `.btn--sm`: compacto, para acciones secundarias.
- Predeterminado: acción estándar.
- `.btn--lg`: acciones principales de mayor presencia.
- `.btn--icon`: botón cuadrado para iconos.

Estados obligatorios:

- `:hover:not(:disabled)` debe comunicar interactividad sin alterar la jerarquía visual.
- `:disabled` utiliza opacidad `0.55` y cursor `not-allowed`.
- Los grupos de acciones usan `.btn-group`, con `flex-wrap` y separación `--spacing-sm`.

### Tarjetas y paneles

La clase `.card` representa el contenedor principal de contenido:

- Fondo `--color-surface`.
- Borde de `1px` en `--color-border`.
- Radio `--radius-md`.
- Elevación `--shadow-sm`.

Estructura recomendada:

```html
<section class="card">
  <header class="card__header">
    <h2 class="card__title">Título</h2>
    <p class="card__subtitle">Contexto breve</p>
  </header>
  <div class="card__body">Contenido</div>
  <footer class="card__footer card__footer--actions">Acciones</footer>
</section>
```

El encabezado y el cuerpo usan `--spacing-lg`. El pie usa un fondo atenuado y concentra acciones con separación `--spacing-md`.

### Tarjetas de métricas

`.metric-card` prioriza la lectura de indicadores:

- Etiqueta en tamaño pequeño y color secundario.
- Valor en `--font-size-2xl`, peso `700` y color de texto principal.
- Tendencia en tamaño extra pequeño y color atenuado.
- `.metric-card--primary` cambia el valor al azul de marca.

### Tarjetas de pasos

`.step-card` comunica procesos, formularios por etapas o flujos guiados:

- Fondo blanco y borde estándar.
- Radio medio.
- Padding `--spacing-xl`.
- Sombra de tarjeta para dar continuidad al flujo.

### Filas de resumen

`.summary-row` organiza pares etiqueta-valor con:

- Distribución horizontal mediante `flex`.
- Etiqueta secundaria sin reducción.
- Valor de peso medio alineado a la derecha.
- Separador inferior, excepto en la última fila.

---

## Composición de pantallas

1. Usar el fondo general `--color-background` como primera capa.
2. Limitar el contenido central con `--content-max-width`.
3. Presentar información relacionada dentro de tarjetas blancas con separación consistente.
4. Priorizar una acción principal azul por contexto; las acciones adicionales deben ser secundarias o fantasma.
5. Reservar los colores semánticos para su significado: verde para éxito, ámbar para alerta, rojo para error y azul informativo para contexto.
6. Mantener bordes tenues y sombras discretas: la prioridad es la legibilidad de datos, no el efecto decorativo.
7. En vistas con datos operativos, utilizar títulos claros, métricas destacadas y textos secundarios para contexto.

## Accesibilidad y consistencia

- Mantener contraste suficiente entre texto y superficies.
- No comunicar estados solo con color; acompañarlos con texto, icono o etiqueta.
- Respetar los estados deshabilitados y hover definidos por los componentes base.
- Evitar colores hardcodeados cuando exista un token semántico equivalente.
- Reutilizar `.btn`, `.card`, `.metric-card`, `.step-card` y `.summary-row` antes de crear variantes visuales nuevas.
- Mantener espacios, radios, sombras y tamaños tipográficos definidos por los tokens globales.

## Aplicación de los ajustes

Los ajustes visuales extraídos de este documento quedan documentados también en `flip7-card-game-DESIGN.md`, adaptados al contexto corporativo de Terpel Flows. Ese archivo debe usarse como referencia resumida cuando se necesite consultar la paleta y la forma de los componentes.