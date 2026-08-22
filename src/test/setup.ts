/// <reference types="vitest/globals" />

// Runs before every test file (wired up via `test.setupFiles` in vite.config.ts).
// Unmounts anything React Testing Library rendered so each test starts from a
// clean DOM — jsdom reuses the same document across tests in a file.
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
