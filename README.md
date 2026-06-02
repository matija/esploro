# Esploro

Modern, sleek, fast SQL client for Mac.

Esploro is an open source database client for PostgreSQL, MySQL, and MariaDB. It is built to feel local, quick, and focused, without the cruft of heavier database tools.

[Website](https://esploro.app) · [Download](https://github.com/matija/esploro/releases)

## Features

- Browse connections, schemas, tables, views, sequences, and roles
- Inspect table data in a fast grid
- Write and run SQL
- Filter tables and copy the generated SQL
- Save queries for repeated work
- Review roles and permissions

## Download

Esploro supports macOS 13 or later. Apple Silicon and Intel builds are available on [GitHub Releases](https://github.com/matija/esploro/releases).

Linux and Windows builds are planned.

## Development

Esploro uses [Tauri 2](https://tauri.app/), Rust, React, and TypeScript.

```sh
npm install
npm run tauri dev
```

Useful commands:

```sh
npm run type-check
npm run lint
npm run build
npm run tauri build
```

## License

The source code is MIT licensed. The app is free for personal use; commercial use requires a license.
