---
name: Esploro
description: Modern, sleek, fast SQL client for Mac
colors:
  accent-blue: "#2563eb"
  accent-blue-hover: "#1d4ed8"
  accent-blue-subtle: "#dbeafe"
  ink: "#1b1b1f"
  text-secondary: "#6b7280"
  text-tertiary: "#9ca3af"
  content-white: "#ffffff"
  sidebar-gray: "#f5f5f7"
  subtle-warm-gray: "#f0efed"
  active-warm-gray: "#e4e2df"
  separator: "#d4d2ce"
  border-strong: "#bab8b4"
  control-bg: "#f3f1ef"
  success-green: "#16a34a"
  warning-amber: "#d97706"
  destructive-red: "#dc2626"
  syntax-keyword-violet: "#7c3aed"
  syntax-type-amber: "#b45309"
  syntax-string-green: "#15803d"
  syntax-number-cyan: "#0891b2"
  syntax-enum-orange: "#ea580c"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif"
    fontSize: "14px"
    fontWeight: 600
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif"
    fontSize: "12px"
    fontWeight: 500
  mono:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Monaco, 'Courier New', monospace"
    fontSize: "12px"
    lineHeight: 1.5
rounded:
  badge: "4px"
  control: "6px"
  popover: "8px"
  panel: "10px"
  modal: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "20px"
components:
  button-primary:
    backgroundColor: "{colors.accent-blue}"
    textColor: "{colors.content-white}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-primary-hover:
    backgroundColor: "{colors.accent-blue-hover}"
  button-secondary:
    backgroundColor: "{colors.control-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-secondary-hover:
    backgroundColor: "{colors.subtle-warm-gray}"
  button-destructive:
    backgroundColor: "{colors.destructive-red}"
    textColor: "{colors.content-white}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
---

# Design System: Esploro

## 1. Overview

**Creative North Star: "The Quiet Workbench"**

Esploro is a craftsman's bench for databases: everything within reach, dense, nothing ornamental. The interface is built so the data — grids, schema trees, query results — carries the visual weight, while chrome recedes into flat, hairline-separated surfaces. It reads as a native macOS tool (SF Pro at 13px, system materials, light/dark parity), not a web app that happens to run in a window.

The system is **two-layered**: a palette layer (`--ds-*` tokens) defines the raw colors per theme, and a semantic craft contract (`--surface-*`, `--border-*`, `--text-*`, `--state-*`, `--schema-*`, `--data-*`, `--query-*`) maps them to roles. Components consume only the semantic layer. This is what makes eleven palettes (Tairiki light/dark default, plus Tokyo Night, GitHub, Catppuccin, Rosé Pine variants) work without touching a component: **never hardcode a color; always go through the contract.**

This system explicitly rejects the pgAdmin/DBeaver school of enterprise clutter (toolbar sprawl, dialog mazes) and generic SaaS web-app styling (cards, decorative shadows, marketing gradients).

**Key Characteristics:**
- Professional-tool density: 13px UI type, 12px mono data, compact rows
- Flat surfaces separated by hairlines; shadows strictly mean "floats above the workspace"
- Restrained color: blue accent for actions/selection/focus only; the rich color lives in data (syntax, type badges, enum chips)
- Fast, functional motion (100–220ms); nothing choreographed
- Theme-agnostic components via the semantic token contract

## 2. Colors

Restrained neutrals frame the workspace; saturated color is reserved for the accent and, above all, for meaning in the data itself.

### Primary
- **Action Blue** (`#2563eb` light / `#60a5fa` dark, via `--ds-accent`): primary buttons, current selection, focus rings, "running" query state, filtered/sorted indicators. Used on well under 10% of any screen — its rarity is what makes selection legible.
- **Action Blue Hover** (`#1d4ed8` / `#93c5fd`, via `--ds-accent-hover`) and **Blue Tint** (`#dbeafe` / `#1e3a5f`, via `--ds-accent-subtle`) for hover states and chip/badge tints.

### Secondary
The **syntax palette** — a fixed vocabulary of meaning-carrying hues used for tree icons, type badges, column-type coloring, enum chips, and the SQL editor:
- **Keyword Violet** (`#7c3aed`): SQL keywords, schemas, foreign keys
- **Type Amber** (`#b45309`): type names, timestamps, dates
- **String Green** (`#15803d`): strings, text columns, tables
- **Number Cyan** (`#0891b2`): numeric columns, views, JSON (deliberately distinct from Action Blue)
- **Enum Orange** (`#ea580c`): enums, custom types, sequences

