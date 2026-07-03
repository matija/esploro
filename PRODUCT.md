# Product

## Register

product

## Users

Developers and engineers on macOS who work with PostgreSQL, MySQL, or MariaDB daily — browsing schemas, inspecting table data, writing SQL, checking roles and permissions. They live in fast native tools (editors, terminals) and open Esploro mid-task; the primary job on any screen is "get to my data quickly and act on it without friction."

## Product Purpose

Esploro is a modern, sleek, fast SQL client for Mac (Tauri 2: Rust backend, React frontend). It exists to feel local, quick, and focused — a lightweight alternative to heavy enterprise database tools. Success looks like: instant startup, dense-but-legible data grids, keyboard-first workflows, and an interface that stays out of the way of the SQL.

## Brand Personality

Fast, focused, native. The tone is quiet confidence — the app proves itself through speed and precision, not decoration. References: **TablePlus** (native-feeling, dense, fast Mac database client) and **Linear** (keyboard-first, crisp, restrained product polish).

## Anti-references

- **pgAdmin / DBeaver**: heavy, cluttered enterprise tooling with toolbar sprawl and dialog mazes.
- **Generic SaaS web app**: cards, drop shadows, marketing gradients, and web-app chrome inside what should feel like a native desktop tool.

## Design Principles

1. **Data is the interface** — grids, trees, and query results get the space and contrast; chrome recedes.
2. **Density with legibility** — professional-tool density (compact rows, monospace where it earns it), never at the cost of scannability.
3. **Keyboard-first, mouse-friendly** — every core workflow reachable without the mouse; visible affordances still exist.
4. **Mac-native conventions win** — system materials, familiar spacing, light/dark parity (the Tairiki token system), no web-app idioms.
5. **Speed is a feature** — no blocking spinners where optimistic or incremental rendering works; motion is minimal and functional.

## Accessibility & Inclusion

Sensible defaults: WCAG AA contrast for text, `prefers-reduced-motion` respected, full keyboard operability for core workflows. No stricter audit-level requirement.
