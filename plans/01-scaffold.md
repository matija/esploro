# Phase 01 — Project Scaffold

**Goal:** A running Tauri app with the full macOS shell in place. No real database logic yet — just the skeleton every subsequent phase hangs on.

**Done when:**
- `cargo tauri dev` boots without errors on Apple Silicon.
- Window looks macOS-native: traffic lights, vibrancy sidebar, correct title bar.
- Sidebar and main content area are in place with placeholder content.
- Tab bar above the main area supports opening/closing tabs.
- Design token CSS loads; light/dark mode switching works automatically.
- `⌘K` opens a command palette stub (empty list, closes on Esc).
- CI: `cargo clippy`, `cargo test`, `tsc --noEmit`, `eslint` all pass.

---

## 1.1 Init project

```bash
cargo install tauri-cli
npm create tauri-app@latest esploro -- --template react-ts
cd esploro
```

Tauri config (`src-tauri/tauri.conf.json`) changes:
```json
{
  "app": {
    "windows": [{
      "title": "Esploro",
      "width": 1200,
      "height": 780,
      "minWidth": 900,
      "minHeight": 600,
      "titleBarStyle": "Overlay",        // macOS native traffic lights
      "hiddenTitle": true,
      "vibrancy": "sidebar"              // NSVisualEffectView on the sidebar
    }]
  }
}
```

Set `"vibrancy": "under-window"` for the full window if the design calls for it; `"sidebar"` is more conservative and closer to Finder/Mail.

---

## 1.2 Frontend dependencies

```bash
npm install \
  @radix-ui/react-dialog \
  @radix-ui/react-dropdown-menu \
  @radix-ui/react-tooltip \
  @radix-ui/react-separator \
  @radix-ui/react-scroll-area \
  @tanstack/react-query \
  @tanstack/react-virtual \
  @tanstack/react-table \
  zustand \
  lucide-react \
  clsx \
  tailwind-merge

npm install -D tailwindcss @tailwindcss/vite autoprefixer
```

---

## 1.3 Tailwind + design tokens

`src/styles/tokens.css` — macOS semantic colors as CSS variables:

```css
:root {
  --color-label:              rgba(0,0,0,0.85);
  --color-secondary-label:    rgba(0,0,0,0.50);
  --color-separator:          rgba(0,0,0,0.10);
  --color-sidebar-bg:         rgba(246,246,246,0.72);  /* matches vibrancy */
  --color-content-bg:         #ffffff;
  --color-control-bg:         rgba(0,0,0,0.06);
  --color-accent:             #007AFF;  /* macOS blue */
  --color-destructive:        #FF3B30;
  --font-ui:                  -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
  --font-mono:                "SF Mono", "Menlo", monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-label:              rgba(255,255,255,0.85);
    --color-secondary-label:    rgba(255,255,255,0.50);
    --color-separator:          rgba(255,255,255,0.10);
    --color-sidebar-bg:         rgba(30,30,30,0.72);
    --color-content-bg:         #1e1e1e;
    --color-control-bg:         rgba(255,255,255,0.06);
  }
}
```

Tailwind config extends these tokens so `bg-sidebar`, `text-label`, etc. are available as utility classes.

---

## 1.4 Layout components

### AppShell (`src/components/AppShell.tsx`)
```
┌─────────────────────────────────────────────────┐
│  [traffic lights]  [toolbar area]               │  ← titlebar height 38px
├──────────┬──────────────────────────────────────┤
│          │  [tab bar]                            │
│ Sidebar  ├──────────────────────────────────────┤
│  (240px) │                                      │
│          │  Main Content (active tab)            │
│          │                                      │
└──────────┴──────────────────────────────────────┘
```

- Sidebar has `backdrop-filter: blur(20px)` + `background: var(--color-sidebar-bg)` to mimic vibrancy in the WebView layer.
- Sidebar is resizable via drag handle (min 180px, max 320px); width persisted to Zustand → localStorage.
- Tab bar (`src/components/TabBar.tsx`): horizontal list of closeable tabs. State in Zustand (`tabsSlice`). Each tab has `{ id, type: 'table' | 'query', title, sessionId, ... }`.

### SidebarSection (`src/components/SidebarSection.tsx`)
Collapsible section with disclosure arrow. Used for Connections, Saved Queries sections.

### CommandPalette (`src/components/CommandPalette.tsx`)
Radix Dialog, triggered by `useHotkeys('meta+k')`. Renders a filtered list of `Command` items (stub in phase 01, populated in later phases). Keyboard-navigable with arrow keys + Enter.

---

## 1.5 Rust scaffold

`src-tauri/src/main.rs` — minimal:
```rust
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Create module stubs (`src-tauri/src/commands/`) for:
- `mod connections;`
- `mod schema;`
- `mod data;`
- `mod license;`

Add `Cargo.toml` dependencies (non-DB for now):
```toml
[dependencies]
tauri = { version = "2", features = ["macos-private-api"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
keyring = "2"
uuid = { version = "1", features = ["v4"] }
tokio = { version = "1", features = ["full"] }
```

---

## 1.6 CI

`.github/workflows/ci.yml`:
- `cargo clippy -- -D warnings`
- `cargo test`
- `npm run type-check` (`tsc --noEmit`)
- `npm run lint` (ESLint)
- Build step: `cargo tauri build` on `macos-latest` runner.

---

## Acceptance checklist

- [ ] `cargo tauri dev` starts in < 10s on M-series.
- [ ] Traffic light buttons visible and functional.
- [ ] Sidebar vibrancy effect renders (blurred background behind sidebar when window is inactive).
- [ ] Light/dark mode toggles automatically when system preference changes.
- [ ] Tab bar renders placeholder tabs; tabs open/close with ⌘T / ⌘W.
- [ ] ⌘K opens palette; Esc closes it.
- [ ] No TypeScript errors, no Clippy warnings.
