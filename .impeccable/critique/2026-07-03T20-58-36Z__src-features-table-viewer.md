---
target: table-viewer
total_score: 29
p0_count: 0
p1_count: 3
timestamp: 2026-07-03T20-58-36Z
slug: src-features-table-viewer
---
# Critique: Table Viewer (`src/features/table-viewer`)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Skeleton grid, refetch spinner, tab-strip sync, save-bar counts, copied-state feedback |
| 2 | Match System / Real World | 3 | "ctid" leaks into user-facing errors; MySQL no-PK tables show cursor-not-allowed with no explanation |
| 3 | User Control and Freedom | 3 | Unsaved-edit guards everywhere; but no Esc to clear row selection, selection silently wiped on refetch |
| 4 | Consistency and Standards | 3 | Native title tooltips mixed with Radix tooltips; two hand-rolled portal menus alongside Radix popovers |
| 5 | Error Prevention | 4 | Navigation guards on sort/filter/page/refresh, single-row delete previews the exact SQL |
| 6 | Recognition Rather Than Recall | 2 | Nearly every power feature is invisible: shift/cmd-click selection, Cmd+F, double-click edit, right-click menus |
| 7 | Flexibility and Efficiency | 3 | Cmd+F, Cmd+C, Tab-through-cells, bulk delete exist; no arrow-key grid navigation, no Cmd+S save |
| 8 | Aesthetic and Minimalist Design | 3 | Clean and dense, but 8px/9px/10px micro-type and banned side-stripe rows |
| 9 | Error Recovery | 3 | Save failure preserves edits, per-row delete failure summary; but messages are raw driver errors |
| 10 | Help and Documentation | 1 | No shortcut discoverability anywhere; no help affordance |
| **Total** | | **29/40** | **Good** |

## Anti-Patterns Verdict

Does this look AI-generated? No. Interaction depth is unmistakably hand-crafted; token contract used faithfully.

Deterministic scan: 1 finding, real — `side-tab` accent border at TableViewerTab.tsx:1392 (`border-l-4 border-l-accent` on selected rows; same pattern at 1394 with warning color for edited rows). Absolute-ban violation, flagged by both review and detector. No false positives.

Visual overlays: skipped — Tauri desktop surface, no dev server running, no browser automation available.

## Priority Issues

**[P1] Banned side-stripe borders on selected/edited rows** (TableViewerTab.tsx:1392-1394). 4px left border also shifts every cell 4px on selection — layout jump on every click. Fix: drop border-l-4; tints already carry the state; if a marker is needed use inset box-shadow. → /impeccable polish

**[P1] Grid is mouse-only.** No arrow-key navigation, cells tabIndex={-1}, Enter/Space handler unreachable; role="gridcell" without grid/row ancestors is broken ARIA. Contradicts PRODUCT.md "keyboard-first". Fix: roving tabindex, arrow keys move selection, Enter edits, Esc clears; add role=grid/row, aria-sort. → /impeccable harden

**[P1] Invisible affordances.** Row selection (shift/cmd-click), double-click edit, right-click menus, Cmd+F have zero visual hints; recognition scored 2. Fix: hover-revealed row gutter for selection, shortcut hints in tooltips, editable-cell hover cue, command-palette shortcut listing. → /impeccable onboard

**[P2] Micro-typography below legibility floor.** Nullable marker text-[8px] (disappears on hover), type badges 9px, Run button 10px. Fix: raise to 10-11px, keep nullable marker visible. → /impeccable typeset

**[P2] Custom context menus can overflow viewport.** CellContextMenu and header menu render at raw cursor x/y, no collision clamping. Fix: clamp or migrate to Radix ContextMenu. → /impeccable harden

## Persona Red Flags

Alex: no arrow-key cell nav; no Cmd+S; no page-jump (page 40 = 40 clicks); selection wiped on refetch silently.
Sam: no keyboard access to any cell; sort state not exposed; edited state color-only; 9px filter icon hit target.
Riley: context menu off-screen at edges; index-based selection race window during confirm-dialog + background refetch; WHERE chip truncates at 280px with no full view.

## Minor Observations

- Save bar + row-selection bar + footer can stack into three chrome strips.
- Ad hoc z-indexes (z-20/40/50/[60]).
- Filter-chip remove targets are role="button" spans nested in buttons.
- Estimate `~` marker could use an explanatory tooltip.

## Questions to Consider

- What if selection were a first-class visible object (row-number gutter, like a spreadsheet)?
- Should "Open as SQL" be the headline trust feature instead of a ghost button?
- Could the command palette teach grid shortcuts contextually?
