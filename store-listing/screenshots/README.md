# Screenshots — Pending Manual Capture

App Store Connect requires a minimum of three screenshots per size set,
maximum of ten. These cannot be reasonably scripted because they require
real database content, a configured connection, and a running app
window — capture them by hand against the Direct build (the visible UI is
identical to the MAS build except for the sidebar vibrancy, which is
irrelevant to App Review).

## Required size sets

| Display | Resolution | Required |
|---|---|---|
| MacBook Pro 14" / 16" | 2880×1800 or 1440×900 | Yes |
| MacBook Air / Pro 13" | 2560×1600 or 1280×800 | Recommended |

## Suggested shots (in App Store gallery order)

1. **Connection manager** — sidebar list with at least two saved connections,
   one connection active (green dot), the connection form open with a
   realistic-looking host/port/database/user filled in.
2. **Table browser** — a populated table loaded into the table viewer,
   sorted by one column, with one column filter applied (e.g. `status = ...`).
   Pick a table that includes a UUID column and a `created_at` timestamp so
   the typed-cell rendering is visible.
3. **Query editor** — a non-trivial SQL query (a join with `ORDER BY` and
   `LIMIT`) with the result panel showing rows below. Use the Tokyo Night
   theme — it's the default for new installs.
4. **Schema browser** — a deeply expanded schema tree (database → schema →
   tables → one expanded table showing column types).
5. **Settings / dark theme** — Appearance section visible, theme picker open,
   demonstrating the available themes.

## Capture tips

- Resize the window to one of the required resolutions before capturing
  (use `osascript` or Rectangle to set window size programmatically).
- Use macOS Screenshot (`⌘⇧4`, then space → click window) and crop tightly.
- Disable any system overlays (notifications, Stage Manager bezel) before
  capturing.
- Save as PNG; App Store Connect accepts PNG and JPEG, PNG preserves text
  edges better.
- File-name convention: `01-connections.png`, `02-table-browser.png`,
  `03-query-editor.png`, `04-schema-browser.png`, `05-settings.png` —
  numeric prefix preserves gallery order during upload.

Place captured files directly in this directory.