### Tertiary
Semantic state: **Success Green** (`#16a34a`), **Warning Amber** (`#d97706`, also "modified cell" and primary-key gold), **Destructive Red** (`#dc2626`). Dark theme uses the -400 equivalents.

### Neutral
The Tairiki neutrals are warm-tinted grays, two-layered (content vs. sidebar/panel):
- **Ink** (`#1b1b1f`): primary text — warm near-black, never pure black.
- **Secondary** (`#6b7280`) / **Tertiary** (`#9ca3af`): supporting text, placeholders, disabled, NULL/empty data values.
- **Content White** (`#ffffff`) vs. **Sidebar Gray** (`#f5f5f7`): the second neutral layer that separates workspace from chrome.
- **Subtle** (`#f0efed`, hover) → **Active** (`#e4e2df`, selected): the interaction ramp.
- **Separator** (`#d4d2ce`) and **Border Strong** (`#bab8b4`): hairlines and focus-adjacent borders.
- Dark equivalents center on `#1c1c1e` content / `#161618` sidebar (macOS-warm, not cold).

### Named Rules
**The Contract Rule.** Components never reference `--ds-*` palette tokens or raw hex. They consume the semantic layer only (`--surface-*`, `--border-*`, `--text-*`, `--state-*`, `--schema-*`, `--data-*`, `--query-*`). Breaking this breaks all eleven themes at once.

**The Data-Owns-Color Rule.** Chrome is neutral. Saturation belongs to meaning: syntax highlighting, type badges, enum chips, state indicators. If a decorative element wants color, the answer is no.

**The Tint Formula.** Colored chips/badges (enum values) are built from their hue via `color-mix`: 12% background tint, 28% border tint, full-strength text. Never solid colored fills for passive labels.

## 3. Typography

**Body Font:** SF Pro Text via system stack (`-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif`) — user-switchable to bundled Inter Variable in Settings.
**Mono Font:** SF Mono via `ui-monospace` stack — user-switchable to bundled JetBrains Mono Variable. Used for SQL, data values, and identifiers.

**Character:** A single quiet sans for all chrome, with a monospace that does the real work. Type contrast comes from weight and size steps of one notch, never from display faces.

### Hierarchy
- **Title** (600, 14px): dialog titles, panel headers. The largest type in the app; there is no "display" tier.
- **Body** (400, 13px, `--font-ui-size`): the default for all UI chrome — sidebar, tabs, menus, forms.
- **Label** (500, 12px): buttons, badges, column headers, secondary labels.
- **Mono** (400, 12px, line-height 1.5, `--font-editor`): SQL editor, grid cell values, type names, keys. Tables run dense and wide; the 65–75ch prose cap applies only to descriptions and empty-state copy.

### Named Rules
**The One-Notch Rule.** Adjacent hierarchy levels differ by one step (12 → 13 → 14px) and/or one weight grade. No jumps, no display sizes; density with legibility.

**The Mono-Means-Data Rule.** Monospace marks database content (SQL, values, identifiers, types). UI chrome is never mono; data is never proportional.

## 4. Elevation

Flat by default. Surfaces at rest are separated by hairline borders (`--shadow-hairline`: 1px inset of `--border-subtle`) and the two-layer neutral system (sidebar vs. content), not by shadows. A shadow strictly means the element **floats above the workspace**.

### Shadow Vocabulary
- **Hairline** (`inset 0 0 0 1px var(--border-subtle)`): resting separation for panels and insets.
- **Popover** (`0 12px 30px rgba(0,0,0,0.18)` via color-mix): menus, dropdowns, command palette.
- **Modal** (`0 20px 60px rgba(0,0,0,0.24)` via color-mix): dialogs, over a `bg-black/40 backdrop-blur-sm` overlay.
- **Active Pane** (`0 0 0 1px var(--border-focus), 0 0 0 4px` accent at 16%): marks the focused split pane.

### Named Rules
**The Floats-Above Rule.** Shadows appear only on transient layers (popover, modal) and the active-pane ring. A resting panel with a drop shadow is a bug.

