# App Store Connect Metadata

Direct copy of the text content from PRD §P3 — Store Listing Assets so the
App Store Connect form can be filled in from this file alone. Update both
this file and the PRD if either drifts.

## Identification

| Field | Limit | Value |
|---|---|---|
| Name | 30 chars | `Esploro` |
| Subtitle | 30 chars | `Postgres & MySQL Client` |
| Bundle ID | — | `app.esploro` |
| Primary Category | — | Developer Tools |
| Pricing | — | Free download (in-app purchase for commercial use) |

## Keywords

100-character limit, comma-separated, no spaces (App Store counts spaces).

```
postgres,mysql,sql,database,query,client,developer,db,schema,postgresql
```

## URLs

| Field | Value |
|---|---|
| Privacy policy | https://esploro.app/privacy |
| Terms of use | https://esploro.app/terms |
| Support URL | https://esploro.app |
| Support email | support@tandoku.hr |
| Marketing URL (optional) | https://esploro.app |

## Description

Use as-is. Paragraphs are separated by blank lines; bold markers in the App
Store are not rendered as markdown, so the `**` prefixes act as label cues
that read naturally even as plain text.

```
Esploro is a native Mac database client for PostgreSQL and MySQL. Built for developers who want to move fast without a cluttered UI.

Browse and filter data — Open any table, sort by any column, and apply filters across multiple column types including UUIDs, timestamps, booleans, and more. Pagination keeps large tables fast.

Write and run queries — A Monaco-powered SQL editor with syntax highlighting, keyboard-driven execution, and per-tab result sets. Export results as CSV.

Explore your schema — Browse tables, views, columns, types, indexes, and foreign keys in the schema panel without writing a single query.

Multiple connections — Manage all your databases from one window. Colour-coded connection tabs.

Esploro is free for personal use. Commercial use requires a license — available as a one-time purchase or annual subscription.
```

## Version release notes (1.0)

First Mac App Store release. Features parity with the existing GitHub
Releases / Homebrew build, with these MAS-specific differences:

- Licensing via Mac App Store In-App Purchase (Personal Lifetime, Personal
  Annual, Business Annual). The Direct build's license-key flow is not
  used on MAS.
- Auto-updater disabled (App Store handles updates).
- Sandboxed; only outbound TCP entitlement (`com.apple.security.network.client`)
  is requested — required to reach PostgreSQL / MySQL servers.
- Flat sidebar instead of the Direct build's frosted-glass vibrancy
  (private API not allowed in App Store submissions).

## In-App Purchase products

Mirror of the table in PRD §IAP Products. All three resolve to
`LicenseTier::Commercial`; the app does not gate features between them.

| Product ID | Type | Price | Intended for |
|---|---|---|---|
| `app.esploro.personal.lifetime` | Non-consumable | $129 | Individual commercial use, one-time |
| `app.esploro.personal.annual` | Auto-renewable subscription | $49/yr | Individual commercial use, subscription |
| `app.esploro.business.annual` | Auto-renewable subscription | $79/yr | Business / company |

## Age rating

4+ (no objectionable content; no user-generated content; no third-party ads).

## App Review notes

> Esploro connects to PostgreSQL and MySQL databases over outbound TCP only
> (`com.apple.security.network.client` entitlement). It does not host a
> server, does not collect telemetry, and does not require an account. To
> exercise the commercial-license code path during review, use one of the
> sandbox IAP products listed above. Personal use is free and does not
> require any purchase to test the core features (connection management,
> schema browsing, table viewer, SQL editor).
