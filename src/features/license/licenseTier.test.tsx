import { QueryClientProvider } from "@tanstack/react-query";
import * as Tooltip from "@radix-ui/react-tooltip";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LicenseStatus, LicenseTier } from "./types";
import { createTestQueryClient, renderWithProviders } from "../../test/renderWithProviders";
import { useAppStore } from "../../store";
import { LicenseBanner } from "./LicenseBanner";
import { AppShell } from "../../components/AppShell";

// The two tier-driven surfaces — the bottom banner and the toolbar badge — both
// read the same `license-status` query, so every scenario is expressed as one
// `LicenseStatus` fixture served by a stubbed `./api`. Stubbing the feature api
// (rather than the invoke layer) keeps the fixture the single input: what the
// query resolves to is exactly what the components render from.
let status: LicenseStatus;

const dismissBanner = vi.fn(() => Promise.resolve());
const openPricingPage = vi.fn(() => Promise.resolve());
const openCustomerPortal = vi.fn(() => Promise.resolve());
const openUrl = vi.fn(() => Promise.resolve());

vi.mock("./api", () => ({
  LICENSE_STATUS_KEY: ["license-status"],
  licenseApi: {
    getStatus: () => Promise.resolve(status),
    // The shell reports its connection count on mount and writes the answer
    // into the same cache entry; echoing the fixture keeps the tier stable.
    notifyConnectionCount: () => Promise.resolve(status),
    activate: () => Promise.resolve(status),
    deactivate: () => Promise.resolve(status),
    answerUsageDialog: () => Promise.resolve(status),
    dismissBanner: () => dismissBanner(),
    openPricingPage: () => openPricingPage(),
    openCustomerPortal: () => openCustomerPortal(),
    openUrl: () => openUrl(),
  },
}));

