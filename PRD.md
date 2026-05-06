# PRD: Themes, polish, and About

A grab-bag release. Two new theme families, a couple of UI papercuts, and an About screen so the app stops feeling anonymous.

The MySQL + filtering PRD has shipped and lives in `prds/PRD-mysql-and-filtering.md`.

---

## Feature 1: Tokyo Night themes (dark + light)

### Why

Tokyo Night is the default theme for a lot of developers. They open Esploro and want it to look like the rest of their setup. We have the token contract in place — adding a palette is mostly data entry.

### What we want

Two new themes in the Appearance picker:

- **Tokyo Night** — the dark variant, based on Tokyo Night Storm.
- **Tokyo Night Day** — the light variant.

Both follow the canonical palette from `folke/tokyonight.nvim`. We pick **Storm** as the dark variant rather than Night because Storm is softer (slightly bluer background) and better for long sessions. Night can come later if anyone asks.

### Palette mapping (Storm → `--ds-*` tokens)

| Token | Storm value | Notes |
|---|---|---|
| `--ds-content-bg` | `#24283b` | bg |
| `--ds-sidebar-bg` | `#1f2335` | bg_dark |
| `--ds-bg-subtle` | `#2e3348` | bg + 8% lighten |
| `--ds-bg-active` | `#363b54` | bg + 14% lighten |
| `--ds-separator` | `#3b4261` | border |
| `--ds-border-strong` | `#545c7e` | comment-ish |
| `--ds-control-bg` | `rgba(192,202,245,0.06)` | translucent |
| `--ds-label` | `#c0caf5` | fg |
| `--ds-secondary` | `#a9b1d6` | fg_dark |
| `--ds-tertiary` | `#565f89` | comment |
| `--ds-accent` | `#7aa2f7` | blue |
| `--ds-accent-hover` | `#89b4fa` | blue lighten |
| `--ds-accent-subtle` | `#3d59a1` | blue darken |
| `--ds-success` | `#9ece6a` | green |
| `--ds-warning` | `#e0af68` | yellow |
| `--ds-destructive` | `#f7768e` | red |
| `--ds-syntax-keyword` | `#bb9af7` | magenta |
| `--ds-syntax-type` | `#e0af68` | yellow |
| `--ds-syntax-string` | `#9ece6a` | green |
| `--ds-syntax-number` | `#7dcfff` | cyan |
| `--ds-syntax-enum` | `#ff9e64` | orange |
| `--ds-syntax-special` | `#f7768e` | red |
| `--ds-syntax-operator` | `#89ddff` | bright cyan |
| `--ds-syntax-comment` | `#565f89` | comment |

### Palette mapping (Day → `--ds-*` tokens)

| Token | Day value |
|---|---|
| `--ds-content-bg` | `#e1e2e7` |
| `--ds-sidebar-bg` | `#d0d5e3` |
| `--ds-bg-subtle` | `#cbd0e3` |
| `--ds-bg-active` | `#b7c1e3` |
| `--ds-separator` | `#a8aecb` |
| `--ds-border-strong` | `#6172b0` |
| `--ds-control-bg` | `#e9e9ed` |
| `--ds-label` | `#3760bf` |
| `--ds-secondary` | `#6172b0` |
| `--ds-tertiary` | `#848cb5` |
| `--ds-accent` | `#2e7de9` |
| `--ds-accent-hover` | `#1a5fbf` |
| `--ds-accent-subtle` | `#b7c5f0` |
| `--ds-success` | `#587539` |
| `--ds-warning` | `#8c6c3e` |
| `--ds-destructive` | `#f52a65` |
| `--ds-syntax-keyword` | `#9854f1` |
| `--ds-syntax-type` | `#8c6c3e` |
| `--ds-syntax-string` | `#587539` |
| `--ds-syntax-number` | `#007197` |
| `--ds-syntax-enum` | `#b15c00` |
| `--ds-syntax-special` | `#f52a65` |
| `--ds-syntax-operator` | `#7847bd` |
| `--ds-syntax-comment` | `#848cb5` |

### Implementation

