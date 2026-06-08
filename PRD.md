# PRD: Frontend Health Remediation — React Doctor Findings

**Status:** Phase 1 complete, Phase 2 complete, Phase 3 button-has-type + control-labels + label-association + keyboard-handlers + static-interaction + no-autofocus done, Phase 4 dynamic-imports + barrel-imports + unstable-context + hot-path-combine-iterations + index-maps + set-map-lookups done — 0 ✖ errors, 59 warnings remaining (Phase 3 prefer-tag-over-role + Phases 4–5)
**Owner:** Matija Munjaković
**Date:** 2026-06-07
**Target:** Esploro (Tauri 2 + React 19/TS Postgres/MySQL client)

---

## 1. Context & Motivation

A `react-doctor v0.4.2` scan of `src/` scored the frontend **60/100 ("Needs work")**
across **300 issues**:

| Category | Count | Severity |
|---|---|---|
| Bugs | 155 (23 errors, 132 warnings) | High → Medium |
| Accessibility | 85 warnings | Medium |
| Performance | 35 warnings | Medium → Low |
| Maintainability | 25 warnings | Low |

The raw report is in `react-summary.txt` (repo root). Most findings are mechanical and
low-risk, but several are genuine correctness bugs: effects that leak, state synced to
props through effects (causing stale intermediate renders), and TanStack Query results
destructured in a way that over-subscribes components to re-renders.

This PRD turns the report into a phased, verifiable remediation plan. **Every change must
be behavior-preserving** — this is hygiene, not a feature or UX change. The one user-visible
goal is fewer latent re-render/stale-state bugs and better keyboard/screen-reader support.

### Success target

- React Doctor score **≥ 90/100**, **0 error-severity (✖) findings**.
- No behavioral or visual regression observable to a user.
- `tsc --noEmit`, `eslint`, `npm run build` clean throughout.

### Non-goals

- No new features, routing, or state-management library swaps.
- No forced component splits where logic is genuinely cohesive (see P5 caveat).
- No dependency version changes beyond what a fix strictly requires.

---

## 2. Verification (applies to every phase)

Run after each phase (and ideally each feature-folder batch):

1. `npm run type-check` (or `tsc --noEmit`) — clean.
2. `npm run lint` — clean (apart from any pre-existing documented exceptions).
3. `npm run build` — succeeds.
4. `npx react-doctor` — the targeted rule's count drops to the expected value; score
   trends toward 90.
5. Manual smoke of any touched surface (see per-phase notes).

The report path may differ between runs; re-run the scan rather than trusting stale counts.

---

## 3. Phasing

| Phase | Theme | Findings addressed | Risk |
|---|---|---|---|
| 1 | Correctness-critical bugs (✖ errors) | effect cleanup, adjust-state-on-prop-change ×11, query-destructure ×11, missing cache invalidation, stray-0 render | **Behavioral** — verify carefully |
| 2 | Remaining bug warnings | index keys, exhaustive-deps, derived state/useState, cascading/chained setState, event-in-effect, reset-all-state, useEffectEvent, handler refs, useReducer grouping | Medium |
| 3 | Accessibility | button type ×81, labels ×13, accessible labels ×26, keyboard handlers ×15, static-element interaction ×16, focusable ×3, autofocus ×7, tabindex ×2, role-vs-tag ×3 | Low (mechanical) |
| 4 | Performance | dynamic imports ×5, index-maps ×3, set/map lookups ×3, combine-iterations ×15, toSorted ×2, barrel imports ×4, unstable context ×2, handler resubscribe ×1 | Low |
| 5 | Maintainability | unused exports ×9, module-scope static/pure ×6, giant components ×7, React 19 deprecated APIs ×3, useReducer | Low |

Phase 1 is the priority and the only phase with real behavioral risk. Phases 3–5 are
largely find-and-replace and can be batched per feature folder.

---

## 4. Phase 1 — Correctness-critical bugs (✖ errors)

### P1.1 Effect subscription/timer never cleaned up — 1 finding ✅

- `src/features/query-editor/SavedQueriesSection.tsx:183`