// The badge only exists inside the shell's toolbar, and the shell mounts the
// sidebar, tab bar and updates alongside it. Faking the generated bindings once
// stands all of that up without a mock per feature.
vi.mock("../../lib/bindings", async () => ({
  commands: (await import("../../test/fakeBindings")).createFakeCommands(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

function licenseStatus(overrides: Partial<LicenseStatus> = {}): LicenseStatus {
  return {
    tier: "Unlicensed",
    bannerVisible: false,
    gracePeriodEnds: null,
    showUsageDialog: false,
    revalidationRequired: false,
    ...overrides,
  };
}

function renderBanner() {
  const user = userEvent.setup();
  return { user, ...renderWithProviders(<LicenseBanner />) };
}

/** Mounts the whole shell; the toolbar badge is the surface under test. */
function renderShell() {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <Tooltip.Provider delayDuration={500}>
        <AppShell />
      </Tooltip.Provider>
    </QueryClientProvider>,
  );
  return user;
}

beforeAll(() => {
  // Radix popovers position through floating-ui, which observes its elements.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
});

beforeEach(() => {
  status = licenseStatus();
  dismissBanner.mockClear();
  openPricingPage.mockClear();
  useAppStore.setState({
    tabs: [],
    activeTabId: null,
    profiles: [],
    activeSessions: {},
    commandPaletteOpen: false,
  });
});

// ─── Banner ──────────────────────────────────────────────────────────────────

describe("license banner", () => {
  it.each<LicenseTier>(["Personal", "Commercial"])(
    "stays hidden for a %s license the backend has not flagged",
    async (tier) => {
      status = licenseStatus({ tier });

      renderBanner();

      // Nothing to wait for when the banner is correctly absent, so settle the
      // status query first and then assert on the quiet DOM.
      await waitFor(() => expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull());
      expect(screen.queryByText(/Commercial use requires a license/)).toBeNull();
      expect(screen.queryByText(/re-validation required/i)).toBeNull();
    },
  );

  it("prompts an unlicensed user to buy or activate when the backend raises it", async () => {
    status = licenseStatus({ tier: "Unlicensed", bannerVisible: true });

    const { user } = renderBanner();

    expect(
      await screen.findByText("Esploro is free for personal use. Commercial use requires a license."),
    ).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Purchase license" }));
    expect(openPricingPage).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "I have a license key" }));
    expect(await screen.findByRole("dialog")).toBeDefined();
  });

  it("dismisses the reminder banner and refetches the status", async () => {
    status = licenseStatus({ tier: "Personal", bannerVisible: true });

    // Dismissal is recorded by the backend, so the status the banner
    // invalidates and refetches afterwards is the one that hides it.
    dismissBanner.mockImplementationOnce(() => {
      status = licenseStatus({ tier: "Personal" });
      return Promise.resolve();
    });

    const { user } = renderBanner();

    await user.click(await screen.findByTitle("Dismiss"));
    expect(dismissBanner).toHaveBeenCalledTimes(1);

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Purchase license" })).toBeNull(),
    );
  });

  it("asks a stale commercial license to re-validate instead of showing the reminder", async () => {
    status = licenseStatus({
      tier: "Commercial",
      bannerVisible: true,
      revalidationRequired: true,
    });

    renderBanner();

    expect(await screen.findByText(/License re-validation required/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Re-enter key" })).toBeDefined();
    // Re-validation outranks the purchase reminder: neither it nor the dismiss
    // affordance is offered, because the banner cannot be dismissed away.
    expect(screen.queryByRole("button", { name: "Purchase license" })).toBeNull();
    expect(screen.queryByTitle("Dismiss")).toBeNull();
  });

  it("asks for re-validation even when the banner itself is not flagged", async () => {
    status = licenseStatus({ tier: "Commercial", revalidationRequired: true });

    renderBanner();

    expect(await screen.findByText(/License re-validation required/)).toBeDefined();
  });
});

// ─── Toolbar badge ───────────────────────────────────────────────────────────

describe("toolbar license badge", () => {
  it.each<LicenseTier>(["Personal", "Commercial"])(
    "labels a %s license as active and opens its details",
    async (tier) => {
      status = licenseStatus({ tier });

      const user = renderShell();

      const trigger = await screen.findByRole("button", { name: tier });
      expect(trigger.getAttribute("title")).toBe(`${tier} license active`);

      await user.click(trigger);

      expect(await screen.findByText(`${tier} license`)).toBeDefined();
      expect(screen.getByText("License active")).toBeDefined();
      // A licensed badge is informational — it opens a popover, not a tab.
      expect(useAppStore.getState().tabs).toEqual([]);

      await user.click(screen.getByRole("button", { name: "Manage license…" }));
      expect(useAppStore.getState().tabs).toMatchObject([
        { type: "settings", title: "Licensing" },
      ]);
    },
  );

  it("shows how long a licence with a grace period is valid for", async () => {
    status = licenseStatus({
      tier: "Commercial",
      gracePeriodEnds: "2026-11-30T00:00:00Z",
    });

    const user = renderShell();

    await user.click(await screen.findByRole("button", { name: "Commercial" }));

    const expected = new Date("2026-11-30T00:00:00Z").toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    expect(await screen.findByText(`Valid through ${expected}`)).toBeDefined();
  });

  it("marks an unlicensed install and jumps straight to licence settings", async () => {
    status = licenseStatus({ tier: "Unlicensed" });

    const user = renderShell();

    // The unlicensed badge is wrapped in a click target that opens settings, so
    // it is addressed by its tooltip rather than by role.
    const trigger = await screen.findByTitle("No active license");

    await user.click(trigger);

    // No details to show without a licence: the badge is a shortcut instead.
    expect(screen.queryByText("Unlicensed license")).toBeNull();
    expect(useAppStore.getState().tabs).toMatchObject([
      { type: "settings", title: "Licensing" },
    ]);
  });

  it("falls back to unlicensed while the status is still loading", () => {
    renderShell();

    // First paint, before the status query resolves: no licence is assumed.
    expect(screen.getByTitle("No active license").textContent).toBe("Unlicensed");
  });
});
