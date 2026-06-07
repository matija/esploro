# PRD: Frontend Health Remediation — React Doctor Findings

**Status:** In progress
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

### P1.3 TanStack Query result assigned whole — 11 findings (`query-destructure-result`)

- `RoleDetailPanel.tsx:352, 356, 718, 1009`
- `SchemaTree.tsx:661, 674`
- `SchemaDetailPanel.tsx:68, 73, 288`
- `TablePrivilegesTab.tsx:65, 71`

Assigning the whole `useQuery(...)` object (`const membersQuery = useQuery(...)`) bypasses
TanStack Query's tracked-property optimization and subscribes the component to *every* field,
causing extra re-renders. **Fix:** destructure only what's used —
`const { data: members, isLoading } = useQuery(...)` — and update references. Where two
queries in one component both expose `data`/`isLoading`, alias them (`data: roles`,
`data: privs`). Purely a re-render optimization; behavior is unchanged but verify the panels
still render their loading/empty/error states.

### P1.4 Mutation without cache invalidation — 1 finding

- `src/features/query-editor/QueryEditorTab.tsx:649`

A mutation succeeds but doesn't invalidate the cache it affects, so cached lists can go
stale. **Fix:** add `onSuccess: () => queryClient.invalidateQueries({ queryKey: [...] })`
with the correct key (likely the saved-queries list). Confirm what the mutation changes
before picking the key. Verify the dependent view refreshes after the mutation.

### P1.5 Stray `0` render — 1 finding

- `src/features/settings/DataGridSettings.tsx:173`

`{someNumber && <X/>}` renders a literal `0` when the number is falsy-zero. **Fix:** make the
test explicit — `{count > 0 && <X/>}` or a ternary. Verify nothing renders a stray "0".

---

## 5. Phase 2 — Remaining bug warnings

Grouped by rule; line numbers per `react-summary.txt` (re-grep before editing).

- **Array index as key ×4** — `RoleDetailPanel.tsx:65`, `QueryEditorTab.tsx:335`,
  `SchemaDetailPanel.tsx:39`, `TablePrivilegesTab.tsx:35`. Use a stable id from the item.
  If no natural id exists, confirm the list never reorders/filters before keeping the index.