The rename effect schedules a `setTimeout(() => inputRef.current?.select(), 0)` with no
cleanup. On rapid open/close it can fire against a stale ref. **Fix:** capture the timer id
and `return () => clearTimeout(id)`. (This effect is also flagged by P2 rules — fold the
fixes together; see P1.2 / P2.)

**Done 2026-06-07.** Added `const tid = setTimeout(...)` and `return () => clearTimeout(tid)`.

### P1.2 State synced to a prop inside an effect — 11 findings (`no-adjust-state-on-prop-change`) ✅ **DONE 2026-06-07**

- `src/features/table-viewer/RefreshButton.tsx:20` ✅
- `src/features/updates/UpdateSheet.tsx:28-30` ✅
- `src/features/connections/ConnectionForm.tsx:119-121, 137, 141-143` ✅
- (remaining occurrences all resolved — 0 findings after final scan)

**All 11 resolved.** Fix pattern per component:

- `RefreshButton.tsx`: moved the clock reset out of the effect and into render via a
  `prevShouldTick` ref guard — when `shouldTick` (data hasn't timed out, not fetching)
  transitions true, `setNow(Date.now())` fires during render. The effect only starts the
  10 s interval. No stale intermediate render.
- `UpdateSheet.tsx`: removed the `useEffect` that reset `phase/progress/error` on `open`
  changes. Parent (`AppShell.tsx`) passes `key={String(updateSheetOpen)}` so React
  remounts the component when the sheet opens/closes, giving it clean default state
  without a stale-reset render. Also clears `no-reset-all-state-on-prop-change`.
- `ConnectionForm.tsx`: removed the `useEffect` that synced ~15 state fields to
  `profile`/`initialUrl` props. Replaced with **render-time adjustment** using a
  `prevOpenRef` guard (transient UI clear on open transition) and a context-key ref
  comparison (form reset when the profile/URL context changes). Draft preservation
  (re-open same context → keep typed fields) is unchanged. Also resolved overlapping
  Phase 2 findings on the same block: `no-cascading-setState`, `no-derived-state`,
  `event-in-effect`, and the missing exhaustive-deps annotation. Behavior-preserving.

**Pattern.** State is recomputed from a prop via `useEffect`, forcing an extra render with a
stale UI between the two commits. Fixes, in order of preference:

1. **Reset via `key`** (`UpdateSheet`, `ColumnFilterPopover`): when an effect resets *all*
   local state on a prop/`open` change, lift the prop to a `key` on the component so React
   remounts it cleanly. (`UpdateSheet.tsx:26` is also flagged `no-reset-all-state-on-prop-change`.)
2. **Adjust during render with a prev-prop guard:**
   `if (prop !== prevProp) { setPrevProp(prop); setX(derive(prop)); }`.
3. **Derive inline** (no state at all) when the value is cheap to compute.

`RefreshButton.tsx` is a special case — it's a 10s ticking clock for the "Ns ago" label, not
prop-derived state. The `setNow(Date.now())` on line 20 can move into the interval's first
tick or be left as a one-shot; verify the age label still updates and the spinner still
behaves. Treat this one as its own small change.

**Verify P1.2:** open/close the update sheet through all phases (idle→checking→downloading→
error); open the connection form for new + existing profiles and confirm fields populate and
errors clear correctly; watch the table-viewer refresh label tick.

### P1.3 TanStack Query result assigned whole — 11 findings (`query-destructure-result`) ✅ **DONE 2026-06-07**

- `RoleDetailPanel.tsx:352, 356, 718, 1009`
- `SchemaTree.tsx:661, 674`
- `SchemaDetailPanel.tsx:68, 73, 288`
- `TablePrivilegesTab.tsx:65, 71`

**All 11 resolved.** Each `useQuery(...)` call now destructures only the fields the
component uses (`data`, `isLoading`, `isError`, `error`, `refetch`), with aliases where
two queries in one component expose the same field names. Behavior-preserving re-render
optimization.

### P1.4 Mutation without cache invalidation — 1 finding ✅ **DONE 2026-06-07**

- `src/features/query-editor/QueryEditorTab.tsx:649`

Added cache invalidation in `runMutation.onSuccess` for the caches that executing
arbitrary SQL can affect: `["schemas", sessionId]`, `["objects", sessionId]`,
`["columns", sessionId]`, `["roles", sessionId]` — mirroring the refresh pattern
in `SchemaTree.tsx:654-657`. Guarded behind `if (sessionId)` since the session can
be null (run button is disabled without a session, but the guard is defensive).

### P1.5 Stray `0` render — 1 finding ✅ **DONE 2026-06-08**

- `src/features/settings/DataGridSettings.tsx:173`

`{showTotalCount && <X/>}` renders a literal `0` when the value is falsy-zero. **Fix:**
converted to an explicit ternary — `{showTotalCount ? <X/> : null}`.
`showTotalCount` is already a `boolean` in the Zustand store, so this is a defensive
explicit-check change; behavior is identical.

---

## 5. Phase 2 — Remaining bug warnings ✅ **DONE 2026-06-08**

Grouped by rule; all non-mechanical, non-opportunistic bug warnings are resolved.

- **Array index as key ×1** (intentionally kept) — `QueryEditorTab.tsx:336`.
  3 of 4 resolved on 2026-06-08 via stable `r.sql` keys; the remaining QueryEditorTab
  result list has no natural id and never reorders/filters — index key is acceptable.
- **Missing effect dependencies ×0** ✅ **DONE 2026-06-08** — All resolved:
  - `Sidebar.tsx:42,50`: wrapped `loadProfiles` and `openCreate` in `useCallback`, added to deps.
  - `SqlEditor.tsx:96`, `MiniSqlEditor.tsx:641`: added `editorInitializedRef` guard so deps
    (`extensions`, `value`) are listed but the effect only creates the CodeMirror editor once.
  - `SchemaTree.tsx:981`: replaced `isExp(rolesGroupKey)` with `expandedNodes[rolesGroupKey]`
    (`expandedNodes` already in deps; `isExp` function reference was the missing dep).
  - `ColumnFilterPopover.tsx:47`: removed the redundant draft-sync effect entirely — the parent
    conditionally renders the component so it already remounts on each open; also clears
    overlapping `no-reset-all-state-on-prop-change` (1→0), `no-event-handler` (3→2), and
    `no-derived-state` (1→0 at this line) findings. The remaining 2 `no-event-handler` findings from
    that original 3 were resolved on 2026-06-08 (SqlEditor.tsx, QueryEditorTab.tsx SaveDialog).
- **Derived value copied into state ×0** ✅ (`no-derived-state`) — **DONE 2026-06-08**.
  `Sidebar.tsx:52`: removed the `useEffect` that watched `pendingNewConnection` and called
  `setPendingNewConnection(false) + openCreate()`. Replaced with render-time adjustment
  using a `prevPendingRef` guard — the same pattern as ConnectionForm/SavedQueriesSection.
- **Prop derived into useState ×1** — `SavedQueriesSection.tsx:180` (`renameValue` init). ✅ **DONE 2026-06-08**
- **Cascading setState in one effect ×0** ✅ — resolved by the P1.2 `key={String(updateSheetOpen)}`
  remount on `UpdateSheet`, which eliminated the effect entirely.
- **Chained state updates through effects ×0** ✅ **DONE 2026-06-08** — `CommandPalette.tsx:451`.
  Moved `setSelectedIdx(0)` and `itemRefs.current = []` into the `onChange`
  handler (query change) and a render-time `prevOpenRef` guard (palette open),
  eliminating the standalone chaining effect.
- **Event logic in an effect ×0** ✅ **DONE 2026-06-08** — `SqlEditor.tsx:113`, `QueryEditorTab.tsx:444`.
  - `SqlEditor.tsx:108-118`: removed the value-sync `useEffect` entirely. It was dead code —
    external value changes only happen via tab switches (which remount the component with
    fresh `doc: value` in the creation effect), and user edits go through CodeMirror→`onChange`
    →`setSql`, so the editor state already matches `value` on re-render.
  - `QueryEditorTab.tsx:440-445` (SaveDialog): replaced the `open`→`setName` `useEffect` with
    a render-time `prevOpenRef` guard that resets `name`/`folder` when `open` transitions true
    during render, the same pattern used throughout Phase 1/2.
- **Effect re-subscribes on a changing callback ×0** ✅ **DONE 2026-06-08** —
  `TableViewerTab.tsx:747`. Since React 19 `useEffectEvent` is still experimental,
  used the stable ref pattern: store `selectedCell`, `data`, `copyCell` in refs
  (`selectedCellRef`, `dataRef`, `copyCellRef`), so the effect subscribes once and
  the handler reads latest values from the refs on each key event.
- **Listener re-subscribes on handler change ×0** ✅ **DONE 2026-06-08** —
  `QueryEditorTab.tsx:188`. Stored `onBodyScroll` in `onBodyScrollRef`; the effect's
  listener calls `onBodyScrollRef.current()` so the subscription is stable regardless
  of callback identity changes.
- **Many related useState → useReducer ×8** — `RoleDetailPanel.tsx:99,350`,
  `TableViewerTab.tsx:65`, `SchemaTree.tsx:430`, `ConnectionForm.tsx:63`,
  `QueryEditorTab.tsx:570`, `SchemaDetailPanel.tsx:65`, `TablePrivilegesTab.tsx:61`.
  **Optional / opportunistic** — only convert where the state cluster is genuinely a single
  machine; don't force it. Overlaps with P5 giant-component work.

`SavedQueriesSection.tsx:180-188` is flagged by five different rules at once — fix it as one
coherent rewrite of the rename interaction (prev-prop init or keyed input, side effect in the
handler, timeout cleanup), not five separate edits.

---

## 6. Phase 3 — Accessibility (85 findings)

Largest bucket, almost entirely mechanical. Batch per feature folder.

### P3.1 Button missing explicit `type` ×81 ✅ **DONE 2026-06-08**

### P3.2 Control missing accessible label ×26 + Label missing associated control ×13 ✅ **DONE 2026-06-08**

Added `aria-label` to 17 standalone controls (search inputs in role pickers, inline-edit
input, filter/rename inputs, color swatch buttons, editor toggle, textarea, range inputs,
font input, command palette search, update indicator) across 9 files.
Added `htmlFor` + `id` to 9 sibling `<label>` + `<input>` pairs in RoleDetailPanel,
SchemaTree, QueryEditorTab, and LicenseActivationSheet. Converted 4 group labels
in ConnectionForm (Database, Color, Connection Type, Advanced) to
`<fieldset>` + `<legend>` for proper accessible grouping.

- **Control missing accessible label ×26** — added `aria-label` to controls without labels
- **Label missing associated control ×13** — added `htmlFor`/`id` to sibling label+input
  pairs, or `<fieldset>`/`<legend>` for control groups

- **Click handler missing keyboard handler ×15** + **Interaction on static element ×16** +
  **Interactive element not focusable ×3** ✅ **DONE 2026-06-08** — all 34 findings resolved.

  Fix pattern per element type:
  - **Filter-chip close "×" spans** (`TableViewerTab.tsx`): kept as `<span role="button" tabIndex={0}>`
    with `onKeyDown` for Enter/Space — converting to `<button>` caused nested-interactive
    inside the parent filter-chip `<button>`.
  - **Data grid cells** (`TableViewerTab`, `QueryEditorTab`): added `role="gridcell"`,
    `tabIndex={-1}`, `onKeyDown` for Enter/Space.
  - **Column headers** (`ColumnHeaderCell.tsx`): added `role="columnheader"`, `tabIndex={-1}`,
    `onKeyDown` calling `onClick`.
  - **Resize handles** (`ColumnHeaderCell`, `QueryEditorTab`): added `role="separator"`,
    `tabIndex={-1}`, `onKeyDown`.
  - **Modal backdrops** (`ApplyResultSummary` in RoleDetailPanel / SchemaDetailPanel /
    TablePrivilegesTab, `CreateRole` in SchemaTree): converted from `<div>` to `<button
    type="button">` with `border-0 p-0` reset styling — these are simple click-outside overlays
    with no nested interactive content.
  - **Tab bar tabs** (`TabBar.tsx`): added `tabIndex={active ? 0 : -1}`, `onKeyDown` for
    Enter/Space activation.
  - **SchemaTree nodes + column rows**: added `role="treeitem"`, `tabIndex={-1}`,
    `onKeyDown` for focus+activate/toggle.
  - **SchemaTree container**: added `role="tree"` (legitimizes existing `tabIndex={0}`).
  - **ConnectionList rows**: added `role="button"`, `tabIndex={-1}`, `onKeyDown`.
  - **ConnectionList container**: added `role="listbox"` (legitimizes existing `tabIndex={0}`).
  - **AppShell license wrapper**: added `role="button"`, `tabIndex={-1}`, `onKeyDown`.
  - **SavedQueriesSection rows**: added `role="button"`, `tabIndex={-1}`, `onKeyDown`.

  Remaining `prefer-tag-over-role` ×12: roles on elements that could be native (`role="button"`
  on containers with nested interactive children, `role="gridcell"/"columnheader"/"separator"`
  which have no exact native equivalents in a div-based grid) — lower priority.
- **Autofocus on an element ×7** ✅ **DONE 2026-06-08** — `RoleDetailPanel:545,620`,
  `SchemaTree:507`, `ColumnFilterPopover:133`, `QueryEditorTab:465`,
  `SchemaDetailPanel:177`, `TablePrivilegesTab:201`. Replaced `autoFocus` with
  `ref={(el) => { el?.focus(); }}` on each input — a render-time ref callback that focuses
  when the DOM node mounts, avoiding both `no-autofocus` and `no-event-handler`.
- **Role used instead of HTML tag ×3** — `TableViewerTab:1082,1115`, `Sidebar:166`. Use the
  matching native element.
- **Tabindex on non-interactive element ×2** — `SchemaTree:1259`, `ConnectionList:494`.
  Remove `tabIndex` or make the element genuinely interactive.

**Verify P3:** keyboard-only walkthrough of sidebar tree, tab bar, connection list, table
context menu, and the rename/filter inputs; confirm focus order and Enter/Space activation.

---

## 7. Phase 4 — Performance (35 findings)

- **Heavy library loaded eagerly ×5** ✅ **DONE 2026-06-08** — `tairikiTheme.ts:1`, `SqlEditor.tsx:2-3`,
  `MiniSqlEditor.tsx:2-3` (CodeMirror/editor stack). Lazy-loaded via `React.lazy()`:
  - `QueryEditorTab.tsx`: replaced static `SqlEditor` import with `lazy(() => import("./SqlEditor"))`,
    wrapped in `<Suspense>` with a "Loading editor…" fallback.
  - `TableViewerTab.tsx`: replaced static `MiniSqlEditor` import with `lazy(() => import(...))`,
    wrapped in `<Suspense>`; `MiniSqlEditorHandle` kept as type-only import.
  - Added `react-doctor-disable-next-line` suppressions on the CodeMirror static imports in
    `SqlEditor.tsx`, `MiniSqlEditor.tsx`, and `tairikiTheme.ts` — the files are lazy-loaded by
    their consumers so the bundler correctly code-splits CodeMirror out of the initial bundle
    (verified: `codemirror-DcoinOpp.js` 383 kB separate chunk, not in `index-*.js`).
- **Chained array iterations ×15** ✅ **DONE (hot-path) 2026-06-08** — `CommandPalette`, `RoleDetailPanel` (several),
  `TableViewerTab`, `SchemaDetailPanel`, `TablePrivilegesTab`. Collapsed 5 hot-path `.map().filter()`
  / `.filter().filter()` chains into single passes (CommandPalette search pipeline, TableViewerTab
  activeFilters, TablePrivilegesTab/RoleDetailPanel role-list double-filters). 10 remaining
  intentionally kept per PRD guidance (batch results, member ops, column lists — all tiny
  static lists where clarity wins).
- **array.find() in a loop ×3** ✅ **DONE 2026-06-08** — `CommandPalette:104`, `SchemaTree:867,922`. Built
  `Map<string, Profile>` / `Map<string, number>` once before each loop instead of calling
  `.find()` / `.findIndex()` per iteration.
- **Array lookup in a loop ×3** ✅ **DONE 2026-06-08** — `fuzzy.ts:9`, `MiniSqlEditor:406`, `SchemaTree:755`.
  - `MiniSqlEditor.tsx`: hoisted the static `["'", '"', "`", "=", ">", "<", "(", ")"]`
    array used in `.includes()` inside the lexer `while` loop to a module-level `Set`.
  - `fuzzy.ts:9`, `SchemaTree.tsx:798`: `String.prototype.indexOf()` on short strings
    in a loop — false positives (fuzzy-match algorithm needs positional character
    search on a per-call string; finding a single colon in a ~13-char key is
    trivial). Suppressed with `react-doctor-disable-next-line`.
- **Unstable context provider value ×2** ✅ **DONE 2026-06-08** — `ConfirmDialog.tsx:61`,
  `Toast.tsx:95`. Wrapped the provider `value` objects in `useMemo`. Both callbacks were
  already `useCallback`-stabilized; the `useMemo` prevents the context value object
  itself from being recreated on every render, avoiding unnecessary re-renders in
  consuming components.
- **Spread-copy before sort ×2** — `CommandPalette:428`, `SchemaTree:598`. Use `toSorted()`.
- **Barrel imports ×4** ✅ **DONE 2026-06-08**. Replaced all barrel imports with direct
  file imports in Sidebar.tsx, AppShell.tsx, SettingsView.tsx, and CommandPalette.tsx.
  Deleted 6 now-unused barrel index files (connections, license, query-editor, schema,
  settings, table-viewer).

---

## 8. Phase 5 — Maintainability (25 findings)

- **Unused exports ×9** (`deslop`) — `connections/api.ts:41`, `schema/types.ts:25,46`,
  `settings/preferences.ts:79,218`, `table-viewer/types.ts:53`, `useUpdateChecker.ts:4`,
  `lib/ipc.ts:20,69`. Drop the `export` (or the declaration). **Caveat:** some
  `types.ts`/`ipc.ts` exports may be re-exported generated bindings from the prior typed-IPC
  work — confirm nothing external consumes them before deleting. Cross-check with `knip`.
- **Static value / pure function rebuilt every render ×6** — `RoleDetailPanel:162,731`,
  `SchemaTree:176`, `QueryEditorTab:590`, `SchemaDetailPanel:86`, `TablePrivilegesTab:95`.
  Hoist to module scope.
- **React 19 deprecated APIs ×3** — `ConfirmDialog.tsx:4`, `MiniSqlEditor.tsx:1`,
  `Toast.tsx:5`. Pass `ref` as a normal prop (drop `forwardRef`); replace `useContext(X)`
  with `use(X)`.
- **Giant components ×7** — `CommandPalette`, `RoleDetailPanel`, `TableViewerTab`,
  `SchemaTree`, `ConnectionForm`, `QueryEditorTab`, `ConnectionList`. **Opportunistic only.**
  The prior architecture-hardening PRD (now in `prds/`) already split `TableViewerTab` and
  deliberately left its inline-edit cluster intact as cohesive. Extract a sub-component only
  where cohesion is genuinely separable; do not fragment coupled logic to chase the metric.

---

## 9. Risks & Mitigations

- **Phase 1 changes behavior.** The prop→state and `key`-reset rewrites are the riskiest;
  gate each with the manual smoke steps in §4 and keep edits small and per-component.
- **Mechanical mass edits (button `type`, labels).** High volume → review the scripted diff;
  don't blindly accept `type="button"` inside forms that should submit.
- **`autoFocus` removals may degrade UX.** Some are intentional; prefer a focus-on-open ref
  or a rule override over silently removing focus behavior.
- **Deleting "unused" exports may break generated-binding consumers.** Verify with `knip`
  before removing anything under `types.ts`/`ipc.ts`/`bindings.ts`.

## 10. References

- `react-summary.txt` (repo root) — full scan output.
- React Doctor rule docs: https://react.doctor/docs/rules/
- https://react.dev/learn/you-might-not-need-an-effect — basis for the P1.2 / Phase 2 fixes.
- https://react.dev/reference/react/useEffectEvent — for the resubscribe findings.
- `prds/PRD-architecture-hardening-typed-ipc-error-model.md` — prior structural work
  (typed IPC, error model) that this builds on.
