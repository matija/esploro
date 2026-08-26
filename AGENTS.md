# AGENTS.md

## Before committing

Run the local verification suite and make sure it passes:

```sh
npm run verify
```

This chains `type-check` (`tsc --noEmit`), `lint` (`eslint .`), and `test` (`vitest run`). Run it after making changes and before committing — do not rely solely on CI to catch these.
