import { useAppStore } from "./index";

// `expandedNodes` (schema-browser expansion state) is persisted to
// localStorage and grows with every node a user expands across every
// connection. Without a cap it would grow unboundedly, so the store trims it
// to MAX_EXPANDED_NODES (see index.ts) both when toggling nodes and when
// persisting/rehydrating, in case an older, uncapped blob is already on disk.
const STORAGE_KEY = "esploro-ui";
const MAX_EXPANDED_NODES = 200;

function seedPersistedExpandedNodes(count: number) {
  const expandedNodes: Record<string, true> = {};
  for (let i = 0; i < count; i++) {
    expandedNodes[`node-${i}`] = true;
  }
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      state: { expandedNodes, sidebarWidth: 240, theme: "tairiki-dark", recentObjects: [] },
      version: 0,
    }),
  );
}

describe("expandedNodes eviction", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({ expandedNodes: {} });
  });

  it("evicts the oldest node once toggling exceeds the cap", () => {
    useAppStore.setState({ expandedNodes: {} });
    for (let i = 0; i < MAX_EXPANDED_NODES; i++) {
      useAppStore.getState().toggleNode(`node-${i}`);
    }
    expect(Object.keys(useAppStore.getState().expandedNodes)).toHaveLength(MAX_EXPANDED_NODES);
    expect(useAppStore.getState().expandedNodes["node-0"]).toBe(true);

    // One more expansion should push the total over the cap and evict the LRU entry.
    useAppStore.getState().toggleNode("node-overflow");

    const state = useAppStore.getState().expandedNodes;
    expect(Object.keys(state)).toHaveLength(MAX_EXPANDED_NODES);
    expect(state["node-0"]).toBeUndefined();
    expect(state["node-overflow"]).toBe(true);
    expect(state["node-1"]).toBe(true);
  });

  it("holds the cap across rehydration even if the persisted blob was written before the cap existed", async () => {
    seedPersistedExpandedNodes(MAX_EXPANDED_NODES + 50);

    await useAppStore.persist.rehydrate();

    const rehydrated = useAppStore.getState().expandedNodes;
    expect(Object.keys(rehydrated)).toHaveLength(MAX_EXPANDED_NODES);
    // Trimming keeps the most-recently-inserted (highest-index) keys.
    expect(rehydrated["node-49"]).toBeUndefined();
    expect(rehydrated["node-50"]).toBe(true);
    expect(rehydrated[`node-${MAX_EXPANDED_NODES + 49}`]).toBe(true);
  });

  it("re-persists a trimmed blob so the on-disk copy never exceeds the cap", () => {
    useAppStore.setState({ expandedNodes: {} });
    for (let i = 0; i < MAX_EXPANDED_NODES + 10; i++) {
      useAppStore.getState().toggleNode(`node-${i}`);
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string);
    expect(Object.keys(persisted.state.expandedNodes)).toHaveLength(MAX_EXPANDED_NODES);
  });
});
