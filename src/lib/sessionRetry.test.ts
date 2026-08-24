// `withSessionRetry` keeps module-level dedup state (in-flight reconnects and
// the "already toasted" set), so every test re-imports the module — and the
// store alongside it — to start from a clean slate.
const connect = vi.fn<(id: string) => Promise<string>>();

vi.mock("../features/connections/api", () => ({
  connectionsApi: {
    connect: (id: string) => connect(id),
  },
}));

type Toast = (
  message: string,
  variant: "success" | "error" | "info" | "warning",
) => void;

let withSessionRetry: typeof import("./sessionRetry").withSessionRetry;
let useAppStore: typeof import("../store").useAppStore;
// `isSessionNotFound` is an `instanceof` check against a class private to
// `./ipc`, so the error factory must come from the same post-reset instance of
// that module the code under test sees.
let normalizeError: typeof import("./ipc").normalizeError;

beforeEach(async () => {
  vi.resetModules();
  connect.mockReset();
  ({ withSessionRetry } = await import("./sessionRetry"));
  ({ useAppStore } = await import("../store"));
  ({ normalizeError } = await import("./ipc"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function sessionNotFound(message = "session gone") {
  return normalizeError({ kind: "SessionNotFound", message, code: null, position: null });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Silence the deliberate `console.warn` the reconnect path emits. */
function muteReconnectWarning() {
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}

describe("withSessionRetry", () => {
  it("passes the cached session id straight through when one exists", async () => {
    useAppStore.getState().connectSession("conn-1", "sess-1");
    const fn = vi.fn().mockResolvedValue("rows");

    await expect(withSessionRetry("conn-1", fn)).resolves.toBe("rows");
    expect(fn).toHaveBeenCalledExactlyOnceWith("sess-1");
    expect(connect).not.toHaveBeenCalled();
  });

  it("connects first when no session is cached, and records the new session", async () => {
    connect.mockResolvedValue("sess-new");
    const fn = vi.fn().mockResolvedValue("rows");

    await expect(withSessionRetry("conn-1", fn)).resolves.toBe("rows");
    expect(connect).toHaveBeenCalledExactlyOnceWith("conn-1");
    expect(fn).toHaveBeenCalledExactlyOnceWith("sess-new");
    expect(useAppStore.getState().activeSessions["conn-1"]).toBe("sess-new");
  });

  it("propagates a failure to establish the first session", async () => {
    connect.mockRejectedValue(new Error("host unreachable"));
    const fn = vi.fn();

    await expect(withSessionRetry("conn-1", fn)).rejects.toThrow("host unreachable");
    expect(fn).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not SessionNotFound without reconnecting", async () => {
    useAppStore.getState().connectSession("conn-1", "sess-1");
    const fn = vi.fn().mockRejectedValue(new Error("syntax error at or near"));
    const toast = vi.fn<Toast>();

    await expect(withSessionRetry("conn-1", fn, toast)).rejects.toThrow(
      "syntax error at or near",
    );
    expect(connect).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("reconnects and retries once when the session is gone", async () => {
    muteReconnectWarning();
    useAppStore.getState().connectSession("conn-1", "stale");
    connect.mockResolvedValue("fresh");
    const fn = vi
      .fn()
      .mockRejectedValueOnce(sessionNotFound())
      .mockResolvedValueOnce("rows");

    await expect(withSessionRetry("conn-1", fn)).resolves.toBe("rows");
    expect(fn.mock.calls).toEqual([["stale"], ["fresh"]]);
    expect(useAppStore.getState().activeSessions["conn-1"]).toBe("fresh");
  });

  it("does not retry a second time if the retry also reports a dead session", async () => {
    muteReconnectWarning();
    useAppStore.getState().connectSession("conn-1", "stale");
    connect.mockResolvedValue("fresh");
    const fn = vi.fn().mockRejectedValue(sessionNotFound("still gone"));

    await expect(withSessionRetry("conn-1", fn)).rejects.toThrow("still gone");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("toasts the connection's display name after a successful reconnect", async () => {
    muteReconnectWarning();
    useAppStore.getState().setProfiles([
      { id: "conn-1", displayName: "Prod DB" },
    ] as never);
    useAppStore.getState().connectSession("conn-1", "stale");
    connect.mockResolvedValue("fresh");
    const toast = vi.fn<Toast>();

    await withSessionRetry("conn-1", vi.fn().mockRejectedValueOnce(sessionNotFound()), toast);

    expect(toast).toHaveBeenCalledExactlyOnceWith("Reconnected to Prod DB", "success");
  });

  it("falls back to the connection id when no profile matches", async () => {
    muteReconnectWarning();
    useAppStore.getState().connectSession("conn-unknown", "stale");
    connect.mockResolvedValue("fresh");
    const toast = vi.fn<Toast>();

    await withSessionRetry(
      "conn-unknown",
      vi.fn().mockRejectedValueOnce(sessionNotFound()),
      toast,
    );

    expect(toast).toHaveBeenCalledExactlyOnceWith(
      "Reconnected to conn-unknown",
      "success",
    );
  });

  it("wraps a failed reconnect in a user-facing error and toasts it", async () => {
    muteReconnectWarning();
    useAppStore.getState().setProfiles([
      { id: "conn-1", displayName: "Prod DB" },
    ] as never);
    useAppStore.getState().connectSession("conn-1", "stale");
    connect.mockRejectedValue(new Error("connection refused"));
    const toast = vi.fn<Toast>();
    const fn = vi.fn().mockRejectedValue(sessionNotFound());

    await expect(withSessionRetry("conn-1", fn, toast)).rejects.toThrow(
      "Could not reconnect to Prod DB: connection refused",
    );
    expect(toast).toHaveBeenCalledExactlyOnceWith(
      "Could not reconnect to Prod DB: connection refused",
      "error",
    );
    expect(useAppStore.getState().activeSessions["conn-1"]).toBe("stale");
  });

  it("works without a toast callback", async () => {
    muteReconnectWarning();
    useAppStore.getState().connectSession("conn-1", "stale");
    connect.mockResolvedValue("fresh");

    await expect(
      withSessionRetry("conn-1", vi.fn().mockRejectedValueOnce(sessionNotFound())),
    ).resolves.toBeUndefined();

    connect.mockRejectedValue(new Error("nope"));
    await expect(
      withSessionRetry("conn-1", vi.fn().mockRejectedValue(sessionNotFound())),
    ).rejects.toThrow("Could not reconnect to conn-1: nope");
  });

  it("shares one reconnect across concurrent callers", async () => {
    muteReconnectWarning();
    useAppStore.getState().connectSession("conn-1", "stale");
    const gate = deferred<string>();
    connect.mockReturnValue(gate.promise);

    const fn = vi.fn((sessionId: string) =>
      sessionId === "stale"
        ? Promise.reject(sessionNotFound())
        : Promise.resolve(sessionId),
    );

    const a = withSessionRetry("conn-1", fn);
    const b = withSessionRetry("conn-1", fn);
    // Both callers must be parked on the same reconnect before it settles.
    await Promise.resolve();
    gate.resolve("fresh");

    await expect(Promise.all([a, b])).resolves.toEqual(["fresh", "fresh"]);
    // Two initial attempts on the stale session, two retries on the fresh one.
    expect(fn).toHaveBeenCalledTimes(4);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("toasts only once when concurrent callers share a reconnect", async () => {
    muteReconnectWarning();
    useAppStore.getState().connectSession("conn-1", "stale");
    const gate = deferred<string>();
    connect.mockReturnValue(gate.promise);
    const toast = vi.fn<Toast>();

    const fn = (sessionId: string) =>
      sessionId === "stale" ? Promise.reject(sessionNotFound()) : Promise.resolve(sessionId);

    const pending = [
      withSessionRetry("conn-1", fn, toast),
      withSessionRetry("conn-1", fn, toast),
      withSessionRetry("conn-1", fn, toast),
    ];
    await Promise.resolve();
    gate.resolve("fresh");
    await Promise.all(pending);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith("Reconnected to conn-1", "success");
  });

  it("toasts again for a later, separate reconnect", async () => {
    muteReconnectWarning();
    useAppStore.getState().connectSession("conn-1", "stale");
    const toast = vi.fn<Toast>();

    connect.mockResolvedValueOnce("fresh-1");
    await withSessionRetry(
      "conn-1",
      vi.fn().mockRejectedValueOnce(sessionNotFound()),
      toast,
    );

    connect.mockResolvedValueOnce("fresh-2");
    await withSessionRetry(
      "conn-1",
      vi.fn().mockRejectedValueOnce(sessionNotFound()),
      toast,
    );

    expect(toast).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().activeSessions["conn-1"]).toBe("fresh-2");
  });

  it("keeps reconnects for different connections independent", async () => {
    muteReconnectWarning();
    useAppStore.getState().connectSession("conn-1", "stale-1");
    useAppStore.getState().connectSession("conn-2", "stale-2");
    connect.mockImplementation((id) => Promise.resolve(`fresh-${id}`));
    const toast = vi.fn<Toast>();

    await Promise.all([
      withSessionRetry("conn-1", vi.fn().mockRejectedValueOnce(sessionNotFound()), toast),
      withSessionRetry("conn-2", vi.fn().mockRejectedValueOnce(sessionNotFound()), toast),
    ]);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().activeSessions).toMatchObject({
      "conn-1": "fresh-conn-1",
      "conn-2": "fresh-conn-2",
    });
  });
});
