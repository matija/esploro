import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LicenseStatus, LicenseTier } from "./types";
import { renderWithProviders } from "../../test/renderWithProviders";
import { useAppStore } from "../../store";
import { LicenseBanner } from "./LicenseBanner";
import { LicenseSettings } from "./LicenseSettings";

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

function renderSettings() {
  const user = userEvent.setup();
  renderWithProviders(<LicenseSettings />);
  return user;
}

beforeAll(() => {
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
      await screen.findByText("Personal use is free. Commercial use requires a license."),
    ).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Purchase license" }));
    expect(openPricingPage).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Activate license" }));
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

    const { user } = renderBanner();

    expect(await screen.findByText(/License re-validation required/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Re-enter key" })).toBeDefined();
    // Re-validation outranks the purchase reminder: neither it nor the dismiss
    // affordance is offered, because the banner cannot be dismissed away.
    expect(screen.queryByRole("button", { name: "Purchase license" })).toBeNull();
    expect(screen.queryByTitle("Dismiss")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Re-enter key" }));
    expect(await screen.findByRole("dialog")).toBeDefined();
  });

  it("asks for re-validation even when the banner itself is not flagged", async () => {
    status = licenseStatus({ tier: "Commercial", revalidationRequired: true });

    renderBanner();

    expect(await screen.findByText(/License re-validation required/)).toBeDefined();
  });
});

describe("license settings", () => {
  it.each<LicenseTier>(["Personal", "Commercial"])(
    "shows a %s license and opens activation",
    async (tier) => {
      status = licenseStatus({ tier });
      const user = renderSettings();

      expect(await screen.findByText(tier === "Personal" ? "Personal (free)" : "Commercial")).toBeDefined();
      await user.click(screen.getByRole("button", {
        name: tier === "Personal" ? "Activate a license key" : "Enter a different key",
      }));
      expect(await screen.findByRole("dialog")).toBeDefined();
    },
  );

  it("shows how long a licence with a grace period is valid for", async () => {
    status = licenseStatus({ tier: "Commercial", gracePeriodEnds: "2026-11-30T00:00:00Z" });
    renderSettings();

    const expected = new Date("2026-11-30T00:00:00Z").toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric",
    });
    expect(await screen.findByText(`Valid through ${expected}`)).toBeDefined();
  });

  it("shows purchase and activation controls for an unlicensed install", async () => {
    const user = renderSettings();

    expect(await screen.findByText("No license")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Purchase license →" }));
    expect(openPricingPage).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Activate a license key" }));
    expect(await screen.findByRole("dialog")).toBeDefined();
  });

  it("waits for the status before displaying a licence", () => {
    renderSettings();
    expect(screen.queryByText("No license")).toBeNull();
    expect(screen.queryByText("Commercial")).toBeNull();
  });
});
