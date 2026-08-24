# Measurement protocol

A perf change is only worth keeping if it moved a number. This is the protocol for
producing that number: which four interactions to time, what to time them with,
and where to write the result down.

It assumes the fixtures from [README.md](README.md) are loaded. Every interaction
below names the fixture it runs against, and every one of them is chosen because
it is slow enough on those fixtures to be readable without a stopwatch.

## Before you record anything

- **Run the app in dev** (`npm run tauri dev`). The web inspector is only attached
  to debug builds. Numbers from a dev build are not release numbers — they are
  comparable to *other dev builds*, which is all this protocol claims.
- **Pin the settings that change the shape of the work.** Defaults are row density
  `compact`, page size `200`, show total count `on`
  (`src/features/settings/preferences.ts:82`). Note any deviation in the results
  table; a page size of 500 is a different measurement, not a slower one.
- **Warm the connection.** The first query on a fresh session pays for pool setup
  and the server's own cold caches. Open the table, close the tab, then start
  measuring.
- **Quiet the machine.** No builds, no Docker image pulls, no Time Machine. A
  background `cargo build` moves these numbers more than most of the changes you
  will be measuring.
- **Take five runs, report the median.** Discard the first. Record the spread if
  the runs disagree by more than ~20% — a wide spread usually means you measured
  the machine, not the app.

## The two instruments

### `execution_ms` — server-side query time

Every query result carries an `executionMs`. It is a wall clock around the driver
call and nothing else: `let start = Instant::now()` immediately before
`client.query(...)`, read immediately after
(`src-tauri/src/commands/data/table_query_execution.rs:157`). It therefore
**includes** query planning and execution on the server plus the wire time for
the rows, and **excludes**:

- acquiring a pooled connection
- decoding rows into `CellValue`s
- the count query, which is a separate round trip with its own timing
- serialising over Tauri IPC
- everything React does afterwards

Read it off the UI without opening anything:

| Surface | Where |
| --- | --- |
| Table viewer footer | `… ms` beside the row range (`src/features/table-viewer/TableViewerFooter.tsx:48`) |
| Status bar, right side | Last action's duration (`src/components/AppShell.tsx:113`) |
| Query editor | Per-result and summed across statements (`src/features/query-editor/QueryEditorTab.tsx:409`) |

`execution_ms` is the denominator for every frontend perf claim. If it is 900 ms
and the interaction takes 950 ms, there is nothing in the frontend to fix.

### Web inspector Timelines — everything else

Esploro is a WKWebView on macOS, so the performance panel is **Safari's Web
Inspector, Timelines tab** — not Chrome DevTools. Right-click anywhere in the
window and choose *Inspect Element* to attach it.

Enable exactly three timelines and turn the rest off; each one you leave on adds
its own overhead to what you are measuring:

- **JavaScript & Events** — the click handler, the query callback, the React
  render.
- **Layout & Rendering** — the layout and paint records that end the interaction.
- **Screenshots** — the ground truth for "painted". When the numbers and your
  eyes disagree, the filmstrip settles it.

Recording one interaction:

1. Put the app in the state *just before* the interaction (table open, node
   collapsed, sitting on page 0).
2. Start recording.
3. Perform the single interaction. Nothing else — no scrolling, no hovering over
   tooltips.
4. Stop recording as soon as the result is on screen.
5. Select the range from the mouse/keyboard event that starts it to the last
   paint record, and read the selection duration off the ruler.

That selection duration is the **wall time** for the interaction. The difference
between it and `execution_ms` is the part this codebase owns:

```
frontend_ms = wall_ms − execution_ms
```

`frontend_ms` is the number a frontend perf task has to move. Record all three so
the subtraction is visible and a regression in the wrong column is obvious.

## The four interactions

### 1. First page paint

**Fixture:** `bench.wide` (128 columns × 50,000 rows).
**Setup:** connection open, schema tree expanded to the table, no tab for it open.
**Start:** the click on `wide` in the schema tree.
**Stop:** the first frame showing rendered cells, not the loading state.

