# Terpel Flows Design System

## Overview

Terpel Flows uses a clear, corporate visual system for analytical and operational workflows. It combines NTT blue with neutral surfaces, restrained elevation, and a strong information hierarchy so data, evidence, and user actions remain easy to scan.

The full extracted guide is maintained in [terpel-flows-DESIGN.md](./terpel-flows-DESIGN.md). This document is the concise root-level reference for the same visual adjustments.

---

## Colors

| Token | Value | Purpose |
| --- | --- | --- |
| Primary | `#0072BC` | Main actions, links, and highlighted metrics. |
| Primary Dark | `#004B85` | Hover states and high-emphasis brand elements. |
| Primary Light | `#E6F2FA` | Light blue surfaces and subtle hover backgrounds. |
| Secondary | `#13192C` | Institutional contrast and auxiliary dark text. |
| Accent | `#00A3E0` | Informational accents and secondary indicators. |
| Background | `#F8FAFC` | Application canvas. |
| Surface | `#FFFFFF` | Cards, forms, and elevated content. |
| Surface Muted | `#F1F5F9` | Secondary sections and card footers. |
| Text Primary | `#111827` | Titles and primary data. |
| Text Secondary | `#4B5563` | Supporting descriptions and labels. |
| Text Muted | `#6B7280` | Metadata and low-priority content. |
| Border | `#E5E7EB` | Standard separators and card borders. |
| Border Strong | `#CBD5E1` | Form control and emphasized borders. |
| Success | `#16A34A` | Successful states. |
| Warning | `#F59E0B` | Attention states. |
| Error | `#DC2626` | Errors and destructive actions. |
| Info | `#0284C7` | Informational states. |

## Typography

- **Font family**: `'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif`
- **Headlines and metrics**: weights 600-700.
- **Actions and emphasized data**: weight 500.
- **xs**: `0.75rem`
- **sm**: `0.875rem`
- **base**: `1rem`
- **lg**: `1.125rem`
- **xl**: `1.25rem`
- **2xl**: `1.5rem`
- **3xl**: `1.875rem`

---

## Spacing

Base unit: **0.25rem**

- **xs**: `0.25rem`
- **sm**: `0.5rem`
- **md**: `1rem`
- **lg**: `1.5rem`
- **xl**: `2rem`
- **2xl**: `3rem`

## Border Radius

- **sm** (`8px`): Compact controls and buttons.
- **md** (`12px`): Standard cards and containers.
- **lg** (`18px`): Higher-emphasis panels.

## Elevation

- **shadow-sm**: `0 1px 3px rgba(15, 23, 42, 0.06)` for subtle elevation.
- **shadow-card**: `0 8px 24px rgba(15, 23, 42, 0.08)` for cards and process steps.
- **transition-base**: `0.2s ease` for interactive changes.

## Components

### Application Shell

- **Sidebar width**: `260px`.
- **Header height**: `64px`.
- **Content width**: maximum `1280px`.
- **Canvas**: `#F8FAFC`, with white cards for grouped content.

### Buttons

Use the shared `.btn` base class: inline-flex alignment, `0.625rem 1.25rem` padding, `8px` radius, and `0.2s ease` transition.

#### Primary

- `.btn--primary`: primary blue background and border (`#0072BC`).
- White text; hover changes background and border to `#004B85`.

#### Secondary

- `.btn--secondary`: white background, primary text, and strong neutral border.
- Hover uses the muted surface (`#F1F5F9`).

#### Ghost

- `.btn--ghost`: transparent background and primary blue text.
- Hover uses the primary-light surface (`#E6F2FA`).

#### Danger

- `.btn--danger`: pale red background, dark red text, and translucent red border.
- Use only for destructive or irreversible actions.

#### Size and state

- `.btn--sm`: compact actions.
- `.btn--lg`: primary actions with greater emphasis.
- `.btn--icon`: square icon control.
- Disabled controls use opacity `0.55` and `not-allowed` cursor.

### Cards

Use `.card` as the standard content container:

- White surface with `1px` neutral border.
- `12px` radius and light elevation.
- Header and body with `1.5rem` padding.
- Footer with muted surface, top border, and horizontal action layout through `.card__footer--actions`.

### Metric Cards

Use `.metric-card` for key figures:

- Label in small, secondary text.
- Value at `1.5rem`, weight `700`.
- Trend in extra-small, muted text.
- Apply `.metric-card--primary` to highlight the metric value in NTT blue.

### Step Cards

Use `.step-card` to represent a workflow phase, wizard step, or guided process:

- White surface, standard border, `12px` radius.
- `2rem` padding and card elevation.

### Summary Rows

Use `.summary-row` for label-value details:

- Horizontal distribution with a secondary label and right-aligned value.
- Standard bottom divider, removed from the final row.

---

## Interaction and Accessibility

- Use subtle hover feedback; do not introduce decorative animation that competes with operational data.
- Preserve semantic colors: success (`#16A34A`), warning (`#F59E0B`), error (`#DC2626`), and info (`#0284C7`).
- Do not communicate status through color alone; combine it with text, iconography, or a status label.
- Reuse tokens and existing component classes rather than hardcoding equivalent values.
- Keep visible contrast between text, borders, and surfaces.

---

## Do's and Don'ts

1. Do use the NTT blue scale for primary actions and brand emphasis.
2. Do use white cards over the cool neutral page background.
3. Do maintain shared spacing, radius, and shadow tokens.
4. Do use semantic colors only for their corresponding state.
5. Do prioritize content hierarchy and data readability.
6. Don't use game-themed colors, retro ribbons, confetti, or decorative bounce effects.
7. Don't replace standard component patterns when `.btn`, `.card`, or `.metric-card` is appropriate.
8. Don't hardcode colors when an existing global token represents the same intent.