1. Extend `uiThemeValues` in `preferences.ts` with `tokyo-night` and `tokyo-night-day`.
2. Extend `themeToDomAttribute` to return `"dark"` for `tokyo-night` and `"light"` for `tokyo-night-day` — the existing dark/light DOM split still applies for things like `prefers-color-scheme`-aware behavior.
3. Add a separate selector that paints the palette:
   ```css
   :root[data-theme="dark"][data-palette="tokyo-night"] { /* Storm tokens */ }
   :root[data-theme="light"][data-palette="tokyo-night-day"] { /* Day tokens */ }
   ```
   Set `data-palette` from `applyUiPreferencesToDocument`. The current code only sets `data-theme`; this PR adds a parallel attribute so each theme can override the base Tairiki tokens.
4. Add the new themes to `THEME_OPTIONS` in `AppearanceSettings.tsx` with sensible icons (Moon for the dark variant, Sun for the light variant — same as Tairiki).
5. Add the same two entries to `coreCommands` in `CommandPalette.tsx`.

### Out of scope

- Tokyo Night Night and Moon variants. Storm covers the dark case for v1.
- Changing the editor syntax highlighting beyond what the token contract already exposes. The CodeMirror theme picks up `--editor-syntax-*` automatically.

---

## Feature 2: GitHub themes (dark + light)

### Why

Same reason as Tokyo Night — a lot of users live in GitHub all day, and a theme that matches the GitHub web UI lowers context-switching cost. The Primer color system is also one of the best-tested palettes for accessibility and contrast.

### What we want

Two new themes:

- **GitHub Dark** — based on `github_dark_default` (the canonical GitHub dark mode).
- **GitHub Light** — based on `github_light_default` (the canonical GitHub light mode).

Both use Primer color values directly. No tweaks. The point is that it should feel like GitHub.

### Palette mapping (GitHub Dark → `--ds-*` tokens)

| Token | Value | Primer name |
|---|---|---|
| `--ds-content-bg` | `#0d1117` | canvas.default |
| `--ds-sidebar-bg` | `#010409` | canvas.inset |
| `--ds-bg-subtle` | `#161b22` | canvas.subtle |
| `--ds-bg-active` | `#21262d` | neutral.muted |
| `--ds-separator` | `#30363d` | border.default |
| `--ds-border-strong` | `#6e7681` | border.muted |
| `--ds-control-bg` | `#21262d` | btn.bg |
| `--ds-label` | `#e6edf3` | fg.default |
| `--ds-secondary` | `#7d8590` | fg.muted |
| `--ds-tertiary` | `#6e7681` | fg.subtle |
| `--ds-accent` | `#2f81f7` | accent.fg |
| `--ds-accent-hover` | `#58a6ff` | accent.emphasis |
| `--ds-accent-subtle` | `#1f6feb` | accent.muted |
| `--ds-success` | `#3fb950` | success.fg |
| `--ds-warning` | `#d29922` | attention.fg |
| `--ds-destructive` | `#f85149` | danger.fg |
| `--ds-syntax-keyword` | `#ff7b72` | red |
| `--ds-syntax-type` | `#ffa657` | orange |
| `--ds-syntax-string` | `#a5d6ff` | blue |
| `--ds-syntax-number` | `#79c0ff` | bright blue |
| `--ds-syntax-enum` | `#ffa657` | orange |
| `--ds-syntax-special` | `#d2a8ff` | purple |
| `--ds-syntax-operator` | `#ff7b72` | red |
| `--ds-syntax-comment` | `#8b949e` | gray |

### Palette mapping (GitHub Light → `--ds-*` tokens)

| Token | Value | Primer name |
|---|---|---|
| `--ds-content-bg` | `#ffffff` | canvas.default |
| `--ds-sidebar-bg` | `#f6f8fa` | canvas.subtle |
| `--ds-bg-subtle` | `#eaeef2` | neutral.subtle |
| `--ds-bg-active` | `#d8dee4` | neutral.muted |
| `--ds-separator` | `#d0d7de` | border.default |
| `--ds-border-strong` | `#8c959f` | border.muted |
| `--ds-control-bg` | `#f6f8fa` | btn.bg |
| `--ds-label` | `#1f2328` | fg.default |
| `--ds-secondary` | `#656d76` | fg.muted |
| `--ds-tertiary` | `#8c959f` | fg.subtle |
| `--ds-accent` | `#0969da` | accent.fg |
| `--ds-accent-hover` | `#0550ae` | accent.emphasis |
| `--ds-accent-subtle` | `#ddf4ff` | accent.muted |
| `--ds-success` | `#1a7f37` | success.fg |
| `--ds-warning` | `#9a6700` | attention.fg |
| `--ds-destructive` | `#cf222e` | danger.fg |
| `--ds-syntax-keyword` | `#cf222e` | red |
| `--ds-syntax-type` | `#953800` | orange |
| `--ds-syntax-string` | `#0a3069` | dark blue |
| `--ds-syntax-number` | `#0550ae` | blue |
| `--ds-syntax-enum` | `#953800` | orange |
| `--ds-syntax-special` | `#8250df` | purple |
| `--ds-syntax-operator` | `#cf222e` | red |
| `--ds-syntax-comment` | `#6e7781` | gray |

