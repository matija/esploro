import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../../components/Toast";
import { AboutSettings } from "../settings/AboutSettings";
import { MenuUpdateCheckListener } from "./MenuUpdateCheckListener";
import { useAppStore } from "../../store";
import type { UpdateInfo } from "./api";

// The two check surfaces share `useUpdateCheckAction`, so both are driven
// against the same fakes: the `check_for_update` command wrapper and the Tauri
// event channel the app menu emits on.
const checkForUpdate = vi.fn<() => Promise<UpdateInfo | null>>();

vi.mock("./api", () => ({
  updatesApi: {
    checkForUpdate: () => checkForUpdate(),
    installUpdate: () => Promise.resolve(),
  },
  // Both surfaces only exist in builds that can self-update; the tests cover
  // that case.
  isSelfUpdateAvailable: () => true,
}));

vi.mock("../license/api", () => ({
  LICENSE_STATUS_KEY: ["license-status"],
  licenseApi: {
    getStatus: () => Promise.resolve({ tier: "Personal" }),
    openUrl: () => Promise.resolve(),
  },
}));

// Minimal stand-in for the Tauri event bus: records handlers by event name so
// tests can emit `menu:check-for-updates` the way the Rust menu item does.
const listeners = new Map<string, Set<() => void>>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: () => void) => {
    const set = listeners.get(name) ?? new Set();
    set.add(handler);
    listeners.set(name, set);
    return Promise.resolve(() => set.delete(handler));
  },
}));

async function emitMenuEvent(name: string) {
  // `onMenuEvent` registers asynchronously; let its `listen` promise settle.
  await waitFor(() => expect(listeners.get(name)?.size).toBeGreaterThan(0));
  for (const handler of [...(listeners.get(name) ?? [])]) handler();
}

const UPDATE: UpdateInfo = { version: "99.0.0", notes: "Shiny new things" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

/**
 * Both surfaces mount `useUpdateChecker`, whose query fires one check on mount.
 * Every scenario starts from that settled "no update" baseline so the assertions
 * describe only the user-triggered check.
 */
async function renderAfterStartupCheck(ui: ReactNode) {
  checkForUpdate.mockResolvedValueOnce(null);
  renderWithProviders(ui);
  await waitFor(() => expect(checkForUpdate).toHaveBeenCalledTimes(1));
  checkForUpdate.mockReset();
}

/** Clicks the About panel's "Check for Updates" button. */
async function clickCheckButton() {
  const user = userEvent.setup();
  const button = await screen.findByRole("button", { name: "Check for Updates" });
  await user.click(button);
}

const aboutPanel = <AboutSettings onNavigateToLicense={() => {}} />;

beforeEach(() => {
  checkForUpdate.mockReset();
  listeners.clear();
  useAppStore.setState({ updateSheetOpen: false });
});

describe.each([
  { surface: "About panel button", trigger: clickCheckButton, ui: aboutPanel },
  {
    surface: "menu:check-for-updates event",
    trigger: () => emitMenuEvent("menu:check-for-updates"),
    ui: <MenuUpdateCheckListener />,
  },
])("update check via $surface", ({ trigger, ui }) => {
  it("reports being up to date when no update is available", async () => {
    await renderAfterStartupCheck(ui);
    checkForUpdate.mockResolvedValue(null);

    await trigger();

    expect(await screen.findByText(`You're up to date — ${__APP_VERSION__}`)).toBeDefined();
    expect(useAppStore.getState().updateSheetOpen).toBe(false);
  });

  it("opens the update sheet when an update is found", async () => {
    await renderAfterStartupCheck(ui);
    checkForUpdate.mockResolvedValue(UPDATE);

    await trigger();

    await waitFor(() => expect(useAppStore.getState().updateSheetOpen).toBe(true));
  });

  it("surfaces an error toast when the check fails", async () => {
    await renderAfterStartupCheck(ui);
    checkForUpdate.mockRejectedValue(new Error("network unreachable"));

    await trigger();

    expect(await screen.findByText(/network unreachable/)).toBeDefined();
    expect(useAppStore.getState().updateSheetOpen).toBe(false);
  });
});

it("ignores a second trigger while a check is already in flight", async () => {
  // Driven through the menu event so both triggers reach the same
  // `useUpdateCheckAction` instance — the in-flight guard is per instance.
  await renderAfterStartupCheck(<MenuUpdateCheckListener />);

  const pending = deferred<UpdateInfo | null>();
  checkForUpdate.mockReturnValue(pending.promise);

  await emitMenuEvent("menu:check-for-updates");
  await waitFor(() => expect(checkForUpdate).toHaveBeenCalledTimes(1));

  await emitMenuEvent("menu:check-for-updates");

  expect(checkForUpdate).toHaveBeenCalledTimes(1);

  pending.resolve(null);
  expect(await screen.findByText(`You're up to date — ${__APP_VERSION__}`)).toBeDefined();
});