- **Missing effect dependencies ×7** — `SqlEditor.tsx:96`, `Sidebar.tsx:42,50`,
  `MiniSqlEditor.tsx:641`, `SchemaTree.tsx:969`, `ConnectionForm.tsx:149`,
  `ColumnFilterPopover.tsx:47`. **Read each callback first** — don't blindly add deps. Prefer
  functional updaters or moving recreated values inside the effect. (`SchemaTree.tsx` has a
  long-standing documented exception in the prior PRD — confirm whether it's the same one.)
- **Derived value copied into state ×15** (`no-derived-state`) — `ConnectionForm.tsx:127-140`,
  `ColumnFilterPopover.tsx:44`, `SavedQueriesSection.tsx:185`. Compute during render / `useMemo`.
- **Prop derived into useState ×1** — `SavedQueriesSection.tsx:180` (`renameValue` init).
  Often resolved together with P1.1 by using the prev-prop pattern or keying the rename input.
- **Cascading setState in one effect ×2** — `UpdateSheet.tsx:26`, `ConnectionForm.tsx:112`.
  Consider `useReducer` or keying.
- **Chained state updates through effects ×2** — `CommandPalette.tsx:451`,
  `SavedQueriesSection.tsx:185`. Set related state together in the triggering handler.
- **Event logic in an effect ×7** — `UpdateSheet.tsx:27`, `SqlEditor.tsx:111`,
  `ConnectionForm.tsx:145`, `ColumnFilterPopover.tsx:43`, `SavedQueriesSection.tsx:184`,
  `QueryEditorTab.tsx:443`. Move the side effect into the event handler.
- **Effect re-subscribes on a changing callback ×1** — `TableViewerTab.tsx:747`. Wrap with
  `useEffectEvent` (React 19) so the effect doesn't re-subscribe each parent render.
- **Listener re-subscribes on handler change ×1** — `QueryEditorTab.tsx:188`. Store the
  handler in a ref; the listener reads `handlerRef.current()`.
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

- **Button missing explicit `type` ×81** — add `type="button"` to every non-submit
  `<button>` (full list in report: `TabBar`, `ConnectionList`, `CellContextMenu`,
  `QueryEditorTab`, `LicenseSettings`, `UpdateSheet`, `LicenseBanner`, etc.). Use
  `type="submit"` only inside forms that submit. Highest-count single fix; consider a
  scripted pass + review.
- **Control missing accessible label ×26** and **Label missing associated control ×13** —
  add `aria-label` to icon-only controls; tie `<label htmlFor>`/nesting to inputs
  (`RoleDetailPanel`, `ConnectionForm`, `SchemaTree`, `QueryEditorTab`, `AppearanceSettings`,
  `LicenseActivationSheet`, …).
- **Click handler missing keyboard handler ×15** + **Interaction on static element ×16** +
  **Interactive element not focusable ×3** — these overlap on the same clickable
  `div`/`span`s (`SchemaTree`, `RoleDetailPanel`, `TableViewerTab`, `ConnectionList`,
  `AppShell`, `TabBar`, `ColumnHeaderCell`, …). Preferred fix: convert to a real `<button>`;
  where layout forbids it, add `role`, `tabIndex={0}`, and an `onKeyDown` for Enter/Space.
- **Autofocus on an element ×7** — `RoleDetailPanel:545,620`, `SchemaTree:507`,
  `ColumnFilterPopover:133`, `QueryEditorTab:465`, `SchemaDetailPanel:177`,
  `TablePrivilegesTab:201`. Replace `autoFocus` with a focus-on-open `useEffect`/ref **only
  where focus genuinely belongs** (e.g. a just-opened rename/filter input); these are
  intentional UX, so confirm before removing — may justify a rule override rather than a code
  change.
- **Role used instead of HTML tag ×3** — `TableViewerTab:1082,1115`, `Sidebar:166`. Use the
  matching native element.
- **Tabindex on non-interactive element ×2** — `SchemaTree:1259`, `ConnectionList:494`.
  Remove `tabIndex` or make the element genuinely interactive.

**Verify P3:** keyboard-only walkthrough of sidebar tree, tab bar, connection list, table
context menu, and the rename/filter inputs; confirm focus order and Enter/Space activation.

---

## 7. Phase 4 — Performance (35 findings)

- **Heavy library loaded eagerly ×5** — `tairikiTheme.ts:1`, `SqlEditor.tsx:2-3`,
  `MiniSqlEditor.tsx:2-3` (CodeMirror/editor stack). Lazy-load via `React.lazy()` /
  dynamic `import()` so the editor bundle isn't in the initial load. **Biggest perf win.**
  Verify the SQL editors still mount and the app's first paint is unaffected.
- **Chained array iterations ×15** — `CommandPalette`, `RoleDetailPanel` (several),
  `TableViewerTab`, `SchemaDetailPanel`, `TablePrivilegesTab`. Collapse `.map().filter()`
  chains into one pass only where the lists are large/hot (table data, command palette);
  skip tiny static lists where clarity wins.
- **array.find() in a loop ×3** — `CommandPalette:104`, `SchemaTree:825,880`. Build a `Map`
  once before the loop.
- **Array lookup in a loop ×3** — `fuzzy.ts:9`, `MiniSqlEditor:406`, `SchemaTree:755`. Use a
  `Set`/`Map` for repeated membership checks.
- **Unstable context provider value ×2** — `ConfirmDialog.tsx:61`, `Toast.tsx:95`. Wrap the
  provider `value` in `useMemo`.
- **Spread-copy before sort ×2** — `CommandPalette:428`, `SchemaTree:598`. Use `toSorted()`.
- **Barrel imports ×4** — `CommandPalette:10`, `SettingsView:9`, `Sidebar:5`, `AppShell:11`.
  Import from direct paths.

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