## 5. Components

Precise and unobtrusive: small, quiet controls that recede behind the data. All motion uses the tokens: `--motion-fast` 100ms / `--motion-base` 150ms / `--motion-slow` 220ms with `--ease-standard` cubic-bezier(0.2, 0, 0, 1); entrances use `--ease-enter` cubic-bezier(0.16, 1, 0.3, 1).

### Buttons
- **Shape:** gently rounded (6px, `--radius-control`), compact padding (`px-3 py-1.5`), 12px medium-weight label.
- **Primary:** Action Blue fill, inverse text; hover shifts to Action Blue Hover; active drops to 80% opacity.
- **Secondary:** control background (`#f3f1ef` / white-6% in dark) with 1px separator border, ink text; hover → subtle, active → pressed.
- **Destructive:** Destructive Red fill, inverse text, hover 90% opacity.
- **Focus:** global `:focus-visible` ring — 2px Action Blue outline, 2px offset. Never removed without replacement.

### Chips / Badges
- **Style:** 4px radius (`--radius-badge`), tint formula (12% background, 28% border, full-color text). Enum values rotate through the 8-color `--data-enum-*` cycle.
- **Type badges** color by column type via the syntax palette.

### Cards / Containers
- **Corner Style:** panels 10px (`--radius-panel`), popovers 8px, modals 12px.
- **Background:** `--surface-raised` (content bg) on modals/popovers; `--surface-inset` for wells.
- **Shadow Strategy:** per Elevation — hairline at rest, shadow only when floating.
- **Border:** 1px `--border-default` separators; `--border-subtle` (55% separator) for internal hairlines.
- **Internal Padding:** 20px (`px-5`) for dialog bodies; 8–12px for dense panels.

### Inputs / Fields
- **Style:** control background, 1px separator border, 6px radius, 13px text.
- **Focus:** border shifts to `--border-focus` (accent) or focus-visible ring; no glow.
- **Placeholder / Disabled:** tertiary text; disabled uses `--text-disabled` (tertiary at 62%).
- **Error:** `--border-danger`.

### Navigation
- **Sidebar (Schema tree):** sidebar-gray surface, 13px rows, hover → `--surface-hover`, selected → `--surface-selected`; object icons colored by the `--schema-*` accents (table green, view cyan, function amber, sequence orange, key gold).
- **Tab bar:** workspace tabs on the content surface; active tab joins the content background, inactive tabs sit on sidebar gray.
- **Command palette:** popover-shadowed overlay, mono for identifiers.

### Data Grid (signature component)
The reason the app exists. Dense mono rows (12px, 1.5 line-height); cell values colored by type via `--data-*` tokens (NULL/empty in tertiary gray, booleans green/gray, numbers cyan, dates amber, JSON cyan); modified cells marked with Warning Amber; filtered/sorted columns marked with Action Blue. Selection uses `--surface-selected`, never accent fills, so value colors stay readable.

## 6. Do's and Don'ts

### Do:
- **Do** route every color through the semantic contract (`--surface-*`, `--text-*`, `--state-*`, `--data-*`); this is what keeps all eleven palettes working.
- **Do** keep controls compact and quiet: 6px radius, `px-3 py-1.5`, 12px medium labels, accent only on the primary action.
- **Do** use the tint formula (12% bg / 28% border / full text) for any colored chip or badge.
- **Do** use the motion tokens (100/150/220ms, standard/enter/exit eases) and respect `prefers-reduced-motion` (globally enforced in `index.css`).
- **Do** keep light/dark parity for every new surface — test both, plus at least one optional palette.

### Don't:
- **Don't** look like pgAdmin or DBeaver: no toolbar sprawl, no dialog mazes, no chrome competing with data.
- **Don't** import generic SaaS web-app styling: no cards with decorative shadows, no marketing gradients, no hero metrics inside a desktop tool.
- **Don't** hardcode hex values or reach past the contract into `--ds-*` tokens from components.
- **Don't** put a drop shadow on a resting surface — shadows mean "floats above the workspace."
- **Don't** use accent fills for selection in data surfaces; selection is `--surface-selected` so type-colored values stay legible.
- **Don't** use proportional type for data or mono for chrome (the Mono-Means-Data Rule).
- **Don't** remove the global focus-visible ring without an equal-or-better replacement.