The one that covers the most ground: column metadata fetch, the data query, row
decode, initial column sizing, and the first virtualised render of a grid too wide
to fit. Expect the count query to land alongside it — with no filters it takes the
`reltuples` fast path
(`src-tauri/src/commands/data/table_query_execution.rs:196`), so it should be
cheap. If the footer's total arrives visibly later than the rows, that is a
finding worth its own row in the table.

### 2. Page change

**Fixture:** `bench.tall` (10,000,000 rows), sitting on page 0.
**Setup:** table open, first page already painted, no sort, no filters.
**Start:** the click on *Next →* in the footer.
**Stop:** the frame showing the new page's rows.

The cheapest of the four on the server — `LIMIT 200 OFFSET 200` off the front of
the table — which makes it the most sensitive to frontend cost. A page change
that spends more than a few tens of milliseconds in `frontend_ms` is re-rendering
something it should not.

### 3. Deep-page jump

**Fixture:** `bench.tall`.
**Setup:** as above.
**Start / stop:** same as the page change.

The grid pages with `LIMIT … OFFSET …`
(`src-tauri/src/commands/data/table_queries.rs:84`), and the server's cost for
that grows with the offset — page 40,000 makes PostgreSQL walk 8,000,000 rows it
then throws away. There is no jump-to-page control in the footer, so reach a deep
page one of two ways:

- **Through the UI**, by sorting descending and taking the last page, which
  exercises the real code path.
- **Through the query editor**, running the same shape the grid builds:

  ```sql
  SELECT * FROM bench.tall ORDER BY id ASC LIMIT 200 OFFSET 8000000;
  ```

  This gives you `execution_ms` alone with no frontend attached, which is the
  point: it isolates how much of the deep-page cost is the database's and
  therefore not fixable from the frontend.

Record both numbers when they differ. This interaction exists to keep anyone from
"optimising" an offset scan in React.

### 4. Node expand

**Fixture:** `bench_many` (2,000 tables + 1,000 views + 500 sequences).
**Setup:** schema tree showing `bench_many`, collapsed.
**Start:** the click on the disclosure triangle.
**Stop:** the frame showing the expanded children.

The tree loads lazily — a level fetches only once it is expanded, and the result
is cached so collapsing and re-expanding replays it rather than refetching
(`src/features/schema/SchemaTree.test.tsx:265`). That gives three distinct
measurements, and they should be recorded separately:

| Case | What it costs |
| --- | --- |
| First expand of `bench_many` | `listObjects` over 3,500 objects, plus the render |
| Re-expand after collapse | Render only — cache hit, no round trip |
| First expand of one table | `listColumns` for that table |

`listObjects` returns no `executionMs` (`src/features/schema/api.ts:17`), so for
this interaction the inspector is the only instrument. Leave the `execution_ms`
column empty rather than guessing; the wall time *is* the number here.

## Results table

Copy this into the perf task before touching any code, fill the *before* rows,
then fill the *after* rows from an otherwise identical run. Both halves must come
from the same machine in the same session — a "before" from yesterday's laptop
state is not a baseline.

**Environment**

| | |
| --- | --- |
| Date | |
| Machine / OS | |
| Build | `npm run tauri dev` @ `<commit>` |
| Engine | PostgreSQL 16 in Docker / … |
| Fixture sizes | defaults / … |
| Page size, density, total count | 200, compact, on |

**Measurements** — median of 5, first run discarded, all values in ms.

| # | Interaction | Fixture | `execution_ms` | Wall | `frontend_ms` |
| --- | --- | --- | --- | --- | --- |
| 1 | First page paint | `bench.wide` | | | |
| 2 | Page change (0 → 1) | `bench.tall` | | | |
| 3 | Deep-page jump (offset 8M) | `bench.tall` | | | |
| 3b | Same offset, query editor only | `bench.tall` | | — | — |
| 4a | Node expand, first | `bench_many` | — | | |
| 4b | Node expand, cached | `bench_many` | — | | |
| 4c | Column expand, first | `bench_many` | — | | |

Duplicate the block for *after*, and add a one-line verdict per row: what moved,
what did not, and whether anything got worse. A perf task that improves one row
and silently regresses another has not been measured, only celebrated.