### Implementation

Same as Tokyo Night — add `github-dark` and `github-light` to `uiThemeValues`, drive the palette via `data-palette` attribute, list them in the picker and command palette.

### Out of scope

- High-contrast and colorblind GitHub variants. Defer.
- Dimmed dark variant. Defer.

---

## Feature 3: Toast queue cap

### Problem

`ToastProvider` appends every toast to a list and never trims it. If something spams toasts (a connection retry loop, a cascade of save errors), the screen fills with cards bottom-to-top and the older ones don't go away until each one's 3.2s timer ticks. The result is a wall of toasts.

### What we want

At most 2 toasts visible at any moment. When a 3rd toast arrives, the oldest one fades out and the new one slides in.

### Implementation

In `ToastProvider`:

```tsx
const MAX_VISIBLE = 2;

const toast = useCallback((message, variant = "info") => {
  const id = crypto.randomUUID();
  setItems((prev) => {
    const next = [...prev, { id, message, variant }];
    if (next.length <= MAX_VISIBLE) return next;
    // Drop the oldest. The exit animation runs from the existing CSS class
    // we'll add for `.is-leaving` (fades + slides down 4px over 160ms).
    return next.slice(next.length - MAX_VISIBLE);
  });
}, []);
```

For a clean fade rather than a hard pop, render `MAX_VISIBLE + 1` items with the overflow item marked `is-leaving`. The simpler version above (just slice) is acceptable for v1 because new toasts arrive on top and the bottom one disappearing isn't jarring.

If we want a graceful exit animation, add a `leavingIds: Set<string>` and a `data-leaving="true"` attribute on the overflowed toast. CSS handles the transition. Remove from `items` after 160ms.

### Out of scope

- A "see all" history pane. The toast log isn't a feature.
- Per-variant priority (errors don't preempt info). Treat all toasts equally.
- Pause on hover. Nice but separate.

---

## Feature 4: Typography pass

### Problem

The font sizes in a few places don't match the visual hierarchy of the app:

- Tab titles render at `text-sm` (14px) — too big. Tabs are navigation chrome, not content. Compare with VS Code (~13px), TablePlus (~12px), DataGrip (~12px). Esploro tabs feel chunky next to those references.
- Connection names render at `text-xs` (12px) with a `text-[10px]` meta line beneath. The connection name is the **primary** identifier in the sidebar, but it's the same size as the muted Saved Queries entries. The hierarchy is flat where it shouldn't be.

### What we want

| Element | Current | Target | Rationale |
|---|---|---|---|
| Tab title | 14px | **12px** | Matches VS Code / DataGrip; recovers vertical room |
| Tab close icon | 11px | 11px | Keep |
| Tab bar height | 36px (`h-9`) | **30px** (`h-[30px]`) | Drops with the smaller text |
| Connection name | 12px | **13px** | Primary identifier — give it weight |
| Connection meta line | 10px | 11px | One step up; legibility on hi-DPI |
| Sidebar section header | 12px uppercase | 11px uppercase | Tighten the chrome |
| Saved Queries / Recent items | 12px | 12px | Keep — already correct |
| Status bar | 11px | 11px | Keep |

### Implementation

Concrete changes:

- `src/components/TabBar.tsx`: change `text-sm` to `text-xs` on the tab title span; change `h-9` on the tablist container to `h-[30px]`. Bump the icon size from 11 to 11 (keep). Adjust `gap-1.5` to `gap-1`.
- `src/features/connections/ConnectionList.tsx`: change `text-xs` on the name div to `text-[13px]`; bump the meta line from `text-[10px]` to `text-[11px]`.
- `src/components/SidebarSection.tsx`: change `text-xs` to `text-[11px]` on the section header (the uppercase label already does most of the work).

That's it for the audit. We're not redesigning anything — just nudging three sizes to match the visual hierarchy that's already implied.

### Constraints

- Don't break the existing user-controlled UI font size (`--font-ui-size`, default 14px). The classes above are explicit `text-[N]` values so they're independent of the global UI size, but the global size should still scale things like body copy, query results, schema tree text.
- No font-family changes. Inter for UI, JetBrains Mono for code, both already shipped as variable fonts.

### Out of scope

- A full typographic scale tokenization. Worthwhile but not the scope here.
- Adjusting the editor font size. Already user-controllable.

---

## Feature 5: About screen

### Problem

The app introduces itself nowhere. There's no place to find:

- Who built it
- The source code repo
- The author's other tools
- The version

Users who like the app and want to find more from the same author have nowhere to go.

### What we want

A new **About** entry at the bottom of the Settings nav. It contains:

- App icon (use the existing one in `assets`)
- App name (**Esploro**) and version (**0.3.0**, read from `package.json` at build time)
- One line: "A native macOS database client for PostgreSQL, MySQL, and MariaDB."
- "Built by Matija Munjaković" — name links to `https://matija.eu`
- "More tools at matija.eu/tools" — link
- "Source on GitHub" — link to the repo
- License tier badge that links to the License settings tab

### Implementation

1. New file `src/features/settings/AboutSettings.tsx` modeled on the other settings sections.
2. Add `{ id: "about", label: "About", icon: <Info size={14} /> }` at the end of `NAV_ITEMS` in `SettingsView.tsx`. Add `"About": "about"` to `TITLE_TO_SECTION`.
3. Render it conditionally below the existing sections.
4. Inject the version at build time. Vite already exposes `import.meta.env`; expose `__APP_VERSION__` via `define` in `vite.config.ts` reading `package.json`.
5. For external links, install `tauri-plugin-opener` (already in the Tauri 2 default scaffold). Wire it up in `src-tauri/src/lib.rs` (`.plugin(tauri_plugin_opener::init())`) and use the JS API:
   ```ts
   import { openUrl } from "@tauri-apps/plugin-opener";
   <button onClick={() => openUrl("https://matija.eu/tools")}>...</button>
   ```
   Plain `<a target="_blank">` won't work — Tauri 2 doesn't navigate external URLs in the webview by default.
6. Surface "About" in the command palette next to the other settings entries.

### Layout sketch

```
┌──────────────────────────────────────────────────┐
│  [icon]  Esploro                                 │
│          0.3.0                                   │
│                                                  │
│  A native macOS database client for PostgreSQL,  │
│  MySQL, and MariaDB.                             │
│                                                  │
│  Built by Matija Munjaković                      │
│  More tools at matija.eu/tools                   │
│  Source on GitHub                                │
│                                                  │
│  ─────────────────────────────────────────────   │
│  License: Personal · Manage →                    │
└──────────────────────────────────────────────────┘
```

Plain text and links. No marketing copy. The license row at the bottom is a courtesy hand-off into the existing License tab.

### Out of scope

- Auto-update copy. We don't have an update channel yet.
- Acknowledgements / third-party licenses page. Worth doing eventually but not blocking on this PRD.
- Sharing / "tweet about Esploro" widgets. No.

---

## Testing

**Themes**

- [ ] Pick each new theme from Appearance settings; the whole app re-skins without reload.
- [ ] Pick each from the command palette; same result.
- [ ] Switch from Tokyo Night → GitHub Dark → Tairiki Dark and back. No leaked tokens (e.g., a Tokyo Night background under a GitHub border).
- [ ] Schema tree icons, type badges, query editor syntax all pick up the new palette.
- [ ] Reset all preferences from Advanced Settings reverts to Tairiki Light.

**Toasts**

- [ ] Trigger 5 toasts in quick succession; only 2 are visible at any moment.
- [ ] The fade-out on the displaced 3rd is smooth (no hard pop).

**Typography**

- [ ] Tabs are visibly smaller and the bar is tighter.
- [ ] The connection name is the most prominent string in the sidebar at a glance.
- [ ] Adjusting the global UI font size in settings still scales body copy, but tab and connection-name sizes hold their relative ratios.

**About**

- [ ] About is the last item in the Settings nav.
- [ ] All three external links open in the system browser.
- [ ] Version matches `package.json`.
- [ ] License badge reflects the current license tier and click-through goes to License settings.
